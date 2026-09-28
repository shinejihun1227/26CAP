from __future__ import annotations

import json
import math
import sys
import time
import csv
import io
from collections import deque
from threading import Lock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FIRMWARE_FILE = PROJECT_ROOT / "firmware" / "esp32_c3_ap" / "esp32_c3_ap.ino"
HOST = sys.argv[1] if len(sys.argv) > 1 else "0.0.0.0"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
STARTED_AT = time.monotonic()
LOG_RESET_AT = STARTED_AT
CURRENT_PROFILE: dict = {"gender": "", "ageBand": "", "purposes": []}
PARKINSON_STATE = {"state": "Normal", "warning_streak": 0, "normal_streak": 0}
DIABETES_STATE = {"state": "Stable", "attention_streak": 0, "clear_streak": 0, "thermal_streak": 0, "baseline_temperature": None}
POSTURE_STATE = {"steps": 0, "last_stance": False}

# ESP32 -> PC STA bridge state.
DEVICE_STREAM_TIMEOUT_SECONDS = 3.0
DEVICE_HISTORY = deque(maxlen=300)
DEVICE_LOCK = Lock()
LATEST_DEVICE_STATE: dict | None = None
LAST_DEVICE_RECEIVED_AT = 0.0
PC_LOG_PATH = Path(__file__).with_name("pc_received_sensor_log.csv")
PC_FRAME_COUNT = 0


def load_dashboard_html() -> str:
    """Reuse the exact dashboard HTML embedded in the ESP32 firmware."""
    source = FIRMWARE_FILE.read_text(encoding="utf-8")
    start_marker = 'R"rawliteral(\n'
    end_marker = '\n)rawliteral";'
    start = source.index(start_marker) + len(start_marker)
    end = source.index(end_marker, start)
    return source[start:end]


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def primary_purpose() -> str:
    for purpose in ("parkinson", "diabetes", "posture"):
        if purpose in CURRENT_PROFILE.get("purposes", []):
            return purpose
    return "parkinson"


def reset_algorithm_memory() -> None:
    PARKINSON_STATE.update(state="Normal", warning_streak=0, normal_streak=0)
    DIABETES_STATE.update(state="Stable", attention_streak=0, clear_streak=0, thermal_streak=0, baseline_temperature=None)
    POSTURE_STATE.update(steps=0, last_stance=False)
    DEVICE_HISTORY.clear()


def update_parkinson(gate_open: bool, fi_ratio: float, spectral_entropy: float, pitch_rom: float, cadence: float) -> dict:
    previous = PARKINSON_STATE["state"]
    fi_norm = clamp(fi_ratio / 2.5)
    shuffling = clamp(1.0 - pitch_rom)
    cadence_penalty = clamp(abs(cadence - 55.0) / 55.0)
    score = clamp(0.55 * fi_norm + 0.25 * shuffling + 0.20 * cadence_penalty)
    warning = gate_open and fi_ratio >= 1.5 and shuffling >= 0.35
    clear = gate_open and fi_ratio < 0.8 and pitch_rom >= 0.35
    if not gate_open:
        PARKINSON_STATE.update(state="Normal", warning_streak=0, normal_streak=0)
    elif warning:
        PARKINSON_STATE["warning_streak"] = min(255, PARKINSON_STATE["warning_streak"] + 1)
        PARKINSON_STATE["normal_streak"] = 0
        PARKINSON_STATE["state"] = "FoG" if PARKINSON_STATE["warning_streak"] >= 3 else "Warning"
    elif clear:
        PARKINSON_STATE["normal_streak"] = min(255, PARKINSON_STATE["normal_streak"] + 1)
        PARKINSON_STATE["warning_streak"] = 0
        if previous in ("Warning", "FoG") and PARKINSON_STATE["normal_streak"] >= 2:
            PARKINSON_STATE["state"] = "Recovery"
        elif previous == "Recovery" and PARKINSON_STATE["normal_streak"] >= 4:
            PARKINSON_STATE["state"] = "Normal"
    return {
        "target": "parkinson_fog",
        "gate_open": gate_open,
        "fi_ratio": fi_ratio,
        "fi": fi_norm,
        "spectral_entropy": spectral_entropy,
        "pitch_rom": pitch_rom,
        "cadence_spm": cadence,
        "score": score,
        "state": PARKINSON_STATE["state"],
        "warning_streak": PARKINSON_STATE["warning_streak"],
        "normal_streak": PARKINSON_STATE["normal_streak"],
        "cue_vibration": PARKINSON_STATE["state"] in ("Warning", "FoG"),
        "cue_laser": PARKINSON_STATE["state"] == "FoG",
        "method": "6 s FI window · 3–8 Hz / 0.5–3 Hz · individual threshold pending",
    }


