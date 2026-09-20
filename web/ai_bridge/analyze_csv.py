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
    if __package__:
        from .csv_pipeline import parse_csv, replay
    else:
        from csv_pipeline import parse_csv, replay
    recording = parse_csv(Path(path).read_text(encoding='utf-8-sig'), {'side': side}, legacy=True, fs=fs)
    return replay(recording, calibration, side, model, ARTIFACT_DIR)


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
