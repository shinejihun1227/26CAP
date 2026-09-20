"""Synthetic integration fixtures only. Never a labelled accuracy evaluation."""
import csv
import io
import json
import math
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from web.ai_bridge.server import ARTIFACT_DIR, BridgeState
from web.ai_bridge.csv_pipeline import COLUMNS, USB_AXES, parse_csv, validate_pair, calibration_from_rows
from web.ai_bridge.datasets import DatasetService

CONTEXT = {'side': 'left', 'participant_id': 'SYNTHETIC_TEST', 'session_id': 'fixture', 'placement': 'shoe'}


def sample(i, hz=100, calibration=False):
    t = i / hz
    walk = not calibration or t >= 5
    return [round(t*1000, 6), 0.23*math.sin(2*math.pi*1.5*t) if walk else 0,
            0.045*math.sin(2*math.pi*t) if walk else 0,
            1 + (0.12*math.sin(2*math.pi*3*t) if walk else 0), 5*math.sin(t) if walk else 0, 0, 0]


def fixture(seconds=6, calibration=False, usb=False, hz=100):
    out = io.StringIO(newline='')
    fields = ['device_time_us', *USB_AXES, 'device_id', 'boot_id', 'side', 'placement', 'sequence', 'clip_mask'] if usb else COLUMNS
    writer = csv.DictWriter(out, fieldnames=fields)
    writer.writeheader()
    for i in range(int(seconds*hz)+1):
        values = sample(i, hz, calibration)
        row = dict(zip(['timestamp_ms', *COLUMNS[1:7]], values))
        row.update(CONTEXT, device_id='synthetic-device', boot_id='synthetic-boot', label='synthetic_only')
        if usb:
            row = {'device_time_us': round(values[0]*1000), **dict(zip(USB_AXES, values[1:])),
                   'device_id': 'synthetic-device', 'boot_id': 'synthetic-boot', 'side': 'left', 'placement': 'shoe', 'sequence': i+1, 'clip_mask': 0}
        writer.writerow(row)
    return out.getvalue()


def pair():
    return {**CONTEXT, 'calibration_csv': fixture(25, True, True), 'measurement_csv': fixture(6, False, True)}


class CsvTests(unittest.TestCase):
    def test_usb_aliases_time_conversion_and_bom(self):
        r = parse_csv('\ufeff' + fixture(6, usb=True), CONTEXT)
        self.assertEqual(r.rows[-1, 0], 6000)
        self.assertEqual(r.quality['received_hz'], 100)
        self.assertEqual(r.quality['format'], 'usb_wroom_v1')
        reread = parse_csv(r.csv_text(), CONTEXT)
        self.assertEqual(reread.rows.tolist(), r.rows.tolist())
        self.assertEqual(reread.context, r.context)

    def test_pair_produces_valid_bound_calibration_without_retraining(self):
        cal, measure, result = validate_pair(pair())
        self.assertEqual(result['device_id'], 'synthetic-device')
        self.assertEqual(result['foot_side'], 'left')
        self.assertGreater(result['forward_confidence'], .3)
        self.assertTrue(all(v > 0 for v in result['zscore_std_vfl']))

    def test_rejects_wrong_foot_device_participant_and_mixed_boot(self):
        for old, new in [('left','right'), ('synthetic-device','other-device'), ('SYNTHETIC_TEST','other-participant')]:
            body = {**CONTEXT, 'calibration_csv': fixture(25, True), 'measurement_csv': fixture().replace(old, new)}
            with self.subTest(old=old), self.assertRaises(ValueError): validate_pair(body)
        with self.assertRaises(ValueError):
            parse_csv(fixture().replace('synthetic-boot','reboot',1), CONTEXT)

    def test_rejects_empty_duplicate_header_nan_units_clock_and_clipping(self):
        cases = [','.join(COLUMNS)+'\n', fixture().replace('raw_acc_x','raw_acc_y',1),
                 fixture().replace('0.0,0.0,1.0', 'NaN,0.0,1.0',1),
                 fixture().replace('0.0,0.0,1.0', '16000,0.0,1.0',1),
                 fixture().replace('10.0,','0.0,',1), fixture(usb=True).replace('shoe,1,0','shoe,1,1',1),
                 fixture().replace('synthetic_only','=1+1',1)]
        for content in cases:
            with self.subTest(content=content[:50]), self.assertRaises(ValueError): parse_csv(content, CONTEXT)

    def test_rejects_insufficient_rate_short_or_moving_still_phase(self):
        with self.assertRaises(ValueError): parse_csv(fixture(hz=10), CONTEXT)
        for content in (fixture(10, True), fixture(25, False)):
            body = pair(); body['calibration_csv'] = content
            with self.assertRaises(ValueError): validate_pair(body)
        r = parse_csv(fixture(25, True), CONTEXT)
        r.rows[:, 1:4] *= 9.80665
        with self.assertRaises(ValueError): calibration_from_rows(r.rows, 'left', 'synthetic-device')

    def test_header_only_template_matches_server_contract(self):
        path = Path(__file__).resolve().parents[3] / 'cap_web/data/imu-template.csv'
        with path.open(encoding='utf-8-sig') as file:
            self.assertEqual(list(csv.reader(file)), [COLUMNS])


class DatasetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='stepon-csv-tests-')
        self.bridge = BridgeState(data_dir=self.temp.name)
        self.service = self.bridge.datasets

    def tearDown(self):
        self.service.close()
        self.temp.cleanup()

    def test_isolated_worker_scores_real_ensemble_and_exports_original_metadata(self):
        result = self.service.analyze(pair())
        with self.assertRaises(ValueError): self.service.analyze(pair())
        until = time.monotonic()+45
        while time.monotonic() < until:
            status = self.service.status(result['id'])
            if status['status'] != 'running': break
            time.sleep(.15)
        self.assertEqual(status['status'], 'complete', status)
        folder = self.service.path(result['id'])
        self.assertEqual((folder/'source-measurement.csv').read_bytes(), pair()['measurement_csv'].encode('utf-8'))
        self.assertNotIn(b'\r\r\n', (folder/'measurement.csv').read_bytes())
        report = json.loads(self.service.download(result['id'], 'result.json'))
        self.assertGreaterEqual(report['window_count'], 5)
        for w in report['windows']:
            self.assertAlmostEqual(w['raw_model_score'], (w['rf_score']+w['cnn_score'])/2)
            self.assertGreaterEqual(w['score_percent'], 0)
            self.assertLessEqual(w['score_percent'], 100)
        self.assertEqual(report['source_quality']['format'], 'usb_wroom_v1')
        self.assertEqual(report['metadata']['participant_id'], 'SYNTHETIC_TEST')
        self.assertEqual(report['artifact_id'], self.bridge.artifact_id)
        self.assertIn('operator_label_at_window_end', self.service.download(result['id'],'windows.csv').decode('utf-8-sig'))
        self.assertFalse((Path(self.temp.name)/'left.calibration.json').exists())
        self.assertFalse(self.bridge.snapshot()['ready'])

    def connect(self):
        r = self.bridge.feet['left']
        payload = {'frame': 0, 'millis': 0, 'device_id': 'synthetic-device', 'boot_id': 'synthetic-boot', 'foot_side': 'left',
                   'accel': {'x': 0,'y': 0,'z': 1}, 'gyro': {'x': 0,'y': 0,'z': 0}, 'imu_ready': True}
        r.ingest(payload)
        return r, payload

    def test_live_raw_capture_countdown_complete_download_and_offline(self):
        runtime, payload = self.connect()
        capture = self.service.start_recording({**CONTEXT,'purpose':'measurement','duration_s':10}, runtime)
        self.service.ingest('left', payload)
        self.assertEqual(self.service.capture['rows'], 0)
        self.service.starts_at = time.monotonic()-1
        for i in range(1001):
            p = {**payload, 'frame': i, 'millis': i*10}
            self.service.ingest('left', p)
        status = self.service.status(capture['id'])
        self.assertEqual(status['status'], 'complete')
        r = parse_csv(self.service.download(capture['id'],'recording.csv').decode('utf-8-sig'), CONTEXT)
        self.assertEqual(r.quality['rows'], 1001)
        self.assertEqual(r.quality['received_hz'], 100)
        capture = self.service.start_recording({**CONTEXT,'purpose':'measurement'}, runtime)
        self.service.last_received -= 3
        self.service.tick()
        self.assertEqual(self.service.status(capture['id'])['status'], 'failed')

    def test_early_calibration_stop_and_device_change_fail_closed(self):
        runtime, payload = self.connect()
        capture = self.service.start_recording({**CONTEXT,'purpose':'calibration'}, runtime)
        self.assertEqual(self.service.finish_recording(capture['id'])['status'], 'failed')
        capture = self.service.start_recording({**CONTEXT,'purpose':'measurement'}, runtime)
        self.service.ingest('left',{**payload,'boot_id':'reboot'})
        self.assertEqual(self.service.status(capture['id'])['status'], 'failed')

    def test_ids_download_allowlist_and_restart_interruption(self):
        for value in ('../left.calibration.json', 'x', '../../', ''):
            with self.assertRaises(ValueError): self.service.status(value)
        with self.assertRaises(ValueError): self.service.download('a'*32,'source-measurement.csv')
        runtime, _ = self.connect()
        capture = self.service.start_recording({**CONTEXT,'purpose':'measurement'},runtime)
        other = DatasetService(self.temp.name, ARTIFACT_DIR, self.bridge.artifact_id, 'ensemble')
        self.assertEqual(other.status(capture['id'])['status'], 'interrupted')


if __name__ == '__main__':
    unittest.main()
