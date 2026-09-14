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
from urllib.parse import urlparse
from urllib.request import Request, urlopen

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / 'ai_engine' / 'src'))
import numpy as np
import torch
from fog_validation.ml.calibration import calibrate
from fog_validation.ml.config import TARGET_FS_HZ
from fog_validation.ml.live_detector import LiveFogDetector, load_axis_calibration

TARGET_HZ = float(TARGET_FS_HZ)
ARTIFACT_DIR = REPOSITORY_ROOT / 'ai_engine/data/processed/ml/model_artifact'
DATA_DIR = REPOSITORY_ROOT / '.stepon-data/ai'
SIDES = ('left', 'right')
MAX_GAP_S = 0.100
MIN_INPUT_HZ = 32.0
STALE_S = 2.0
CSV_COLUMNS = ['timestamp_ms', 'raw_acc_x', 'raw_acc_y', 'raw_acc_z', 'raw_gyro_x', 'raw_gyro_y', 'raw_gyro_z']
torch.set_num_threads(1)


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
            self.calibration_info = {
                'file': self.calibration_path.name, 'id': hashlib.sha256(self.calibration_path.read_bytes()).hexdigest(), 'device_id': metadata.get('device_id'),
                'foot_side': self.side, 'vertical_confidence': cal.vertical_confidence,
                'forward_confidence': cal.forward_confidence,
                'yaw_enabled': cal.gyro_yaw_idx is not None,
                'device_binding': 'verified_on_input' if metadata.get('device_id') else 'legacy_unbound',
            }
            self.load_error = None
        except Exception as exc:
            self.detector = None
            self.load_error = str(exc)

    def reset(self, reason):
        self.resampler.reset()
        self.times.clear()
        self.window_count = 0
        self.last_window_received = None
        self.last_window_epoch_ms = None
        self.state = None
        self.last_device_t = None
        self.error = reason
        self.resets += 1
        if self.detector:
            self.detector.reset_stream()
        if self.capture and self.capture['status'] in ('countdown', 'recording'):
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
                raise ValueError('imu_not_ready')
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
                # Keep receiving raw measurements so the replacement device can be recalibrated.
            if frame == self.frame:
                return False
            t = device_ms / 1000.0
            if self.last_device_t is not None and (t <= self.last_device_t or t - self.last_device_t > MAX_GAP_S):
                self.reset('sample_gap_or_clock_reset')
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
            self._capture_sample(t, accel, gyro, self.last_received)
            self.resampler.push(t, accel, gyro, self._score_sample)
            return True
        except (ValueError, TypeError, KeyError) as exc:
            self.reset(str(exc))
            return False

    def _score_sample(self, accel, gyro, timestamp):
        if not self.detector or (self.capture and self.capture['status'] in ('countdown', 'recording', 'failed')):
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
        self.capture = {'status': 'countdown', 'starts_at': time.monotonic() + 3,
                        'elapsed_sec': 0, 'duration_sec': 25, 'still_sec': 5, 'error': None}

    def cancel_calibration(self):
        if self.capture:
            self.capture.update(status='cancelled')
        self.capture_rows = []
        self.reset('calibration_cancelled')

    def _capture_sample(self, t, accel, gyro, received):
        c = self.capture
        if not c or c['status'] not in ('countdown', 'recording') or received < c['starts_at']:
            return
        if c['status'] == 'countdown':
            c.update(status='recording', first_t=t)
        elapsed = t - c['first_t']
        c['elapsed_sec'] = round(elapsed, 1)
        self.capture_rows.append([t * 1000, *accel.tolist(), *gyro.tolist()])
        if elapsed < c['duration_sec']:
            return
        try:
            rows = np.asarray(self.capture_rows)
            times = (rows[:, 0] - rows[0, 0]) / 1000
            if (len(rows) - 1) / times[-1] < MIN_INPUT_HZ or np.diff(times).max() > MAX_GAP_S:
                raise ValueError('calibration_sample_quality')
            uniform = np.arange(0, times[-1], 1 / TARGET_HZ)
            signals = np.column_stack([np.interp(uniform, times, rows[:, i]) for i in range(1, 7)])
            still = signals[:int(5 * TARGET_HZ), :3]
            if not 0.7 <= np.linalg.norm(still.mean(axis=0)) <= 1.3 or still.std(axis=0).max() > 0.1:
                raise ValueError('calibration_still_phase_or_g_units_invalid')
            cal = calibrate(signals[:, :3], fs=TARGET_HZ, still_end_s=5, raw_gyro=signals[:, 3:])
            if not np.isfinite([cal.vertical_confidence, cal.forward_confidence]).all() or min(cal.vertical_confidence, cal.forward_confidence) < 0.3:
                raise ValueError('calibration_low_confidence')
            names = ['raw_acc_x', 'raw_acc_y', 'raw_acc_z']
            result = {'foot_side': self.side, 'device_id': self.identity[0], 'fs_hz': TARGET_HZ,
                      'source_received_hz': (len(rows) - 1) / times[-1], 'still_end_s': 5,
                      'vertical_channel': names[cal.vertical_idx], 'vertical_sign': cal.vertical_sign,
                      'forward_channel': names[cal.forward_idx], 'lateral_channel': names[cal.lateral_idx],
                      'vertical_confidence': cal.vertical_confidence, 'forward_confidence': cal.forward_confidence,
                      'gyro_yaw_channel': None, 'zscore_mean_vfl': cal.mean.tolist(), 'zscore_std_vfl': cal.std.tolist()}
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
            self.reset('warming_up')
        except Exception as exc:
            c.update(status='failed', error=str(exc))
            self.reset('calibration_failed')
        finally:
            self.capture_rows = []

    def snapshot(self):
        now = time.monotonic()
        connected = self.last_received is not None and now - self.last_received <= STALE_S
        if not connected and (self.window_count or (self.capture and self.capture['status'] in ('countdown', 'recording'))):
            self.reset('device_offline')
        capturing = self.capture and self.capture['status'] in ('countdown', 'recording')
        capture_failed = self.capture and self.capture['status'] == 'failed'
        current = self.last_window_received is not None and now - self.last_window_received <= STALE_S
        ready = bool(connected and current and self.detector and self.window_count and not self.error and not capturing and not capture_failed)
        status = 'calibrating' if capturing else 'calibration_failed' if capture_failed else 'calibration_missing' if self.load_error == 'calibration_missing' else 'unavailable' if not self.detector else 'device_offline' if not connected else 'invalid_data' if self.error and self.error not in ('warming_up', 'calibration_cancelled') else self.state if ready else 'warming_up'
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
                'last_error': self.load_error or self.error, 'calibration': self.calibration_info, 'capture': capture,
                'pressure_gate_enabled': False, 'pressure_note': 'relative_4_channel_pressure_not_force_calibrated'}


