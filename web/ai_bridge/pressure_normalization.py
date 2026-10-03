"""Fixed standing reference from the first five seconds of IMU calibration."""
import math
import statistics
import uuid


class StandingPressureReference:
    def __init__(self, side):
        self.side = side
        self.contract = None
        self.values = [[] for _ in range(4)]
        self.samples = 0
        self.first = self.last = None
        self.invalidated = False

    def observe(self, payload, elapsed, still_sec=5, duration_sec=25):
        if not payload or not 0 <= elapsed <= duration_sec or payload.get('pressure_ready') is not True:
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
                    'pressure_channels': list(channels), 'sensor_map': list(sensor_map),
                    'pressure_transport': payload.get('pressure_transport'),
                    'pressure_input_gpio': payload.get('pressure_input_gpio')}
        if not contract['device_id'] or payload.get('foot_side') != self.side:
            return
        if self.contract is not None and self.contract != contract:
            self.invalidated = True
            return
        self.contract = contract
        if elapsed >= still_sec:
            return  # Walking never moves the saved 50-point reference.
        try:
            accel = [payload['accel'][key] for key in ('x', 'y', 'z')]
            gyro = [payload['gyro'][key] for key in ('x', 'y', 'z')]
            if payload.get('imu_ready') is not True or any(
                    isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in accel + gyro):
                return
            if abs(math.hypot(*accel) - 1) > .12 or math.hypot(*gyro) > 12:
                return
        except (KeyError, TypeError):
            return
        if self.last is not None and elapsed <= self.last:
            return
        for collected, value in zip(self.values, values):
            collected.append(value)
        self.samples += 1
        if self.first is None:
            self.first = elapsed
        self.last = elapsed

    def finish(self):
        span = self.last - self.first if self.first is not None else 0
        # A missing/unloaded channel must not amplify a tiny ADC noise floor.
        reference = [float(statistics.median(values)) if values else 0 for values in self.values]
        ready = not self.invalidated and self.samples >= 20 and span >= 3 and all(v >= 32 for v in reference)
        return {**(self.contract or {}), 'version': 2, 'method': 'standing-50-v1',
                'id': uuid.uuid4().hex, 'status': 'ready' if ready else 'incomplete',
                'reference_raw': reference, 'reference_score': 50, 'statistic': 'median',
                'samples': self.samples, 'span_sec': round(span, 3),
                'physical_count': 2 if self.contract and self.contract['sensor_profile'] == 'two-shared' else 4}
