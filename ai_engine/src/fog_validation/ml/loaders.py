"""Raw-file loaders for Daphnet, FoG-STAR, and HuGaDB, returning a common Segment type.

A Segment is a temporally CONTIGUOUS run of usable samples, already at
TARGET_FS_HZ, in the 3 common channels, with a per-sample binary FoG label
AND a per-sample ground-truth ACTIVITY code where the source dataset has one.
Segmenting happens at the RAW sampling rate, before resampling, so that a
gap (Daphnet annotation==0, a FoG-STAR sensor NaN dropout, or a HuGaDB
activity-type boundary) is never bridged by the resampling filter, and a
window is never built across one.

`activity` uses ACTIVITY_UNKNOWN (-1) for datasets with no ground-truth
activity sub-label (Daphnet; own-data unless its optional `activity` column
is populated). windowing.py falls back to the walk class for those, rather
than guessing via an energy heuristic - see windowing.py's docstring for why
that heuristic (used in an earlier session) was dropped.

Exclusions (gaps in the recording, not a modeling choice):
  Daphnet:  annotation == 0 ("not part of the experiment") rows dropped.
  FoG-STAR: rows where any of the 3 used ankleR channels is NaN dropped.
  HuGaDB:   ONLY activity codes {1 (walking), 5,6,7,8 (sitting/sitting_down/
            standing_up/standing)} are kept - running/stairs/cycling/
            elevator/car are out of this project's "walk or stop" scope and
            would corrupt the walk class's biomechanics if lumped in.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from fog_validation.common.config import DAPHNET_COLUMNS, DAPHNET_RAW_DIR
from fog_validation.ml.channel_map import (
    DAPHNET_CHANNEL_COLUMNS,
    FOGSTAR_CHANNEL_COLUMNS_BY_SIDE,
    HUGADB_CHANNEL_COLUMNS,
    HUGADB_COLUMN_INDEX,
    OWN_CHANNEL_COLUMNS,
)
from fog_validation.ml.config import (
    COMMON_CHANNELS,
    FOGSTAR_RAW_CSV,
    HUGADB_FS_HZ,
    HUGADB_RAW_DIR,
    HUGADB_STOP_ACTIVITY_CODES,
    HUGADB_WALK_ACTIVITY_CODES,
    OWN_DATA_RAW_DIR,
    TARGET_FS_HZ,
)
from fog_validation.ml.resampling import resample_labels_nearest, resample_signal

_DAPHNET_FS = 64
_FOGSTAR_FS = 60
ACTIVITY_UNKNOWN = -1
_HUGADB_KEEP_CODES = HUGADB_WALK_ACTIVITY_CODES | HUGADB_STOP_ACTIVITY_CODES


@dataclass(frozen=True)
class Segment:
    dataset: str           # "daphnet" | "fogstar" | "hugadb" | "own"
    subject: str            # namespaced-safe string id
    block_id: str            # run/session/file id, unique within (dataset, subject)
    signal: np.ndarray        # [T, 3] float32, at TARGET_FS_HZ, in g, common channel order
    fog: np.ndarray            # [T] int, 0/1
    activity: np.ndarray        # [T] int, ground-truth activity code, or ACTIVITY_UNKNOWN


def _contiguous_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """(start, end) exclusive-end index pairs of contiguous True runs."""
    if not mask.any():
        return []
    d = np.diff(mask.astype(np.int8))
    starts = list(np.flatnonzero(d == 1) + 1)
    ends = list(np.flatnonzero(d == -1) + 1)
    if mask[0]:
        starts = [0] + starts
    if mask[-1]:
        ends = ends + [len(mask)]
    return list(zip(starts, ends))


# --------------------------------------------------------------------- Daphnet
def load_daphnet_segments(raw_dir: Path = DAPHNET_RAW_DIR) -> list[Segment]:
    files = sorted(raw_dir.glob("S*R*.txt"))
    if not files:
        raise FileNotFoundError(f"No Daphnet files under {raw_dir}")

    segments = []
    for p in files:
        m = re.match(r"^(S\d{2})(R\d{2})\.txt$", p.name)
        subject, run = m.group(1), m.group(2)
        arr = np.loadtxt(p)
        df = pd.DataFrame(arr, columns=DAPHNET_COLUMNS)
        annotation = df["annotation"].to_numpy().astype(int)
        t_s = df["time_ms"].to_numpy() / 1000.0

        chans = np.stack(
            [df[col].to_numpy() * scale for col, scale in
             (DAPHNET_CHANNEL_COLUMNS[c] for c in COMMON_CHANNELS)],
            axis=1,
        )
        fog = (annotation == 2).astype(int)
        activity = np.full(len(fog), ACTIVITY_UNKNOWN, dtype=int)

        for s, e in _contiguous_runs(annotation != 0):
            if e - s < 2:
                continue
            sig = resample_signal(chans[s:e], _DAPHNET_FS, TARGET_FS_HZ).astype(np.float32)
            lab, _ = resample_labels_nearest(fog[s:e], t_s[s:e], TARGET_FS_HZ)
            act, _ = resample_labels_nearest(activity[s:e], t_s[s:e], TARGET_FS_HZ)
            n = min(len(sig), len(lab))
            segments.append(Segment("daphnet", subject, f"{run}_{s}", sig[:n], lab[:n], act[:n]))
    return segments


# -------------------------------------------------------------------- FoG-STAR
def load_fogstar_segments(csv_path: Path = FOGSTAR_RAW_CSV, sides: tuple[str, ...] = ("R", "L")) -> list[Segment]:
    """sides=("R","L") (default): loads BOTH ankles as separate segment sets,
    same `subject` id so splits.py keeps a subject's two sides together (see
    channel_map.py's "BILATERAL upgrade" docstring for why that matters).
    Pass sides=("R",) to reproduce the original single-side pipeline.
    """
    if not csv_path.exists():
        raise FileNotFoundError(f"FoG-STAR csv not found at {csv_path} (set FOGSTAR_RAW_CSV env var)")

    all_side_cols = {col for side in sides for col, _ in FOGSTAR_CHANNEL_COLUMNS_BY_SIDE[side].values()}
    cols_needed = ["timestamp", "fog", "activity", "subjectID", "sessionID", "taskID"] + sorted(all_side_cols)
    d = pd.read_csv(csv_path, usecols=cols_needed)

    segments = []
    for (subj, sess, task), g in d.groupby(["subjectID", "sessionID", "taskID"], sort=False):
        g = g.reset_index(drop=True)
        fog = g["fog"].to_numpy().astype(int)
        activity = g["activity"].fillna(ACTIVITY_UNKNOWN).to_numpy().astype(int)
        t_s = g["timestamp"].to_numpy()

        for side in sides:
            channel_map = FOGSTAR_CHANNEL_COLUMNS_BY_SIDE[side]
            chans = np.stack(
                [g[col].to_numpy() * scale for col, scale in
                 (channel_map[c] for c in COMMON_CHANNELS)],
                axis=1,
            )
            valid = ~np.isnan(chans).any(axis=1)

            for s, e in _contiguous_runs(valid):
                if e - s < 2:
                    continue
                sig = resample_signal(chans[s:e], _FOGSTAR_FS, TARGET_FS_HZ).astype(np.float32)
                lab, _ = resample_labels_nearest(fog[s:e], t_s[s:e], TARGET_FS_HZ)
                act, _ = resample_labels_nearest(activity[s:e], t_s[s:e], TARGET_FS_HZ)
                n = min(len(sig), len(lab))
                segments.append(Segment("fogstar", str(subj), f"{side}_{sess}_{task}_{s}",
                                        sig[:n], lab[:n], act[:n]))
    return segments


# --------------------------------------------------------------------- HuGaDB
def _load_hugadb_file(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Returns (chans6 [T,6] float64 raw counts, activity_id [T] int).

    File format (see docs read this session, no header names in data rows):
      line 1: '#Activity\\t<name> <name> ...'   (one name per embedded segment)
      line 2: '#ActivityID\\t<id> <id> ...'      (matching ids)
      line 3: '#Date ...'
      line 4: tab-separated column header (RF_acc_x ... last col unused text)
      rows 5+: 39 tab-separated numeric columns, last one = ActivityID per sample
    """
    with open(path) as f:
        f.readline(); f.readline(); f.readline(); f.readline()
        data = np.loadtxt(f, delimiter="\t")
    col_names = [HUGADB_CHANNEL_COLUMNS[c][0] for c in COMMON_CHANNELS]
    idx = [HUGADB_COLUMN_INDEX[c] for c in col_names]
    chans = data[:, idx]
    activity = data[:, -1].astype(int)
    return chans, activity


