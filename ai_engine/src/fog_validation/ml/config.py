"""Config for the multi-dataset (Daphnet + FoG-STAR) training pipeline.

Confirmed in STEP 0 (this session) by directly loading raw files, not assumed:
  Daphnet:  17 recordings, 10 subjects, 11 columns, 64.0000 Hz (mean dt, NOT
            median - Daphnet timestamps are integer-ms quantized so dt
            alternates 15/16ms and the median reads a false 62.5 Hz).
            annotation in {0,1,2}; 0 = not part of experiment (excluded here).
            8/10 subjects have >=1 FoG sample (S04, S10 have zero).
  FoG-STAR: 22 subjects, 31 columns, 60.0000 Hz exactly, binary `fog` label,
            `subjectID` present. 16/22 subjects have >=1 FoG sample.
            NaN gaps exist in every channel (worst: back, 8.2% of rows).
"""
from __future__ import annotations

import os
from pathlib import Path

from fog_validation.common.config import DATA_PROCESSED, DATA_RAW, PROJECT_ROOT

# FoG-STAR lives in a sibling project folder, not inside this repo (raw data
# is never copied/moved - see project rule). Overridable via env var since
# this path crosses repo boundaries and is the one thing that can't be
# guaranteed portable.
FOGSTAR_RAW_CSV = Path(os.environ.get(
    "FOGSTAR_RAW_CSV",
    PROJECT_ROOT.parent / "StepOn_Track1_TurningRisk" / "data" / "fogstar" / "sensor_data.csv",
))

# Future own-collected data (see docs/own_data_schema.md). Directory doesn't
# exist yet - load_own_segments() raises a clear error until files are placed
# here, rather than failing on an import-time missing-path check.
OWN_DATA_RAW_DIR = DATA_RAW / "own"

# HuGaDB (Chereshnev & Kertesz-Farkas 2017/2018), downloaded this session from
# github.com/romanchereshnev/HuGaDB. Healthy (non-PD) subjects, right-foot IMU,
# 60 Hz, documented int16 raw counts over +-2g / +-2000 deg/s. Used ONLY as a
# source of GROUND-TRUTH walk/stop activity labels - it has no FoG concept at
# all (healthy subjects), so every HuGaDB window is fog=0 by construction.
HUGADB_RAW_DIR = DATA_RAW / "hugadb" / "Data"
HUGADB_ACC_SCALE = 2.0 / 32768   # raw int16 count -> g
HUGADB_GYRO_SCALE = 2000.0 / 32768  # raw int16 count -> deg/s
HUGADB_FS_HZ = 60  # documented rate; NOT independently verifiable - HuGaDB
                   # carries no per-sample timestamp column to cross-check
                   # (unlike Daphnet/FoG-STAR, where the mean-of-diffs check
                   # caught a documentation/median-statistic trap).

# Ground-truth activity codes used to build the 3-class label (walk/stop/fog)
# WITHOUT the energy-threshold heuristic this project used before this
# session (see windowing.py docstring for why that heuristic was replaced).
FOGSTAR_STOP_ACTIVITY_CODES = {2, 3, 4, 5}    # Sit, Stand, Sit2Stand, Stand2Sit
FOGSTAR_WALK_ACTIVITY_CODES = {1, 6, 7}       # Walk, TurnRight, TurnLeft
HUGADB_STOP_ACTIVITY_CODES = {5, 6, 7, 8}     # sitting, sitting_down, standing_up, standing
HUGADB_WALK_ACTIVITY_CODES = {1}              # walking only - running/stairs/cycling/
                                               # elevator/car are excluded (see loaders.py)

# 4-class label refinement (see windowing.assign_4class_labels /
# label_4class_from_3class and scripts/sitstand_classification_
# investigation.py): the Sit-to-Stand/Stand-to-Sit POSTURAL-TRANSITION
# subset of the codes above, carved OUT of the 3-class "stop" label into its
# own class. Strict subsets of FOGSTAR_STOP_ACTIVITY_CODES/
# HUGADB_STOP_ACTIVITY_CODES above - no new ground truth invented, just a
# finer split of the same already-established stop-family codes.
FOGSTAR_SITSTAND_ACTIVITY_CODES = {4, 5}      # Sit-to-Stand, Stand-to-Sit
HUGADB_SITSTAND_ACTIVITY_CODES = {6, 7}       # sitting_down, standing_up

