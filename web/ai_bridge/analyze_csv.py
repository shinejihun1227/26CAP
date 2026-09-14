"""Replay a user's timestamped sensor CSV through the exact live pipeline."""
import argparse
import csv
import json
from pathlib import Path
if __package__:
    from .server import FootRuntime, ARTIFACT_DIR, CSV_COLUMNS
else:
    from server import FootRuntime, ARTIFACT_DIR, CSV_COLUMNS


def analyze(path, calibration, side='right', model='ensemble', fs=None):
    runtime = FootRuntime(side, calibration, model, ARTIFACT_DIR)
    if not runtime.detector:
        raise ValueError(runtime.load_error)
    windows = []
    previous_t = None
    with Path(path).open(encoding='utf-8-sig', newline='') as file:
        reader = csv.DictReader(file)
        required = CSV_COLUMNS[1:]
        if not set(required).issubset(reader.fieldnames or []):
            raise ValueError(f'CSV requires {required}')
        if 'timestamp_ms' not in reader.fieldnames and (fs is None or fs <= 0):
            raise ValueError('timestamp_ms column or explicit --fs required')
        for index, row in enumerate(reader):
            timestamp = float(row['timestamp_ms']) if 'timestamp_ms' in row else index * 1000 / fs
            if previous_t is not None and timestamp <= previous_t:
                raise ValueError(f'non-increasing timestamp at CSV row {index + 2}')
            previous_t = timestamp
            payload = {'foot_side': side, 'device_id': runtime.calibration_info.get('device_id') or side,
                       'frame': index, 'millis': timestamp, 'imu_ready': True,
                       'accel': {axis: float(row[f'raw_acc_{axis}']) for axis in 'xyz'},
                       'gyro': {axis: float(row[f'raw_gyro_{axis}']) for axis in 'xyz'}}
            count = runtime.total_windows
            if not runtime.ingest(payload):
                raise ValueError(f'invalid sample at CSV row {index + 2}: {runtime.error}')
            if runtime.total_windows > count:
                snap = runtime.snapshot()
                windows.append({'timestamp_ms': timestamp, 'state': snap['state'],
                                'raw_model_score': snap['fog_score'], 'decision_score': snap['decision_score'],
                                'reason': snap['diagnostics'].get('reason')})
    return {'source': 'csv_replay', 'model': model, 'foot': side, 'samples': runtime.accepted_samples,
            'window_count': len(windows), 'resets': runtime.resets,
            'latest': windows[-1] if windows else None, 'windows': windows,
            'note': 'Recorded model outputs, not a diagnosis or a labelled accuracy evaluation.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv', type=Path)
    parser.add_argument('--calibration', type=Path, required=True)
    parser.add_argument('--foot', choices=['left', 'right'], default='right')
    parser.add_argument('--model', choices=['rf', 'cnn', 'ensemble'], default='ensemble')
    parser.add_argument('--fs', type=float)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    result = analyze(args.csv, args.calibration, args.foot, args.model, args.fs)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'windows'}, ensure_ascii=False))
    if not result['windows']:
        raise SystemExit('No valid 4-second window. Check duration, gaps and actual sample rate.')


if __name__ == '__main__':
    main()