def update_diabetes(
    temperature: float,
    humidity: float,
    temperature_sensors: list[float],
    humidity_sensors: list[float],
    left: list[int],
    right: list[int],
    pressure_total: float,
) -> dict:
    if DIABETES_STATE["baseline_temperature"] is None:
        DIABETES_STATE["baseline_temperature"] = temperature
    sensors = (temperature_sensors + [temperature] * 4)[:4]
    humidities = (humidity_sensors + [humidity] * 4)[:4]
    peak = max(left + right)
    balance_gap = abs(sum(left) - sum(right)) / max(1.0, pressure_total)
    pressure_hotspot = clamp((peak - 55.0) / 45.0)
    heel_delta = abs(sensors[0] - sensors[2])
    forefoot_delta = abs(sensors[1] - sensors[3])
    max_delta = max(heel_delta, forefoot_delta)
    mean_delta = (heel_delta + forefoot_delta) / 2.0
    temperature_threshold = max_delta >= 2.2
    pressure_signal = pressure_total >= 180.0 and (peak >= 75 or balance_gap >= 0.28)
    attention_signal = pressure_signal or temperature_threshold
    humidity_context = clamp(abs(humidity - 50.0) / 35.0)
    thermal_score = clamp(max_delta / 2.2)
    score = clamp(0.45 * pressure_hotspot + 0.40 * thermal_score + 0.10 * balance_gap + 0.05 * humidity_context)
    if temperature_threshold:
        DIABETES_STATE["thermal_streak"] = min(255, DIABETES_STATE["thermal_streak"] + 1)
    else:
        DIABETES_STATE["thermal_streak"] = 0
    if attention_signal:
        DIABETES_STATE["attention_streak"] = min(255, DIABETES_STATE["attention_streak"] + 1)
        DIABETES_STATE["clear_streak"] = 0
        DIABETES_STATE["state"] = "Attention" if DIABETES_STATE["attention_streak"] >= 2 else "Observe"
    else:
        DIABETES_STATE["clear_streak"] = min(255, DIABETES_STATE["clear_streak"] + 1)
        DIABETES_STATE["attention_streak"] = 0
        DIABETES_STATE["state"] = "Observe" if score >= 0.35 else "Stable"
    return {
        "target": "diabetic_foot_context",
        "state": DIABETES_STATE["state"],
        "score": score,
        "peak_pressure": peak,
        "pressure_hotspot": pressure_hotspot,
        "pressure_balance_gap": balance_gap,
        "temperature_c": temperature,
        "temperature_delta_c": max_delta,
        "max_temperature_delta_c": max_delta,
        "mean_temperature_delta_c": mean_delta,
        "humidity_pct": humidity,
        "temperature_sensors": sensors,
        "humidity_sensors": humidities,
        "temperature_asymmetry_available": True,
        "temperature_threshold_exceeded": temperature_threshold,
        "two_window_confirmation_ready": DIABETES_STATE["thermal_streak"] >= 2,
        "temperature_asymmetry_streak": DIABETES_STATE["thermal_streak"],
        "temperature_hot_region": 1 if forefoot_delta >= heel_delta and sensors[1] >= sensors[3] else 3 if forefoot_delta >= heel_delta else 0 if sensors[0] >= sensors[2] else 2,
        "attention_streak": DIABETES_STATE["attention_streak"],
        "recommendation": "압력·온도 비대칭이 반복됩니다. 발 상태를 확인하고 필요하면 전문가와 상의하세요." if DIABETES_STATE["state"] == "Attention" else "혈당·질환 판정이 아닌 발 건강 컨텍스트를 기록합니다.",
        "method": "4-point thermal asymmetry + plantar load context · 2 observation windows; daily confirmation required",
    }


