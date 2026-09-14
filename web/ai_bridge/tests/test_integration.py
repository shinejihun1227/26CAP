"""Synthetic inputs test integration only; not clinical accuracy or calibration."""
import copy
import json
import math
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from web.ai_bridge.server import BridgeState, FootRuntime, ARTIFACT_DIR, TimeResampler, vector
from fog_validation.ml.live_detector import load_axis_calibration
import numpy as np

CAL = {'vertical_channel':'raw_acc_z', 'vertical_sign':-1, 'forward_channel':'raw_acc_x',
       'lateral_channel':'raw_acc_y', 'vertical_confidence':0.9, 'forward_confidence':0.8,
       'zscore_mean_vfl':[-1,0,0], 'zscore_std_vfl':[0.15,0.2,0.1], 'gyro_yaw_channel':None,
       'test_only':True}


def frame(i, side='right', step=1000/64, **extra):
    t = i * step / 1000
    return {'frame':i, 'millis':i*step, 'boot_id':'test-boot', 'device_id':f'test-{side}', 'foot_side':side,
            'imu_ready':True, 'accel':{'x':0.2*math.sin(2*math.pi*1.5*t), 'y':0.06*math.cos(2*math.pi*1.5*t),
                                    'z':1+0.12*math.sin(2*math.pi*3*t)},
            'gyro':{'x':5*math.sin(t), 'y':0, 'z':0}, **extra}


