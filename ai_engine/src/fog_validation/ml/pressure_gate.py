"""Pressure-sensor (FSR) gates for the two-tier Warning/FoG-confirmed
actuation policy - mirrors motion_gate.py's role, but for the L_fsr/R_fsr
channels ble_codec.decode_sensor_packet() already decodes (8-channel-per-foot,
Newtons - see ble_codec.py, docs/own_data_schema.md's "FSR 배치" section)
that live_detector.py has never read until now.

STATUS - READ THIS FIRST: no physical pressure-sensor hardware exists for
this project yet (see firmware_esp32's pin/protocol headers for the planned
8-FSR-per-foot mux wiring this module is written against). Every number and
threshold below comes from a SEPARATE, EXTERNAL clinical dataset - real PD
patients performing a Timed-Up-and-Go (TUG) protocol on an instrumented
insole system, analyzed in this session's own scratchpad
(tug_pressure_analysis/step5_hypothesis_b.py and step8_sitstand_
pretransition_pressure.py / step8b_window_length_sensitivity.py) - NOT this
project's own FoG-STAR/Daphnet/HuGaDB/own-collected data, and NOT this
project's own insole/FSR layout, sampling rate, or subject population. This
module is therefore, honestly, an UNVALIDATED-ON-THIS-PROJECT'S-OWN-DATA
seam: it is unit-tested only against clearly-synthetic force arrays (see
tests/test_pressure_gate.py), never against a single real sample from this
project's own hardware, because that hardware does not exist. See
docs/own_data_schema.md's new pressure-gate section for the full disclosure,
matching this project's established convention for gates like motion_gate.
py's PROLONGED-UNNATURAL-STILLNESS section and standing_freeze_tremor_
augmentation.

Both signals below need a per-session "peak stance-force reference" -
conceptually the same role calibration.py's AxisCalibration plays for accel
axes (a short calibration recording establishes fixed reference stats, then
every later window is scored against them). NO such calibration protocol
step exists yet for pressure (the current "stand 5s, walk 15s, [turn 10s]"
protocol in docs/own_data_schema.md only ever collected accel/gyro). Rather
than inventing a fake auto-calibration here, every function/tracker below
takes its peak-force reference as a plain parameter, to be supplied by
whatever future calibration protocol extension establishes it.

  TODO (once real pressure-sensor hardware AND a real calibration-protocol
  extension exist): add a walking-phase FSR pass to run_calibration.py that
  derives peak_force_reference (per foot) and peak_combined_force_reference
  (L+R) the same way calibration.calibrate() derives vertical/forward axis
  stats from the accel walk phase, and confirm the exact percentile/window
  choices below still make sense against THIS project's own insole, not just
  the external TUG dataset they were derived from.

Two independent signals, matching the two independent false-alarm problems
this project has already documented software-only mitigations for
(motion_gate.py's CONFIRMED-tier gate for Sit/Stand-type postural motion, and
the general standing-freeze-vs-standing ambiguity):

SIGNAL 1 - "failed foot-lift" (PressureFootLiftTracker / had_genuine_
footlift): during real FoG episodes, a foot spends much LESS time genuinely
unweighted (force below 5% of that foot's peak stance force) than during
real Turn/Walk/TurnToSit locomotion - real gait's swing phase requires a true
near-zero unweight, ordinary postural sway or an in-place freeze attempt does
not. This is an ADDITIONAL, stricter AND-condition alongside motion_gate.
is_confirmed_grade_motion() before granting CONFIRMED - same structural
slot, never able to move a decision below WARNING (see live_detector.py).

SIGNAL 2 - pre-transition pressure baseline (PreTransitionPressureTracker /
pre_transition_force_frac): combined (L+R) foot force in the ~2 seconds
immediately before a Sit-to-Stand transition is dramatically lower than
before a real FoG onset (the person about to freeze already has full weight
on both feet; the person about to stand up has just been sitting, offloaded).
Used at the specific moment an Active decision's ONSET would otherwise fire
(see live_detector.py for why only the onset window, not every window of an
ongoing Active streak, is checked) to catch the specific "model mistook a
Sit-to-Stand transition for a freeze" false-alarm case.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from fog_validation.ml.config import TARGET_FS_HZ
from fog_validation.ml.realtime import RealtimeWindower

# =============================================================================
# SIGNAL 1 - failed foot-lift (CONFIRMED-tier third gate)
# =============================================================================
#
# SOURCE - external clinical TUG dataset (7 real PD patients, NLS-coded
# subject IDs), this session's scratchpad tug_pressure_analysis/
# step5_hypothesis_b.py, saved output hypB_output.txt / hypB_pairs.csv. NOT
# this project's own data - see this module's top docstring.
#
# METHODOLOGY: for each of 62 real, clinician-tagged FoG episodes, and a set
# of duration-matched real Turn/Walk/TurnToSit baseline windows from the same
# (same-subject where available, else cross-subject) recording, per-foot
# "fraction of time this foot's TotalForce was below 5% of that foot's own
# peak stance force" was computed. Peak stance force = that foot's 90th
# percentile TotalForce over clean (unlabeled), real Walk/Turn rows for that
# subject (step5_hypothesis_b.py's `peak_force`) - i.e. NOT the foot's
# all-time max (too noise-sensitive), a robust "typical full stance" value.
#
# RESULT (n=38 same-subject episode/baseline pairs, 6 subjects - the study's
# headline "best-of-both-feet" metric): FoG windows spent mean 16.67%
# (median 14.28%) of their time genuinely unweighted, vs mean 31.67% (median
# 32.07%) for matched real Turn/Walk/TurnToSit windows - Cohen's d=-1.069,
# Wilcoxon p=3.67e-07, subject-level Wilcoxon (n=6 subjects, all 6/6 in the
# same direction) p=0.03125.
#
# WHY THIS MODULE USES THE PER-FOOT METRIC, NOT "BEST-OF-BOTH-FEET": the
# source study's headline number combines both feet (whichever foot achieved
# the cleaner unweight "wins"), but live_detector.LiveFogDetector is
# architected per-foot (one instance per foot, reading only that foot's own
# channels - see its class docstring) with no cross-foot state today. The
# SAME study also reports each foot's metric held up independently when
# split out (L foot frac-time-near-zero: FoG mean 7.47% vs baseline mean
# 20.63%, Cohen's d=-1.436; R foot: FoG mean 12.84% vs baseline mean 24.87%,
# Cohen's d=-0.840 - both still large effects, both still significant at
# subject level, p=0.03125 for both) - so using one foot's own signal alone,
# rather than restructuring live_detector.py to see both feet, is a real,
# still-validated (on the external dataset) simplification, not a shortcut
# that throws the finding away.

NEAR_ZERO_FORCE_FRAC_OF_PEAK = 0.05
"""A single force SAMPLE counts as "genuinely unweighted" if it is below this
fraction of peak_force_reference. Inherited verbatim from the source study's
own definition (step5_hypothesis_b.py: `frac_near_zero = (x_i < 0.05 *
pkval).mean()`) - not independently re-derived, since changing it would break
comparability with the validated numbers above. NOTE: this is a fraction of
FORCE magnitude, unlike FOOTLIFT_TIME_FRAC_THRESHOLD below, which is a
fraction of WINDOW TIME - the two constants both happening to be tunable
percentages is coincidental, they are not the same kind of quantity."""

FOOTLIFT_TIME_FRAC_THRESHOLD = 0.10
"""had_genuine_footlift()'s bar on the WINDOW-level "fraction of time this
window's samples were near-zero" value: True (genuine footlift occurred, real
gait is plausible) if that fraction is >= this threshold.

