"""CLI entry point for on-device calibration - run this the moment real
shoe/ESP32 data exists.

Usage:
    python scripts/run_calibration.py recording.csv --fs 100 --still-end 5.0

Expects a CSV with raw_acc_x, raw_acc_y, raw_acc_z columns (any physical
meaning, unlabeled) and optionally raw_gyro_x, raw_gyro_y, raw_gyro_z,
recorded as: put the device on, stand still for `--still-end` seconds, then
walk normally, optionally followed by turning in place (several full
rotations) for the rest of the file if `--walk-end` is given - that turn
phase is what lets this identify a gyro YAW axis, not just pitch. Without
`--walk-end`, everything after `--still-end` is treated as walk (the
original 2-phase protocol) and no yaw axis is identified.

Writes a JSON with the recovered axis mapping + locked-in normalization
stats, ready to feed into fog_validation.ml.realtime.CalibrationStats and
AxisCalibration.remap()/normalize() for the live pipeline.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from fog_validation.ml.calibration import calibrate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path", type=Path)
    ap.add_argument("--fs", type=float, required=True, help="sampling rate of the recording, Hz")
    ap.add_argument("--still-end", type=float, default=5.0,
                    help="seconds of standing-still at the start before walking begins")
    ap.add_argument("--walk-end", type=float, default=None,
                    help="seconds (from file start) where straight walking ends and a "
                         "turning-in-place phase begins - omit if the recording has no "
                         "turn phase (no gyro yaw axis will be identified)")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    d = pd.read_csv(args.csv_path)
    accel_cols = ["raw_acc_x", "raw_acc_y", "raw_acc_z"]
    missing = [c for c in accel_cols if c not in d.columns]
    if missing:
        raise SystemExit(f"CSV missing required columns: {missing}. "
                         f"Found: {list(d.columns)}")
    raw_accel = d[accel_cols].to_numpy()

    raw_gyro = None
    gyro_cols = ["raw_gyro_x", "raw_gyro_y", "raw_gyro_z"]
    if all(c in d.columns for c in gyro_cols):
        raw_gyro = d[gyro_cols].to_numpy()

    cal = calibrate(raw_accel, fs=args.fs, still_end_s=args.still_end,
                    raw_gyro=raw_gyro, walk_end_s=args.walk_end)

    axis_names = ["raw_acc_x", "raw_acc_y", "raw_acc_z"]
    gyro_names = ["raw_gyro_x", "raw_gyro_y", "raw_gyro_z"]
    result = {
        "source_file": str(args.csv_path),
        "fs_hz": args.fs,
        "still_end_s": args.still_end,
        "walk_end_s": args.walk_end,
        "vertical_channel": axis_names[cal.vertical_idx],
        "vertical_sign": cal.vertical_sign,
        "forward_channel": axis_names[cal.forward_idx],
        "lateral_channel": axis_names[[i for i in range(3)
                                       if i not in (cal.vertical_idx, cal.forward_idx)][0]],
        "vertical_confidence": cal.vertical_confidence,
        "forward_confidence": cal.forward_confidence,
        "gyro_pitch_channel": (gyro_names[cal.gyro_pitch_idx]
                               if cal.gyro_pitch_idx is not None else None),
        "gyro_pitch_confidence": cal.gyro_pitch_confidence,
        "gyro_yaw_channel": (gyro_names[cal.gyro_yaw_idx]
                             if cal.gyro_yaw_idx is not None else None),
        "gyro_yaw_confidence": cal.gyro_yaw_confidence,
        "zscore_mean_vfl": cal.mean.tolist(),   # [vertical, forward, lateral] order
        "zscore_std_vfl": cal.std.tolist(),
    }

    print(json.dumps(result, indent=2, ensure_ascii=False))

    core_confidences = [cal.vertical_confidence, cal.forward_confidence]
    if any(c < 0.3 for c in core_confidences):
        print("\n[WARNING] low confidence on vertical/forward (<0.3) - "
              "check mounting, or the still/walk phases may not be clean. "
              "See channel_map.py's HuGaDB docstring for what a low-confidence "
              "forward/lateral split looked like on a real (tilted) mount.")
    if cal.gyro_yaw_confidence is not None and cal.gyro_yaw_confidence < 0.3:
        print("\n[WARNING] low confidence on gyro yaw (<0.3) - this identification is "
              "noisier than the others even when it succeeds (see calibration.py's module "
              "docstring: ~66% per-recording agreement in the empirical check, not the ~100% "
              "the other 3 axes get). Consider a longer turn phase (more full rotations) "
              "and recalibrating before trusting the yaw gate on this session.")

    out_path = args.out or args.csv_path.with_suffix(".calibration.json")
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[saved] {out_path}")


if __name__ == "__main__":
    main()
