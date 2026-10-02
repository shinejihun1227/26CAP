"""Oct 1 AI update must preserve stop, calibration and fresh-data behavior."""
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from web.ai_bridge.server import BridgeState
from web.ai_bridge.fog_cue import FogCueController
from web.ai_bridge.tests.test_pressure_and_dismiss import BASE, sample


class UpdateCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.bridge = BridgeState(data_dir=self.temp.name)
        for side in ('left', 'right'):
            self.bridge.rules.set_baseline(side, dict(BASE))

    def tearDown(self):
        self.bridge.datasets.close()
        self.temp.cleanup()

    def pressure(self, start=0):
        now, count = time.time() * 1000, 50
        rows = []
        for i in range(start, start + count):
            rows.append(sample('left', i, now, start + count, pressure=(1000, 1000, 100, 100)))
            rows.append(sample('right', i, now + 1, start + count))
        for row in rows:
            with patch('web.ai_bridge.server.time.time', return_value=row['received_at_ms'] / 1000):
                self.bridge.consume({'service': 'stepon-bilateral-v1', 'stream_id': 's', 'samples': [row],
                                     'next_cursor': 0, 'feet': {'left': {'connected': True}, 'right': {'connected': True}}})

    def test_pause_blocks_pressure_and_outputs_and_resume_discards_history(self):
        self.pressure()
        self.assertEqual(self.bridge.snapshot()['state'], 'confirmed')
        self.bridge.set_detection_enabled(False)
        self.pressure(60)
        snap = self.bridge.snapshot()
        self.assertEqual(snap['status'], 'detection_paused')
        self.assertFalse(snap['ready'])
        self.assertEqual(snap['reasons'], [])
        self.assertIsNone(self.bridge.cue_plan()['state'])
        self.bridge.set_detection_enabled(True)
        self.assertFalse(self.bridge.snapshot()['ready'])
        self.assertTrue(all(not f.samples for f in self.bridge.rules.feet.values()))

    def test_pressure_strengthens_normal_ai_without_fabricating_a_model_score(self):
        self.pressure()
        runtime = self.bridge.feet['right']
        foot = runtime.snapshot()
        foot.update(ready=True, window_ready=True, status='normal', state='normal',
                    decision_score=0.12, fog_score=0.12, score_percent=12, last_window_at_ms=time.time() * 1000)
        with patch.object(runtime, 'snapshot', return_value=foot):
            snap = self.bridge.snapshot()
            self.assertEqual((snap['state'], snap['status'], snap['ai_state']), ('confirmed', 'confirmed', 'normal'))
            self.assertEqual(snap['decision_score'], 0.12)
            self.assertEqual(snap['decision_source'], 'ai_and_pressure')
            self.bridge.dismiss('left')
            self.assertEqual(self.bridge.snapshot()['status'], 'dismissed')
            self.assertFalse(self.bridge.snapshot()['ready'])
            self.assertIsNone(self.bridge.cue_plan()['state'])

    def test_pressure_cannot_alert_during_calibration_or_after_device_replacement(self):
        self.pressure()
        self.bridge.feet['left'].capture = {'status': 'countdown', 'starts_at': time.monotonic() + 100}
        self.pressure(60)
        self.assertFalse(self.bridge.snapshot()['ready'])
        self.assertIsNone(self.bridge.cue_plan()['state'])
        runtime = self.bridge.feet['left']
        runtime.capture = None
        runtime.calibration_info['device_id'] = 'previous-device'
        self.pressure(120)
        self.assertIsNone(self.bridge.rules.feet['left'].baseline)
        self.assertFalse(self.bridge.snapshot()['ready'])

    def test_stale_pressure_cannot_renew_a_cue_or_keep_a_hold(self):
        self.pressure()
        stamp = self.bridge.last_rules_at
        with patch('web.ai_bridge.server.time.time', return_value=stamp + 3):
            self.assertFalse(self.bridge.snapshot()['ready'])
            self.assertIsNone(self.bridge.cue_plan()['state'])
        self.bridge.rules.push('left', stamp + 3, 1000, 100)
        self.assertIsNone(self.bridge.rules.evaluate(stamp + 3)['state'])

    def test_global_pause_sends_off_even_if_a_previous_plan_was_confirmed(self):
        bridge = SimpleNamespace(lock=threading.RLock(), detection_enabled=False,
            feet={'left': SimpleNamespace(snapshot=lambda: {'device_connected': True, 'device_id': 'd', 'boot_id': 'b'})},
            datasets=SimpleNamespace(capture=None),
            cue_plan=lambda: {'state': 'confirmed', 'level': 70, 'laser': True})
        controller = FogCueController(bridge, self.temp.name)
        controller.send = Mock(return_value={'accepted': True, 'cue_api_version': 1})
        controller.tick('left')
        self.assertFalse(controller.send.call_args.args[2])
        self.assertTrue(controller.enabled)


if __name__ == '__main__':
    unittest.main()
