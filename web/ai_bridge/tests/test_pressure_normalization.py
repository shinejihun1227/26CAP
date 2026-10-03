"""Synthetic standing reference checks, not physical pressure validation."""
import copy
import unittest
from web.ai_bridge.pressure_normalization import StandingPressureReference


def frame(values, shared=False, side='left'):
    return {'device_id': 'test-' + side, 'foot_side': side, 'pressure_ready': True,
            'imu_ready': True, 'accel': {'x': 0, 'y': 0, 'z': 1}, 'gyro': {'x': 0, 'y': 0, 'z': 0},
            'sensor_profile': 'two-shared' if shared else 'four-independent',
            'pressure_channels': [0, 0, 1, 1] if shared else [0, 2, 4, 6],
            'pressure_sensor_map': [0, 0, 1, 1] if shared else [0, 1, 2, 3], 'pressure_raw': values}


def standing(reference, payload, count=100):
    for i in range(count):
        reference.observe(payload, i / 20)


class PressureNormalizationTests(unittest.TestCase):
    def test_only_first_five_seconds_define_fixed_median_not_walking_peaks(self):
        reference = StandingPressureReference('left')
        for i in range(100):
            reference.observe(frame([500, 1000, 1500, 2000] if i > 2 else [4095]*4), i / 20)
        for i in range(401):
            reference.observe(frame([4095]*4), 5 + i / 20)
        result = reference.finish()
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(result['method'], 'standing-50-v1')
        self.assertEqual(result['version'], 2)
        self.assertEqual(result['reference_raw'], [500, 1000, 1500, 2000])
        self.assertEqual(result['reference_score'], 50)
        self.assertEqual(result['samples'], 100)
        self.assertEqual(result['span_sec'], 4.95)

    def test_shared_sensors_have_identical_reference_without_four_fake_values(self):
        reference = StandingPressureReference('right')
        standing(reference, frame([400, 400, 800, 800], True, 'right'))
        result = reference.finish()
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(result['physical_count'], 2)
        self.assertEqual(result['sensor_map'], [0, 0, 1, 1])
        self.assertEqual(result['reference_raw'], [400, 400, 800, 800])

    def test_unloaded_missing_moving_and_too_short_cannot_form_reference(self):
        for values in ([0]*4, [10, 800, 800, 800], [float('nan')]*4, [True]*4, [5000]*4):
            reference = StandingPressureReference('left')
            standing(reference, frame(values))
            self.assertEqual(reference.finish()['status'], 'incomplete')
        for broken in ({'pressure_ready': False}, {'pressure_raw': None}, {'foot_side': 'right'},
                       {'imu_ready': False}, {'accel': {'x': 0, 'y': 0, 'z': 1.5}},
                       {'gyro': {'x': 20, 'y': 0, 'z': 0}}, {'gyro': None}):
            reference = StandingPressureReference('left')
            standing(reference, {**frame([1000]*4), **broken})
            self.assertEqual(reference.finish()['samples'], 0)
        reference = StandingPressureReference('left')
        standing(reference, frame([1000]*4), count=40)
        self.assertEqual(reference.finish()['status'], 'incomplete')

    def test_device_wiring_or_direct_pin_changes_during_walk_invalidate_reference(self):
        for change in ({'device_id': 'another'}, {'pressure_channels': [0, 1, 2, 3]},
                       {'pressure_input_gpio': [34, 35, 33, 32]}):
            reference = StandingPressureReference('left')
            standing(reference, frame([1000]*4))
            reference.observe({**frame([1000]*4), **change}, 10)
            self.assertEqual(reference.finish()['status'], 'incomplete')

    def test_capture_does_not_modify_input_or_reuse_previous_reference(self):
        payload = frame([500, 1000, 1500, 2000])
        original = copy.deepcopy(payload)
        reference = StandingPressureReference('left')
        standing(reference, payload)
        reference.observe(payload, 0)
        self.assertEqual(reference.finish()['samples'], 100)
        self.assertEqual(payload, original)
        empty = StandingPressureReference('left').finish()
        self.assertNotEqual(reference.finish()['id'], empty['id'])
        self.assertEqual(empty['reference_raw'], [0]*4)

    def test_direct_four_sensor_contract_is_retained(self):
        reference = StandingPressureReference('left')
        payload = {**frame([400, 600, 800, 1000]), 'pressure_channels': [0, 1, 2, 3],
                   'pressure_input_gpio': [34, 35, 32, 33], 'pressure_transport': 'direct-adc1'}
        standing(reference, payload)
        result = reference.finish()
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(result['pressure_input_gpio'], [34, 35, 32, 33])


if __name__ == '__main__':
    unittest.main()
