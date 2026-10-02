"""Per-physical-sensor peaks from the walking part of IMU calibration only."""
import math
import uuid


class WalkingPressurePeaks:
    def __init__(self, side):
        self.side = side
        self.contract = None
        self.maxima = [0.0] * 4
        self.samples = 0
        self.first = self.last = None
        self.invalidated = False

    def observe(self, payload, elapsed, still_sec=5, duration_sec=25):
        if not payload or not still_sec <= elapsed <= duration_sec or payload.get('pressure_ready') is not True:
            return
        values = payload.get('pressure_raw')
        if not isinstance(values, list) or len(values) != 4 or any(
                isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 4095 for v in values):
            return
        shared = payload.get('sensor_profile') == 'two-shared'
        channels = payload.get('pressure_channels')
        sensor_map = payload.get('pressure_sensor_map', [0, 1, 2, 3])
        if shared:
            if channels != [0, 0, 1, 1] or sensor_map != channels or values[0] != values[1] or values[2] != values[3]:
                return
        elif channels not in ([0, 2, 4, 6], [0, 1, 2, 3]) or sensor_map != [0, 1, 2, 3]:
            return
        contract = {'device_id': payload.get('device_id'), 'foot_side': self.side,
                    'sensor_profile': 'two-shared' if shared else 'four-independent',
                    'pressure_channels': list(channels), 'sensor_map': list(sensor_map)}
        if not contract['device_id'] or payload.get('foot_side') != self.side:
            return
        if self.contract is not None and self.contract != contract:
            self.invalidated = True
            return
        self.contract = contract
        self.maxima = [max(old, value) for old, value in zip(self.maxima, values)]
        self.samples += 1
        if self.first is None:
            self.first = elapsed
        self.last = elapsed

    def finish(self):
        span = self.last - self.first if self.first is not None else 0
        # A missing/unloaded channel must not amplify a tiny ADC noise floor.
        ready = not self.invalidated and self.samples >= 20 and span >= 10 and all(v >= 32 for v in self.maxima)
        return {**(self.contract or {}), 'version': 1, 'method': 'walk-max-v1',
                'id': uuid.uuid4().hex, 'status': 'ready' if ready else 'incomplete',
                'max_raw': self.maxima, 'samples': self.samples, 'span_sec': round(span, 3),
                'physical_count': 2 if self.contract and self.contract['sensor_profile'] == 'two-shared' else 4}