def update_posture(elapsed: float, accel: dict, gyro: dict, pressure_total: float) -> dict:
    phase = elapsed % 1.14
    stance = phase < 0.18
    if stance and not POSTURE_STATE["last_stance"]:
        POSTURE_STATE["steps"] += 1
    POSTURE_STATE["last_stance"] = stance
    roll = 7.0 * math.sin(elapsed * 1.1)
    pitch = 9.0 * math.sin(elapsed * 0.72 + 0.6)
    yaw = (elapsed * (gyro["z"] * 0.08)) % 360.0
    step_length = 42.0 + 4.0 * math.sin(elapsed * 0.41)
    alignment_score = clamp(1.0 - (abs(roll) / 30.0 + abs(pitch) / 35.0) / 2.0)
    return {
        "target": "posture_trajectory",
        "state": "Stance" if stance else "Swing",
        "alignment": "정렬 확인 필요" if alignment_score < 0.58 else "기준선 범위",
        "score": clamp(1.0 - alignment_score),
        "roll_deg": roll,
        "pitch_deg": pitch,
        "yaw_deg": yaw,
        "stance": stance,
        "step_count": POSTURE_STATE["steps"],
        "step_length_cm": step_length,
        "trajectory_x_cm": POSTURE_STATE["steps"] * step_length / 100.0,
        "trajectory_y_cm": 2.5 * math.sin(elapsed * 0.35),
        "zero_velocity_update": stance,
        "drift_warning": abs(yaw) > 25.0,
        "method": "complementary orientation + stance-gated ZUPT prototype",
    }


def _number_list(payload: dict, key: str, count: int, fallback: float = 0.0) -> list[float]:
    raw = payload.get(key)
    values = raw if isinstance(raw, list) else []
    result: list[float] = []
    for value in values[:count]:
        try:
            result.append(float(value))
        except (TypeError, ValueError):
            result.append(fallback)
    while len(result) < count:
        result.append(fallback)
    return result


def _number_dict(payload: dict, key: str) -> dict[str, float]:
    raw = payload.get(key)
    raw = raw if isinstance(raw, dict) else {}
    result: dict[str, float] = {}
    for axis in ("x", "y", "z"):
        try:
            result[axis] = float(raw.get(axis, 0.0))
        except (TypeError, ValueError):
            result[axis] = 0.0
    return result


def _device_pitch(accel: dict[str, float]) -> float:
    denominator = math.sqrt(accel["y"] ** 2 + accel["z"] ** 2)
    return math.degrees(math.atan2(-accel["x"], max(denominator, 1e-6)))


def _dft_power(signal: list[float], frequency: float, sample_rate: float) -> float:
    if len(signal) < 8:
        return 0.0
    mean = sum(signal) / len(signal)
    real = 0.0
    imaginary = 0.0
    for index, value in enumerate(signal):
        angle = 2.0 * math.pi * frequency * index / sample_rate
        centered = value - mean
        real += centered * math.cos(angle)
        imaginary -= centered * math.sin(angle)
    return (real * real + imaginary * imaginary) / max(1, len(signal) ** 2)


def _device_motion_features() -> tuple[float, float, float, float]:
    samples = list(DEVICE_HISTORY)
    if len(samples) < 12:
        return 0.35, 0.24, 0.55, 60.0
    signal = [sample["gyro_z"] for sample in samples]
    pitch_values = [sample["pitch"] for sample in samples]
    sample_rate = 20.0
    low_power = sum(_dft_power(signal, frequency, sample_rate) for frequency in (0.5, 1.0, 1.5, 2.0, 2.5))
    high_power = sum(_dft_power(signal, frequency, sample_rate) for frequency in (3.0, 3.5, 4.0, 4.5, 5.0, 6.0, 7.0, 8.0))
    fi_ratio = high_power / max(low_power, 1e-6)
    band_powers = [
        _dft_power(signal, frequency, sample_rate)
        for frequency in (0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0)
    ]
    total_power = sum(band_powers)
    entropy = 0.0
    if total_power > 1e-9:
        probabilities = [power / total_power for power in band_powers if power > 1e-9]
        entropy = -sum(probability * math.log(probability) for probability in probabilities)
        entropy = clamp(entropy / math.log(len(band_powers)))
    pitch_rom = clamp((max(pitch_values) - min(pitch_values)) / 30.0)
    return fi_ratio, entropy, pitch_rom, 60.0


