"""Versioned raw IMU CSV contract shared by web uploads, recording and replay."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

AXES = ['raw_acc_x', 'raw_acc_y', 'raw_acc_z', 'raw_gyro_x', 'raw_gyro_y', 'raw_gyro_z']
IDENTITY = ['device_id', 'boot_id', 'side', 'participant_id', 'session_id', 'placement']
COLUMNS = ['timestamp_ms', *AXES, *IDENTITY, 'label']
USB_AXES = ['ax_g', 'ay_g', 'az_g', 'gx_dps', 'gy_dps', 'gz_dps']
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_ROWS = 60001
MAX_GAP_MS = 100.0
MIN_HZ = 32.0


def metadata(body):
    result = {}
    for key in ('participant_id', 'session_id', 'placement', 'side'):
        value = body.get(key)
        if not isinstance(value, str) or not value.strip() or len(value) > 80:
            raise ValueError(f'{key}: 1~80자 값을 입력하세요.')
        value = value.strip()
        if any(ord(c) < 32 for c in value) or value[0] in '=+-@':
            raise ValueError(f'{key}: 제어 문자와 수식 문자는 사용할 수 없습니다.')
        result[key] = value
    if result['side'] not in ('left', 'right'):
        raise ValueError('side: left 또는 right를 선택하세요.')
    return result


@dataclass
class Recording:
    rows: np.ndarray  # original timestamp in ms, g (including gravity), degrees/sec
    context: dict
    labels: list[str]
    quality: dict

    def csv_text(self):
        output = io.StringIO(newline='')
        writer = csv.writer(output)
        writer.writerow(COLUMNS)
        for row, label in zip(self.rows, self.labels):
            writer.writerow([*row.tolist(), *(self.context.get(k, '') for k in IDENTITY), label])
        return output.getvalue()


def safe_cell(value, field, line):
    value = str(value or '').strip()
    if len(value) > 120 or any(ord(c) < 32 for c in value) or (value and value[0] in '=+-@'):
        raise ValueError(f'{line}행 {field}: 올바른 짧은 텍스트를 사용하세요.')
    return value


def parse_csv(content, context=None, *, legacy=False, fs=None):
    if not isinstance(content, str) or len(content.encode('utf-8')) > MAX_FILE_BYTES:
        raise ValueError('CSV 파일은 UTF-8 형식, 최대 8 MiB입니다.')
    reader = csv.DictReader(io.StringIO(content.lstrip('\ufeff'), newline=''), strict=True)
    fields = reader.fieldnames or []
    if len(fields) != len(set(fields)):
        raise ValueError('CSV 헤더에 중복 열이 있습니다.')
    canonical = set(AXES).issubset(fields)
    usb = set(USB_AXES + ['device_time_us']).issubset(fields)
    if canonical == usb:
        raise ValueError('IMU 6축 열이 필요합니다. 표준 양식 또는 06 USB 수집 CSV를 사용하세요.')
    time_key = 'device_time_us' if usb else 'timestamp_ms'
    if time_key not in fields and not (legacy and isinstance(fs, (int, float)) and math.isfinite(fs) and fs > 0):
        raise ValueError(f'{time_key} 열이 필요합니다. PC 수신 시각 대신 장치 시각을 사용하세요.')
    if not legacy and not {'device_id', 'boot_id'}.issubset(fields):
        raise ValueError('device_id, boot_id 열이 필요합니다. 서로 다른 장치·부팅의 데이터를 합치지 마세요.')
    context = dict(context or {})
    values, labels = [], []
    previous_sequence = None
    missing_sequences = 0
    counter_first, counter_last = {}, {}
    for line, row in enumerate(reader, start=2):
        if len(values) >= MAX_ROWS:
            raise ValueError('파일당 최대 60,001행입니다. 긴 측정을 나누어 주세요.')
        if None in row or any(v is None for v in row.values()):
            raise ValueError(f'{line}행: 헤더와 데이터 열 개수가 다릅니다.')
        try:
            timestamp = float(row[time_key]) / (1000 if usb else 1) if time_key in fields else len(values) * 1000 / fs
            axes = [float(row[key]) for key in (USB_AXES if usb else AXES)]
            if not math.isfinite(timestamp) or timestamp < 0 or not all(math.isfinite(v) for v in axes):
                raise ValueError('시각·IMU 값은 유한한 숫자여야 합니다.')
            if any(abs(v) > (16.001 if i < 3 else 2000.001) for i, v in enumerate(axes)):
                raise ValueError('센서 범위 초과: 가속도 g, 각속도 °/s 단위를 확인하세요.')
            if values and timestamp <= values[-1][0]:
                raise ValueError('장치 시각은 엄격히 증가해야 합니다. 중복·재부팅 파일을 분리하세요.')
            if 'clip_mask' in row and int(row['clip_mask']) != 0:
                raise ValueError('센서 포화(clip_mask)가 기록되었습니다. 부착과 측정 범위를 확인하세요.')
            if 'sequence' in row:
                seq = int(row['sequence'])
                if seq < 0 or (previous_sequence is not None and seq <= previous_sequence):
                    raise ValueError('sequence 중복 또는 역순입니다.')
                if previous_sequence is not None:
                    missing_sequences += seq - previous_sequence - 1
                previous_sequence = seq
            for key in ('read_errors', 'tx_drops', 'gap_events'):
                if key in row:
                    number = int(row[key])
                    if number < counter_last.get(key, 0):
                        raise ValueError(f'{key} 카운터가 감소했습니다.')
                    counter_first.setdefault(key, number)
                    counter_last[key] = number
        except (ValueError, OverflowError) as exc:
            raise ValueError(f'{line}행: {exc}') from exc
        for key in IDENTITY:
            value = safe_cell(row.get(key, ''), key, line)
            if key in ('side', 'placement') and value == 'unknown':
                value = ''  # Older USB logger defaults; operator must supply these in the form.
            if key in ('device_id', 'boot_id') and not value and not legacy:
                raise ValueError(f'{line}행: {key}가 비어 있습니다.')
            if value:
                if context.get(key) and context[key] != value:
                    raise ValueError(f'{line}행 {key}: 입력한 정보 또는 이전 행과 다릅니다. 파일을 분리하세요.')
                context[key] = value
        values.append([timestamp, *axes])
        labels.append(safe_cell(row.get('label', ''), 'label', line))
    if len(values) < 2:
        raise ValueError('헤더만으로 분석할 수 없습니다. 실제 센서 데이터가 2행 이상 필요합니다.')
    rows = np.asarray(values, dtype=float)
    gaps = np.diff(rows[:, 0])
    duration = (rows[-1, 0] - rows[0, 0]) / 1000
    hz = (len(rows) - 1) / duration
    if hz < MIN_HZ:
        raise ValueError(f'실제 수집률 {hz:.1f} Hz: 최소 32 Hz, 권장 64~100 Hz로 다시 수집하세요.')
    if duration > 600.1:
        raise ValueError('파일당 최대 10분입니다. 측정 구간을 나누어 주세요.')
    quality = {'format': 'usb_wroom_v1' if usb else 'stepon_imu_csv_v1', 'rows': len(rows),
               'duration_s': round(duration, 3), 'received_hz': round(hz, 3),
               'max_gap_ms': round(float(gaps.max()), 3), 'gaps_over_100ms': int((gaps > MAX_GAP_MS).sum()),
               'missing_sequences': missing_sequences, 'counter_deltas': {k: counter_last[k] - v for k, v in counter_first.items()},
               'sha256': hashlib.sha256(content.encode('utf-8')).hexdigest(),
               'units': {'acceleration': 'g_including_gravity', 'gyroscope': 'degrees_per_second', 'time': 'device_milliseconds'}}
    return Recording(rows, context, labels, quality)


def calibration_from_rows(rows, side, device_id):
    # Imports resolve after server has set the engine's src path.
    from fog_validation.ml.calibration import calibrate
    from fog_validation.ml.config import TARGET_FS_HZ
    hz = float(TARGET_FS_HZ)
    times = (rows[:, 0] - rows[0, 0]) / 1000
    if times[-1] < 24.9:
        raise ValueError('보정 CSV: 첫 5초 정지 + 이어서 20초 일반 보행을 기록하세요 (총 25초).')
    if (len(rows) - 1) / times[-1] < MIN_HZ or np.diff(times).max() > 0.100000001:
        raise ValueError('보정 CSV의 수집률 또는 100ms 초과 누락을 확인하세요.')
    # Exactly one declared protocol; extra rows do not change normalization.
    uniform = np.arange(0, min(times[-1], 25), 1 / hz)
    signals = np.column_stack([np.interp(uniform, times, rows[:, i]) for i in range(1, 7)])
    still = signals[:int(5 * hz), :3]
    if not 0.7 <= np.linalg.norm(still.mean(axis=0)) <= 1.3 or still.std(axis=0).max() > 0.1:
        raise ValueError('calibration_still_phase_or_g_units_invalid: 첫 5초는 정지, 가속도는 중력 포함 g 단위여야 합니다.')
    if signals[int(5 * hz):, :3].std(axis=0).max() < 0.03:
        raise ValueError('보정 CSV의 5~25초 구간에 충분한 보행 움직임이 없습니다.')
    cal = calibrate(signals[:, :3], fs=hz, still_end_s=5, raw_gyro=signals[:, 3:])
    if not np.isfinite([cal.vertical_confidence, cal.forward_confidence]).all() or min(cal.vertical_confidence, cal.forward_confidence) < 0.3:
        raise ValueError('calibration_low_confidence: 센서 부착 방향을 고정하고 보정을 다시 기록하세요.')
    return {'foot_side': side, 'device_id': device_id, 'fs_hz': hz,
            'source_received_hz': (len(rows) - 1) / times[-1], 'still_end_s': 5,
            'vertical_channel': AXES[cal.vertical_idx], 'vertical_sign': cal.vertical_sign,
            'forward_channel': AXES[cal.forward_idx], 'lateral_channel': AXES[cal.lateral_idx],
            'vertical_confidence': cal.vertical_confidence, 'forward_confidence': cal.forward_confidence,
            'gyro_yaw_channel': None, 'zscore_mean_vfl': cal.mean.tolist(), 'zscore_std_vfl': cal.std.tolist()}


def validate_pair(body):
    context = metadata(body)
    calibration = parse_csv(body.get('calibration_csv'), context)
    measurement = parse_csv(body.get('measurement_csv'), context)
    for key in ('device_id', 'side', 'placement', 'participant_id', 'session_id'):
        if calibration.context.get(key) != measurement.context.get(key):
            raise ValueError(f'보정 파일과 측정 파일의 {key}가 다릅니다.')
    if measurement.quality['duration_s'] < 4:
        raise ValueError('측정 CSV는 최소 4초, 권장 30~60초 이상 기록하세요.')
    cal = calibration_from_rows(calibration.rows, context['side'], calibration.context['device_id'])
    cal.update({k: calibration.context[k] for k in ('participant_id', 'session_id', 'placement')})
    return calibration, measurement, cal


def replay(recording, calibration_path, side, model, artifact_dir, progress=None):
    if __package__:
        from .server import FootRuntime
    else:
        from server import FootRuntime
    runtime = FootRuntime(side, calibration_path, model, artifact_dir)
    if not runtime.detector:
        raise ValueError(runtime.load_error)
    expected = runtime.calibration_info.get('device_id')
    identity = recording.context.get('device_id', expected or side)
    if expected and expected != identity:
        raise ValueError('calibration_device_mismatch')
    windows = []
    start = recording.rows[0, 0]
    for index, (row, label) in enumerate(zip(recording.rows, recording.labels)):
        timestamp, *axes = row.tolist()
        payload = {'foot_side': side, 'device_id': identity, 'boot_id': recording.context.get('boot_id', 'csv'),
                   'frame': index, 'millis': timestamp - start, 'imu_ready': True,
                   'accel': dict(zip('xyz', axes[:3])), 'gyro': dict(zip('xyz', axes[3:]))}
        count = runtime.total_windows
        if not runtime.ingest(payload):
            raise ValueError(f'CSV {index + 2}행: {runtime.error}')
        if runtime.total_windows > count:
            diag = dict(runtime.detector.last_diagnostics)
            end = runtime.resampler.next_time * 1000 - 1000 / 64
            windows.append({'timestamp_ms': float(start + end), 'elapsed_s': round(end / 1000, 6),
                            'window_start_ms': float(start + end - 255 * 1000 / 64),
                            'state': runtime.state, 'raw_model_score': diag.get('raw_model_score'),
                            'rf_score': diag.get('rf_score'), 'cnn_score': diag.get('cnn_score'),
                            'decision_score': diag.get('decision_score'), 'score_percent': round(diag['decision_score'] * 100, 1),
                            'reason': diag.get('reason'), 'operator_label_at_window_end': recording.labels[max(0, int(np.searchsorted(recording.rows[:, 0], start + end, side='right')) - 1)],
                            'segment': runtime.resets, 'diagnostics': diag})
        if progress and index % 512 == 0:
            progress(index + 1, len(recording.rows))
    if not windows:
        raise ValueError('연속된 유효 4초 구간이 없습니다. 누락과 실제 수집률을 확인하세요.')
    severity = {'normal': 0, 'warning': 1, 'confirmed': 2}
    highest = max(windows, key=lambda w: (severity[w['state']], w['decision_score']))
    return {'source': 'csv_replay', 'schema': 'stepon-analysis-v1', 'model': model, 'foot': side,
            'metadata': recording.context, 'quality': recording.quality,
            'samples': runtime.accepted_samples, 'window_count': len(windows), 'resets': runtime.resets,
            'latest': windows[-1], 'highest': highest,
            'state_counts': {s: sum(w['state'] == s for w in windows) for s in severity},
            'windows': windows, 'window_sec': 4, 'hop_sec': 0.5,
            'note': '각 4초 창의 기록 분석입니다. 전체 파일의 단일 진단·정답 정확도가 아니며 label은 수집자 메모입니다.'}


def windows_csv(result):
    output = io.StringIO(newline='')
    columns = ['timestamp_ms', 'window_start_ms', 'elapsed_s', 'segment', 'state', 'rf_score', 'cnn_score',
               'raw_model_score', 'decision_score', 'score_percent', 'reason', 'operator_label_at_window_end']
    writer = csv.DictWriter(output, fieldnames=columns, extrasaction='ignore')
    writer.writeheader()
    writer.writerows(result['windows'])
    return output.getvalue()


def write_json(path, value):
    path = Path(path)
    pending = path.with_suffix('.pending')
    pending.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    pending.replace(path)
