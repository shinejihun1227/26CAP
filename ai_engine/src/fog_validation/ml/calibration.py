"""Axis identification + normalization stats from a short on-device
calibration recording - the "put the shoe on, stand still 5s, walk normally
15s" protocol mentioned throughout this project.

Same empirical methods used (by hand, ad hoc) for FoG-STAR and HuGaDB this
session, packaged so a brand-new device with UNKNOWN, unlabeled raw axes
(raw_acc_0/1/2, not yet "vertical/forward/lateral") can be calibrated
automatically the first time it's ever worn, with no manual axis inspection:

  vertical: the accel axis with the largest |mean| during the STILL phase
            (gravity). Sign is flipped if needed so vertical reads NEGATIVE
            at rest, matching the convention already used for Daphnet/
            FoG-STAR/HuGaDB (mean ~ -1g).
  forward:  of the remaining 2 axes, the one with more power in the 0.5-3 Hz
            walking band during the WALK phase (a shank/foot's dominant
            walking-band energy sits on the sagittal/forward axis, confirmed
            repeatedly this session).
  lateral:  whichever axis is left.
  gyro pitch (if gyro channels are supplied): same walking-band-power logic,
            applied to the 3 gyro axes independently of the accel result.
  gyro yaw  (if gyro channels are supplied AND a turn phase is recorded):
            of the 2 non-pitch gyro axes, the one whose walk-band power
            grows MORE (as a ratio) from the WALK phase to the TURN phase -
            "the axis that gets relatively more active when the wearer
            turns" (matches the yaw-gate finding: turning-in-place raises
            yaw energy much more than it raises roll/wobble energy).

CONFIDENCE CAVEAT - gyro yaw is meaningfully less reliable than the other
three: on a real per-recording check (74 FoG-STAR subject/session/task
blocks, each with real walk AND turn phases), the higher-ratio axis matched
the confirmed yaw channel in only 66.2% of individual blocks (vs 100% for
pitch-vs-others). The AGGREGATE direction is real (median ratio 2.71 vs 1.84
across blocks) but a SINGLE short calibration recording's turn phase is a
noisy one-block sample from that same distribution - expect gyro_yaw_idx to
sometimes be wrong on a real device, not just low-confidence. Treat a
successful identification as "probably right, and the confidence score says
how sure," never as "certain" the way vertical/forward/pitch are. A longer
turn phase (recommended: several full rotations each direction, not one
quick spin) should reduce this noise by averaging over more turn-band power,
but this has not been verified.

A `confidence` value (the gap between the winning and runner-up axis, as a
fraction of the winner) is returned for every decision so a low-confidence
mount (e.g. a near-vertical dorsum placement with ambiguous forward/lateral
split, as seen with HuGaDB this session) is visible rather than silently
trusted.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.signal import welch

WALK_BAND_HZ = (0.5, 3.0)


@dataclass
class AxisCalibration:
    vertical_idx: int
    vertical_sign: float
    forward_idx: int
    lateral_idx: int
    vertical_confidence: float
    forward_confidence: float
    gyro_pitch_idx: int | None
    gyro_pitch_confidence: float | None
    mean: np.ndarray    # [3] - locked-in z-score mean, from the WALK phase, in the
                        # [vertical, forward, lateral] order this calibration decided on
    std: np.ndarray     # [3] - locked-in z-score std, same order
    gyro_yaw_idx: int | None = None
    gyro_yaw_confidence: float | None = None

    def remap(self, raw_signal: np.ndarray) -> np.ndarray:
        """raw_signal: [T, 3] in the ORIGINAL raw axis order used for
        calibration -> [T, 3] in [vertical, forward, lateral] order, sign-corrected."""
        v = raw_signal[:, self.vertical_idx] * self.vertical_sign
        remaining = [i for i in range(3) if i != self.vertical_idx]
        f = raw_signal[:, self.forward_idx]
        l_idx = [i for i in remaining if i != self.forward_idx][0]
        l = raw_signal[:, l_idx]
        return np.stack([v, f, l], axis=1)

    def normalize(self, remapped_signal: np.ndarray) -> np.ndarray:
        return (remapped_signal - self.mean) / self.std

    def extract_gyro_yaw(self, raw_gyro: np.ndarray) -> np.ndarray:
        """raw_gyro: [T, 3] in the ORIGINAL raw axis order -> [T] raw
        (un-normalized) yaw angular velocity. Raises if this calibration
        never identified a yaw axis (no turn phase was recorded)."""
        if self.gyro_yaw_idx is None:
            raise ValueError("this calibration has no gyro_yaw_idx - it was run without a "
                             "turn phase (walk_end_s), see calibrate()'s docstring")
        return raw_gyro[:, self.gyro_yaw_idx]


def _walk_band_power(x: np.ndarray, fs: float) -> float:
    """ABSOLUTE power in the walking band - deliberately NOT normalized by
    the signal's own total power. During walking, forward AND lateral axes
    both oscillate mostly within 0.5-3 Hz, so their power FRACTION is nearly
    identical regardless of amplitude (confirmed: an earlier fraction-based
    version gave forward vs lateral confidence of ~0.03 on a synthetic
    signal built with a 5x true amplitude gap - useless). Absolute power
    preserves the amplitude difference this project has repeatedly found
    between the two (FoG-STAR: std 0.462 vs 0.213; HuGaDB: 0.705 vs 0.614),
    which IS the discriminating signal.
    """
    f, p = welch(x, fs=fs, nperseg=min(256, len(x)))
    band = (f >= WALK_BAND_HZ[0]) & (f < WALK_BAND_HZ[1])
    return float(p[band].sum())


def calibrate(raw_accel: np.ndarray, fs: float, still_end_s: float,
             raw_gyro: np.ndarray | None = None,
             walk_end_s: float | None = None) -> AxisCalibration:
    """raw_accel: [T, 3], raw axis order unknown. Samples [0, still_end_s)
    are the STILL phase, [still_end_s, walk_end_s) is the WALK phase
    (straight-line normal walking), and - only if walk_end_s is given -
    [walk_end_s, end) is a TURN phase (turning in place, several full
    rotations). raw_gyro, if given, same shape/timing.

    walk_end_s=None (default): everything after still_end_s is treated as
    WALK for both accel axis ID and gyro pitch ID - the original 2-phase
    protocol, unchanged. gyro_yaw_idx stays None (no turn phase to identify
    it from) - Daphnet-style devices with no gyro, and any capture that
    skipped the turn phase, simply don't get a yaw axis.

    walk_end_s=<value>: enables gyro yaw identification from the turn
    phase. See this module's docstring for the CONFIDENCE CAVEAT - this one
    identification is noticeably less reliable than the other three.
    """
    n_still = int(still_end_s * fs)
    n_walk_end = int(walk_end_s * fs) if walk_end_s is not None else None
    still = raw_accel[:n_still]
    walk = raw_accel[n_still:n_walk_end]
    if len(walk) < fs * 2:
        raise ValueError(f"walk phase too short ({len(walk)/fs:.1f}s) - need >= 2s after still_end_s")
    if n_walk_end is not None and len(raw_accel) - n_walk_end < fs * 2:
        raise ValueError(f"turn phase too short ({(len(raw_accel)-n_walk_end)/fs:.1f}s) - "
                         f"need >= 2s after walk_end_s")

    # ---- vertical: largest |mean| during STILL ----
    means = still.mean(axis=0)
    order = np.argsort(-np.abs(means))
    vertical_idx = int(order[0])
    vertical_sign = -1.0 if means[vertical_idx] > 0 else 1.0
    vertical_conf = float(1 - np.abs(means[order[1]]) / np.abs(means[vertical_idx])) \
        if means[vertical_idx] != 0 else 0.0

    # ---- forward: of the other 2, larger walk-band power during WALK ----
    remaining = [i for i in range(3) if i != vertical_idx]
    fracs = {i: _walk_band_power(walk[:, i], fs) for i in remaining}
    forward_idx = max(fracs, key=fracs.get)
    lateral_idx = [i for i in remaining if i != forward_idx][0]
    f_vals = sorted(fracs.values(), reverse=True)
    forward_conf = float(1 - f_vals[1] / f_vals[0]) if f_vals[0] > 0 else 0.0

    gyro_pitch_idx, gyro_pitch_conf = None, None
    if raw_gyro is not None:
        # pitch uses everything after still (walk + turn phase, if any) -
        # pitch is so dominant (100% agreement in the empirical check, see
        # module docstring) that mixing in turn-phase data doesn't hurt it.
        gwalk = raw_gyro[n_still:]
        gfracs = {i: _walk_band_power(gwalk[:, i], fs) for i in range(3)}
        gyro_pitch_idx = max(gfracs, key=gfracs.get)
        g_vals = sorted(gfracs.values(), reverse=True)
        gyro_pitch_conf = float(1 - g_vals[1] / g_vals[0]) if g_vals[0] > 0 else 0.0

    gyro_yaw_idx, gyro_yaw_conf = None, None
    if raw_gyro is not None and n_walk_end is not None and gyro_pitch_idx is not None:
        # yaw: of the 2 non-pitch gyro axes, whichever axis's walk-band
        # power grows MORE (as a ratio) from WALK to TURN. See module
        # docstring's CONFIDENCE CAVEAT - this is the least reliable of the
        # 4 identifications this function makes.
        g_walk_phase = raw_gyro[n_still:n_walk_end]
        g_turn_phase = raw_gyro[n_walk_end:]
        non_pitch = [i for i in range(3) if i != gyro_pitch_idx]
        ratios = {}
        for i in non_pitch:
            walk_p = _walk_band_power(g_walk_phase[:, i], fs)
            turn_p = _walk_band_power(g_turn_phase[:, i], fs)
            ratios[i] = turn_p / walk_p if walk_p > 0 else 0.0
        gyro_yaw_idx = max(ratios, key=ratios.get)
        r_vals = sorted(ratios.values(), reverse=True)
        gyro_yaw_conf = float(1 - r_vals[1] / r_vals[0]) if r_vals[0] > 0 else 0.0

    cal = AxisCalibration(
        vertical_idx=vertical_idx, vertical_sign=vertical_sign,
        forward_idx=forward_idx, lateral_idx=lateral_idx,
        vertical_confidence=round(vertical_conf, 3), forward_confidence=round(forward_conf, 3),
        gyro_pitch_idx=gyro_pitch_idx,
        gyro_pitch_confidence=round(gyro_pitch_conf, 3) if gyro_pitch_conf is not None else None,
        mean=np.zeros(3), std=np.ones(3),
        gyro_yaw_idx=gyro_yaw_idx,
        gyro_yaw_confidence=round(gyro_yaw_conf, 3) if gyro_yaw_conf is not None else None,
    )
    remapped_walk = cal.remap(walk)
    cal.mean = remapped_walk.mean(axis=0)
    cal.std = np.where(remapped_walk.std(axis=0) < 1e-8, 1.0, remapped_walk.std(axis=0))
    return cal
