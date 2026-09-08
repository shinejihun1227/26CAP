"""Hand-crafted features for the baseline model, computed from a window array [N, T, C].

Channel order is COMMON_CHANNELS = [vertical, horizontal_forward, horizontal_lateral].
FI is computed on the VERTICAL channel only, same band definition as
fog_validation.daphnet.freezing_index (3-8 Hz freeze band over 0.5-3 Hz
locomotor band, periodogram PSD) - kept consistent with the rest of this
project rather than reinvented here.

Windows are already per-subject z-scored (see build_dataset.py) by the time
they reach this module, so std/SMA here are computed on NORMALIZED units,
not physical g - they measure movement RELATIVE TO that subject's own
typical amplitude, which is the point of z-scoring in the first place.
"""
from __future__ import annotations

import numpy as np
from scipy.signal import periodogram

from fog_validation.ml.config import TARGET_FS_HZ

FREEZE_BAND = (3.0, 8.0)
LOCO_BAND = (0.5, 3.0)
DOMINANT_FREQ_BAND = (0.3, 5.0)
EPS = 1e-9

FEATURE_NAMES = [
    "FI", "std_vertical", "std_horiz_fwd", "std_horiz_lat", "SMA", "dominant_freq_hz",
]


def compute_features(X: np.ndarray, fs: int = TARGET_FS_HZ) -> np.ndarray:
    """X: [N, T, C] -> [N, len(FEATURE_NAMES)]."""
    vertical = X[:, :, 0]
    freqs, psd = periodogram(vertical, fs=fs, window="hann", detrend="constant", axis=1)
    fmask = (freqs >= FREEZE_BAND[0]) & (freqs < FREEZE_BAND[1])
    lmask = (freqs >= LOCO_BAND[0]) & (freqs < LOCO_BAND[1])
    dmask = (freqs >= DOMINANT_FREQ_BAND[0]) & (freqs < DOMINANT_FREQ_BAND[1])

    fp = psd[:, fmask].sum(axis=1)
    lp = psd[:, lmask].sum(axis=1)
    fi = fp / (lp + EPS)

    dom_freq = freqs[dmask][np.argmax(psd[:, dmask], axis=1)]

    std = X.std(axis=1)  # [N, 3]
    sma = np.abs(X).sum(axis=2).mean(axis=1)

    return np.stack([fi, std[:, 0], std[:, 1], std[:, 2], sma, dom_freq], axis=1)