Chosen via a direct sweep of hypB_pairs.csv's per-foot, per-episode fields
(pooling L+R foot columns, n=76 each; NOT part of the original step5 script,
computed for this module) at candidate thresholds 0.05/0.08/0.10/0.12:

    threshold | freeze-context per-foot episodes correctly read as         | real active-context (Turn/Walk/
              | "no genuine footlift" (fraction below threshold)           | TurnToSit) per-foot episodes
              |                                                            | WRONGLY flagged (below threshold)
    ----------|------------------------------------------------------------|----------------------------------
    0.05      | 33/76 (43.4%)                                              | 3/76 (3.9%)
    0.08      | 43/76 (56.6%)                                              | 6/76 (7.9%)
    0.10      | 46/76 (60.5%)                                              | 7/76 (9.2%)
    0.12      | 51/76 (67.1%)                                              | 8/76 (10.5%)

0.10 was chosen: its 9.2% cost to real active-context windows sits inside
this project's own established "acceptable WARNING-tier-only cost" band
(roughly 5-15%, the same band motion_gate.py's STILLNESS_ESCALATION_SEC
retune explicitly adopted - see that module's docstring), while catching a
majority (60.5%) of the matched freeze-context episodes. Like motion_gate.
is_confirmed_grade_motion, this check can ONLY ever demote an already-Active,
already-is_confirmed_grade_motion-passing decision from CONFIRMED to
WARNING, never below WARNING - so this cost is a "quieter alert," never a
missed one, which is why a real (not zero) cost is acceptable here the same
way it was for that gate. A more conservative choice is one sweep-table edit
away (PRESSURE_UNAVAILABLE-safe callers just pass a different `threshold=`).

CAVEAT stated plainly: this sweep is episode-level (one value per whole
episode/baseline-window from the external study), not this project's own
4-second/0.5s-hop window-level resolution - a real ROC/Youden's-J sweep at
THIS project's own window cadence, on THIS project's own hardware, has never
been done and cannot be until real pressure hardware exists.
"""


def frac_time_near_zero(force_window: np.ndarray, peak_force_reference: float | None,
                        near_zero_frac_of_peak: float = NEAR_ZERO_FORCE_FRAC_OF_PEAK) -> float | None:
    """force_window: [T] one foot's total force samples (sum of that foot's
    FSR channels, Newtons) over one completed window - same window length/
    hop as the main accel RealtimeWindower (see PressureFootLiftTracker).
    peak_force_reference: that foot's calibrated peak stance force (Newtons,
    see this module's top docstring for why this must come from a future
    calibration step, not invented here).

    Returns None (PRESSURE UNAVAILABLE, distinct from a real 0.0 reading) if
    peak_force_reference is None or non-positive - i.e. no calibration
    reference has ever been supplied. Never raises, never guesses a default,
    per this module's "tell unavailable apart from says-no" requirement."""
    if peak_force_reference is None or peak_force_reference <= 0:
        return None
    threshold_force = near_zero_frac_of_peak * peak_force_reference
    return float(np.mean(np.asarray(force_window) < threshold_force))


