"""StepOn AI bridge for the existing ESP32 Wi-Fi web dashboard.

The original AI package contains a BLE/PC relay, while this project already
uses the ESP32 ``03_final`` firmware over HTTP.  This bridge polls
``/api/state`` at the device's 64 Hz IMU rate, keeps a target-rate resampler
to absorb small HTTP timing jitter, runs the packaged model, and exposes the
latest decision as JSON for ``cap_web``.

Run from the repository root:

    python web/ai_bridge/server.py --esp32-url http://192.168.4.1 \
        --calibration C:/data/session.calibration.json

The bridge never writes commands to the device. Existing web controls remain
responsible for the explicit laser/vibration API calls.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
AI_ROOT = REPOSITORY_ROOT / "ai_engine"
AI_SRC = AI_ROOT / "src"
if str(AI_SRC) not in sys.path:
    sys.path.insert(0, str(AI_SRC))

import numpy as np

from fog_validation.ml.config import ML_DIR, TARGET_FS_HZ
from fog_validation.ml.live_detector import LiveFogDetector, load_axis_calibration


DEFAULT_ESP32_URL = os.environ.get("STEPON_ESP32_URL", "http://192.168.4.1")
DEFAULT_MODEL = os.environ.get("STEPON_AI_MODEL", "ensemble")
DEFAULT_CALIBRATION = os.environ.get("STEPON_AI_CALIBRATION", "")
DEFAULT_ARTIFACT_DIR = Path(os.environ.get("STEPON_AI_ARTIFACT_DIR", str(ML_DIR / "model_artifact")))
TARGET_HZ = float(TARGET_FS_HZ)
DEVICE_POLL_HZ = TARGET_HZ
DEVICE_POLL_INTERVAL_S = 1.0 / DEVICE_POLL_HZ


def _number(value: object, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    return result if np.isfinite(result) else fallback


def _vector(payload: object) -> np.ndarray:
    raw = payload if isinstance(payload, dict) else {}
    return np.array([_number(raw.get(axis)) for axis in ("x", "y", "z")], dtype=np.float64)


class TimeResampler:
    """Keep irregular HTTP snapshots on the model's 64 Hz sample clock."""

    def __init__(self, target_hz: float = TARGET_HZ) -> None:
        self.period = 1.0 / target_hz
        self.reset()

    def reset(self) -> None:
        self.previous_time: float | None = None
        self.previous_accel: np.ndarray | None = None
        self.previous_gyro: np.ndarray | None = None
        self.next_output_time: float | None = None

    def push(self, timestamp_s: float, accel: np.ndarray, gyro: np.ndarray, callback) -> None:
        if self.previous_time is None:
            self.previous_time = timestamp_s
            self.previous_accel = accel.copy()
            self.previous_gyro = gyro.copy()
            self.next_output_time = timestamp_s
            return

        gap = timestamp_s - self.previous_time
        if gap <= 0 or gap > 1.0:
            self.reset()
            self.previous_time = timestamp_s
            self.previous_accel = accel.copy()
            self.previous_gyro = gyro.copy()
            self.next_output_time = timestamp_s
            return

        assert self.previous_accel is not None
        assert self.previous_gyro is not None
        assert self.next_output_time is not None
        while self.next_output_time <= timestamp_s + 1e-9:
            ratio = (self.next_output_time - self.previous_time) / gap
            ratio = min(1.0, max(0.0, ratio))
            sample_accel = self.previous_accel + ratio * (accel - self.previous_accel)
            sample_gyro = self.previous_gyro + ratio * (gyro - self.previous_gyro)
            callback(sample_accel, sample_gyro, self.next_output_time)
            self.next_output_time += self.period

        self.previous_time = timestamp_s
        self.previous_accel = accel.copy()
        self.previous_gyro = gyro.copy()


