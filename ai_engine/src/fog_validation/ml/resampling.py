"""Resample a multi-channel signal (and its integer label track) to TARGET_FS_HZ.

Only used for FoG-STAR (60 Hz -> 64 Hz). Daphnet is already 64 Hz exactly and
is passed through untouched (resampling a signal to its own rate would be a
no-op modulo floating point noise, so it's skipped rather than "resampled").
"""
from __future__ import annotations

from fractions import Fraction

import numpy as np
from scipy.signal import resample_poly


def resample_signal(signal: np.ndarray, fs_in: int, fs_out: int) -> np.ndarray:
    """signal: [T, C] float array. Returns [T', C] at fs_out."""
    if fs_in == fs_out:
        return signal
    frac = Fraction(fs_out, fs_in).limit_denominator(1000)
    return resample_poly(signal, frac.numerator, frac.denominator, axis=0)


def resample_labels_nearest(labels: np.ndarray, t_in: np.ndarray, fs_out: int) -> tuple[np.ndarray, np.ndarray]:
    """Nearest-neighbour resample for an INTEGER label/annotation track.

    Labels must never be linearly interpolated (a 0/1/2 code has no
    in-between meaning), so this maps each new timestamp to its nearest
    original sample instead of running it through resample_poly.
    Returns (new_labels, new_timestamps_s).
    """
    duration_s = t_in[-1] - t_in[0]
    n_out = int(round(duration_s * fs_out)) + 1
    t_out = t_in[0] + np.arange(n_out) / fs_out
    idx = np.searchsorted(t_in, t_out)
    idx = np.clip(idx, 0, len(t_in) - 1)
    left = np.clip(idx - 1, 0, len(t_in) - 1)
    use_left = np.abs(t_in[left] - t_out) < np.abs(t_in[idx] - t_out)
    idx = np.where(use_left, left, idx)
    return labels[idx], t_out