def load_hugadb_segments(raw_dir: Path = HUGADB_RAW_DIR) -> list[Segment]:
    if not raw_dir.exists():
        raise FileNotFoundError(
            f"No HuGaDB files under {raw_dir}. Download from "
            "https://github.com/romanchereshnev/HuGaDB and extract HumanGaitDataBase.zip "
            "so that *.txt files sit directly under this directory."
        )
    files = sorted(raw_dir.glob("HuGaDB_*.txt"))  # excludes the sibling ReadMe.txt
    if not files:
        raise FileNotFoundError(f"{raw_dir} exists but contains no HuGaDB_*.txt files.")

    scales = np.array([HUGADB_CHANNEL_COLUMNS[c][1] for c in COMMON_CHANNELS])
    segments = []
    for p in files:
        # filename: HuGaDB_v{version}_{activity-type}_{participant}_{counter}.txt
        # -> participant id is always the second-to-last underscore token
        # (confirmed this session across all 635 files: exactly 18 unique
        # 2-digit ids, no exceptions).
        subject = p.stem.split("_")[-2]

        raw_chans, activity = _load_hugadb_file(p)
        chans = raw_chans * scales
        n = len(chans)
        t_s = np.arange(n) / HUGADB_FS_HZ  # no per-sample timestamp in this dataset - see config.py

        for s, e in _contiguous_runs(np.isin(activity, list(_HUGADB_KEEP_CODES))):
            if e - s < 2:
                continue
            sig = resample_signal(chans[s:e], HUGADB_FS_HZ, TARGET_FS_HZ).astype(np.float32)
            act, _ = resample_labels_nearest(activity[s:e], t_s[s:e], TARGET_FS_HZ)
            fog = np.zeros(len(act), dtype=int)  # HuGaDB has no PD/FoG subjects at all
            n_out = min(len(sig), len(act))
            segments.append(Segment("hugadb", subject, f"{p.stem}_{s}", sig[:n_out], fog[:n_out], act[:n_out]))
    return segments