def had_genuine_footlift(force_window: np.ndarray, peak_force_reference: float | None,
                         threshold: float = FOOTLIFT_TIME_FRAC_THRESHOLD) -> bool | None:
    """True if `force_window` (one foot) shows a real, near-zero-force swing
    phase for at least `threshold` fraction of the window - the signature of
    genuine ongoing locomotion (see this module's SIGNAL 1 section). False if
    the foot never meaningfully unweighted - consistent with either a freeze
    attempt (real gait's swing phase failed to happen) or ordinary postural
    sway (never attempted at all); this check alone cannot tell those two
    apart, which is why it is wired as an ADDITIONAL condition alongside
    motion_gate.is_confirmed_grade_motion(), never a replacement for it (see
    live_detector.py).

    Returns None (PRESSURE UNAVAILABLE) if frac_time_near_zero() itself
    returns None (no peak_force_reference supplied) - callers must treat
    None as "cannot evaluate this check," never as False."""
    frac = frac_time_near_zero(force_window, peak_force_reference)
    if frac is None:
        return None
    return frac >= threshold


@dataclass
class PressureFootLiftTracker:
    """Buffers ONE foot's total-force stream into the SAME fixed-size,
    fixed-hop windows the main accel RealtimeWindower already produces (same
    WINDOW_SEC/HOP_SEC/TARGET_FS_HZ defaults - see realtime.py), so a
    completed force window lines up in time with the completed accel window
    live_detector.py scores every hop. Thin wrapper around
    RealtimeWindower(n_channels=1), reusing that class's buffering/hop logic
    rather than reimplementing it (same reuse pattern live_detector.py's own
    yaw_windower already uses).

    push() must be called AT MOST once per incoming packet, and ONLY when
    that packet actually carries this foot's FSR data - see live_detector.py
    for why calling it on a packet with no pressure data would desync this
    tracker's internal sample count from the main windower's (both must
    advance in lockstep for their windows to describe the same time span)."""
    windower: RealtimeWindower = field(default_factory=lambda: RealtimeWindower(n_channels=1))

    def push(self, total_force_n: float) -> np.ndarray | None:
        """total_force_n: this foot's total force this sample (sum of its
        FSR channels, Newtons). Returns the completed [WINDOW_SAMPLES] force
        window once one is ready (same cadence as RealtimeWindower.push),
        else None - pass the result straight to had_genuine_footlift()
        (that function's own force_window argument expects this shape;
        squeeze not required, RealtimeWindower already returns [T, 1], so
        callers should index [:, 0])."""
        return self.windower.push(np.array([total_force_n], dtype=np.float32))

    def reset(self) -> None:
        self.windower.reset()


