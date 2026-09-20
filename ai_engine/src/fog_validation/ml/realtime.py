"""Real-time (streaming) inference building blocks - the PC-relay side of the
ESP32-shoe -> BLE/WiFi -> laptop -> DRV2605 trigger pipeline.

CRITICAL DIFFERENCE FROM THE OFFLINE PIPELINE: build_dataset.py z-scores each
window using that SUBJECT'S FULL SESSION mean/std - a batch statistic that
needs the whole recording, past AND future, to compute. A live system does
not have its own future data. The only honest live equivalent is a
CALIBRATION PASS: lock in mean/std from a short window at startup (e.g. 20 s
of normal walking) and reuse those FIXED stats for the rest of the session.
This module implements exactly that, plus the sliding-window buffer needed
to turn a live sample stream into the same [WINDOW_SAMPLES, N_CHANNELS]
windows the trained models expect.

Nothing here is specific to any particular sensor transport (BLE/WiFi/
serial) - feed it samples one at a time (or in small chunks) from whatever
receives the ESP32's stream, and it does not care where they came from.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from fog_validation.ml.config import HOP_SAMPLES, N_CHANNELS, WINDOW_SAMPLES


@dataclass
class CalibrationStats:
    """Per-channel mean/std, locked in from a calibration recording. Frozen
    for the rest of the session - never updated from live data, so it can
    never leak future information into a window's normalization the way the
    offline batch z-score would."""
    mean: np.ndarray   # [N_CHANNELS]
    std: np.ndarray    # [N_CHANNELS]

    @classmethod
    def from_calibration_signal(cls, signal: np.ndarray) -> "CalibrationStats":
        """signal: [T_cal, N_CHANNELS], e.g. ~20s of normal walking at
        TARGET_FS_HZ collected right after the device is put on."""
        mean = signal.mean(axis=0)
        std = signal.std(axis=0)
        std = np.where(std < 1e-8, 1.0, std)
        return cls(mean=mean, std=std)

    def normalize(self, window: np.ndarray) -> np.ndarray:
        return (window - self.mean) / self.std


@dataclass
class RealtimeWindower:
    """Turns a stream of individual samples into fixed-size, fixed-hop
    windows, exactly like build_windows() does offline but sample-by-sample
    instead of over an already-fully-recorded array.

    Call push(sample) once per incoming sample ([N_CHANNELS] array). It
    returns a [WINDOW_SAMPLES, N_CHANNELS] window once enough NEW samples
    have arrived since the last window (i.e. every HOP_SAMPLES), else None.
    """
    window_samples: int = WINDOW_SAMPLES
    hop_samples: int = HOP_SAMPLES
    n_channels: int = N_CHANNELS
    _buf: np.ndarray = field(default=None, repr=False)
    _count_since_last: int = 0
    _total_pushed: int = 0

    def __post_init__(self):
        self._buf = np.zeros((self.window_samples, self.n_channels), dtype=np.float32)

    def push(self, sample: np.ndarray) -> np.ndarray | None:
        self._buf = np.roll(self._buf, -1, axis=0)
        self._buf[-1] = sample
        self._total_pushed += 1
        self._count_since_last += 1

        if self._total_pushed < self.window_samples:
            return None  # buffer not full yet - no window possible
        if self._count_since_last < self.hop_samples:
            return None  # not yet time for the next hop

        self._count_since_last = 0
        return self._buf.copy()

    def reset(self):
        self._buf[:] = 0
        self._count_since_last = 0
        self._total_pushed = 0
