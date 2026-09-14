"""Segment -> window table: FoG labeling + GROUND-TRUTH-activity stop/walk labeling.

3-class label: walk(0) / stop(1) / fog(2). Binary label: fog(1) vs rest(0).

CHANGE FROM AN EARLIER SESSION (important): stop used to be assigned by an
energy threshold (Otsu on SMA). That was cross-validated against FoG-STAR's
own activity column and found noisy: ~36% of true Walk windows and ~40-53%
of Turn windows were being called "stop" by energy alone, because slow
walking and a freeze both look like low signal energy - exactly the
confound this project needs to NOT have in its stop label.

This session replaces it with GROUND-TRUTH activity labels wherever the
source dataset actually has them:
  FoG-STAR: its own `activity` column (already validated ~88-98% pure
            against Sit/Stand/etc in an earlier session).
  HuGaDB:   its own per-sample ActivityID (experimenter-annotated, not
            inferred at all).
  Daphnet:  has NO activity sub-label (annotation==1 merges stand/walk/turn
            with no way to split them). Its non-freeze windows are labeled
            walk, not "guessed" into stop via energy - a wrong "walk" is a
            less harmful training signal than a heuristically wrong "stop"
            (Daphnet's freeze/non-freeze annotation itself stays exact;
            only the walk/stop split within "non-freeze" is coarsened).

FoG windows (fog_frac > FOG_LABEL_RATIO) are decided FIRST from the FoG
label and always win - a window can never be reassigned from fog to
stop/walk based on activity.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view

from fog_validation.ml.config import (
    FOG_LABEL_RATIO,
    FOGSTAR_SITSTAND_ACTIVITY_CODES,
    FOGSTAR_STOP_ACTIVITY_CODES,
    HOP_SAMPLES,
    HUGADB_SITSTAND_ACTIVITY_CODES,
    HUGADB_STOP_ACTIVITY_CODES,
    WINDOW_SAMPLES,
)
from fog_validation.ml.loaders import ACTIVITY_UNKNOWN, Segment

LABEL_WALK, LABEL_STOP, LABEL_FOG = 0, 1, 2

_STOP_CODES_BY_DATASET = {
    "fogstar": FOGSTAR_STOP_ACTIVITY_CODES,
    "hugadb": HUGADB_STOP_ACTIVITY_CODES,
    "daphnet": frozenset(),  # no activity sub-label - see module docstring
    "own": FOGSTAR_STOP_ACTIVITY_CODES,  # own_data_schema.md uses the same code scheme
}

# 4-class label (walk/stop/sit-stand/fog) - see assign_4class_labels /
# label_4class_from_3class below and scripts/sitstand_classification_
# investigation.py for why this exists. Deliberately a SEPARATE integer
# namespace from LABEL_WALK/LABEL_STOP/LABEL_FOG above (LABEL_FOG=2 there,
# LABEL4_FOG=3 here) rather than renumbering the 3-class constants in place -
# every already-saved train/val/test.npz's y_3class column, and every script
# that imports LABEL_FOG expecting value 2, stays valid and untouched.
LABEL4_WALK, LABEL4_STOP, LABEL4_SITSTAND, LABEL4_FOG = 0, 1, 2, 3

_SITSTAND_CODES_BY_DATASET = {
    "fogstar": FOGSTAR_SITSTAND_ACTIVITY_CODES,
    "hugadb": HUGADB_SITSTAND_ACTIVITY_CODES,
    "daphnet": frozenset(),  # no activity sub-label - see module docstring
    "own": FOGSTAR_SITSTAND_ACTIVITY_CODES,
}


def _dominant_known_code(a: np.ndarray) -> int:
    known = a[a >= 0]
    if len(known) == 0:
        return ACTIVITY_UNKNOWN
    return int(np.bincount(known).argmax())


def build_windows(segments: list[Segment]) -> pd.DataFrame:
    """One row per window: dataset, subject, block_id, window_idx, signal
    ([WINDOW_SAMPLES, N_CHANNELS] float32 array), fog_frac, sma, dominant_activity.
    """
    rows = []
    for seg in segments:
        T = len(seg.signal)
        if T < WINDOW_SAMPLES:
            continue
        W = sliding_window_view(seg.signal, WINDOW_SAMPLES, axis=0)  # [n_win, C, WINDOW_SAMPLES]
        W = np.moveaxis(W, 1, 2)[::HOP_SAMPLES]                     # [n_win, WINDOW_SAMPLES, C]
        Lw = sliding_window_view(seg.fog, WINDOW_SAMPLES)[::HOP_SAMPLES]
        Aw = sliding_window_view(seg.activity, WINDOW_SAMPLES)[::HOP_SAMPLES]

        fog_frac = Lw.mean(axis=1)
        sma = np.abs(W).sum(axis=2).mean(axis=1)  # kept as a FEATURE, not used for labeling anymore
        # per-window dominant activity = most frequent KNOWN (>=0) code.
        # ACTIVITY_UNKNOWN(-1) must never be clipped into 0 before counting -
        # 0 is FoG-STAR's real "other/unlabeled-in-source" activity code, so
        # conflating "no ground truth" with "labeled as other" would corrupt
        # the stop/walk split for exactly the windows where it matters least
        # to get wrong silently.
        dom_act = np.array([_dominant_known_code(a) for a in Aw])

        for i in range(len(W)):
            rows.append({
                "dataset": seg.dataset, "subject": seg.subject, "block_id": seg.block_id,
                "window_idx": i, "signal": W[i].astype(np.float32),
                "fog_frac": float(fog_frac[i]), "sma": float(sma[i]),
                "dominant_activity": int(dom_act[i]),
            })
    return pd.DataFrame(rows)


def assign_3class_labels(df: pd.DataFrame) -> pd.DataFrame:
    is_fog = df["fog_frac"].to_numpy() > FOG_LABEL_RATIO

    is_stop = np.zeros(len(df), dtype=bool)
    for ds, stop_codes in _STOP_CODES_BY_DATASET.items():
        if not stop_codes:
            continue
        mask = (df["dataset"] == ds).to_numpy() & df["dominant_activity"].isin(stop_codes).to_numpy()
        is_stop |= mask

    label3 = np.where(is_fog, LABEL_FOG, np.where(is_stop & ~is_fog, LABEL_STOP, LABEL_WALK))

    df = df.copy()
    df["label_3class"] = label3
    df["label_binary_fog"] = is_fog.astype(int)
    return df


def label_4class_from_3class(label3: np.ndarray, dataset: np.ndarray, dominant_activity: np.ndarray) -> np.ndarray:
    """Refines the 3-class stop label into stop/sit-stand, using the SAME
    ground-truth activity codes already used to build it (a strict subset
    split: FOGSTAR_SITSTAND_ACTIVITY_CODES/HUGADB_SITSTAND_ACTIVITY_CODES
    are subsets of the STOP code sets assign_3class_labels already uses -
    see config.py). walk/fog windows are NEVER touched - only windows the
    3-class label already called "stop" can become "sit-stand" here.

    Operates on plain arrays (not a windows dataframe) so it can be applied
    identically to (a) a freshly-built windows dataframe (via
    assign_4class_labels below) and (b) columns already saved to
    train/val/test.npz (y_3class, dataset_id, activity_code) - the two are
    equivalent because npz's dataset_id/activity_code/y_3class ARE exactly
    the columns assign_3class_labels/build_windows computed before
    build_dataset.py exported them, so applying this to the npz columns
    never re-derives ground truth, only re-reads it. Used by
    scripts/sitstand_classification_investigation.py so there is exactly
    ONE implementation of this label scheme regardless of entry point.
    """
    label3 = np.asarray(label3)
    dataset = np.asarray(dataset)
    dominant_activity = np.asarray(dominant_activity)

    is_stop = label3 == LABEL_STOP
    is_sitstand = np.zeros(len(label3), dtype=bool)
    for ds, codes in _SITSTAND_CODES_BY_DATASET.items():
        if not codes:
            continue
        mask = (dataset == ds) & np.isin(dominant_activity, list(codes))
        is_sitstand |= mask
    is_sitstand &= is_stop  # sit-stand is carved OUT of stop only, never out of walk/fog

    label4 = np.select(
        [label3 == LABEL_FOG, label3 == LABEL_WALK, is_sitstand],
        [LABEL4_FOG, LABEL4_WALK, LABEL4_SITSTAND],
        default=LABEL4_STOP,
    )
    return label4.astype(np.int64)


def assign_4class_labels(df: pd.DataFrame) -> pd.DataFrame:
    """Dataframe-level wrapper around label_4class_from_3class - reuses
    assign_3class_labels rather than reimplementing fog/stop logic, then
    only refines the "stop" rows. Adds `label_4class`; leaves
    `label_3class`/`label_binary_fog` untouched so callers that still want
    the 3-class label keep getting it from the same dataframe."""
    df = assign_3class_labels(df)
    df = df.copy()
    df["label_4class"] = label_4class_from_3class(
        df["label_3class"].to_numpy(), df["dataset"].to_numpy(), df["dominant_activity"].to_numpy())
    return df


def _contiguous_true_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """(start, end) exclusive-end index pairs of contiguous True runs in mask.
    Same logic as loaders._contiguous_runs / severity_gap_investigation.py's
    contiguous_runs (kept as its own tiny copy here rather than importing
    across module boundaries for a one-line helper)."""
    if not mask.any():
        return []
    d = np.diff(np.concatenate([[False], mask, [False]]).astype(np.int8))
    starts = np.flatnonzero(d == 1)
    ends = np.flatnonzero(d == -1)
    return list(zip(starts.tolist(), ends.tolist()))


def compute_episode_sample_weights(df: pd.DataFrame) -> np.ndarray:
    """Per-window sample_weight that counters the window-count bias found in
    scripts/severity_gap_investigation.py (Q4): with a 4.0s window / 0.5s hop
    sliding scheme, a long FOG episode produces far more overlapping windows
    than a short one (e.g. ~33 windows for a 20s episode vs ~2 for a 4.7s
    one). Since training loss is computed per WINDOW, long episodes dominate
    the fog-class gradient roughly 8:1 regardless of model (confirmed there:
    severity-1 episodes are 23.4% of train-split episodes but only 8.3% of
    the actual FOG-labeled training windows; severity-3 is 35.9% of episodes
    but 64.5% of windows) - and severity turned out to be confounded with
    duration, so the real effect is "long episodes drown out short ones".

    Fix: every FOG-labeled window is weighted 1/(number of windows in its own
    episode), so each FOG EPISODE contributes total weight 1.0 to training no
    matter how many windows it was sliced into - instead of every WINDOW
    contributing 1.0, which is what currently favors long episodes. Non-FOG
    (walk/stop) windows keep weight 1.0 - their own class imbalance is
    already handled separately (RandomForestClassifier's class_weight=
    "balanced" / class_weights_from_labels for the CNN) - this is an
    additional, ORTHOGONAL axis (duration bias WITHIN the fog class), not a
    replacement for that class balancing.

    An "episode" here = a maximal run of consecutive `window_idx` within one
    (dataset, subject, block_id) group whose label_3class == LABEL_FOG - the
    natural definition at the WINDOW granularity this weight operates on
    (rows need not already be sorted by window_idx; this function sorts
    within each group before scanning for runs). This is deliberately a
    different, coarser notion of "episode" than
    severity_gap_investigation.py's raw-signal-level onset/offset episodes
    (built straight from the FoG-STAR CSV's timestamps) - that one remains
    the right definition for duration/severity ANALYSIS; this window-level
    one is the natural definition for a WEIGHT that multiplies per-window
    training loss, since adjacent overlapping windows (hop=0.5s within a
    4.0s window) are exactly the units this weight needs to down-weight.

    df must have columns: dataset, subject, block_id, window_idx,
    label_3class. Returns an array aligned to df's row order (positionally -
    df's own pandas Index labels are never relied upon).
    """
    n = len(df)
    weight = np.ones(n, dtype=np.float64)
    is_fog = df["label_3class"].to_numpy() == LABEL_FOG
    if not is_fog.any():
        return weight

    key = pd.DataFrame({
        "dataset": df["dataset"].to_numpy(),
        "subject": df["subject"].to_numpy(),
        "block_id": df["block_id"].to_numpy(),
        "window_idx": df["window_idx"].to_numpy(),
        "_pos": np.arange(n),
    })
    for _, g in key.groupby(["dataset", "subject", "block_id"], sort=False):
        g_sorted = g.sort_values("window_idx")
        pos = g_sorted["_pos"].to_numpy()
        fog_run_mask = is_fog[pos]
        for start, end in _contiguous_true_runs(fog_run_mask):
            episode_pos = pos[start:end]
            weight[episode_pos] = 1.0 / len(episode_pos)
    return weight
