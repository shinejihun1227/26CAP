import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from web.ai_bridge.datasets import DatasetService, GUIDED_PROTOCOL
from web.ai_bridge.csv_pipeline import parse_csv, write_json
from web.ai_bridge.tests.test_datasets import sample, CONTEXT

class GuidedCollectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = DatasetService(self.temp.name, '.', 'synthetic', 'ensemble')
        self.runtime = SimpleNamespace(snapshot=lambda:{'device_connected':True}, identity=('synthetic-device','synthetic-boot'), error=None)

    def tearDown(self):
        self.service.close(); self.temp.cleanup()

    def start(self, purpose, **extra):
        result = self.service.start_recording({**CONTEXT, 'purpose':purpose, 'protocol':GUIDED_PROTOCOL, **extra}, self.runtime)
        self.service.starts_at = time.monotonic()-1
        return result['id']

    def feed(self, seconds, calibration=False, hz=100):
        for i in range(int(seconds*hz)+1):
            values = sample(i, hz, calibration)
            self.service.ingest('left', {'millis':values[0], 'device_id':'synthetic-device','boot_id':'synthetic-boot',
                                        'accel':dict(zip('xyz',values[1:4])), 'gyro':dict(zip('xyz',values[4:7]))})

    def calibrate(self):
        identifier = self.start('calibration'); self.feed(25, True)
        self.assertTrue(self.service.status(identifier)['calibration_valid'])
        return identifier

    def test_complete_protocol_retains_instruction_quality_calibration_and_repeat_number(self):
        calibration = self.calibrate()
        for repeat in (1,2):
            identifier = self.start('measurement', activity='standing', calibration_id=calibration, duration_s=10)
            self.feed(30)
            record = self.service.status(identifier)
            self.assertEqual(record['status'],'complete')
            self.assertEqual(record['duration_s'],30)
            self.assertEqual(record['repetition'],repeat)
            self.assertEqual(record['ground_truth_status'],'unreviewed')
            self.assertEqual(record['calibration_id'],calibration)
            self.assertEqual(record['quality']['received_hz'],100)
            csv = self.service.download(identifier,'recording.csv').decode('utf-8-sig')
            self.assertEqual(set(parse_csv(csv, CONTEXT).labels), {'planned_standing'})

    def test_early_stop_missing_calibration_wrong_device_and_low_rate_do_not_complete(self):
        with self.assertRaises(ValueError): self.start('measurement',activity='walking')
        calibration = self.calibrate()
        self.runtime.identity=('other-device','synthetic-boot')
        with self.assertRaises(ValueError): self.start('measurement',activity='walking',calibration_id=calibration)
        self.runtime.identity=('synthetic-device','synthetic-boot')
        identifier=self.start('measurement',activity='walking',calibration_id=calibration)
        self.feed(10); self.service.finish_recording(identifier)
        self.assertEqual(self.service.status(identifier)['status'],'failed')
        identifier=self.start('measurement',activity='standing',calibration_id=calibration)
        self.feed(30,hz=20)
        self.assertEqual(self.service.status(identifier)['status'],'failed')

    def test_session_history_survives_more_than_twenty_other_records_and_restart(self):
        identifier=self.calibrate()
        for i in range(25):
            folder=self.service.path(f'{i:032x}'); folder.mkdir()
            write_json(folder/'manifest.json', {'id':f'{i:032x}','kind':'analysis','status':'complete','metadata':{**CONTEXT,'session_id':'other'}})
        restarted=DatasetService(self.temp.name,'.','synthetic','ensemble')
        self.assertEqual(len(restarted.list()['items']),20)
        self.assertEqual([i['id'] for i in restarted.list(CONTEXT)['items']],[identifier])
