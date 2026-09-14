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

GYRO_PITCH_ROM_MIN (opt-in, bilateral-only, FoG-STAR-specific): a 7th feature
validated this session against a real, clinician-tagged, external PD-mobility
dataset finding (n=62 episodes, 7 subjects, Cohen's d=-1.01, 6/6 subjects
agree) - during a real freeze, the foot pressure sensors show as "stuck"
(attempting but failing to unweight) also shows a COLLAPSED gyro
peak-to-peak range-of-motion on its pitch axis, vs. real walking/turning.
This is a foot-specific ASYMMETRY signal (the non-stuck foot shows a much
weaker effect), computed from BOTH feet's pitch-gyro concurrently - which
Daphnet and HuGaDB cannot supply (no gyro at all / single-foot only), so it
is Daphnet/HuGaDB-INCOMPATIBLE by construction, unlike the 6 features above
(which every dataset can compute from its own 3 common accel channels).

Because this module's compute_features(X) only ever receives the 3 common
accel channels (X is [N,T,3] for every dataset pooled - see config.
COMMON_CHANNELS), the bilateral gyro ROM value cannot be derived from X
itself. It is instead precomputed PER ROW, once, straight from the raw
FoG-STAR CSV (see scripts/gyro_pitch_rom_investigation.py for the paired-
window reconstruction + per-subject walk-phase normalization, bit-exact-
validated against train/val/test.npz's own window order), and passed in here
via `extra_features` - exactly the same "extra opt-in array, unchanged
behavior when omitted" convention build_dataset.py already uses for
sample_weight and models_cnn.train_cnn uses for n_classes/sample_weight.
Rows with no both-foot-gyro coverage (Daphnet, HuGaDB, and the fraction of
FoG-STAR windows lost to non-simultaneous L/R dropout - see channel_map.py's
"BILATERAL upgrade" docstring for why L/R dropout is never bridged) carry a
NEUTRAL fallback value of 0.0 (the z-scored midpoint of "typical walking ROM,
not collapsed") in that array, computed upstream - this module does not
invent or gate that value itself, it only concatenates whatever is given.
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

# Name of the opt-in 7th feature (see module docstring) - appended to
# FEATURE_NAMES only by callers that actually pass extra_features, so
# existing FEATURE_NAMES-indexing code (motion_gate.py's
# STD_HORIZ_FWD_FEATURE_INDEX, poster_plot.py's len(FEATURE_NAMES)) is
# completely unaffected unless it explicitly opts in.
GYRO_PITCH_ROM_MIN = "gyro_pitch_rom_min"


def compute_features(X: np.ndarray, fs: int = TARGET_FS_HZ,
                     extra_features: np.ndarray | None = None) -> np.ndarray:
    """X: [N, T, C] -> [N, len(FEATURE_NAMES)], or [N, len(FEATURE_NAMES)+k]
    if extra_features ([N] or [N, k], e.g. gyro_pitch_rom_min) is given -
    concatenated as-is, with no gating/imputation logic here (that lives
    entirely upstream - see GYRO_PITCH_ROM_MIN's docstring above). Default
    None reproduces the exact original 6-column output, unchanged."""
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

    base = np.stack([fi, std[:, 0], std[:, 1], std[:, 2], sma, dom_freq], axis=1)
    if extra_features is None:
        return base
    extra = np.asarray(extra_features, dtype=base.dtype).reshape(len(X), -1)
    return np.concatenate([base, extra], axis=1)