class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.cal_path = Path(cls.temp.name)/'fixture.json'
        cls.cal_path.write_text(json.dumps(CAL), encoding='utf-8')
        cls.template = FootRuntime('right', cls.cal_path, 'ensemble', ARTIFACT_DIR)
        if not cls.template.detector:
            raise RuntimeError(cls.template.load_error)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def runtime(self, side='right'):
        r = FootRuntime(side, None, 'ensemble', ARTIFACT_DIR, self.temp.name)
        r.detector = copy.copy(self.template.detector)
        # A copy shares weights, but no buffers, state machine or temporal gates.
        r.detector.foot = 'L' if side == 'left' else 'R'
        r.detector.windower = copy.deepcopy(self.template.detector.windower)
        r.detector.state_machine = copy.deepcopy(self.template.detector.state_machine)
        r.detector.reset_stream()
        r.load_error = None
        return r

    def fill(self, r, start=0, stop=300, **extra):
        for i in range(start, stop): r.ingest(frame(i, r.side, **extra))
        return r.snapshot()

    def test_real_ensemble_weights_produce_finite_scores_and_thresholds(self):
        r = self.runtime()
        self.assertIsNone(self.fill(r, stop=200)['fog_score'])
        snap = self.fill(r, start=200)
        self.assertTrue(snap['ready'])
        self.assertIn(snap['state'], ['normal','warning','confirmed'])
        self.assertGreaterEqual(snap['fog_score'], 0)
        self.assertLessEqual(snap['fog_score'], 1)
        d = snap['diagnostics']
        self.assertAlmostEqual(d['raw_model_score'], (d['rf_score']+d['cnn_score'])/2)
        self.assertEqual(d['enter_threshold'], 0.36)
        self.assertAlmostEqual(d['exit_threshold'], 0.21)
        self.assertEqual(d['n_consecutive'], 2)
        self.assertFalse(snap['pressure_gate_enabled'])

    def test_missing_calibration_never_infers(self):
        r = FootRuntime('right', None, 'ensemble', ARTIFACT_DIR)
        self.fill(r)
        self.assertEqual(r.snapshot()['status'], 'calibration_missing')
        self.assertIsNone(r.snapshot()['fog_score'])

    def test_duplicate_frames_do_not_fill_window(self):
        r = self.runtime()
        for _ in range(400): r.ingest(frame(0))
        self.assertEqual(r.accepted_samples, 1)
        self.assertFalse(r.snapshot()['ready'])

    def test_gap_discards_entire_temporal_history_and_requires_new_window(self):
        r = self.runtime(); self.fill(r)
        self.assertTrue(r.snapshot()['ready'])
        r.ingest(frame(400))
        self.assertFalse(r.snapshot()['ready'])
        self.assertIsNone(r.snapshot()['fog_score'])
        self.fill(r, start=401, stop=600)
        self.assertFalse(r.snapshot()['ready'])
        self.fill(r, start=600, stop=680)
        self.assertTrue(r.snapshot()['ready'])

    def test_reboot_clears_state_machine_even_if_frame_number_matches(self):
        r = self.runtime(); self.fill(r)
        r.ingest(frame(299, boot_id='reboot'))
        self.assertFalse(r.snapshot()['ready'])
        self.assertFalse(r.detector.state_machine._active)

    def test_invalid_imu_is_not_zero_filled_and_wrong_foot_is_rejected(self):
        for bad in [{'accel':{'x':None,'y':0,'z':1}}, {'accel':{'x':float('nan'),'y':0,'z':1}},
                    {'gyro':{}}, {'imu_ready':False}, {'foot_side':'left'}]:
            r = self.runtime(); self.fill(r)
            self.assertFalse(r.ingest(frame(301, **bad)))
            self.assertIsNone(r.snapshot()['decision_score'])
        with self.assertRaises(ValueError): vector({'x':True,'y':0,'z':1})

    def test_low_input_rate_cannot_look_like_real_64hz(self):
        r = self.runtime(); self.fill(r, stop=100, step=50)
        self.assertFalse(r.snapshot()['ready'])
        self.assertIsNone(r.snapshot()['decision_score'])
        self.assertAlmostEqual(r.input_hz(), 20)

    def test_expired_result_is_cleared(self):
        r = self.runtime(); self.fill(r)
        r.last_received = time.monotonic()-3
        self.assertFalse(r.snapshot()['ready'])
        self.assertEqual(r.window_count, 0)

    def test_calibration_validation_rejects_duplicate_axes_and_bad_std(self):
        for fields in [{'lateral_channel':'raw_acc_x'}, {'zscore_std_vfl':[1,0,1]}, {'zscore_mean_vfl':[0,float('nan'),1]}]:
            p=Path(self.temp.name)/'bad.json'; p.write_text(json.dumps({**CAL, **fields}))
            with self.assertRaises(ValueError): load_axis_calibration(p)

    def test_two_feet_use_independent_models_and_report_consistent_selected_score(self):
        bridge = BridgeState(data_dir=self.temp.name)
        bridge.feet = {'left':self.runtime('left'), 'right':self.runtime()}
        for r in bridge.feet.values(): self.fill(r)
        # Deliberately set different tier/score outputs to test aggregation, not model sensitivity.
        bridge.feet['left'].state='warning'
        bridge.feet['left'].detector.last_diagnostics['decision_score']=0.2
        bridge.feet['right'].state='normal'
        bridge.feet['right'].detector.last_diagnostics['decision_score']=0.8
        s=bridge.snapshot()
        self.assertEqual(s['selected_foot'],'left')
        self.assertEqual(s['decision_score'],0.2)
        self.assertEqual(s['coverage'],2)
        bridge.feet['left'].last_received = time.monotonic()-3
        s=bridge.snapshot()
        self.assertEqual(s['selected_foot'],'right')
        self.assertEqual(s['coverage'],1)

    def test_yaw_suppression_reports_raw_and_effective_score_separately(self):
        r=self.runtime()
        from fog_validation.ml.realtime import RealtimeWindower
        r.detector.yaw_gate_enabled=True
        r.detector.calibration=copy.deepcopy(r.detector.calibration)
        r.detector.calibration.gyro_yaw_idx=2
        r.detector.yaw_gate_threshold_dps=250
        r.detector.yaw_windower=RealtimeWindower(n_channels=1)
        for i in range(300):
            r.ingest(frame(i, gyro={'x':0,'y':0,'z':300*math.sin(i/10)}))
        d=r.snapshot()['diagnostics']
        self.assertTrue(d['yaw_suppressed'])
        self.assertEqual(d['decision_score'],0)
        self.assertGreater(d['raw_model_score'],0)

    def test_calibration_gap_fails_without_replacing_old_file(self):
        r=self.runtime(); self.fill(r, stop=20)
        r.start_calibration(); r.capture['starts_at']=time.monotonic()-1
        r.ingest(frame(20))
        r.ingest(frame(100))
        self.assertEqual(r.capture['status'],'failed')
        self.assertEqual(r.capture['error'],'sample_gap_or_clock_reset')
        self.fill(r,start=101,stop=420)
        self.assertEqual(r.snapshot()['status'],'calibration_failed')
        self.assertIsNone(r.snapshot()['decision_score'])

    def test_calibration_capture_saves_actual_samples_and_reloads_model(self):
        r=self.runtime(); r.ingest(frame(0))
        r.start_calibration(); r.capture['starts_at']=time.monotonic()-1
        # Synthetic stand+walk validates the workflow only. Saved inside temporary test directory.
        for i in range(1, 1603):
            p=frame(i)
            if i<=320: p['accel']={'x':0.001*math.sin(i),'y':0.001*math.cos(i),'z':1}
            r.ingest(p)
        self.assertEqual(r.capture['status'],'complete', r.capture)
        self.assertTrue(r.capture_path.is_file())
        self.assertEqual(json.loads(r.calibration_path.read_text())['device_id'],'test-right')
        self.assertIsNotNone(r.detector)
        self.assertFalse(r.snapshot()['ready'])

    def test_epoch_timestamp_is_available_for_existing_web_trend_records(self):
        r=self.runtime(); self.fill(r)
        snap=r.snapshot()
        self.assertLess(abs(time.time()*1000-snap['last_window_at_ms']), 2500)
        bridge=BridgeState(data_dir=self.temp.name); bridge.feet={'right':r}
        snap=bridge.snapshot()
        self.assertEqual(len(snap['artifact_id']),64)
        self.assertIsNotNone(snap['last_window_at_ms'])

    def test_csv_replay_uses_real_models_and_outputs_window_evidence(self):
        from web.ai_bridge.analyze_csv import analyze
        import csv
        p=Path(self.temp.name)/'synthetic.csv'
        with p.open('w',newline='') as f:
            writer=csv.writer(f)
            writer.writerow(['timestamp_ms','raw_acc_x','raw_acc_y','raw_acc_z','raw_gyro_x','raw_gyro_y','raw_gyro_z'])
            for i in range(330):
                sample=frame(i)
                writer.writerow([sample['millis'],*sample['accel'].values(),*sample['gyro'].values()])
        result=analyze(p,self.cal_path)
        self.assertEqual(result['source'],'csv_replay')
        self.assertEqual(result['samples'],330)
        self.assertGreaterEqual(result['window_count'],3)
        self.assertIsNotNone(result['latest']['decision_score'])

    def test_resampler_never_interpolates_a_long_gap(self):
        r=TimeResampler(); out=[]
        r.push(0,np.ones(3),np.zeros(3),lambda *v:out.append(v))
        with self.assertRaises(ValueError): r.push(1,np.ones(3),np.zeros(3),lambda *v:out.append(v))
        self.assertEqual(len(out),1)


if __name__ == '__main__': unittest.main()
