"""Synthetic calibration samples; no hardware or clinical validation."""
import copy
import unittest
from web.ai_bridge.pressure_normalization import WalkingPressurePeaks


def frame(values, shared=False, side='left'):
    return {'device_id': 'test-' + side, 'foot_side': side, 'pressure_ready': True,
            'sensor_profile': 'two-shared' if shared else 'four-independent',
            'pressure_channels': [0, 0, 1, 1] if shared else [0, 2, 4, 6],
            'pressure_sensor_map': [0, 0, 1, 1] if shared else [0, 1, 2, 3], 'pressure_raw': values}


class PressureNormalizationTests(unittest.TestCase):
    def test_only_walking_samples_define_each_peak(self):
        peaks = WalkingPressurePeaks('left')
        for i in range(100):
            peaks.observe(frame([4095] * 4), i / 20)
        for i in range(401):
            peaks.observe(frame([100 + i, 1000, 1500, 2000]), 5 + i / 20)
        peaks.observe(frame([4095] * 4), 25.05)
        result = peaks.finish()
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(result['max_raw'], [500, 1000, 1500, 2000])
        self.assertEqual(result['samples'], 401)
        self.assertEqual(result['span_sec'], 20)

    def test_shared_sensors_are_not_four_independent_peaks(self):
        peaks = WalkingPressurePeaks('right')
        for i in range(201):
            peaks.observe(frame([400, 400, 800, 800], True, 'right'), 5 + i / 10)
        result = peaks.finish()
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(result['physical_count'], 2)
        self.assertEqual(result['sensor_map'], [0, 0, 1, 1])
        self.assertEqual(result['max_raw'], [400, 400, 800, 800])

    def test_missing_zero_weak_and_too_short_do_not_create_a_reference(self):
        for values in ([0]*4, [10, 800, 800, 800], [float('nan')]*4, [True]*4, [5000]*4):
            peaks = WalkingPressurePeaks('left')
            for i in range(201):
                peaks.observe(frame(values), 5 + i / 10)
            self.assertEqual(peaks.finish()['status'], 'incomplete')
        for broken in ({'pressure_ready': False}, {'pressure_raw': None}, {'foot_side': 'right'}):
            peaks = WalkingPressurePeaks('left')
            peaks.observe({**frame([1000]*4), **broken}, 5)
            self.assertEqual(peaks.finish()['samples'], 0)
        peaks = WalkingPressurePeaks('left')
        for i in range(20):
            peaks.observe(frame([1000]*4), 5 + i / 10)
        self.assertEqual(peaks.finish()['status'], 'incomplete')

    def test_changed_wiring_or_device_invalidates_collection(self):
        for change in ({'device_id': 'another'}, {'pressure_channels': [0, 1, 2, 3]}):
            peaks = WalkingPressurePeaks('left')
            for i in range(201):
                peaks.observe(frame([1000]*4), 5 + i / 10)
            peaks.observe({**frame([1000]*4), **change}, 25)
            self.assertEqual(peaks.finish()['status'], 'incomplete')

    def test_capture_does_not_mutate_sensor_data_or_reuse_previous_walk(self):
        payload = frame([500, 1000, 1500, 2000])
        original = copy.deepcopy(payload)
        peaks = WalkingPressurePeaks('left')
        for i in range(201):
            peaks.observe(payload, 5 + i / 10)
        self.assertEqual(payload, original)
        self.assertNotEqual(peaks.finish()['id'], WalkingPressurePeaks('left').finish()['id'])
        self.assertEqual(WalkingPressurePeaks('left').finish()['max_raw'], [0]*4)


if __name__ == '__main__':
    unittest.main()