class BridgeState:
    def __init__(self, esp32_url=None, calibration_path=None, model_name='ensemble', artifact_dir=ARTIFACT_DIR,
                 hub_url='http://127.0.0.1:8000', foot='right', data_dir=DATA_DIR, calibrations=None):
        self.esp32_url = esp32_url.rstrip('/') if esp32_url else None
        self.hub_url = hub_url.rstrip('/')
        self.model_name, self.foot = model_name, foot
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.stream_id, self.cursor = None, 0
        paths = dict(calibrations or {})
        if calibration_path:
            paths[foot] = calibration_path
        self.feet = {s: FootRuntime(s, paths.get(s, Path(data_dir) / f'{s}.calibration.json'), model_name, artifact_dir, data_dir)
                     for s in ((foot,) if esp32_url else SIDES)}
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

    def consume(self, payload):
        with self.lock:
            if self.esp32_url:
                self.feet[self.foot].ingest(payload)
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
                            runtime.ingest(row['state'], row['received_at_ms'])
                        except Exception as exc:
                            runtime.reset(f'inference_failed: {exc}')
                self.cursor = payload['next_cursor']
                for side, runtime in self.feet.items():
                    if not payload.get('feet', {}).get(side, {}).get('connected'):
                        if runtime.window_count or runtime.last_device_t is not None:
                            runtime.reset('device_offline')
                        runtime.last_received = None
            self.source_error = None
            snap = self.snapshot()
            key = (snap['selected_foot'], snap['state'])
            if snap['window_ready'] and key != self.last_decision:
                self.events.append({'timestamp_ms': int(time.time() * 1000), 'foot': key[0], 'state': key[1],
                                    'fog_score': snap['fog_score'], 'decision_score': snap['decision_score'],
                                    'reason': snap['diagnostics'].get('reason')})
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
            interval = 1 / TARGET_HZ if self.esp32_url else 0.05
            self.stop.wait(max(0.001, interval - (time.monotonic() - started)))

    def snapshot(self):
        with self.lock:
            feet = {s: runtime.snapshot() for s, runtime in self.feet.items()}
            ready = [s for s in feet.values() if s['ready']]
            severity = {'normal': 0, 'warning': 1, 'confirmed': 2}
            selected = max(ready, key=lambda s: (severity.get(s['state'], -1), s['decision_score'])) if ready else None
            fallback = next((s for s in feet.values() if s['status'] == 'calibrating'), None) or next((s for s in feet.values() if s['device_connected']), None) or next(iter(feet.values()))
            result = selected or fallback
            return {'service': 'stepon-ai-bridge', 'api_version': 2, 'ok': bool(selected), 'ready': bool(selected),
                    'status': result['status'], 'state': selected['state'] if selected else None,
                    'fog_score': selected['fog_score'] if selected else None,
                    'decision_score': selected['decision_score'] if selected else None,
                    'score_percent': selected['score_percent'] if selected else None,
                    'diagnostics': selected['diagnostics'] if selected else {}, 'selected_foot': selected['side'] if selected else None,
                    'aggregation': 'highest_state_then_decision_score', 'coverage': len(ready), 'feet': feet,
                    'model': self.model_name, 'artifact_id': self.artifact_id,
                    'last_window_at_ms': selected['last_window_at_ms'] if selected else None, 'device_connected': any(s['device_connected'] for s in feet.values()),
                    'detector_loaded': any(s['detector_loaded'] for s in feet.values()), 'window_ready': bool(selected),
                    'window_count': sum(s['window_count'] for s in feet.values()), 'sample_rate_hz': TARGET_HZ,
                    'window_sec': 4, 'hop_sec': 0.5, 'calibration': result['calibration'],
                    'last_error': self.source_error or (result['last_error'] if not selected else None),
                    'source': 'esp32' if self.esp32_url else 'insole_hub', 'device_url': self.esp32_url or self.hub_url}


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
        if route in ('/api/ai/state', '/api/ai/ping'):
            self.send_json(200, self.bridge.snapshot())
        elif route == '/api/ai/events':
            with self.bridge.lock:
                self.send_json(200, {'events': list(self.bridge.events)})
        else:
            self.send_json(404, {'error': 'not_found'})

    def do_POST(self):
        if self.headers.get('Origin') and urlparse(self.headers['Origin']).netloc != self.headers.get('Host'):
            return self.send_json(403, {'error': 'cross_origin_write_denied'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.send_json(415, {'error': 'json_required'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4096:
                raise ValueError('invalid_body_length')
            body = json.loads(self.rfile.read(length))
            side = body.get('side')
            route = urlparse(self.path).path
            with self.bridge.lock:
                if side not in self.bridge.feet:
                    raise ValueError('invalid_side')
                runtime = self.bridge.feet[side]
                if route == '/api/ai/calibration/start':
                    runtime.start_calibration()
                elif route == '/api/ai/calibration/cancel':
                    runtime.cancel_calibration()
                else:
                    return self.send_json(404, {'error': 'not_found'})
                self.send_json(200, self.bridge.snapshot())
        except (ValueError, AttributeError) as exc:
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
    print(f'StepOn AI API: http://{args.host}:{args.port}/api/ai/state', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        bridge.stop.set()
        server.server_close()
        worker.join(timeout=2)


if __name__ == '__main__':
    main()
