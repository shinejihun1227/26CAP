import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from web.ai_bridge.fog_cue import FogCueController, wants_cue

class CueTests(unittest.TestCase):
    def foot(self, **extra):
        return dict(ready=True, device_connected=True, state='confirmed', last_window_at_ms=time.time()*1000,
                    device_id='test-device', boot_id='test-boot', **extra)

    def test_only_fresh_confirmed_live_decision_activates(self):
        foot = self.foot()
        self.assertTrue(wants_cue(foot))
        for change in ({'state':'warning'}, {'state':'normal'}, {'ready':False}, {'device_connected':False},
                       {'last_window_at_ms':time.time()*1000-2001}, {'boot_id':None}):
            self.assertFalse(wants_cue({**foot, **change}))
        self.assertFalse(wants_cue(foot, enabled=False))
        self.assertFalse(wants_cue(foot, collecting=True))

    def test_renew_until_clear_and_stop_during_collection_disable_and_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            snapshot = self.foot()
            bridge = SimpleNamespace(lock=threading.RLock(), feet={'left':SimpleNamespace(snapshot=lambda:snapshot)},
                                     datasets=SimpleNamespace(capture=None))
            controller = FogCueController(bridge, folder)
            controller.send = Mock(return_value={'cue_api_version':1, 'accepted':True})
            controller.tick('left'); controller.tick('left')
            self.assertTrue(all(call.args[2] for call in controller.send.call_args_list))
            snapshot['state']='normal'; controller.tick('left')
            self.assertFalse(controller.send.call_args.args[2])
            snapshot['state']='confirmed'; bridge.datasets.capture={'status':'recording'}; controller.tick('left')
            self.assertFalse(controller.send.call_args.args[2])
            bridge.datasets.capture=None; controller.set_enabled(False); controller.tick('left')
            self.assertFalse(controller.send.call_args.args[2])
            self.assertFalse(FogCueController(bridge, folder).enabled)
            controller.set_enabled(True); controller.send.side_effect=OSError('offline'); controller.tick('left')
            self.assertFalse(controller.snapshot()['feet']['left']['acknowledged'])
            self.assertEqual(controller.snapshot()['feet']['left']['status'],'error')