def _update_device_posture(accel: dict[str, float], gyro: dict[str, float], pressure_total: float) -> dict:
    stance = pressure_total >= 180.0
    if stance and not POSTURE_STATE["last_stance"]:
        POSTURE_STATE["steps"] += 1
    POSTURE_STATE["last_stance"] = stance
    roll = math.degrees(math.atan2(accel["y"], max(accel["z"], 1e-6)))
    pitch = _device_pitch(accel)
    yaw = gyro["z"]
    alignment_score = clamp(1.0 - (abs(roll) / 30.0 + abs(pitch) / 35.0) / 2.0)
    return {
        "target": "posture_trajectory",
        "state": "Stance" if stance else "Swing",
        "alignment": "정렬 확인 필요" if alignment_score < 0.58 else "기준선 범위",
        "score": clamp(1.0 - alignment_score),
        "roll_deg": roll,
        "pitch_deg": pitch,
        "yaw_deg": yaw,
        "stance": stance,
        "step_count": POSTURE_STATE["steps"],
        "step_length_cm": 42.0,
        "trajectory_x_cm": POSTURE_STATE["steps"] * 0.42,
        "trajectory_y_cm": 0.0,
        "zero_velocity_update": stance,
        "drift_warning": abs(yaw) > 45.0,
        "method": "PC complementary orientation + stance-gated ZUPT prototype",
    }


def _append_device_log(state: dict) -> None:
    global PC_FRAME_COUNT
    exists = PC_LOG_PATH.exists()
    with PC_LOG_PATH.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        if not exists:
            writer.writerow([
                "received_at", "frame", "device_millis", "temperature_c", "humidity_pct",
                "pressure_total", "risk", "primary_algorithm", "parkinson_state",
                "diabetes_state", "posture_state", "pitch_deg", "roll_deg",
                *[f"temperature_{i + 1}_c" for i in range(4)],
                *[f"humidity_{i + 1}_pct" for i in range(4)],
                *[f"pressure_left_{i + 1}" for i in range(8)],
                *[f"pressure_right_{i + 1}" for i in range(8)],
            ])
        algorithms = state["algorithms"]
        writer.writerow([
            state["received_at"], state["frame"], state.get("device_millis", 0),
            round(state["temperature"], 2), round(state["humidity"], 2),
            state["pressure_total"], state["risk"], state["primary_algorithm"],
            algorithms["parkinson"]["state"], algorithms["diabetes"]["state"],
            algorithms["posture"]["state"], round(algorithms["posture"]["pitch_deg"], 2),
            round(algorithms["posture"]["roll_deg"], 2),
            *[round(value, 2) for value in state["temperature_sensors"]],
            *[round(value, 2) for value in state["humidity_sensors"]],
            *state["pressure_left"], *state["pressure_right"],
        ])
    PC_FRAME_COUNT += 1


