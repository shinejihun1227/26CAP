"""Synthetic streams for the pressure rules, triple-stomp dismiss and per-wearer thresholds."""
import copy
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from web.ai_bridge import pressure_rules as pr
from web.ai_bridge import personal_threshold as pt
from web.ai_bridge.server import BridgeState, ARTIFACT_DIR

BASE = {'front_still': 1000.0, 'heel_still': 800.0, 'front_ok': True, 'heel_ok': True,
        'stride_median': 1.2, 'stride_cv': 0.05, 'steps': 15}


def rules(**changes):
    config = copy.deepcopy(pr.DEFAULTS)
    for key, value in changes.items():
        name, field = key.split('__')
        config['rules'][name][field] = value
    r = pr.PressureRules(config)
    for side in ('left', 'right'):
        r.set_baseline(side, dict(BASE))
    return r


def feed(r, t0, seconds, left, right, hz=20):
    """left/right: f(t) -> (front_raw, heel_raw). Returns the last evaluation time."""
    t = t0
    for i in range(int(seconds * hz)):
        t = t0 + i / hz
        r.push('left', t, *left(t))
        r.push('right', t + 0.001, *right(t))
        r.evaluate(t + 0.001)  # live code evaluates on every poll
    return t + 0.001


def standing(t):
    return 1000.0, 800.0


def walking(period, phase=0.0):
    # Forefoot loaded for 60% of each stride, unloaded in swing; heel similar but earlier.
    return lambda t: (1000.0, 800.0) if ((t + phase) % period) / period < 0.6 else (0.0, 0.0)


