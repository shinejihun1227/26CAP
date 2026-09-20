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

from dataclasses import dataclass

import numpy as np

from fog_validation.ml.config import HOP_SEC, TARGET_FS_HZ, WINDOW_SEC
from fog_validation.ml.features import FEATURE_NAMES, compute_features

STD_HORIZ_FWD_FEATURE_INDEX = FEATURE_NAMES.index("std_horiz_fwd")
STD_VERTICAL_FEATURE_INDEX = FEATURE_NAMES.index("std_vertical")
STD_HORIZ_LAT_FEATURE_INDEX = FEATURE_NAMES.index("std_horiz_lat")

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


# =============================================================================
# PROLONGED-UNNATURAL-STILLNESS ESCALATION - an ADDITIVE safety margin for the
# case the two gates above cannot touch at all: the state machine never even
# reaches Active (fog_score stays below entry threshold every window), which
# is the likely outcome for a genuine COMPLETE-AKINESIA standing freeze (no
# tremor at all, so nothing in the freeze band for the model to pick up on -
# see augment/model docstrings elsewhere; this project's own model was never
# trained on any real standing-freeze example, positive or negative, because
# none exist anywhere in this project's reach - FoG-STAR has 0/101 episodes
# Stand-dominant, and a separate external clinician-tagged PD dataset checked
# this session also had 0/62 episodes during pure Standing). If the model
# itself never fires, motion_gate.py's other two checks never even run (they
# only ever move WARNING<->CONFIRMED for an ALREADY-Active window) - so a
# real complete-akinesia freeze could currently get STATE_NORMAL forever,
# quietly violating this module's own "a real standing freeze must still get
# SOME cue" principle for exactly the subtype the model is blindest to.
#
# THIS HAS NO REAL POSITIVE-CLASS VALIDATION - stated plainly, not softened:
# there is no real standing-freeze example (complete-akinesia or otherwise)
# anywhere in this project's reach to confirm this rule actually fires on one.
# It is a physiologically-motivated heuristic ("normal voluntary standing
# keeps a small amount of postural sway / weight-shifting; a much longer,
# much quieter stretch than anything seen in real voluntary-standing data is
# itself suspicious") - see docs/own_data_schema.md's new section for the
# full disclosure and the numbers behind it. The ONLY thing checkable here is
# the false-alarm side: how often would this fire on REAL, non-freeze Stand
# data - measured precisely below, not guessed.
#
# SIGNAL - combined_motion_energy: the L2 norm of the SAME 3 per-axis std
# features motion_energy()/is_active_walking() already computes (std_vertical,
# std_horiz_fwd, std_horiz_lat - features.py, no new spectral code), combined
# rather than forward-axis-only. Deliberately DIFFERENT from motion_energy()
# above: that signal is tuned to separate active LOCOMOTION from a stop (only
# the forward axis matters for that question); this one asks "is there
# meaningful movement on ANY axis at all", which is the right question for
# "how still is this person right now", including postural sway that shows
# up mostly on the vertical or lateral axis, not the forward one.
#
# THRESHOLD/DURATION CHOICE - SUPERSEDES an earlier, more conservative
# deployment (tau=0.10, D=75.0s) that is kept here as history because the
# reasoning for changing it matters. That original pair was chosen on
# train+val real Stand-activity data by requiring LITERALLY ZERO false
# triggers across every real Stand bout available (see scripts/
# standing_freeze_stillness_escalation_investigation.py and data/processed/
# ml/standing_freeze_stillness_escalation_summary.json for that derivation -
# still valid as methodology, not deleted). D=75.0 was that population's own
# longest continuous quiet streak (66.5s on train+val, both datasets pooled)
# rounded up plus a margin - i.e. it was picked to survive the single
# longest quiet stretch anyone had ever recorded while genuinely NOT frozen.
#
# WHY THAT WAS THE WRONG BAR FOR *THIS* RULE - stated plainly: this rule can
# only ever move STATE_NORMAL -> STATE_WARNING (see StillnessDurationTracker
# below and live_detector.py's push_sample) - the weakest tier, a gentle
# haptic buzz only, never the CONFIRMED haptic+laser tier. Every other
# threshold in this module (MOTION_ENERGY_THRESHOLD, CONFIRMED_TIER_
# MOTION_ENERGY_THRESHOLD above) already accepts a real, nonzero false-
# WARNING/false-CONFIRMED-downgrade rate for exactly this reason - annoyance
# at the WARNING tier is cheap, missing a real freeze is not. Requiring
# ZERO false triggers specifically for the one rule that can only ever
# produce the CHEAPEST possible outcome was inconsistent with that
# philosophy, and it had a real cost: real FoG episode durations (external
# clinician-tagged TUG dataset, 62 episodes / 7 real PD patients - this
# project's own scratchpad analysis) have mean=3.28s, median=1.87s,
# p90=8.45s, p95=11.82s, max=15.46s. A 75s bar is roughly 5x longer than the
# single longest real freeze episode ever recorded in that reference data -
# for a genuine complete-akinesia freeze (this rule's entire reason to
# exist - see the PROLONGED-UNNATURAL-STILLNESS section above), the rule
# would in practice almost never fire while the freeze was still happening.
# A safety net whose hole is 5x the size of what it exists to catch is not
# a safety net, it is a formality.
#
# NEW CHOICE (scripts/standing_freeze_stillness_escalation_retune.py, data/
# processed/ml/standing_freeze_stillness_escalation_retune_summary.json -
# reuses this investigation's own bout-construction/sweep code, does not
# rebuild it): rather than re-deriving D as "this data's own observed max",
# a grid of candidate D's (5-75s) x tau's (0.05-0.20) was evaluated directly
# against ALL 775 real Stand bouts available (train+val+test pooled -
# FoG-STAR 177 real-PD-patient bouts, longest 35.5s; HuGaDB 598 healthy-
# non-PD bouts, longest 67.0s; no held-out split needed here since these are
# fixed a priori candidates, not values fit to the data). Full curve at the
# chosen tau=0.05 (pooled / FoG-STAR-PD-only / HuGaDB-non-PD-only bout
# trigger rates): D=5s 38.45%/5.08%/48.33%, D=8s 26.71%/3.39%/33.61%, D=10s
# 19.74%/2.82%/24.75%, D=12s 11.87%/1.69%/14.88%, D=15s 7.10%/1.69%/8.70%,
# D=20s 4.90%/1.13%/6.02%, D=25s 4.00%/1.13%/4.85%, D=30s 2.97%/1.13%/3.51%,
# D=45s 1.03%/0.00%/1.34%, D=60s 0.52%/0.00%/0.67%, D=75s 0.00%/0.00%/0.00%.
#
# tau was ALSO lowered, from 0.10 to 0.05 - not the primary lever (duration
# is, by roughly an order of magnitude more effect across this grid), but a
# genuinely free additional win: at every D, a lower tau requires a
# stricter (closer to true zero) reading to count as "still" at all, which
# only ever REDUCES the false-trigger rate against real, mildly-swaying
# voluntary standing, while a genuine complete-akinesia freeze - by
# definition near-exactly zero combined_motion_energy on every axis, see
# this module's PROLONGED-UNNATURAL-STILLNESS section - is not expected to
# lose any real sensitivity from a stricter "still" bar (real Stand data's
# own sensor-noise floor sits around 0.010-0.012 combined_motion_energy,
# comfortably below 0.05 - see the retune summary json's descriptive
# stats). At D=15s specifically, dropping tau 0.10->0.05 cut the FoG-STAR
# (real-PD)-only bout trigger rate from 6.21% (11/177) to 1.69% (3/177).
#
# CHOSEN: tau=0.05, D=15.0s. Reasoning for exactly 15s: it sits inside this
# project's own stated acceptable range for a WARNING-tier-only false-alarm
# cost (roughly 5-15%) at the POOLED rate (7.10%, 55/775 bouts), the
# FoG-STAR(real-PD)-only cost is small in absolute terms (1.69%, 3/177
# bouts - the rest of the pooled rate is HuGaDB's non-PD population, which
# this device will never actually be deployed against), AND 15s is now
# close to - rather than ~5x beyond - the single longest real freeze
# episode ever recorded in the reference data (15.46s), a genuine,
# qualitative improvement in how much of the real freeze-duration
# distribution this rule can plausibly still be running during. It is NOT
# fast enough to catch a TYPICAL real freeze (median 1.87s, p90 8.45s) -
# stated honestly, not softened: this rule is inherently a slower, last-
# resort layer for the specific worst case (a freeze the base model's
# fog_score never flags Active for at all), so "faster than 75s and still
# low-nuisance" is the realistically achievable improvement here, not
# "fast enough to catch a typical freeze." D=12s (11.87%/1.69%/14.88%) and
# D=20s (4.90%/1.13%/6.02%) were the closest runners-up if this exact
# trade-off is ever revisited - see the retune summary json for the full
# grid, including the per-split (train/val/test) breakdown confirming the
# trigger rate is not an artifact concentrated in a single split.
#
# GRADUATED (2-stage) DESIGN CONSIDERED AND REJECTED: a short D (mild first
# nudge) plus a longer D as a "stronger" fallback stage was considered, per
# this session's task. Rejected because this rule's own floor makes it
# structurally pointless as designed: BOTH stages can only ever resolve to
# STATE_WARNING (see StillnessDurationTracker/live_detector.py's
# push_sample docstring - this rule never reaches CONFIRMED), and
# STATE_WARNING is currently one flat, undifferentiated action (gentle
# haptic only - see scripts/ble_receiver.py's STATE_WARNING branch, no
# existing intensity/pattern gradation to escalate INTO). A second,
# longer-duration stage would therefore just re-emit the identical
# STATE_WARNING the first stage already produced - no observable difference
# to the wearer, for the real cost of a second tracked threshold and more
# code to test. A single well-chosen D captures essentially all of the
# reachable benefit; revisit a real 2-stage design only if STATE_WARNING
# itself ever grows a graduated intensity (a new, separate change, not a
# threshold retune).
STILLNESS_ENERGY_THRESHOLD = 0.05
STILLNESS_ESCALATION_SEC = 15.0


