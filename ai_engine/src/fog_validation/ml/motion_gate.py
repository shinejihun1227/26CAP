"""Causal "is this window an active-walking context, or a low-motion one?"
gate - the signal behind the two-tier Warning/FoG-confirmed actuation policy.

WHY THIS EXISTS: this project's hardest confusable pair is "voluntary
standing still" vs "frozen while standing" - both are upright, weight-
bearing, non-translating, so this session's own investigations (see
data/processed/ml/standing_freeze_fi_summary.json,
standing_freeze_full_census_summary.json) found no accel/gyro feature that
cleanly tells them apart, and every software-only fix tried this session
(episode weighting, bilateral combination, a standing-freeze tremor
signature, a pre-onset kinematics gate) failed to deploy without a net
sensitivity loss. A peer-reviewed LSTM + real plantar-pressure study on real
PD patients (Jour. NeuroEngineering & Rehab) hit the SAME wall - 65.3% FPR
during standing vs 3.72% walking, 7.09% turning - and fixed it not by
classifying better but by gating actuation CONFIDENCE with an activity-
recognition signal during low-motion periods, rather than trying to make the
freeze/no-freeze classifier itself smarter. This module is that gate for
this project: it does not touch the model or its threshold at all, it only
answers "was the wearer in an active-locomotion context just now" so
live_detector.py can decide how strongly to act on the model's own decision.

SIGNAL CHOICE - std_horiz_fwd (features.py's FEATURE_NAMES[2]), reused
verbatim via compute_features(), not reinvented: forward-axis accel std over
the window. Chosen empirically on FoG-STAR VAL split only (never test) over
3 candidates (std_horiz_fwd, std_vertical, 0.5-3Hz locomotor-band power) -
all three separate real Walk from real Stop windows well (AUC 0.96-0.97),
std_horiz_fwd was picked for being simplest (already returned by
compute_features, no new spectral code) while being within 0.01 AUC of the
best (loco-band power, 0.9735) - see scripts/motion_energy_gate_
investigation.py for the full comparison and data/processed/ml/
motion_energy_gate_summary.json for the numbers.

WHY NO SECOND PARALLEL WINDOWER (unlike the yaw gate): tried and rejected,
not just skipped. A longer parallel window (6-12s, same pattern
live_detector.py's yaw_windower already uses for gyro) was tested
empirically and made things WORSE, not better: a genuine FREEZE necessarily
LOOKS like near-zero forward energy AT THE INSTANT it happens regardless of
whether the freeze occurred during a walking bout or while standing still -
that is definitionally what a freeze is. A longer trailing window smooths
right over that instant with whatever real walking energy came just before
it, which does help preserve the CONFIRMED tier for walking-context freezes,
but it does so by ALSO smoothing over genuine voluntary stops that happen
shortly after walking (the common case in this protocol - most stops here
ARE walk-then-stand transitions), which erases most of the annoyance-
reduction this gate exists for (measured: 8s context window drops
stop_spec from ~0.47 to ~0.41 at matched walking-context-freeze
preservation - worse on BOTH axes, not a real trade). The plain SAME window
already computed for the main model, at a conservative (low) threshold,
dominated every longer-window variant tried - see the investigation script.
Reusing that existing window is also simply less code than a second
buffered windower would be.

THRESHOLD CHOICE - deliberately NOT the walk-vs-stop Youden's-J-optimal
value (0.69 on val): that threshold trades away too much of what this
project cannot afford to lose. At 0.69, only 56.6% of val's walking/turning-
context freeze windows (498 of 500 val FoG windows have that context) would
still get the full CONFIRMED tier - a real regression during exactly the
"active walking/turning: keep the existing response UNCHANGED" case this
gate must never touch. MOTION_ENERGY_THRESHOLD is set low (0.20) instead,
chosen so that on val: (a) sensitivity for real Walk windows is 100.00%
(1996/1996) - zero true active-walking windows are ever capped, the hard
requirement, (b) 96.2% of walking/turning-context freeze windows still get
CONFIRMED (only 3.8% cost, the real price of this policy), while still (c)
capping 47.4% of real voluntary-Stop windows to the gentler tier (the
annoyance-reduction win). This is a genuinely conservative choice: it
protects real detection much more than it maximizes annoyance reduction,
on purpose (see this project's decision record for why - annoyance is
merely inconvenient, missing a real freeze during active gait is not).
Margin check: the single lowest std_horiz_fwd value among all 1996 real
Walk windows in val was 0.2277 (subject fogstar_20) - only ~14% above this
threshold, so this is real headroom, not a coincidence, but not a huge one
either; re-validate if a materially different subject population, sensor
placement, or gait speed distribution is ever deployed.
"""
from __future__ import annotations

import numpy as np

from fog_validation.ml.config import TARGET_FS_HZ
from fog_validation.ml.features import FEATURE_NAMES, compute_features

STD_HORIZ_FWD_FEATURE_INDEX = FEATURE_NAMES.index("std_horiz_fwd")

# Picked on FoG-STAR VAL split only (never test) - see this module's
# docstring for why this number, and scripts/motion_energy_gate_
# investigation.py / data/processed/ml/motion_energy_gate_summary.json for
# the full sweep this was chosen from.
MOTION_ENERGY_THRESHOLD = 0.20


