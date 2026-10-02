"""Local sensor history -> calibrated RF/CNN inference -> web decision API.

The 8000 collector owns device polling; this process consumes sample history.
Use --esp32-url for the legacy single-foot direct HTTP transport.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import os
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(REPOSITORY_ROOT / 'ai_engine' / 'src'))
import numpy as np
import torch
from fog_validation.ml.config import TARGET_FS_HZ
from fog_validation.ml.live_detector import LiveFogDetector, load_axis_calibration

TARGET_HZ = float(TARGET_FS_HZ)
ARTIFACT_DIR = REPOSITORY_ROOT / 'ai_engine/data/processed/ml/model_artifact'
DATA_DIR = Path(os.environ.get('STEPON_AI_DATA_DIR', REPOSITORY_ROOT / '.stepon-data/ai'))
SIDES = ('left', 'right')
MAX_GAP_S = 5.0      # WiFi poll gaps up to 5 s are linearly interpolated; longer ones reset the window
MIN_INPUT_HZ = 8.0   # two boards on one hotspot deliver ~10-25 Hz, not the original 64 Hz
STALE_S = 2.0
DISMISS_SEC = 5.0          # triple stomp: both feet silent for this long, judgement windows restart
TAP_QUIET_STD_G = 0.15     # the other foot must be standing still (walking/shuffling is not a dismiss)
PC_TAP_THRESHOLD_G = 2.0   # fallback detector for boards without firmware tap counting
CUE_LEVEL = {'confirmed': 70, 'warning': 30}  # DRV2605 real-time strength; WARNING has no laser
CSV_COLUMNS = ['timestamp_ms', 'raw_acc_x', 'raw_acc_y', 'raw_acc_z', 'raw_gyro_x', 'raw_gyro_y', 'raw_gyro_z']
torch.set_num_threads(1)
if __package__:
    from .csv_pipeline import calibration_from_rows
    from .datasets import DatasetService, BODY_LIMIT
    from . import pressure_rules, personal_threshold
    from .pressure_normalization import WalkingPressurePeaks
else:
    from csv_pipeline import calibration_from_rows
    from datasets import DatasetService, BODY_LIMIT
    import pressure_rules
    import personal_threshold
    from pressure_normalization import WalkingPressurePeaks
SEVERITY = {None: 0, 'normal': 0, 'warning': 1, 'confirmed': 2}


def vector(value):
    if not isinstance(value, dict):
        raise ValueError('imu_vector_missing')
    values = [value.get(axis) for axis in 'xyz']
    if any(isinstance(v, bool) or not isinstance(v, (float, int)) for v in values):
        raise ValueError('imu_vector_invalid')
    result = np.asarray(values, dtype=float)
    if not np.isfinite(result).all():
        raise ValueError('imu_vector_invalid')
    return result


class TimeResampler:
    """Interpolate small timing gaps only, never fabricate long windows."""
    def __init__(self, target_hz=TARGET_HZ):
        self.period = 1 / target_hz
        self.reset()

    def reset(self):
        self.previous = None
        self.next_time = None

    def push(self, timestamp_s, accel, gyro, callback):
        if self.previous is None:
            self.previous = (timestamp_s, accel.copy(), gyro.copy())
            self.next_time = timestamp_s + self.period
            callback(accel, gyro, timestamp_s)
            return
        t, a, g = self.previous
        gap = timestamp_s - t
        if gap <= 0 or gap > MAX_GAP_S:
            raise ValueError('sample_gap_or_clock_reset')
        while self.next_time <= timestamp_s + 1e-9:
            ratio = min(1.0, max(0.0, (self.next_time - t) / gap))
            callback(a + ratio * (accel - a), g + ratio * (gyro - g), self.next_time)
            self.next_time += self.period
        self.previous = (timestamp_s, accel.copy(), gyro.copy())


class FootRuntime:
    def __init__(self, side, calibration_path, model_name, artifact_dir, data_dir=DATA_DIR):
        self.side, self.foot = side, 'L' if side == 'left' else 'R'
        self.calibration_path = Path(calibration_path) if calibration_path else None
        self.model_name, self.artifact_dir, self.data_dir = model_name, Path(artifact_dir), Path(data_dir)
        self.detector = None
        self.calibration_info = {}
        self.load_error = None
        self.error = None
        self.identity = None
        self.frame = None
        self.last_device_t = None
        self.last_received = None
        self.last_window_received = None
        self.last_window_epoch_ms = None
        self.times = deque()
        self.window_count = 0
        self.total_windows = 0
        self.accepted_samples = 0
        self.resets = 0
        self.state = None
        self.resampler = TimeResampler()
        self.capture = None
        self.capture_rows = []
        self.capture_path = None
        self.lock = threading.RLock()        # BridgeState replaces this with its own lock
        self.pressure_config = pressure_rules.load_config()
        self.pressure_rows = []              # (t, forefoot_raw, heel_raw) during calibration
        self.pressure_baseline = None
        self.pressure_normalization = None
        self.pressure_peaks = WalkingPressurePeaks(side)
        self.personal = None                 # per-wearer thresholds from the calibration walk
        self.personal_status = None
        self.last_pressure = None            # (pc_time_s, forefoot_raw, heel_raw) of the last accepted sample
        self._current_pressure = None
        self.cue_level_supported = False
        self.tap_count = None
        self.tap_supported = False
        self.pending_tap = False
        self.motion = deque()                # (pc_time_s, accel magnitude g) for the last 3 s
        self._pc_taps = deque()
        self._pc_tap_above = False
        self.on_calibrated = None            # BridgeState hook: new pressure baseline
        self.on_reset = None
        self._load_detector()

    def _load_detector(self):
        self.detector = None
        try:
            if self.calibration_path is None or not self.calibration_path.is_file():
                raise ValueError('calibration_missing')
            metadata = json.loads(self.calibration_path.read_text(encoding='utf-8'))
            if metadata.get('foot_side', self.side) != self.side:
                raise ValueError('calibration_foot_mismatch')
            cal = load_axis_calibration(self.calibration_path)
            if not np.isfinite([cal.vertical_confidence, cal.forward_confidence]).all() or min(cal.vertical_confidence, cal.forward_confidence) < 0.3:
                raise ValueError('calibration_low_confidence')
            self.detector = LiveFogDetector(cal, self.model_name, self.artifact_dir, self.foot)
            self.pressure_baseline = metadata.get('pressure_baseline')
            self.pressure_normalization = metadata.get('pressure_normalization')
            self.personal = metadata.get('personal_threshold')
            if self.personal:
                self._apply_personal()
            self.calibration_info = {
                'file': self.calibration_path.name, 'id': hashlib.sha256(self.calibration_path.read_bytes()).hexdigest(), 'device_id': metadata.get('device_id'),
                'foot_side': self.side, 'vertical_confidence': cal.vertical_confidence,
                'forward_confidence': cal.forward_confidence,
                'yaw_enabled': cal.gyro_yaw_idx is not None,
                'device_binding': 'verified_on_input' if metadata.get('device_id') else 'legacy_unbound',
                'pressure_baseline': bool(self.pressure_baseline and self.pressure_baseline.get('front_ok')),
                'personal_threshold': self.personal,
            }
            self.load_error = None
        except Exception as exc:
            self.detector = None
            self.load_error = str(exc)

    def _apply_personal(self):
        deploy = json.loads((self.artifact_dir / 'deploy_config.json').read_text(encoding='utf-8'))
        personal_threshold.apply(self.detector, self.personal, deploy['state_machine_defaults']['exit_margin'])

    def _profile_walk(self, rows, path, calibration_id):
        """Background: score the calibration walk with the new calibration, store per-wearer thresholds."""
        try:
            detector = LiveFogDetector(load_axis_calibration(path), self.model_name, self.artifact_dir, self.foot)
            base_enter = detector.state_machine.enter_threshold
            base_confirmed = detector.confirmed_threshold
            detector.confirmed_threshold = None
            walk_from = rows[0][0] / 1000 + 5 + 1 + 4  # windows made only of walking (5 s still + 1 s margin + 4 s window)
            scores, resampler = [], TimeResampler()

            def score(accel, gyro, t):
                if detector.push_sample({f'{self.foot}_raw_acc': accel, f'{self.foot}_raw_gyro': gyro}) is not None and t >= walk_from:
                    scores.append(detector.last_diagnostics.get('decision_score'))
            for row in rows:
                try:
                    resampler.push(row[0] / 1000, np.asarray(row[1:4], float), np.asarray(row[4:7], float), score)
                except ValueError:
                    resampler.reset()
            profile = personal_threshold.personal_thresholds(scores, base_enter, base_confirmed)
            with self.lock:
                # A newer calibration can finish while this walk is still scoring.
                if hashlib.sha256(path.read_bytes()).hexdigest() != calibration_id:
                    return
                metadata = json.loads(path.read_text(encoding='utf-8'))
                metadata['personal_threshold'] = profile
                pending = path.with_suffix('.pending.json')
                pending.write_text(json.dumps(metadata, indent=2), encoding='utf-8')
                pending.replace(path)
                self.personal_status = 'ready' if profile else 'too_few_walk_windows'
                if self.detector and self.calibration_info.get('id') == calibration_id and profile:
                    self.personal = profile
                    self._apply_personal()
                    self.calibration_info['personal_threshold'] = profile
                    self.calibration_info['id'] = hashlib.sha256(path.read_bytes()).hexdigest()
        except Exception as exc:
            with self.lock:
                self.personal_status = f'failed: {exc}'

    def reset(self, reason, keep_capture=False):
        self.resampler.reset()
        self.times.clear()
        self.window_count = 0
        self.last_window_received = None
        self.last_window_epoch_ms = None
        self.state = None
        self.last_device_t = None
        self.error = reason
        self.resets += 1
        self.last_pressure = self._current_pressure = None
        self.motion.clear()
        self._pc_taps.clear()
        self._pc_tap_above = self.pending_tap = False
        self.tap_count = None
        if self.on_reset:
            self.on_reset(self.side)
        if self.detector:
            self.detector.reset_stream()
        if not keep_capture and self.capture and self.capture['status'] in ('countdown', 'recording'):
            self.capture.update(status='failed', error=reason)
            self.capture_rows = []

    def input_hz(self):
        if len(self.times) < 2 or self.times[-1] <= self.times[0]:
            return 0.0
        return (len(self.times) - 1) / (self.times[-1] - self.times[0])

    def ingest(self, payload, received_at_ms=None):
        now = time.monotonic()
        try:
            if payload.get('foot_side', self.side) != self.side:
                raise ValueError('foot_side_mismatch')
            if payload.get('imu_ready', True) is not True:
                # A momentary IMU dropout is just a missing sample: the gap logic below
                # interpolates or resets as needed, so a 25 s calibration survives it.
                return False
            accel, gyro = vector(payload.get('accel')), vector(payload.get('gyro'))
            device_ms, frame = payload.get('millis'), payload.get('frame')
            if isinstance(device_ms, bool) or not isinstance(device_ms, (int, float)) or not np.isfinite(device_ms) or device_ms < 0:
                raise ValueError('invalid_device_clock')
            if isinstance(frame, bool) or not isinstance(frame, int) or frame < 0:
                raise ValueError('invalid_frame')
            identity = (payload.get('device_id', self.side), payload.get('boot_id', 'legacy'))
            if self.identity is not None and identity != self.identity:
                self.reset('device_restarted_or_replaced')
                self.frame = None
            self.identity = identity
            expected = self.calibration_info.get('device_id')
            if expected and expected != identity[0]:
                self.detector = None
                self.load_error = 'calibration_device_mismatch'
                self.pressure_baseline = None
                self.pressure_normalization = None
                self.personal = None
                if self.on_calibrated:
                    self.on_calibrated(self.side, None)
                # Keep receiving raw measurements so the replacement device can be recalibrated.
            if frame == self.frame:
                return False
            t = device_ms / 1000.0
            if self.last_device_t is not None and t <= self.last_device_t:
                # Out-of-order/duplicate delivery from the hub's merged two-foot stream.
                # A real reboot is already caught by the boot_id check above, so drop
                # only this sample instead of wiping the accumulated window.
                return False
            if self.last_device_t is not None and t - self.last_device_t > MAX_GAP_S:
                # Long poll gap: restart the analysis window but keep an in-progress
                # calibration recording instead of failing all 25 s.
                self.reset('sample_gap_recovered', keep_capture=True)
            age = max(0, (time.time() * 1000 - received_at_ms) / 1000) if received_at_ms is not None else 0
            if age > STALE_S:
                raise ValueError('sample_backlog_stale')
            self.last_received = now - age
            self.frame, self.last_device_t = frame, t
            self.accepted_samples += 1
            self.times.append(t)
            while self.times and t - self.times[0] > 4.01:
                self.times.popleft()
            self.error = None
            pc_t = received_at_ms / 1000 if received_at_ms is not None else time.time()
            fh = pressure_rules.front_heel(payload, self.side, self.pressure_config)
            self._current_pressure = fh
            self.last_pressure = (pc_t, *fh) if fh else None
            self.cue_level_supported = payload.get('cue_level_supported') is True
            self._track_motion(pc_t, accel, payload)
            self._capture_sample(t, accel, gyro, self.last_received, payload)
            self.resampler.push(t, accel, gyro, self._score_sample)
            return True
        except (ValueError, TypeError, KeyError) as exc:
            self.reset(str(exc))
            return False

    def _track_motion(self, pc_t, accel, payload):
        """Keep 3 s of accel magnitude and flag a triple-stomp candidate (BridgeState confirms it)."""
        magnitude = float(np.linalg.norm(accel))
        self.motion.append((pc_t, magnitude))
        while self.motion and pc_t - self.motion[0][0] > 3.0:
            self.motion.popleft()
        count = payload.get('tap_gesture_count')
        self.tap_supported = payload.get('tap_api_version') == 1 and isinstance(count, int) and not isinstance(count, bool)
        if self.tap_supported:
            # Firmware counts stomps at 64 Hz; a new count is one completed triple stomp.
            if self.tap_count is not None and count > self.tap_count:
                self.pending_tap = True
            self.tap_count = count
            return
        # Older firmware: rising edges above PC_TAP_THRESHOLD_G at ~20 Hz, 3 within 2 s, 0.2-0.9 s apart.
        above = magnitude >= PC_TAP_THRESHOLD_G
        if above and not self._pc_tap_above:
            if self._pc_taps and pc_t - self._pc_taps[-1] > 0.9:
                self._pc_taps.clear()
            if not self._pc_taps or pc_t - self._pc_taps[-1] >= 0.2:  # closer edges = one stomp's rebound
                self._pc_taps.append(pc_t)
            if len(self._pc_taps) >= 3 and pc_t - self._pc_taps[-3] <= 2.0:
                self.pending_tap = True
                self._pc_taps.clear()
        self._pc_tap_above = above

    def motion_std(self, now, seconds=1.5):
        values = [m for t, m in self.motion if now - t <= seconds]
        return float(np.std(values)) if len(values) >= 5 else None

    def _score_sample(self, accel, gyro, timestamp):
        if not getattr(self, 'detection_enabled', True) or not self.detector or (self.capture and self.capture['status'] in ('countdown', 'recording', 'failed')):
            return
        decision = self.detector.push_sample({f'{self.foot}_raw_acc': accel, f'{self.foot}_raw_gyro': gyro})
        if decision is None:
            return
        if self.input_hz() < MIN_INPUT_HZ:
            self.detector.reset_stream()
            self.state = None
            self.window_count = 0
            self.last_window_received = None
            self.last_window_epoch_ms = None
            self.error = 'insufficient_sample_rate'
            return
        self.state = decision
        self.window_count += 1
        self.total_windows += 1
        self.last_window_received = self.last_received
        self.last_window_epoch_ms = int((time.time() - (time.monotonic() - self.last_received)) * 1000)

    def start_calibration(self):
        if self.last_received is None or time.monotonic() - self.last_received > STALE_S or self.error:
            raise ValueError('connect_valid_imu_first')
        if self.capture and self.capture['status'] in ('countdown', 'recording'):
            raise ValueError('calibration_already_running')
        self.reset('calibrating')
        self.capture_rows = []
        self.pressure_rows = []
        self.capture = {'status': 'countdown', 'starts_at': time.monotonic() + 3,
                        'elapsed_sec': 0, 'duration_sec': 25, 'still_sec': 5, 'error': None}
        self.pressure_peaks = WalkingPressurePeaks(self.side)

    def cancel_calibration(self):
        if self.capture:
            self.capture.update(status='cancelled')
        self.capture_rows = []
        self.reset('calibration_cancelled')

    def _capture_sample(self, t, accel, gyro, received, payload=None):
        c = self.capture
        if not c or c['status'] not in ('countdown', 'recording') or received < c['starts_at']:
            return
        if c['status'] == 'countdown':
            c.update(status='recording', first_t=t)
        elapsed = t - c['first_t']
        c['elapsed_sec'] = round(elapsed, 1)
        self.pressure_peaks.observe(payload, elapsed, c['still_sec'], c['duration_sec'])
        self.capture_rows.append([t * 1000, *accel.tolist(), *gyro.tolist()])
        if self._current_pressure:
            self.pressure_rows.append((t, *self._current_pressure))
        if elapsed < c['duration_sec']:
            return
        try:
            rows = np.asarray(self.capture_rows)
            result = calibration_from_rows(rows, self.side, self.identity[0])
            # Quiet-standing pressure (first 5 s) and walking stride time for the pressure rules.
            result['pressure_baseline'] = pressure_rules.baseline_from_rows(self.pressure_rows, self.pressure_config, c['still_sec'])
            result['pressure_normalization'] = self.pressure_peaks.finish()
            self.data_dir.mkdir(parents=True, exist_ok=True)
            stamp = time.time_ns()
            self.capture_path = self.data_dir / f'{self.side}-{stamp}.csv'
            with self.capture_path.open('w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(CSV_COLUMNS)
                writer.writerows(self.capture_rows)
            self.calibration_path = self.data_dir / f'{self.side}.calibration.json'
            pending = self.calibration_path.with_suffix('.pending.json')
            pending.write_text(json.dumps(result, indent=2), encoding='utf-8')
            load_axis_calibration(pending)
            pending.replace(self.calibration_path)
            c.update(status='complete', file=self.calibration_path.name)
            self._load_detector()
            if self.load_error:
                c.update(status='failed', error=self.load_error)
            else:
                self.personal_status = 'scoring_walk'
                threading.Thread(target=self._profile_walk, daemon=True,
                                 args=(list(self.capture_rows), self.calibration_path, self.calibration_info.get('id'))).start()
            self.reset('warming_up')
            if self.on_calibrated:
                self.on_calibrated(self.side, self.pressure_baseline)
        except Exception as exc:
            c.update(status='failed', error=str(exc))
            self.reset('calibration_failed')
        finally:
            self.capture_rows = []
            self.pressure_rows = []

    def snapshot(self):
        now = time.monotonic()
        connected = self.last_received is not None and now - self.last_received <= STALE_S
        if not connected and (self.window_count or (self.capture and self.capture['status'] in ('countdown', 'recording'))):
            self.reset('device_offline', keep_capture=True)
        capturing = self.capture and self.capture['status'] in ('countdown', 'recording')
        capture_failed = self.capture and self.capture['status'] == 'failed'
        current = self.last_window_received is not None and now - self.last_window_received <= STALE_S
        ready = bool(connected and current and self.detector and self.window_count and not self.error and not capturing and not capture_failed)
        status = 'calibrating' if capturing else 'calibration_failed' if capture_failed else 'calibration_missing' if self.load_error == 'calibration_missing' else 'unavailable' if not self.detector else 'device_offline' if not connected else 'invalid_data' if self.error and self.error not in ('warming_up', 'calibration_cancelled', 'dismissed') else self.state if ready else 'warming_up'
        diag = dict(self.detector.last_diagnostics) if ready else {}
        capture = {k: v for k, v in (self.capture or {}).items() if k not in ('first_t', 'starts_at')}
        if capturing:
            capture['countdown_sec'] = max(0, round(self.capture['starts_at'] - now, 1))
        return {'side': self.side, 'status': status, 'ready': ready, 'state': self.state if ready else None,
                'fog_score': diag.get('raw_model_score'), 'decision_score': diag.get('decision_score'),
                'score_percent': round(diag['decision_score'] * 100, 1) if ready else None,
                'diagnostics': diag, 'device_connected': connected, 'detector_loaded': self.detector is not None,
                'last_window_at_ms': self.last_window_epoch_ms if ready else None,
                'window_ready': ready, 'window_count': self.window_count, 'total_windows': self.total_windows,
                'received_hz': round(self.input_hz(), 1), 'sample_rate_hz': TARGET_HZ,
                'accepted_samples': self.accepted_samples, 'resets': self.resets, 'device_id': self.identity[0] if self.identity else None,
                'boot_id': self.identity[1] if self.identity else None,
                'last_error': self.load_error or (self.error if self.error != 'dismissed' else None),
                'calibration': self.calibration_info, 'capture': capture,
                'personal_threshold': self.personal, 'personal_status': self.personal_status,
                'pressure_baseline': self.pressure_baseline,
                'pressure_normalization': self.pressure_normalization,
                'cue_level_supported': self.cue_level_supported, 'tap_supported': self.tap_supported,
                'pressure_gate_enabled': False, 'pressure_note': 'model_gates_ignore_pressure; see top-level pressure rules'}


class BridgeState:
    def __init__(self, esp32_url=None, calibration_path=None, model_name='ensemble', artifact_dir=ARTIFACT_DIR,
                 hub_url='http://127.0.0.1:8000', foot='right', data_dir=DATA_DIR, calibrations=None):
        self.esp32_url = esp32_url.rstrip('/') if esp32_url else None
        self.hub_url = hub_url.rstrip('/')
        self.model_name, self.foot = model_name, foot
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.detection_path = Path(data_dir) / 'fog-detection-settings.json'
        self.detection_enabled = True
        self.detection_changed_at_ms = 0
        try:
            settings = json.loads(self.detection_path.read_text(encoding='utf-8'))
            self.detection_enabled = isinstance(settings, dict) and settings.get('enabled') is True
        except FileNotFoundError:
            pass
        except (ValueError, OSError):
            self.detection_enabled = False
        self.stream_id, self.cursor = None, 0
        paths = dict(calibrations or {})
        if calibration_path:
            paths[foot] = calibration_path
        self.feet = {s: FootRuntime(s, paths.get(s, Path(data_dir) / f'{s}.calibration.json'), model_name, artifact_dir, data_dir)
                     for s in ((foot,) if esp32_url else SIDES)}
        for runtime in self.feet.values():
            runtime.detection_enabled = self.detection_enabled
        digest = hashlib.sha256()
        try:
            for name in ('rf_model.joblib', 'cnn_model.pt', 'deploy_config.json'):
                with (Path(artifact_dir) / name).open('rb') as model_file:
                    for chunk in iter(lambda: model_file.read(1024 * 1024), b''):
                        digest.update(chunk)
            self.artifact_id = digest.hexdigest()
        except OSError:
            self.artifact_id = None
        self.events = deque(maxlen=200)
        self.last_decision = None
        self.source_error = None
        self.datasets = DatasetService(data_dir, artifact_dir, self.artifact_id, model_name)
        if __package__:
            from .fog_cue import FogCueController
        else:
            from fog_cue import FogCueController
        self.cue = FogCueController(self, data_dir)
        self.rules = pressure_rules.PressureRules(pressure_rules.load_config())
        self.suppress_until = 0.0
        self.suppress_foot = None
        self.last_rules_at = None
        for side, runtime in self.feet.items():
            runtime.lock = self.lock
            runtime.on_calibrated = self.rules.set_baseline
            runtime.on_reset = self.rules.reset_side
            self.rules.set_baseline(side, runtime.pressure_baseline)

    def set_detection_enabled(self, enabled):
        if not isinstance(enabled, bool):
            raise ValueError('enabled must be boolean')
        with self.lock:
            self.detection_path.parent.mkdir(parents=True, exist_ok=True)
            pending = self.detection_path.with_suffix('.pending')
            pending.write_text(json.dumps({'enabled': enabled}), encoding='utf-8')
            pending.replace(self.detection_path)
            if self.detection_enabled == enabled:
                return
            self.detection_enabled = enabled
            self.detection_changed_at_ms = int(time.time() * 1000)
            self.last_decision = None
            self.rules.reset()
            self.last_rules_at = None
            self.suppress_until = 0.0
            self.suppress_foot = None
            for runtime in self.feet.values():
                runtime.detection_enabled = enabled
                runtime.reset('warming_up' if enabled else 'detection_paused', keep_capture=True)

    def _after_ingest(self, runtime):
        """Pressure-rule input and triple-stomp handling for one accepted sample."""
        calibrating = any(r.capture and r.capture['status'] in ('countdown', 'recording') for r in self.feet.values())
        if not self.detection_enabled or calibrating or self.suppression()['active']:
            runtime.pending_tap = False
            self.rules.reset()
            self.last_rules_at = None
            return
        if runtime.last_pressure:
            self.rules.push(runtime.side, *runtime.last_pressure)
            self.last_rules_at = runtime.last_pressure[0]
        if runtime.pending_tap:
            runtime.pending_tap = False
            now = runtime.motion[-1][0] if runtime.motion else time.time()
            others = [r.motion_std(now) for s, r in self.feet.items() if s != runtime.side and r.last_received is not None]
            if not calibrating and all(v is None or v < TAP_QUIET_STD_G for v in others):
                self.dismiss(runtime.side)

    def dismiss(self, side):
        """Triple stomp: both feet silent for DISMISS_SEC and every judgement window restarts."""
        with self.lock:
            self.suppress_until = time.time() + DISMISS_SEC
            self.suppress_foot = side
            for runtime in self.feet.values():
                runtime.reset('dismissed', keep_capture=True)
            self.rules.reset()
            self.events.append({'timestamp_ms': int(time.time() * 1000), 'foot': side, 'state': 'dismissed',
                                'fog_score': None, 'decision_score': None, 'reason': 'triple_stomp'})

    def suppression(self):
        remaining = self.suppress_until - time.time()
        return {'active': remaining > 0, 'remaining_sec': round(max(0.0, remaining), 1),
                'duration_sec': DISMISS_SEC, 'foot': self.suppress_foot if remaining > 0 else None}

    def consume(self, payload):
        with self.lock:
            if self.esp32_url:
                runtime = self.feet[self.foot]
                if runtime.ingest(payload):
                    self.datasets.ingest(self.foot, payload)
                    self._after_ingest(runtime)
            else:
                if payload.get('service') != 'stepon-bilateral-v1' or not isinstance(payload.get('samples'), list):
                    raise ValueError('insole_history_api_required')
                changed = self.stream_id is not None and self.stream_id != payload.get('stream_id')
                if changed or payload.get('dropped'):
                    for runtime in self.feet.values():
                        runtime.reset('collector_restarted_or_history_lost')
                        runtime.frame = None
                self.stream_id = payload.get('stream_id')
                for row in payload['samples']:
                    if row.get('side') in self.feet:
                        runtime = self.feet[row['side']]
                        try:
                            if runtime.ingest(row['state'], row['received_at_ms']):
                                self.datasets.ingest(row['side'], row['state'])
                                self._after_ingest(runtime)
                        except Exception as exc:
                            runtime.reset(f'inference_failed: {exc}')
                self.cursor = payload['next_cursor']
                for side, runtime in self.feet.items():
                    if not payload.get('feet', {}).get(side, {}).get('connected'):
                        if runtime.window_count or runtime.last_device_t is not None:
                            runtime.reset('device_offline', keep_capture=True)
                        runtime.last_received = None
            self.source_error = None
            snap = self.snapshot()
            key = (snap['selected_foot'], snap['state'], tuple(snap['reasons']))
            if snap['window_ready'] and key != self.last_decision:
                self.events.append({'timestamp_ms': int(time.time() * 1000), 'foot': key[0], 'state': key[1],
                                    'fog_score': snap['fog_score'], 'decision_score': snap['decision_score'],
                                    'reason': snap['diagnostics'].get('reason'), 'reasons': snap['reasons']})
            self.last_decision = key

    def poll_device(self):
        while not self.stop.is_set():
            started = time.monotonic()
            try:
                url = f'{self.esp32_url}/api/state' if self.esp32_url else f'{self.hub_url}/api/insoles/samples?after={self.cursor}&limit=512'
                with urlopen(Request(url, headers={'Accept': 'application/json'}), timeout=1) as response:
                    body = response.read(2_000_001)
                if len(body) > 2_000_000:
                    raise ValueError('source_response_too_large')
                self.consume(json.loads(body))
            except Exception as exc:
                with self.lock:
                    self.source_error = f'source_unreachable: {exc}'
                    for runtime in self.feet.values():
                        if runtime.window_count or runtime.last_device_t is not None:
                            runtime.reset('source_unreachable')
                        runtime.last_received = None
            self.datasets.tick()
            interval = 1 / TARGET_HZ if self.esp32_url else 0.05
            self.stop.wait(max(0.001, interval - (time.monotonic() - started)))

    def _pressure_decision(self, ai_state):
        """Evaluate the pressure rules at the newest pressure sample (stale -> no pressure output)."""
        if self.last_rules_at is None or time.time() - self.last_rules_at > STALE_S:
            return {'state': None, 'rules': {}, 'reasons': []}
        return self.rules.evaluate(self.last_rules_at, ai_state)

    def snapshot(self):
        with self.lock:
            feet = {s: runtime.snapshot() for s, runtime in self.feet.items()}
            suppression = self.suppression()
            blocked = 'detection_paused' if not self.detection_enabled else 'dismissed' if suppression['active'] else None
            if blocked:
                for foot in feet.values():
                    foot.update(ready=False, window_ready=False, status=blocked, state=None,
                                fog_score=None, decision_score=None, score_percent=None, diagnostics={})
            ready = [s for s in feet.values() if s['ready']]
            selected = max(ready, key=lambda s: (SEVERITY.get(s['state'], -1), s['decision_score'])) if ready else None
            fallback = next((s for s in feet.values() if s['status'] == 'calibrating'), None) or next((s for s in feet.values() if s['device_connected']), None) or next(iter(feet.values()))
            result = selected or fallback
            ai_state = selected['state'] if selected else None
            calibrating = any(f['status'] == 'calibrating' for f in feet.values())
            pressure = {'state': None, 'rules': {}, 'reasons': []} if blocked or calibrating else self._pressure_decision(ai_state)
            # Final output = the stronger of the AI decision and the pressure rules.
            state, reasons = ai_state, []
            if ai_state in ('warning', 'confirmed'):
                reasons.append('ai_' + ai_state)
            if SEVERITY[pressure['state']] > SEVERITY[state]:
                state = pressure['state']
            reasons += pressure['reasons']
            decided = bool(selected) or pressure['state'] is not None
            last_window = selected['last_window_at_ms'] if selected else (int(self.last_rules_at * 1000) if decided else None)
            return {'service': 'stepon-ai-bridge', 'api_version': 2, 'ok': decided, 'ready': decided,
                    'status': blocked or (state if decided else result['status']),
                    'detection': {'enabled': self.detection_enabled, 'changed_at_ms': self.detection_changed_at_ms},
                    'state': state if decided else None, 'ai_state': ai_state,
                    'decision_source': ('ai_and_pressure' if selected else 'pressure') if pressure['state'] else ('ai' if selected else None),
                    'fog_score': selected['fog_score'] if selected else None,
                    'decision_score': selected['decision_score'] if selected else None,
                    'score_percent': selected['score_percent'] if selected else None,
                    'diagnostics': selected['diagnostics'] if selected else {}, 'selected_foot': selected['side'] if selected else None,
                    'reasons': reasons, 'pressure': {**self.rules.snapshot(), **pressure},
                    'suppression': suppression,
                    'aggregation': 'highest_state_then_decision_score', 'coverage': len(ready), 'feet': feet,
                    'model': self.model_name, 'artifact_id': self.artifact_id,
                    'last_window_at_ms': last_window, 'device_connected': any(s['device_connected'] for s in feet.values()),
                    'detector_loaded': any(s['detector_loaded'] for s in feet.values()), 'window_ready': decided,
                    'window_count': sum(s['window_count'] for s in feet.values()), 'sample_rate_hz': TARGET_HZ,
                    'window_sec': 4, 'hop_sec': 0.5, 'calibration': result['calibration'],
                    'last_error': self.source_error or (result['last_error'] if not decided else None),
                    'source': 'esp32' if self.esp32_url else 'insole_hub', 'device_url': self.esp32_url or self.hub_url,
                    'cue': self.cue.snapshot()}

    def cue_plan(self):
        """What both insoles should output now: one combined decision drives both feet."""
        snap = self.snapshot()
        state = snap['state'] if snap['ready'] else None
        stamp = snap['last_window_at_ms']
        fresh = isinstance(stamp, (int, float)) and 0 <= time.time() * 1000 - stamp <= 2000
        calibrating = any(f.get('capture', {}).get('status') in ('countdown', 'recording') for f in snap['feet'].values())
        if not self.detection_enabled or calibrating or snap['suppression']['active'] or not fresh or state not in CUE_LEVEL:
            return {'state': None, 'level': 0, 'laser': False, 'suppressed': snap['suppression']['active']}
        return {'state': state, 'level': CUE_LEVEL[state], 'laser': state == 'confirmed', 'suppressed': False}


class BridgeHandler(BaseHTTPRequestHandler):
    bridge: BridgeState

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        route = urlparse(self.path).path
        try:
            if route in ('/api/ai/state', '/api/ai/ping'):
                self.send_json(200, self.bridge.snapshot())
            elif route == '/api/ai/events':
                with self.bridge.lock:
                    self.send_json(200, {'events': list(self.bridge.events)})
            elif route == '/api/ai/datasets':
                query = parse_qs(urlparse(self.path).query)
                context = None
                if query:
                    from_context = {key: query.get(key, [''])[0] for key in ('participant_id', 'session_id', 'side', 'placement')}
                    if __package__:
                        from .csv_pipeline import metadata
                    else:
                        from csv_pipeline import metadata
                    context = metadata(from_context)
                self.send_json(200, self.bridge.datasets.list(context))
            elif route.startswith('/api/ai/datasets/'):
                parts = route.removeprefix('/api/ai/datasets/').split('/')
                if len(parts) == 1:
                    self.send_json(200, self.bridge.datasets.status(parts[0]))
                elif len(parts) == 2:
                    data = self.bridge.datasets.download(*parts)
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/csv; charset=utf-8' if parts[1].endswith('.csv') else 'application/json; charset=utf-8')
                    self.send_header('Content-Disposition', f'attachment; filename="{parts[0]}-{parts[1]}"')
                    self.send_header('Content-Length', str(len(data)))
                    self.send_header('Cache-Control', 'no-store')
                    self.send_header('X-Content-Type-Options', 'nosniff')
                    self.end_headers()
                    self.wfile.write(data)
                else:
                    self.send_json(404, {'error': 'not_found'})
            else:
                self.send_json(404, {'error': 'not_found'})
        except (ValueError, OSError) as exc:
            self.send_json(400, {'error': str(exc)})

    def do_POST(self):
        if self.headers.get('Origin') and urlparse(self.headers['Origin']).netloc != self.headers.get('Host'):
            return self.send_json(403, {'error': 'cross_origin_write_denied'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.send_json(415, {'error': 'json_required'})
        try:
            route = urlparse(self.path).path
            limit = BODY_LIMIT if route in ('/api/ai/datasets/analyze', '/api/ai/datasets/validate') else 4096
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= limit:
                return self.send_json(413, {'error': 'body_too_large_or_empty'})
            self.connection.settimeout(30)
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError('json_object_required')
            if route == '/api/ai/cue':
                self.bridge.cue.set_enabled(body.get('enabled'))
                return self.send_json(200, self.bridge.snapshot())
            if route == '/api/ai/detection':
                self.bridge.set_detection_enabled(body.get('enabled'))
                return self.send_json(200, self.bridge.snapshot())
            if route == '/api/ai/datasets/validate':
                return self.send_json(200, self.bridge.datasets.validate(body))
            if route == '/api/ai/datasets/analyze':
                return self.send_json(202, self.bridge.datasets.analyze(body))
            if route == '/api/ai/datasets/record/stop':
                return self.send_json(200, self.bridge.datasets.finish_recording(body.get('id')))
            side = body.get('side')
            with self.bridge.lock:
                if side not in self.bridge.feet:
                    raise ValueError('invalid_side')
                runtime = self.bridge.feet[side]
                if route == '/api/ai/datasets/record/start':
                    return self.send_json(201, self.bridge.datasets.start_recording(body, runtime))
                if route == '/api/ai/calibration/start':
                    if self.bridge.datasets.list()['active_recording']:
                        raise ValueError('CSV 수집이 끝난 뒤 실시간 개인 보정을 시작하세요.')
                    runtime.start_calibration()
                elif route == '/api/ai/calibration/cancel':
                    runtime.cancel_calibration()
                else:
                    return self.send_json(404, {'error': 'not_found'})
                self.send_json(200, self.bridge.snapshot())
        except (ValueError, AttributeError, TypeError, OSError) as exc:
            self.send_json(400, {'error': str(exc)})

    def log_message(self, fmt, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--esp32-url', default=os.environ.get('STEPON_ESP32_URL'))
    parser.add_argument('--hub-url', default=os.environ.get('STEPON_HUB_URL', 'http://127.0.0.1:8000'))
    parser.add_argument('--calibration', type=Path, default=os.environ.get('STEPON_AI_CALIBRATION'))
    parser.add_argument('--calibration-left', type=Path)
    parser.add_argument('--calibration-right', type=Path)
    parser.add_argument('--foot', choices=SIDES, default='right')
    parser.add_argument('--model', choices=('rf', 'cnn', 'ensemble'), default=os.environ.get('STEPON_AI_MODEL', 'ensemble'))
    parser.add_argument('--artifact-dir', type=Path, default=os.environ.get('STEPON_AI_ARTIFACT_DIR', ARTIFACT_DIR))
    parser.add_argument('--data-dir', type=Path, default=DATA_DIR)
    parser.add_argument('--host', default=os.environ.get('STEPON_AI_HOST', '127.0.0.1'))
    parser.add_argument('--port', type=int, default=int(os.environ.get('STEPON_AI_PORT', '8787')))
    args = parser.parse_args()
    calibrations = {s: getattr(args, f'calibration_{s}') for s in SIDES if getattr(args, f'calibration_{s}')}
    bridge = BridgeState(args.esp32_url, args.calibration, args.model, args.artifact_dir, args.hub_url, args.foot, args.data_dir, calibrations)
    BridgeHandler.bridge = bridge
    server = ThreadingHTTPServer((args.host, args.port), BridgeHandler)
    worker = threading.Thread(target=bridge.poll_device, daemon=True)
    worker.start()
    bridge.cue.start()
    print(f'StepOn AI API: http://{args.host}:{args.port}/api/ai/state', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        bridge.stop.set()
        bridge.cue.close()
        bridge.datasets.close()
        server.server_close()
        worker.join(timeout=2)


if __name__ == '__main__':
    main()