# --------------------------------------------------------------- own data
def load_own_segments(raw_dir: Path = OWN_DATA_RAW_DIR) -> list[Segment]:
    """Loader hook for docs/own_data_schema.md. Fs is estimated per-file from
    the mean of timestamp_s diffs (not median - see Daphnet's docstring in
    common/config.py for why median is the wrong statistic for quantized
    timestamps). fog==NaN rows (unlabeled real-time capture) are treated as
    fog=0 for windowing purposes but the caller should filter unlabeled
    segments out before training - this loader does not do that filtering
    itself, since "unlabeled" is a training-time decision, not a loading one.
    The schema's optional `activity` column, if present, is carried through
    with FoG-STAR's code scheme; otherwise ACTIVITY_UNKNOWN.
    """
    if not raw_dir.exists():
        raise FileNotFoundError(
            f"No own-collected data found under {raw_dir}. "
            "See docs/own_data_schema.md for the expected CSV format and filename convention."
        )
    files = sorted(raw_dir.glob("*_*.csv"))
    if not files:
        raise FileNotFoundError(f"{raw_dir} exists but contains no *_*.csv files.")

    segments = []
    for p in files:
        subject, session = p.stem.split("_", 1)
        d = pd.read_csv(p)
        t_s = d["timestamp_s"].to_numpy(float)
        fs_in = 1.0 / float(np.mean(np.diff(t_s)))

        chans = np.stack(
            [d[col].to_numpy(float) * scale for col, scale in
             (OWN_CHANNEL_COLUMNS[c] for c in COMMON_CHANNELS)],
            axis=1,
        )
        valid = ~np.isnan(chans).any(axis=1)
        fog = d["fog"].fillna(0).to_numpy().astype(int)
        activity = d["activity"].fillna(ACTIVITY_UNKNOWN).to_numpy().astype(int) \
            if "activity" in d.columns else np.full(len(d), ACTIVITY_UNKNOWN, dtype=int)

        for s, e in _contiguous_runs(valid):
            if e - s < 2:
                continue
            need_resample = round(fs_in) != TARGET_FS_HZ
            if need_resample:
                sig = resample_signal(chans[s:e], round(fs_in), TARGET_FS_HZ).astype(np.float32)
                lab, _ = resample_labels_nearest(fog[s:e], t_s[s:e], TARGET_FS_HZ)
                act, _ = resample_labels_nearest(activity[s:e], t_s[s:e], TARGET_FS_HZ)
            else:
                sig, lab, act = chans[s:e].astype(np.float32), fog[s:e], activity[s:e]
            n = min(len(sig), len(lab))
            segments.append(Segment("own", str(subject), f"{session}_{s}", sig[:n], lab[:n], act[:n]))
    return segments


def load_all_segments(include_hugadb: bool = True) -> list[Segment]:
    segs = load_daphnet_segments() + load_fogstar_segments()
    if include_hugadb:
        segs += load_hugadb_segments()
    return segs
