"""Final-package motion switch and retained gates; synthetic inputs, not accuracy tests."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from web.ai_bridge.server import ARTIFACT_DIR
from web.ai_bridge.tests.test_integration import CAL
from fog_validation.ml.live_detector import LiveFogDetector, load_axis_calibration


class MotionGateSwitchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.folder = Path(cls.temp.name)
        cal_path = cls.folder / 'calibration.json'
        cal_path.write_text(json.dumps(CAL), encoding='utf-8')
        cls.calibration = load_axis_calibration(cal_path)
        cls.template = LiveFogDetector(cls.calibration, 'ensemble', ARTIFACT_DIR, 'R')

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def detector(self, switch='deployed'):
        cfg = json.loads((ARTIFACT_DIR / 'deploy_config.json').read_text(encoding='utf-8'))
        if switch == 'missing':
            cfg.pop('motion_gates', None)
        elif switch != 'deployed':
            cfg['motion_gates'] = {'enabled': switch}
        (self.folder / 'deploy_config.json').write_text(json.dumps(cfg), encoding='utf-8')
        # Only skip repeated loading; scores/temporal behavior below are independently controlled.
        with patch('fog_validation.ml.live_detector.load_rf', return_value=self.template.model['rf']), \
             patch('fog_validation.ml.live_detector.load_cnn', return_value=self.template.model['cnn']):
            return LiveFogDetector(copy.deepcopy(self.calibration), 'ensemble', self.folder, 'R')

    def probability(self, detector, value):
        result = np.zeros((1, 3))
        result[0, detector.i_fog] = value
        return result

    def windows(self, detector, count=4, yaw=False):
        states = []
        for i in range(80 + 10 * (count - 1)):
            packet = {'R_raw_acc': np.array([0.0, 0.0, 1.0]),
                      'R_raw_gyro': np.array([0.0, 0.0, 300.0 * (-1 if i % 2 else 1) if yaw else 0.0])}
            state = detector.push_sample(packet)
            if state is not None:
                states.append(state)
        return states

    def test_final_config_skips_both_motion_checks_but_needs_four_strong_windows(self):
        detector = self.detector()
        self.assertIs(detector.motion_gates_enabled, False)
        proba = self.probability(detector, 0.5)
        with patch('fog_validation.ml.live_detector.predict_proba_baseline', return_value=proba), \
             patch('fog_validation.ml.live_detector.predict_proba_cnn', return_value=proba), \
             patch('fog_validation.ml.live_detector.is_active_walking', return_value=False) as low, \
             patch('fog_validation.ml.live_detector.is_confirmed_grade_motion', return_value=False) as grade:
            self.assertEqual(self.windows(detector), ['normal', 'warning', 'warning', 'confirmed'])
            low.assert_not_called()
            grade.assert_not_called()
            self.assertEqual(detector.last_diagnostics['reason'], 'sustained_model_score')
            self.assertIs(detector.last_diagnostics['motion_gates_enabled'], False)
            detector.reset_stream()
            self.assertEqual(self.windows(detector, 2), ['normal', 'warning'])

    def test_enabled_and_older_config_keep_each_motion_gate(self):
        for switch in (True, 'missing'):
            for low, grade, expected in ((False, False, 'low_motion'), (True, False, 'motion_grade'), (True, True, 'sustained_model_and_motion')):
                with self.subTest(switch=switch, low=low, grade=grade):
                    detector = self.detector(switch)
                    self.assertIs(detector.motion_gates_enabled, True)
                    proba = self.probability(detector, 0.5)
                    with patch('fog_validation.ml.live_detector.predict_proba_baseline', return_value=proba), \
                         patch('fog_validation.ml.live_detector.predict_proba_cnn', return_value=proba), \
                         patch('fog_validation.ml.live_detector.is_active_walking', return_value=low), \
                         patch('fog_validation.ml.live_detector.is_confirmed_grade_motion', return_value=grade):
                        self.windows(detector)
                        self.assertEqual(detector.last_diagnostics['reason'], expected)
                        self.assertEqual(detector.last_diagnostics['state'], 'confirmed' if low and grade else 'warning')

    def test_low_scores_never_confirm_when_motion_checks_disabled(self):
        for score, expected in ((0.0, 'normal'), (0.35, 'warning')):
            with self.subTest(score=score):
                detector = self.detector()
                proba = self.probability(detector, score)
                with patch('fog_validation.ml.live_detector.predict_proba_baseline', return_value=proba), \
                     patch('fog_validation.ml.live_detector.predict_proba_cnn', return_value=proba):
                    states = self.windows(detector, 6)
                    self.assertNotIn('confirmed', states)
                    self.assertEqual(states[-1], expected)

    def test_disabled_motion_checks_do_not_bypass_yaw_suppression(self):
        from fog_validation.ml.realtime import RealtimeWindower
        detector = self.detector()
        detector.yaw_gate_enabled = True
        detector.calibration.gyro_yaw_idx = 2
        detector.yaw_windower = RealtimeWindower(n_channels=1)
        detector.yaw_gate_threshold_dps = 250.0
        proba = self.probability(detector, 0.9)
        with patch('fog_validation.ml.live_detector.predict_proba_baseline', return_value=proba), \
             patch('fog_validation.ml.live_detector.predict_proba_cnn', return_value=proba):
            self.assertEqual(self.windows(detector), ['normal', 'warning', 'warning', 'confirmed'])
            detector.reset_stream()
            self.assertEqual(self.windows(detector, yaw=True), ['normal'] * 4)
            self.assertEqual(detector.last_diagnostics['raw_model_score'], 0.9)
            self.assertEqual(detector.last_diagnostics['decision_score'], 0.0)
            self.assertEqual(detector.last_diagnostics['reason'], 'yaw_suppressed')


if __name__ == '__main__':
    unittest.main()