def motion_energy(window: np.ndarray, fs: int = TARGET_FS_HZ) -> float:
    """window: [T, 3] calibrated+normalized accel window, channel order
    [vertical, forward, lateral] (COMMON_CHANNELS) - the SAME window
    live_detector.py's main RealtimeWindower already builds for the model,
    reused as-is (see module docstring for why no second windower is
    needed). Returns std_horiz_fwd for this window."""
    feats = compute_features(window[np.newaxis], fs=fs)[0]
    return float(feats[STD_HORIZ_FWD_FEATURE_INDEX])


def is_active_walking(window: np.ndarray, fs: int = TARGET_FS_HZ,
                      threshold: float = MOTION_ENERGY_THRESHOLD) -> bool:
    """True if `window` looks like active locomotion (walking/turning -
    keep the full existing response), False if it looks like a low-motion
    context (voluntary standing OR standing-freeze - the ambiguous zone
    this gate exists for; live_detector.py caps actuation to the Warning
    tier in that case, never suppresses it entirely)."""
    return motion_energy(window, fs=fs) >= threshold


# CONFIRMED-TIER SECOND GATE - a STRICTER bar than MOTION_ENERGY_THRESHOLD,
# checked ONLY once is_active_walking has already returned True for the same
# window (see live_detector.py's push_sample). WHY THIS EXISTS: scripts/
# warning_floor_gate_investigation.py found that is_active_walking's own
# 0.20 threshold, chosen to never miss a real Walk window, is loose enough
# that ordinary Sit/Stand/Sit-to-Stand/Stand-to-Sit postural motion
# (a weight-shift, or the push-off of actually sitting/standing up - none of
# it real locomotion) regularly crosses it too, so those windows get the
# FULL CONFIRMED (haptic+laser) tier exactly as if they were a real
# walking/turning-context freeze. Measured on FoG-STAR VAL (never re-tuned
# from test): of 188 non-FoG, is_active_walking-positive STOP-context
# windows CONFIRMED by the plain 0.20 gate, motion_energy separates them
# from real active-context windows (AUC=0.80 vs the true-CONFIRMED
# population, Mann-Whitney p=4.5e-37) - see warning_floor_gate_summary.json's
# "part_b_separability". late_burst_ratio (the SAME pre-onset-burst feature
# scripts/movement_attempt_gate_investigation.py tried for a different
# purpose) was ALSO checked and does NOT separate these two groups
# (AUC 0.36-0.45, i.e. no better than chance, sometimes backwards) - it is
# tuned to detect a brief kinematic burst before an approaching freeze, not
# to size ongoing motion, so it is the wrong tool for this specific job;
# motion_energy (already computed for every window, no new signal) is used
# instead.
#
# THE FLOOR IS STRUCTURALLY UNTOUCHED: this second gate is only ever
# consulted from the `active AND is_active_walking` branch, so its only
# possible effect is CONFIRMED -> WARNING, never WARNING/CONFIRMED -> NORMAL
# (verified empirically too - 0 floor violations at every threshold swept,
# see warning_floor_gate_summary.json). It is also, on purpose, NOT the
# unconditional "escalate-only" movement-attempt-buffer redesign considered
# and rejected in the same investigation (PART A there): that lever is
# structurally incapable of changing stop_false_alarm_rate at all under the
# floor (WARNING and CONFIRMED count identically in that metric), so it was
# not worth deploying - this threshold is the lever that actually helps.
#
# THRESHOLD CHOICE - deliberately the SMALLEST step above 0.20 that was
# swept (0.25), not the most aggressive one that still passed the episode
# safety check (0.45 was still 0/25 val, 0/12 test episodes downgraded):
# chosen to keep the cost to the walking/turning-context freeze path (this
# project's own motion_gate.py precedent already accepts a similar-sized
# cost for the SAME reason: is_active_walking's own choice of 0.20 costs
# 3.8% of real walking/turning-context freeze windows their CONFIRMED tier,
# see this module's own threshold-choice note above) roughly in that same
# ballpark rather than the larger cost a more aggressive value would add.
# At 0.25 (FoG-STAR VAL / test, see warning_floor_gate_summary.json's
# "part_b_threshold_sweep"):
#   - false-CONFIRMED stop-context windows corrected (CONFIRMED->WARNING,
#     still gets an alert, just not the loudest one): 33/188 (17.6%) val,
#     20/161 (12.4%) test.
#   - cost to real freeze windows in active/turning context (CONFIRMED-
#     >WARNING for that window): 22/352 (6.3%) val, 2/580 (0.3%) test.
#   - cost to real freeze EPISODES in active/turning context EVER reaching
#     CONFIRMED (the safety-critical number): 0/25 val, 0/12 test - fully
#     unchanged from the plain is_active_walking-only policy.
# More aggressive values (0.30-0.45) recover substantially more of the
# false-CONFIRMED windows (up to ~50-60%) at zero additional episode-level
# cost through 0.45 on both splits, but at growing PER-WINDOW cost to real
# freeze windows in active context (14-25% by 0.45) - a real, deliberate
# trade this project has not made; retune here, with the same sweep, if
# that trade is ever wanted.
CONFIRMED_TIER_MOTION_ENERGY_THRESHOLD = 0.25


def is_confirmed_grade_motion(window: np.ndarray, fs: int = TARGET_FS_HZ,
                              threshold: float = CONFIRMED_TIER_MOTION_ENERGY_THRESHOLD) -> bool:
    """True if `window` clears the STRICTER CONFIRMED-tier motion bar. Only
    meaningful to check once is_active_walking(window) is already True for
    the SAME window - see this function group's module-level note above and
    live_detector.py's push_sample for how the two checks compose (never
    called standalone in production)."""
    return motion_energy(window, fs=fs) >= threshold
