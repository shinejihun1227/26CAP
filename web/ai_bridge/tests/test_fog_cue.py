import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from web.ai_bridge.fog_cue import FogCueController, wants_cue

CONFIRMED = {'state': 'confirmed', 'level': 70, 'laser': True, 'suppressed': False}
WARNING = {'state': 'warning', 'level': 30, 'laser': False, 'suppressed': False}
OFF = {'state': None, 'level': 0, 'laser': False, 'suppressed': False}


class CueTests(unittest.TestCase):
    def foot(self, **extra):
        return {'ready': True, 'device_connected': True, 'device_id': 'test-device', 'boot_id': 'test-boot',
                'cue_level_supported': True, **extra}

    def test_confirmed_is_strong_with_laser_and_warning_is_weak_without(self):
        foot = self.foot()
        self.assertEqual(wants_cue(foot, CONFIRMED), (True, 70, True))
        self.assertEqual(wants_cue(foot, WARNING), (True, 30, False))
        self.assertEqual(wants_cue(foot, OFF), (False, 0, False))
        for change in ({'device_connected': False}, {'boot_id': None}):
            self.assertFalse(wants_cue({**foot, **change}, CONFIRMED)[0])
        self.assertFalse(wants_cue(foot, CONFIRMED, enabled=False)[0])
        self.assertFalse(wants_cue(foot, CONFIRMED, collecting=True)[0])

    def test_old_firmware_keeps_warning_silent(self):
        foot = self.foot(cue_level_supported=False)
        self.assertEqual(wants_cue(foot, WARNING), (False, 0, False))
        self.assertTrue(wants_cue(foot, CONFIRMED)[0])

    def test_popup_wakes_both_workers_but_never_overrides_stop_or_invents_inference(self):
        with tempfile.TemporaryDirectory() as folder:
            plan = dict(OFF)
            bridge = SimpleNamespace(lock=threading.RLock(), detection_enabled=True,
                feet={side: SimpleNamespace(snapshot=self.foot) for side in ('left', 'right')},
                datasets=SimpleNamespace(capture=None), cue_plan=lambda: plan)
            controller = FogCueController(bridge, folder)
            controller.send = Mock(return_value={'accepted': True, 'cue_api_version': 1})
            controller.request_sync()
            self.assertTrue(all(event.is_set() for event in controller.wake.values()))
            controller.tick('left')
            self.assertFalse(controller.send.call_args.args[2])
            plan.update(CONFIRMED)
            for side in bridge.feet:
                controller.tick(side)
                self.assertEqual(controller.send.call_args.args[2:], (True, 70, True))
            controller.set_enabled(False)
            controller.request_sync(); controller.tick('left')
            self.assertFalse(controller.send.call_args.args[2])
            controller.set_enabled(True); bridge.detection_enabled = False
            controller.request_sync(); controller.tick('right')
            self.assertFalse(controller.send.call_args.args[2])

    def test_partial_hardware_ack_reports_missing_motor_but_retains_laser(self):
        with tempfile.TemporaryDirectory() as folder:
            bridge = SimpleNamespace(lock=threading.RLock(), feet={'left': SimpleNamespace(snapshot=self.foot)},
                datasets=SimpleNamespace(capture=None), cue_plan=lambda: CONFIRMED)
            controller = FogCueController(bridge, folder)
            controller.send = Mock(return_value={'accepted': True, 'cue_api_version': 1,
                'laser': True, 'vibration': False, 'level': 0})
            controller.tick('left')
            result = controller.snapshot()['feet']['left']
            self.assertTrue(result['laser'])
            self.assertFalse(result['vibration'])
            self.assertIn('진동', result['error'])

    def test_renew_until_clear_and_stop_during_collection_disable_and_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            snapshot = self.foot()
            plan = dict(CONFIRMED)
            bridge = SimpleNamespace(lock=threading.RLock(), feet={'left': SimpleNamespace(snapshot=lambda: snapshot)},
                                     datasets=SimpleNamespace(capture=None), cue_plan=lambda: plan)
            controller = FogCueController(bridge, folder)
            controller.send = Mock(return_value={'cue_api_version': 1, 'accepted': True})
            controller.tick('left'); controller.tick('left')
            self.assertTrue(all(call.args[2] for call in controller.send.call_args_list))
            self.assertEqual(controller.send.call_args.args[3:], (70, True))
            plan.update(WARNING); controller.tick('left')
            self.assertEqual(controller.send.call_args.args[2:], (True, 30, False))
            plan.update(OFF); controller.tick('left')
            self.assertFalse(controller.send.call_args.args[2])
            plan.update(CONFIRMED); bridge.datasets.capture = {'status': 'recording'}; controller.tick('left')
            self.assertFalse(controller.send.call_args.args[2])
            bridge.datasets.capture = None; controller.set_enabled(False); controller.tick('left')
            self.assertFalse(controller.send.call_args.args[2])
            self.assertFalse(FogCueController(bridge, folder).enabled)
            controller.set_enabled(True); controller.send.side_effect = OSError('offline'); controller.tick('left')
            self.assertFalse(controller.snapshot()['feet']['left']['acknowledged'])
            self.assertEqual(controller.snapshot()['feet']['left']['status'], 'error')