def _process_device_frame(payload: dict) -> dict:
    global LATEST_DEVICE_STATE, LAST_DEVICE_RECEIVED_AT
    left = [int(round(value)) for value in _number_list(payload, "pressure_left", 8)]
    right = [int(round(value)) for value in _number_list(payload, "pressure_right", 8)]
    accel = _number_dict(payload, "accel")
    gyro = _number_dict(payload, "gyro")
    temperature_sensors = _number_list(payload, "temperature_sensors", 4, float(payload.get("temperature", 0.0) or 0.0))
    humidity_sensors = _number_list(payload, "humidity_sensors", 4, float(payload.get("humidity", 0.0) or 0.0))
    temperature = float(payload.get("temperature", sum(temperature_sensors) / 4.0) or 0.0)
    humidity = float(payload.get("humidity", sum(humidity_sensors) / 4.0) or 0.0)
    pressure_total = sum(left) + sum(right)
    pitch = _device_pitch(accel)
    DEVICE_HISTORY.append({"gyro_z": gyro["z"], "pitch": pitch})
    fi_ratio, spectral_entropy, pitch_rom, cadence = _device_motion_features()
    parkinson = update_parkinson(pressure_total >= 180.0, fi_ratio, spectral_entropy, pitch_rom, cadence)
    diabetes = update_diabetes(temperature, humidity, temperature_sensors, humidity_sensors, left, right, pressure_total)
    posture = _update_device_posture(accel, gyro, pressure_total)
    algorithms = {"parkinson": parkinson, "diabetes": diabetes, "posture": posture}
    primary = algorithms[primary_purpose()]
    state = {
        "frame": int(payload.get("frame", 0) or 0),
        "mock": False,
        "source": "esp32_sta",
        "transport": "esp32_to_pc",
        "device_millis": int(payload.get("device_millis", 0) or 0),
        "received_at": time.strftime("%H:%M:%S"),
        "pressure_left": left,
        "pressure_right": right,
        "pressure_total": pressure_total,
        "temperature": temperature,
        "humidity": humidity,
        "temperature_sensors": temperature_sensors,
        "humidity_sensors": humidity_sensors,
        "shtc3_ready_count": int(payload.get("shtc3_ready_count", 0) or 0),
        "accel": accel,
        "gyro": gyro,
        "cop_x": float(payload.get("cop_x", 50.0) or 50.0),
        "cop_y": float(payload.get("cop_y", 50.0) or 50.0),
        "battery": int(payload.get("battery", 0) or 0),
        "risk": round(float(primary.get("score", 0.0)) * 100),
        "profile": CURRENT_PROFILE,
        "primary_algorithm": primary_purpose(),
        "algorithms": algorithms,
        "algorithm": {**primary, "mode": primary_purpose()},
        "device_connected": True,
    }
    LAST_DEVICE_RECEIVED_AT = time.monotonic()
    LATEST_DEVICE_STATE = state
    _append_device_log(state)
    return state

def build_mock_state() -> dict:
    elapsed = time.monotonic() - STARTED_AT
    cycle = elapsed % 18
    fog_phase = 5 < cycle < 10
    hotspot_phase = 10 < cycle < 13
    left = [round(max(8, min(96, 34 + i * 5 + math.sin(elapsed * 1.1 + i) * 10))) for i in range(8)]
    right = [round(max(8, min(96, 40 + i * 5 + math.cos(elapsed * 0.95 + i) * 12))) for i in range(8)]
    if hotspot_phase:
        left[2] = 88
        right[3] = 82
    accel = {
        "x": 0.12 + math.sin(elapsed * 1.1) * 0.08 + (0.12 * math.sin(elapsed * 2 * math.pi * 5.2) if fog_phase else 0.0),
        "y": -0.03 + math.cos(elapsed * 0.8) * 0.06,
        "z": 0.98 + math.sin(elapsed * 0.55) * 0.04,
    }
    gyro = {
        "x": 1.4 + math.sin(elapsed * 1.1) * 1.2,
        "y": 0.2 + math.cos(elapsed * 0.7) * 0.8,
        "z": 12.1 + math.sin(elapsed * 0.6) * 3.2 + (16 * math.sin(elapsed * 2 * math.pi * 5.2) if fog_phase else 0.0),
    }
    pressure_total = sum(left) + sum(right)
    base_temperature = 31.8 + math.sin(elapsed / 3) * 0.2
    base_humidity = 48.2 + math.cos(elapsed / 4) * 1.4
    temperature_sensors = [
        base_temperature + 0.05,
        base_temperature + (2.35 if hotspot_phase else 0.15),
        base_temperature - 0.05,
        base_temperature + 0.10,
    ]
    humidity_sensors = [
        base_humidity + 0.5,
        base_humidity + (8.0 if hotspot_phase else 1.2),
        base_humidity - 0.3,
        base_humidity + 0.8,
    ]
    temperature = sum(temperature_sensors) / 4.0
    humidity = sum(humidity_sensors) / 4.0
    fi_ratio = 2.4 + 0.35 * math.sin(elapsed * 0.5) if fog_phase else 0.35 + 0.10 * math.sin(elapsed)
    spectral_entropy = clamp(0.64 + 0.12 * math.sin(elapsed) if fog_phase else 0.24 + 0.06 * math.sin(elapsed))
    pitch_rom = clamp(0.18 + 0.10 * math.sin(elapsed) if fog_phase else 0.56 + 0.08 * math.sin(elapsed))
    cadence = 30.0 if fog_phase else 58.0 + 3.0 * math.sin(elapsed * 0.25)
    parkinson = update_parkinson(pressure_total >= 180, fi_ratio, spectral_entropy, pitch_rom, cadence)
    diabetes = update_diabetes(temperature, humidity, temperature_sensors, humidity_sensors, left, right, pressure_total)
    posture = update_posture(elapsed, accel, gyro, pressure_total)
    algorithms = {"parkinson": parkinson, "diabetes": diabetes, "posture": posture}
    primary = algorithms[primary_purpose()]
    primary_score = float(primary.get("score", 0.0))

    return {
        "frame": int(elapsed * 50),
        "mock": True,
        "source": "local_mock",
        "transport": "mock",
        "device_connected": False,
        "pressure_left": left,
        "pressure_right": right,
        "pressure_total": pressure_total,
        "temperature": temperature,
        "humidity": humidity,
        "temperature_sensors": temperature_sensors,
        "humidity_sensors": humidity_sensors,
        "shtc3_ready_count": 4,
        "accel": accel,
        "gyro": gyro,
        "cop_x": max(15, min(85, 54 + math.sin(elapsed * 0.7) * 17)),
        "cop_y": max(15, min(85, 62 + math.cos(elapsed * 0.8) * 18)),
        "battery": 86,
        "risk": round(primary_score * 100),
        "profile": CURRENT_PROFILE,
        "primary_algorithm": primary_purpose(),
        "algorithms": algorithms,
        "algorithm": {**primary, "mode": primary_purpose()},
    }