class PressureRuleTests(unittest.TestCase):
    def test_baseline_from_calibration_rows(self):
        rows = [(i / 20, 1000.0, 800.0) for i in range(100)]
        rows += [(5 + i / 20, *walking(1.2)(i / 20)) for i in range(400)]
        b = pr.baseline_from_rows(rows)
        self.assertTrue(b['front_ok'] and b['heel_ok'])
        self.assertAlmostEqual(b['stride_median'], 1.2, delta=0.06)
        self.assertEqual(b['step_sensor'], 'front')
        self.assertIsNone(pr.baseline_from_rows([(i / 20, 20.0, 20.0) for i in range(500)])['stride_median'])

    def test_preloaded_forefoot_uses_heel_for_steps(self):
        heel_steps = lambda t: (1000.0 if (t % 1.2) / 1.2 < 0.6 else 450.0, 800.0 if (t % 1.2) / 1.2 < 0.5 else 0.0)
        rows = [(i / 20, 1000.0, 800.0) for i in range(100)] + [(5 + i / 20, *heel_steps(i / 20)) for i in range(400)]
        b = pr.baseline_from_rows(rows)
        self.assertEqual(b['step_sensor'], 'heel')
        self.assertAlmostEqual(b['stride_median'], 1.2, delta=0.06)
        r = pr.PressureRules(copy.deepcopy(pr.DEFAULTS)); r.set_baseline('left', b)
        for i in range(200):
            r.push('left', i / 20, *heel_steps(i / 20))
        self.assertGreaterEqual(len(r.feet['left'].steps), 7)

    def test_standing_and_normal_walking_trigger_nothing(self):
        r = rules()
        t = feed(r, 0, 5, standing, standing)
        self.assertIsNone(r.evaluate(t)['state'])
        t = feed(r, 5, 10, walking(1.2), walking(1.2, 0.6))
        self.assertIsNone(r.evaluate(t)['state'])

    def test_calibration_prefers_regular_sensor_over_more_noisy_steps(self):
        front_steps = [0.2, 0.7, 1.5, 1.9, 2.6, 3.1, 4.0, 4.4, 5.6, 6.1, 7.4, 8.0,
                       8.4, 9.7, 10.4, 11.0, 12.3, 12.8, 13.5, 14.8, 15.5, 16.0, 17.1, 17.7, 18.6, 19.3]
        rows = [(i / 20, 1000.0, 800.0) for i in range(100)]
        for i in range(400):
            t = i / 20
            front = 0.0 if any(step <= t < step + 0.2 for step in front_steps) else 1000.0
            heel = walking(1.2)(t)[1]
            rows.append((5 + t, front, heel))
        baseline = pr.baseline_from_rows(rows)
        self.assertEqual(baseline['step_sensor'], 'heel')
        self.assertAlmostEqual(baseline['stride_median'], 1.2, delta=0.06)
        self.assertLess(baseline['stride_cv'], 0.05)

    def test_forefoot_only_load_for_two_seconds_is_confirmed(self):
        r = rules()
        t = feed(r, 0, 3, standing, standing)
        heel_up = lambda t: (1000.0, 440.0)  # 55% of baseline: old 40% rule would not fire.
        t = feed(r, 3, 1.4, heel_up, standing)
        self.assertIsNone(r.evaluate(t)['state'])
        t = feed(r, 4.4, 0.8, heel_up, standing)
        result = r.evaluate(t)
        self.assertEqual(result['state'], 'confirmed')
        self.assertEqual(result['rules']['forefoot_load'], ['left'])
        self.assertEqual(result['reasons'], ['forefoot_load'])

    def test_rule_switch_turns_a_rule_off(self):
        r = rules(forefoot_load__enabled=False)
        feed(r, 0, 3, standing, standing)
        t = feed(r, 3, 2, lambda t: (1000.0, 100.0), standing)
        self.assertIsNone(r.evaluate(t)['state'])

    def test_shuffle_is_warning(self):
        r = rules()
        t = feed(r, 0, 6, walking(0.6), walking(0.6, 0.3))
        result = r.evaluate(t)
        self.assertEqual(result['state'], 'warning')
        self.assertIn('shuffle', result['reasons'])

    def test_start_hesitation_rocking_without_step_is_confirmed(self):
        r = rules()
        t = feed(r, 0, 4, standing, standing)
        rock = lambda t: (1000.0, 800.0 if int(t * 2) % 2 else 150.0)  # heel load swings every 0.5 s, no step
        t = feed(r, 4, 4, rock, standing)
        result = r.evaluate(t)
        self.assertEqual(result['state'], 'confirmed')
        self.assertIn('start_hesitation', result['reasons'])

    def test_post_walk_tremor_only_upgrades_an_ai_warning(self):
        r = rules()
        t = feed(r, 0, 6, walking(1.2), walking(1.2, 0.6))
        jitter = lambda t: (1000.0 if int(t * 20) % 2 else 700.0, 800.0)
        t = feed(r, 6, 2.5, jitter, standing)
        self.assertIn('left', r.evaluate(t, 'warning')['rules']['post_walk_tremor'])
        self.assertEqual(r.evaluate(t, 'warning')['state'], 'confirmed')
        self.assertNotIn('post_walk_tremor', r.evaluate(t, None)['reasons'])

    def test_front_heel_mapping_and_swap(self):
        payload = {'pressure_ready': True, 'pressure_raw': [3000, 3000, 500, 500]}
        config = copy.deepcopy(pr.DEFAULTS)
        self.assertEqual(pr.front_heel(payload, 'left', config), (3000.0, 500.0))
        config['swap_front_heel']['left'] = True
        self.assertEqual(pr.front_heel(payload, 'left', config), (500.0, 3000.0))
        self.assertIsNone(pr.front_heel({'pressure_ready': False, 'pressure_raw': [1, 1, 1, 1]}, 'left', config))

    def test_missing_baseline_disables_rules(self):
        r = pr.PressureRules(copy.deepcopy(pr.DEFAULTS))
        t = feed(r, 0, 3, lambda t: (1000.0, 100.0), standing)
        self.assertIsNone(r.evaluate(t)['state'])