# =============================================================================
# SIGNAL 2 - pre-transition pressure baseline (Sit-to-Stand false-alarm)
# =============================================================================
#
# SOURCE - same external TUG dataset as Signal 1, this session's scratchpad
# tug_pressure_analysis/step8_sitstand_pretransition_pressure.py (3.0s window,
# original) and step8b_window_length_sensitivity.py (window-length
# sensitivity sweep that motivated switching to 2.0s - see PRE_TRANSITION_
# WINDOW_SEC below). NOT this project's own data - see top docstring.
#
# METHODOLOGY: for 44 real SitToStand bouts (17 subjects) and 61-62 real FoG
# episodes (7 subjects), the median COMBINED (L+R) TotalForce over the last
# <=N seconds of whatever activity immediately, contiguously precedes the
# transition/onset (Sitting, for SitToStand; whatever clean activity
# preceded it, for FoG) was computed, expressed as a fraction of that
# subject's peak COMBINED stance force (95th percentile of L+R TotalForce
# over clean Walk/Turn/Standing rows - note this is a DIFFERENT reference
# statistic from Signal 1's per-foot 90th percentile over Walk/Turn only;
# do not reuse Signal 1's peak_force_reference for this signal).
#
# RESULT at the chosen 2.0s window (step8b_output.txt): STS-pre median
# fraction-of-peak = 4.17%, FoG-pre median = 73.21% - subject-level (n=7
# subjects, ALL 7/7 in the same direction) paired Cohen's d=8.08 (Wilcoxon
# p=0.01562). At a practical decision threshold set from the STS-pre
# population's own 90th percentile (0.1191 at this window length), 0 of 61
# evaluable real pre-FoG windows fell at/below it (the 62nd of the original
# 62 clinician-tagged episodes lacked a full 2.0s of contiguous preceding
# clean-activity data and was excluded from evaluation entirely, not
# misclassified).

PRE_TRANSITION_WINDOW_SEC = 2.0
"""Length of the rolling pre-transition buffer. NOT the study's original
choice - the original analysis (step8_sitstand_pretransition_pressure.py)
used 3.0s and found exactly ONE real pre-FoG window (of 61) that fell into
the "looks like a Sit-to-Stand" range: NLS141's row 5002 case, a genuine fast
stand-up-directly-into-a-gait-initiation-freeze (Sitting until t=48.15s,
SitToStand tag ending t=50.00s, FoG starting immediately at t=50.02s with NO
free-walking step in between) - the 3.0s look-back window reached far enough
back to still catch the low-force Sitting tail, dragging that one episode's
median down to 5.7% of peak (below the STS-pre 90th-percentile threshold of
12.53% at 3.0s). step8b_window_length_sensitivity.py swept 3.0/2.0/1.0/0.5s
and found the SAME false-negative case resolves at every SHORTER window
(2.0s: that episode's value jumps to 57.8% of peak, clear of the STS range)
while the FoG-vs-STS separation itself stays just as strong at every length
(Cohen's d 7.92-8.51 across all four, essentially flat) - i.e. shortening the
window was a pure win here, not a trade-off, because the underlying
mechanism (full weight already on the feet in a real pre-freeze moment) is
present at 2.0s just as strongly as at 3.0s; only the FAILURE MODE (a window
long enough to still be looking back at genuine sitting) is length-sensitive.
2.0s, not 1.0s or 0.5s, was picked as the smallest window with a FULL
independent sweep point still validating 0/61 (rather than picking the most
aggressive value tried, matching this project's general preference - see
motion_gate.py's threshold-choice notes - for the least-aggressive value in
a flat region of a sweep, not the most aggressive that still happened to pass)."""