def combined_motion_energy(window: np.ndarray, fs: int = TARGET_FS_HZ) -> float:
    """window: same [T,3] window as motion_energy() (calibrated+normalized
    accel, channel order [vertical, forward, lateral]). Returns the L2 norm
    of (std_vertical, std_horiz_fwd, std_horiz_lat) - movement magnitude on
    ANY axis, unlike motion_energy()'s forward-axis-only std_horiz_fwd (that
    one is tuned for a different question - see this module's top docstring
    and the PROLONGED-UNNATURAL-STILLNESS section above for why a different
    signal is used here)."""
    feats = compute_features(window[np.newaxis], fs=fs)[0]
    std_v = feats[STD_VERTICAL_FEATURE_INDEX]
    std_f = feats[STD_HORIZ_FWD_FEATURE_INDEX]
    std_l = feats[STD_HORIZ_LAT_FEATURE_INDEX]
    return float(np.sqrt(std_v ** 2 + std_f ** 2 + std_l ** 2))


def is_unnaturally_still(window: np.ndarray, fs: int = TARGET_FS_HZ,
                         threshold: float = STILLNESS_ENERGY_THRESHOLD) -> bool:
    """True if `window` shows LESS combined-axis movement than `threshold` -
    a single window's worth of evidence only; see StillnessDurationTracker
    for the multi-window duration check that actually decides whether to
    escalate (a single still window is completely normal and must never
    trigger anything on its own)."""
    return combined_motion_energy(window, fs=fs) < threshold