class PersonalThresholdTests(unittest.TestCase):
    def test_only_raises_and_caps(self):
        p = pt.personal_thresholds([0.1] * 30 + [0.35] * 5, 0.26, 0.40)
        self.assertGreater(p['enter'], 0.26)
        self.assertGreaterEqual(p['confirmed'], p['enter'] + 0.1 - 1e-9)
        low = pt.personal_thresholds([0.05] * 30, 0.26, 0.40)
        self.assertEqual((low['enter'], low['confirmed']), (0.26, 0.40))
        high = pt.personal_thresholds([0.9] * 30, 0.26, 0.40)
        self.assertEqual((high['enter'], high['confirmed']), (0.45, 0.55))
        self.assertIsNone(pt.personal_thresholds([0.2] * 3, 0.26, 0.40))


def sample(side, i, now_ms, n, *, tap=None, accel=(0.0, 0.0, 1.0), pressure=(1000, 1000, 800, 800)):
    state = {'frame': i, 'millis': i * 50, 'boot_id': 'b', 'device_id': f'dev-{side}', 'foot_side': side,
             'imu_ready': True, 'accel': dict(zip('xyz', accel)), 'gyro': {'x': 0, 'y': 0, 'z': 0},
             'pressure_ready': True, 'pressure_raw': list(pressure), 'cue_level_supported': True}
    if tap is not None:
        state.update(tap_api_version=1, tap_gesture_count=tap)
    return {'side': side, 'received_at_ms': now_ms - (n - i) * 50, 'state': state}


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.bridge = BridgeState(data_dir=self.temp.name, artifact_dir=ARTIFACT_DIR)
        for side in ('left', 'right'):
            self.bridge.rules.set_baseline(side, dict(BASE))

    def tearDown(self):
        self.bridge.datasets.close()
        self.temp.cleanup()

    def consume(self, rows):
        # Deliver as a live stream, keeping the production 2 s hold and stale-data checks.
        for row in rows:
            with patch('web.ai_bridge.server.time.time', return_value=row['received_at_ms'] / 1000):
                self.bridge.consume({'service': 'stepon-bilateral-v1', 'stream_id': 's', 'samples': [row], 'next_cursor': 0,
                                     'feet': {'left': {'connected': True}, 'right': {'connected': True}}})

    def test_pressure_rule_drives_both_feet_without_ai(self):
        now, n = time.time() * 1000, 50
        rows = []
        for i in range(n):
            rows.append(sample('left', i, now, n, pressure=(1000, 1000, 100, 100)))
            rows.append(sample('right', i, now + 1, n))
        self.consume(rows)
        snap = self.bridge.snapshot()
        self.assertEqual(snap['state'], 'confirmed')
        self.assertIsNone(snap['ai_state'])
        self.assertEqual(snap['reasons'], ['forefoot_load'])
        self.assertEqual(self.bridge.cue_plan(), {'state': 'confirmed', 'level': 70, 'laser': True, 'suppressed': False})

    def test_triple_stomp_suppresses_both_feet_for_five_seconds(self):
        now, n = time.time() * 1000, 30
        rows = []
        for i in range(n):
            rows.append(sample('left', i, now, n, tap=0 if i < n - 1 else 1, pressure=(1000, 1000, 100, 100)))
            rows.append(sample('right', i, now + 1, n))
        self.consume(rows)
        snap = self.bridge.snapshot()
        self.assertTrue(snap['suppression']['active'])
        self.assertGreater(snap['suppression']['remaining_sec'], 4.0)
        self.assertEqual(snap['suppression']['foot'], 'left')
        self.assertIsNone(snap['state'])
        self.assertEqual(self.bridge.cue_plan()['state'], None)
        self.assertTrue(self.bridge.cue_plan()['suppressed'])
        self.assertEqual(self.bridge.events[-1]['state'], 'dismissed')

    def test_stomp_while_the_other_foot_moves_is_not_a_dismiss(self):
        now, n = time.time() * 1000, 30
        rows = []
        for i in range(n):
            rows.append(sample('left', i, now, n, tap=0 if i < n - 1 else 1))
            rows.append(sample('right', i, now + 1, n, accel=(0.0, 0.0, 1.6 if i % 2 else 0.5)))
        self.consume(rows)
        self.assertFalse(self.bridge.snapshot()['suppression']['active'])


if __name__ == '__main__':
    unittest.main()