# Human-readable activity names, per dataset. The integer codes COLLIDE across
# datasets (code 5 = "Stand-to-Sit" in FoG-STAR but "sitting" in HuGaDB), so
# any cross-dataset activity analysis MUST namespace by dataset.
FOGSTAR_ACTIVITY_NAMES = {
    0: "other", 1: "Walking", 2: "Sit", 3: "Stand",
    4: "Sit-to-Stand", 5: "Stand-to-Sit", 6: "TurnRight", 7: "TurnLeft",
}
HUGADB_ACTIVITY_NAMES = {
    1: "walking", 2: "running", 3: "stairs_up", 4: "stairs_down",
    5: "sitting", 6: "sitting_down", 7: "standing_up", 8: "standing",
    9: "cycling", 10: "elevator_up", 11: "elevator_down", 12: "in_car",
}
ACTIVITY_NAMES_BY_DATASET = {
    "fogstar": FOGSTAR_ACTIVITY_NAMES,
    "hugadb": HUGADB_ACTIVITY_NAMES,
    # Daphnet has NO activity sub-label: annotation==1 merges stand/walk/turn
    # into one code. Turn-vs-FoG confusion is therefore UNMEASURABLE on
    # Daphnet - only FoG-STAR can answer that question.
    "daphnet": {},
    "own": FOGSTAR_ACTIVITY_NAMES,  # own_data_schema.md reuses FoG-STAR's codes
}

ML_DIR = DATA_PROCESSED / "ml"
ML_FIGS_DIR = DATA_PROCESSED / "figs"
for _d in (ML_DIR, ML_FIGS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Target sampling rate. Daphnet is already exactly 64 Hz (pass-through).
# FoG-STAR is exactly 60 Hz -> resampled with polyphase resample_poly(up=16,
# down=15), which is exact since 64/60 = 16/15 (no approximation error from
# the rate ratio itself; resample_poly's anti-aliasing filter is the only
# approximation, standard for this kind of small-ratio resampling).
# ---------------------------------------------------------------------------
TARGET_FS_HZ = 64

# Window length/hop are independently overridable via env vars so different
# configs can be A/B compared (on VAL only) without editing this file.
#
# Default changed THIS session from the task's original spec (2.0s, 50%
# overlap) to 4.0s / 0.5s hop, based on a real A/B run: RandomForest trained
# identically on both, PD_only VAL AUC (Daphnet+FoG-STAR only, never test)
# was 0.799 @ 4.0s/0.5s vs 0.768 @ 2.0s/1.0s. This matches an earlier,
# independent window-length sweep on this same overall project (Daphnet
# concurrent-framing AUC peaked around 4.0s and fell off below ~2.0s) - two
# separate pipelines agreeing is a stronger signal than either alone.
# Pass FOG_WINDOW_SEC=2.0 to reproduce the original 2.0s spec if needed.
WINDOW_SEC = float(os.environ.get("FOG_WINDOW_SEC", 4.0))
HOP_SEC = float(os.environ.get("FOG_HOP_SEC", 0.5))
WINDOW_SAMPLES = int(round(WINDOW_SEC * TARGET_FS_HZ))
HOP_SAMPLES = int(round(HOP_SEC * TARGET_FS_HZ))

FOG_LABEL_RATIO = 0.5          # window is FoG if >50% of its samples are FoG-labeled

# ---------------------------------------------------------------------------
# Common channel set: 3-axis ANKLE/SHANK ACCELEROMETER ONLY.
# Daphnet has no gyroscope at all, so gyro is out of scope for any channel
# shared across both datasets - this is the "minimum common intersection"
# the task explicitly falls back to.
# Channel order fixed as [vertical, horizontal_forward, horizontal_lateral],
# units standardized to g. See channel_map.py for the per-dataset mapping
# and the empirical justification for the FoG-STAR axis assignment (FoG-STAR
# does not document its axis semantics anywhere).
# ---------------------------------------------------------------------------
COMMON_CHANNELS = ["acc_vertical_g", "acc_horiz_fwd_g", "acc_horiz_lat_g"]
N_CHANNELS = len(COMMON_CHANNELS)

DAPHNET_SIDE = "shank"     # only side Daphnet has
FOGSTAR_SIDE = "ankleR"    # chosen over ankleL - see channel_map.py docstring

# ---------------------------------------------------------------------------
# Subject-level split. Ratios are a target, not exact - with only 10 Daphnet
# subjects the actual per-split counts are necessarily coarse (see splits.py).
# ---------------------------------------------------------------------------
TRAIN_FRAC = 0.70
VAL_FRAC = 0.15
TEST_FRAC = 0.15
MIN_FOG_POSITIVE_SUBJECTS_IN_TEST = 2   # per dataset, not pooled
SPLIT_SEARCH_SEEDS = 2000               # rejection-sampling attempts (see splits.py)

RANDOM_SEED = 42