@dataclass
class StillnessDurationTracker:
    """Tracks how long a SINGLE foot's stream has been continuously
    is_unnaturally_still(), in real seconds - the multi-window state the two
    checks above (deliberately stateless, single-window) cannot express on
    their own. One instance per foot (same convention as RealtimeWindower/
    FogStateMachine in live_detector.py - each foot's LiveFogDetector gets
    its own independent tracker, no cross-foot sharing).

    update() must be called exactly once per COMPLETED window (i.e. only
    after RealtimeWindower.push() actually returns a window, same
    precondition motion_energy()'s callers already follow) - never once per
    raw sample. A window that clears the stillness threshold resets the run
    to zero immediately (this is about UNBROKEN stillness, not an average);
    a gap in calls (e.g. a dropped BLE packet) is simply not distinguished
    from a real movement burst by this simple counter, which is the
    conservative direction for a rule whose only job is to escalate caution,
    never to suppress it.
    """
    hop_sec: float = HOP_SEC
    window_sec: float = WINDOW_SEC
    threshold: float = STILLNESS_ENERGY_THRESHOLD
    duration_sec: float = STILLNESS_ESCALATION_SEC
    _quiet_run: int = 0

    def update(self, window: np.ndarray, fs: int = TARGET_FS_HZ) -> bool:
        """Feed one completed window. Returns True iff the wearer has now
        been continuously is_unnaturally_still() for at least
        `duration_sec` seconds (see this class's + the module's
        PROLONGED-UNNATURAL-STILLNESS section for what a caller should do
        with that - live_detector.py escalates STATE_NORMAL to STATE_WARNING
        only, never anything stronger, and never touches an
        already-WARNING/CONFIRMED decision)."""
        if is_unnaturally_still(window, fs=fs, threshold=self.threshold):
            self._quiet_run += 1
        else:
            self._quiet_run = 0
        if self._quiet_run == 0:
            return False
        current_duration = self.window_sec + (self._quiet_run - 1) * self.hop_sec
        return current_duration >= self.duration_sec

    def reset(self) -> None:
        self._quiet_run = 0