def build_state() -> dict:
    if LATEST_DEVICE_STATE is None:
        return build_mock_state()
    with DEVICE_LOCK:
        state = dict(LATEST_DEVICE_STATE)
        state["profile"] = CURRENT_PROFILE
        state["primary_algorithm"] = primary_purpose()
        primary = state["algorithms"][state["primary_algorithm"]]
        state["algorithm"] = {**primary, "mode": state["primary_algorithm"]}
        state["device_connected"] = time.monotonic() - LAST_DEVICE_RECEIVED_AT <= DEVICE_STREAM_TIMEOUT_SECONDS
        state["stream_age_ms"] = round((time.monotonic() - LAST_DEVICE_RECEIVED_AT) * 1000)
        return state


def build_summary() -> dict:
    elapsed = max(0.0, time.monotonic() - LOG_RESET_AT)
    using_device = LATEST_DEVICE_STATE is not None
    return {
        "storage": "PC 서버 · ESP32 STA" if using_device else "로컬 모의 저장소",
        "file": str(PC_LOG_PATH.name) if using_device else "/stepon_log.csv",
        "summary_file": "PC 수신 로그" if using_device else "/stepon_summary.json",
        "frames": PC_FRAME_COUNT if using_device else int(elapsed * 2),
        "fog_events": sum(1 for _ in []) if not using_device else 0,
        "updated_at": time.strftime("%H:%M:%S"),
        "device_connected": bool(LATEST_DEVICE_STATE is not None and time.monotonic() - LAST_DEVICE_RECEIVED_AT <= DEVICE_STREAM_TIMEOUT_SECONDS),
    }


def build_csv() -> bytes:
    if PC_LOG_PATH.exists():
        return PC_LOG_PATH.read_bytes()
    state = build_state()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "frame", "temperature_c", "humidity_pct",
        "temperature_1_c", "temperature_2_c", "temperature_3_c", "temperature_4_c",
        "humidity_1_pct", "humidity_2_pct", "humidity_3_pct", "humidity_4_pct",
        "risk", "primary_algorithm", "parkinson_state", "parkinson_fi_ratio",
        "diabetic_foot_state", "peak_pressure", "temperature_max_delta_c",
        "temperature_asymmetry_streak", "posture_state", "step_count",
        *[f"pressure_left_{i + 1}" for i in range(8)],
        *[f"pressure_right_{i + 1}" for i in range(8)],
    ])
    for offset in range(12):
        algorithms = state["algorithms"]
        diabetes = algorithms["diabetes"]
        writer.writerow([
            max(0, state["frame"] - offset),
            round(state["temperature"], 2),
            round(state["humidity"], 2),
            *[round(value, 2) for value in state["temperature_sensors"]],
            *[round(value, 2) for value in state["humidity_sensors"]],
            state["risk"],
            state["primary_algorithm"],
            algorithms["parkinson"]["state"],
            round(algorithms["parkinson"]["fi_ratio"], 3),
            diabetes["state"],
            diabetes["peak_pressure"],
            round(diabetes["max_temperature_delta_c"], 2),
            diabetes["temperature_asymmetry_streak"],
            algorithms["posture"]["state"],
            algorithms["posture"]["step_count"],
            *state["pressure_left"],
            *state["pressure_right"],
        ])
    return output.getvalue().encode("utf-8-sig")