PRE_TRANSITION_LOW_FORCE_FRAC_THRESHOLD = 0.12
"""pre_transition_force_frac() bar for is_pre_transition_low_force(): below
this fraction of peak_combined_force_reference reads as "this looks like a
Sit-to-Stand transition, not a real pre-freeze moment." Rounded up slightly
from the empirical STS-pre 90th-percentile value at the 2.0s window
(0.1191, step8b_output.txt) for a small safety margin. At this operating
point: 0/61 evaluable real pre-FoG windows misclassified (see this section's
RESULT note above) - the practical false-negative number this project's task
record cites. CAVEAT stated plainly, same as Signal 1: n=61 pre-FoG windows
across only 7 subjects from an EXTERNAL dataset with a different insole
system - a clean 0/61 on a small external sample is a strong result, not a
guarantee it stays 0 on this project's own hardware/population."""


@dataclass
class PreTransitionPressureTracker:
    """Rolling (NOT hop-gated, unlike PressureFootLiftTracker/RealtimeWindower)
    circular buffer of the last PRE_TRANSITION_WINDOW_SEC seconds of COMBINED
    (L+R) total force, in samples. Deliberately a plain rolling buffer, not a
    fixed-hop windower: this signal must be readable at the exact instant an
    Active decision's onset fires (see live_detector.py), not only once every
    HOP_SEC - by the time the next hop's window completed, the "last ~2s"
    would already have moved past the moment we need to ask about.

    push() should be called once per incoming packet whenever BOTH feet's FSR
    data are present (this signal needs L+R combined, unlike
    PressureFootLiftTracker which only ever needs its own foot) - see
    live_detector.py."""
    window_sec: float = PRE_TRANSITION_WINDOW_SEC
    fs: int = TARGET_FS_HZ
    _buf: np.ndarray = field(default=None, repr=False)
    _write_idx: int = 0
    _filled: int = 0

    def __post_init__(self):
        self._n_samples = max(1, int(round(self.window_sec * self.fs)))
        self._buf = np.zeros(self._n_samples, dtype=np.float32)

    def push(self, combined_force_n: float) -> None:
        """combined_force_n: L foot total force + R foot total force this
        sample (Newtons)."""
        self._buf[self._write_idx] = combined_force_n
        self._write_idx = (self._write_idx + 1) % self._n_samples
        self._filled = min(self._filled + 1, self._n_samples)

    def pre_transition_force_frac(self, peak_combined_force_reference: float | None) -> float | None:
        """Median of the buffered ~PRE_TRANSITION_WINDOW_SEC seconds of
        combined force, as a fraction of peak_combined_force_reference (this
        subject's peak COMBINED L+R stance force - see this section's
        METHODOLOGY note; NOT the same reference as Signal 1's per-foot
        peak_force_reference). Median, not mean, matching the source study's
        own methodology exactly (step8_sitstand_pretransition_pressure.py's
        `combined.median()`).

        Returns None (PRESSURE UNAVAILABLE) if peak_combined_force_reference
        is None/non-positive, OR if the buffer has not yet been filled with a
        full PRE_TRANSITION_WINDOW_SEC of real samples (early in a session,
        before enough packets have arrived - returning a median over a
        partially-real, partially-zero-initialized buffer would silently
        UNDER-report force, biasing toward false "looks like Sit-to-Stand"
        readings right after startup; refusing to answer instead is the
        conservative direction, matching this module's "never guess a
        default" principle)."""
        if peak_combined_force_reference is None or peak_combined_force_reference <= 0:
            return None
        if self._filled < self._n_samples:
            return None
        return float(np.median(self._buf)) / peak_combined_force_reference

    def reset(self) -> None:
        self._buf[:] = 0
        self._write_idx = 0
        self._filled = 0


def is_pre_transition_low_force(frac: float | None,
                                threshold: float = PRE_TRANSITION_LOW_FORCE_FRAC_THRESHOLD) -> bool | None:
    """True if `frac` (from PreTransitionPressureTracker.pre_transition_
    force_frac()) reads low enough to match the validated Sit-to-Stand
    pre-transition pattern (see PRE_TRANSITION_LOW_FORCE_FRAC_THRESHOLD).
    Returns None (PRESSURE UNAVAILABLE) unchanged if `frac` is None - never
    coerces "unavailable" into either True or False."""
    if frac is None:
        return None
    return frac < threshold