class BridgeState:
    def __init__(self, esp32_url: str, calibration_path: Path | None, model_name: str, artifact_dir: Path) -> None:
        self.esp32_url = esp32_url.rstrip("/")
        self.calibration_path = calibration_path
        self.model_name = model_name
        self.artifact_dir = artifact_dir
        self.lock = threading.Lock()
        self.detector: LiveFogDetector | None = None
        self.calibration_info: dict[str, object] = {}
        self.resampler = TimeResampler()
        self.events: deque[dict[str, object]] = deque(maxlen=200)
        self.last_state: str | None = None
        self.last_score: float | None = None
        self.last_device_frame: int | None = None
        self.last_device_at = 0.0
        self.last_window_at: float | None = None
        self.window_count = 0
        self.last_error: str | None = None
        self.started_at = time.time()
        self._load_detector()

    def _load_detector(self) -> None:
        if self.calibration_path is None:
            self.last_error = "calibration_missing: use --calibration or STEPON_AI_CALIBRATION"
            return
        if not self.calibration_path.exists():
            self.last_error = f"calibration_not_found: {self.calibration_path}"
            return
        if not self.artifact_dir.exists():
            self.last_error = f"artifact_dir_not_found: {self.artifact_dir}"
            return
        try:
            calibration = load_axis_calibration(self.calibration_path)
            self.detector = LiveFogDetector(calibration, self.model_name, self.artifact_dir, "R")
            self.calibration_info = {
                "file": str(self.calibration_path),
                "vertical_confidence": calibration.vertical_confidence,
                "forward_confidence": calibration.forward_confidence,
                "yaw_enabled": calibration.gyro_yaw_idx is not None,
                "yaw_confidence": calibration.gyro_yaw_confidence,
            }
            self.last_error = None
        except Exception as error:  # keep the web dashboard available for diagnostics
            self.detector = None
            self.last_error = f"detector_load_failed: {error}"

    def _process_resampled_sample(self, accel: np.ndarray, gyro: np.ndarray, timestamp_s: float) -> None:
        if self.detector is None:
            return
        packet = {
            "R_raw_acc": accel,
            "R_raw_gyro": gyro,
        }
        decision = self.detector.push_sample(packet)
        score = getattr(self.detector, "last_fog_score", None)
        with self.lock:
            if score is not None:
                self.last_score = float(score)
            if decision is None:
                return
            self.last_state = decision
            self.last_window_at = timestamp_s
            self.window_count += 1
            if not self.events or self.events[-1]["state"] != decision:
                self.events.append({
                    "timestamp": time.time(),
                    "timestamp_ms": int(timestamp_s * 1000),
                    "state": decision,
                    "fog_score": round(float(self.last_score), 4) if self.last_score is not None else None,
                })

    def _process_device_payload(self, payload: dict[str, object]) -> None:
        frame = int(_number(payload.get("frame"), -1))
        now = time.monotonic()
        with self.lock:
            self.last_device_at = now
            if frame >= 0:
                self.last_device_frame = frame

        accel = _vector(payload.get("accel"))
        gyro = _vector(payload.get("gyro"))
        if not np.isfinite(accel).all() or not np.isfinite(gyro).all():
            return
        device_ms = _number(payload.get("millis"), time.time() * 1000.0)
        self.resampler.push(device_ms / 1000.0, accel, gyro, self._process_resampled_sample)

    def poll_device(self) -> None:
        last_seen_frame: int | None = None
        next_poll_at = time.monotonic()
        while True:
            try:
                request = Request(
                    f"{self.esp32_url}/api/state",
                    headers={"Accept": "application/json"},
                    method="GET",
                )
                with urlopen(request, timeout=0.35) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("ESP32 state must be a JSON object")
                frame = int(_number(payload.get("frame"), -1))
                if frame < 0 or frame != last_seen_frame:
                    last_seen_frame = frame
                    self._process_device_payload(payload)
                with self.lock:
                    self.last_error = None if self.detector is not None else self.last_error
            except (HTTPError, URLError, OSError, ValueError, json.JSONDecodeError) as error:
                with self.lock:
                    self.last_error = f"device_unreachable: {error}"
            except Exception as error:
                with self.lock:
                    self.last_error = f"device_poll_failed: {error}"
            next_poll_at += DEVICE_POLL_INTERVAL_S
            delay = next_poll_at - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            else:
                # Do not spin or build an ever-growing backlog after a slow
                # HTTP response; resume from the current clock position.
                next_poll_at = time.monotonic()

    def snapshot(self) -> dict[str, object]:
        with self.lock:
            device_connected = bool(self.last_device_at and time.monotonic() - self.last_device_at <= 2.0)
            detector_loaded = self.detector is not None
            if not detector_loaded:
                status = "unavailable"
            elif not device_connected:
                status = "device_offline"
            elif self.window_count == 0:
                status = "warming_up"
            else:
                status = self.last_state or "normal"
            return {
                "ok": detector_loaded and device_connected,
                "service": "stepon-ai-bridge",
                "status": status,
                "state": self.last_state,
                "fog_score": round(self.last_score, 4) if self.last_score is not None else None,
                "model": self.model_name,
                "device_url": self.esp32_url,
                "device_connected": device_connected,
                "detector_loaded": detector_loaded,
                "window_ready": self.window_count > 0,
                "window_count": self.window_count,
                "sample_rate_hz": TARGET_HZ,
                "window_sec": 4.0,
                "hop_sec": 0.5,
                "calibration": self.calibration_info,
                "last_window_at_ms": int(self.last_window_at * 1000) if self.last_window_at else None,
                "last_error": self.last_error,
            }

    def event_snapshot(self) -> list[dict[str, object]]:
        with self.lock:
            return list(self.events)


class BridgeHandler(BaseHTTPRequestHandler):
    bridge: BridgeState

    def _send(self, status: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        route = urlparse(self.path).path
        if route in ("/api/ai/ping", "/api/ai/state"):
            self._send(200, self.bridge.snapshot())
            return
        if route == "/api/ai/events":
            self._send(200, {"events": self.bridge.event_snapshot()})
            return
        self._send(404, {"error": "not_found"})

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Bridge StepOn ESP32 Wi-Fi state into the packaged AI detector")
    parser.add_argument("--esp32-url", default=DEFAULT_ESP32_URL)
    parser.add_argument("--calibration", type=Path, default=Path(DEFAULT_CALIBRATION) if DEFAULT_CALIBRATION else None)
    parser.add_argument("--model", choices=("rf", "cnn", "ensemble"), default=DEFAULT_MODEL)
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--host", default=os.environ.get("STEPON_AI_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("STEPON_AI_PORT", "8787")))
    args = parser.parse_args()

    bridge = BridgeState(args.esp32_url, args.calibration, args.model, args.artifact_dir)
    BridgeHandler.bridge = bridge
    threading.Thread(target=bridge.poll_device, name="stepon-esp32-poll", daemon=True).start()
    server = ThreadingHTTPServer((args.host, args.port), BridgeHandler)
    print("StepOn AI bridge is running")
    print(f"AI API: http://{args.host}:{args.port}/api/ai/state")
    print(f"ESP32: {args.esp32_url}")
    print(json.dumps(bridge.snapshot(), ensure_ascii=False))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping StepOn AI bridge")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