class DashboardHandler(BaseHTTPRequestHandler):
    def send_bytes(self, body: bytes, content_type: str, status: int = 200, download_name: str | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if download_name:
            self.send_header("Content-Disposition", f"attachment; filename={download_name}")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        route = urlparse(self.path).path
        if route in ("/", "/index.html"):
            self.send_bytes(load_dashboard_html().encode("utf-8"), "text/html; charset=utf-8")
            return
        if route == "/api/state":
            body = json.dumps(build_state(), ensure_ascii=False).encode("utf-8")
            self.send_bytes(body, "application/json; charset=utf-8")
            return
        if route == "/api/summary":
            self.send_bytes(json.dumps(build_summary(), ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")
            return
        if route == "/api/log.csv":
            self.send_bytes(build_csv(), "text/csv; charset=utf-8", download_name="stepon_log.csv")
            return
        if route == "/api/ping":
            self.send_bytes(b"StepOn local server OK", "text/plain; charset=utf-8")
            return
        self.send_bytes(b"Not found", "text/plain; charset=utf-8", 404)

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        global CURRENT_PROFILE, LOG_RESET_AT, LATEST_DEVICE_STATE, PC_FRAME_COUNT
        route = urlparse(self.path).path
        if route == "/api/ingest":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 65536:
                    raise ValueError("invalid payload length")
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                if not isinstance(data, dict):
                    raise ValueError("payload must be an object")
                with DEVICE_LOCK:
                    state = _process_device_frame(data)
                body = json.dumps({
                    "ok": True,
                    "frame": state["frame"],
                    "received_at": state["received_at"],
                    "transport": "esp32_to_pc",
                }, ensure_ascii=False).encode("utf-8")
                self.send_bytes(body, "application/json; charset=utf-8")
            except (ValueError, TypeError, json.JSONDecodeError):
                self.send_bytes(b'{"ok":false,"error":"invalid sensor frame"}', "application/json; charset=utf-8", 400)
            except OSError as error:
                print(f"[ingest] storage error: {error}")
                self.send_bytes(b'{"ok":false,"error":"storage"}', "application/json; charset=utf-8", 500)
            return
        if route == "/api/log/clear":
            LOG_RESET_AT = time.monotonic()
            reset_algorithm_memory()
            PC_FRAME_COUNT = 0
            if PC_LOG_PATH.exists():
                PC_LOG_PATH.unlink()
            self.send_bytes(b'{"ok":true}', "application/json; charset=utf-8")
            return
        if route != "/api/profile":
            self.send_bytes(b"Not found", "text/plain; charset=utf-8", 404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            purposes = data.get("purposes", [])
            if not isinstance(purposes, list) or not purposes:
                raise ValueError("purposes must contain at least one item")
            CURRENT_PROFILE = {
                "gender": str(data.get("gender", "")),
                "ageBand": str(data.get("ageBand", "")),
                "purposes": [str(item) for item in purposes],
            }
            reset_algorithm_memory()
            self.send_bytes(b'{"ok":true}', "application/json; charset=utf-8")
        except (ValueError, TypeError, json.JSONDecodeError):
            self.send_bytes(b'{"ok":false}', "application/json; charset=utf-8", 400)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def main() -> None:
    if not FIRMWARE_FILE.exists():
        raise SystemExit(f"Firmware dashboard not found: {FIRMWARE_FILE}")
    server = ThreadingHTTPServer((HOST, PORT), DashboardHandler)
    print("StepOn local dashboard is running")
    print(f"Open http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local dashboard")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()






