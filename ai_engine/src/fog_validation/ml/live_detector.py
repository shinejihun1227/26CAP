"""The transport-independent half of the live FoG pipeline: decoded sensor
sample -> calibrated window -> model score -> (optional yaw gate) ->
debounced Active/Normal decision -> (low-motion gate) -> graduated
Normal/Warning/Confirmed actuation tier. Split out from scripts/ble_receiver.py
so this logic is testable without a bleak import or any hardware, the same
reason ble_codec.py is separate from the BLE I/O around it.

STATE_NORMAL / STATE_WARNING / STATE_CONFIRMED: the three tiers push_sample()
can resolve to once a window completes (see its own docstring). This is a
DIFFERENT axis from the yaw gate: the yaw gate runs BEFORE the state machine
and can force a window's fog_score to 0.0, i.e. it can prevent Active from
triggering at all. The motion gate (motion_gate.py) runs AFTER the state
machine and only decides which TIER an already-Active decision gets - it
never turns Active back into Normal, and never suppresses a real detection
down to nothing. See motion_gate.py's module docstring for why this project
does that (a real standing freeze must still get SOME cue) and
docs/own_data_schema.md's "저모션 게이트" section for the validated numbers.
The motion gate is actually TWO checks in series (is_active_walking, then
the stricter is_confirmed_grade_motion): both can only ever move a window
between WARNING and CONFIRMED, never down to NORMAL - see
docs/own_data_schema.md's "저모션 게이트 - CONFIRMED 2차 게이트" section for
why the second check exists and the validated numbers behind it.

A THIRD, separate check - motion_gate.StillnessDurationTracker - covers the
one case the two checks above cannot touch at all: the state machine never
reaching Active in the first place (fog_score never crosses entry threshold),
the likely outcome for a genuine complete-akinesia standing freeze this
project's model was never trained on any real example of. That tracker can
ONLY ever turn a would-be STATE_NORMAL into STATE_WARNING, never anything
else - see motion_gate.py's PROLONGED-UNNATURAL-STILLNESS section for the
full disclosure (this has NO real positive-class validation, unlike every
other gate in this file) and docs/own_data_schema.md's "저모션 게이트 -
장시간 무동작 에스컬레이션" section for the numbers behind it.

OPTIONAL, INERT-BY-DEFAULT PRESSURE (FSR) GATES - pressure_gate.py, wired in
below push_sample()'s existing accel-only logic. No physical pressure
hardware exists for this project yet, so both gates below are a no-op TODAY
by construction: they only ever activate when a packet actually carries
"{foot}_fsr"/"L_fsr"/"R_fsr" keys (ble_codec.decode_sensor_packet() always
includes these once real firmware sends them, but every packet built by this
project's own code/tests today omits them entirely) AND a peak-force
reference has been supplied to this constructor (no real calibration
protocol step produces one yet - see pressure_gate.py's top docstring). See
that module for the full disclosure: every threshold below comes from an
EXTERNAL clinical dataset, not this project's own data, and none of this has
ever been validated against a single real sample from this project's own
hardware.

  - pressure_gate.PressureFootLiftTracker / had_genuine_footlift(): a THIRD,
    even stricter AND-condition alongside is_active_walking/
    is_confirmed_grade_motion before granting CONFIRMED - same structural
    slot, same floor guarantee (can only ever move CONFIRMED->WARNING, never
    below WARNING). See pressure_gate.py's SIGNAL 1 section.
  - pressure_gate.PreTransitionPressureTracker / is_pre_transition_low_force():
    checked ONLY at the exact window an Active decision's ONSET fires (not on
    every window of an ongoing Active streak - see push_sample()'s own
    docstring for why). If combined pre-onset force reads as low as a real
    Sit-to-Stand transition, caps that onset decision to WARNING - a
    deliberate, documented choice to still respect the project-wide "never
    fully silence an Active decision" floor even here, despite this signal's
    unusually clean external validation (Cohen's d=8.1) - see
    docs/own_data_schema.md's new pressure-gate section and this module's
    push_sample() docstring for the full reasoning.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from fog_validation.ml.calibration import AxisCalibration
from fog_validation.ml.evaluate import CLASS_ORDER
from fog_validation.ml.model_io import load_cnn, load_rf
from fog_validation.ml.models_baseline import predict_proba_baseline
from fog_validation.ml.models_cnn import predict_proba_cnn
from fog_validation.ml.motion_gate import (
    StillnessDurationTracker,
    is_active_walking,
    is_confirmed_grade_motion,
)
from fog_validation.ml.pressure_gate import (
    PressureFootLiftTracker,
    PreTransitionPressureTracker,
    had_genuine_footlift,
    is_pre_transition_low_force,
)
from fog_validation.ml.realtime import RealtimeWindower
from fog_validation.ml.state_machine import FogStateMachine
from fog_validation.ml.windowing import LABEL_FOG

# push_sample()'s three "a window was just scored" outcomes (None means "no
# window completed yet, still buffering" - unchanged from before this gate
# existed, and deliberately kept DISTINCT from STATE_NORMAL so callers can
# still tell "no decision yet" apart from "decided, and it's Normal" - the
# same distinction the old None-vs-False return already made).
STATE_NORMAL = "normal"        # state machine Normal - no alert
STATE_WARNING = "warning"      # state machine Active, low-motion context - weak cue only
STATE_CONFIRMED = "confirmed"  # state machine Active, active-walking context - full cue, unchanged


def load_axis_calibration(calibration_json_path: Path) -> AxisCalibration:
    d = json.loads(calibration_json_path.read_text(encoding="utf-8"))
    # run_calibration.py stores channel NAMES (raw_acc_x/y/z, raw_gyro_x/y/z),
    # not indices - this is the only place that needs the name<->index map.
    acc_name_to_idx = {"raw_acc_x": 0, "raw_acc_y": 1, "raw_acc_z": 2}
    gyro_name_to_idx = {"raw_gyro_x": 0, "raw_gyro_y": 1, "raw_gyro_z": 2}
    gyro_yaw_channel = d.get("gyro_yaw_channel")
    channels = [d["vertical_channel"], d["forward_channel"], d["lateral_channel"]]
    if set(channels) != set(acc_name_to_idx) or d["vertical_sign"] not in (-1, 1):
        raise ValueError("calibration requires three distinct axes and a +/-1 vertical sign")
    mean, std = np.asarray(d["zscore_mean_vfl"], dtype=float), np.asarray(d["zscore_std_vfl"], dtype=float)
    if mean.shape != (3,) or std.shape != (3,) or not np.isfinite(mean).all() or not np.isfinite(std).all() or (std <= 1e-8).any():
        raise ValueError("calibration requires finite means and positive standard deviations")
    return AxisCalibration(
        vertical_idx=acc_name_to_idx[d["vertical_channel"]],
        vertical_sign=d["vertical_sign"],
        forward_idx=acc_name_to_idx[d["forward_channel"]],
        lateral_idx=acc_name_to_idx[d["lateral_channel"]],
        vertical_confidence=d["vertical_confidence"],
        forward_confidence=d["forward_confidence"],
        gyro_pitch_idx=None, gyro_pitch_confidence=None,  # unused for accel-only live inference
        mean=np.array(d["zscore_mean_vfl"]), std=np.array(d["zscore_std_vfl"]),
        gyro_yaw_idx=gyro_name_to_idx[gyro_yaw_channel] if gyro_yaw_channel else None,
        gyro_yaw_confidence=d.get("gyro_yaw_confidence"),
    )


class LiveFogDetector:
    """Wraps one foot's decoded sensor samples -> calibrated window -> model
    score -> (optional yaw gate) -> debounced Active/Normal decision -> (low-
    motion gate) -> Normal/Warning/Confirmed actuation tier. See
    state_machine.py for why n_consecutive/exit_margin are flagged defaults,
    not tuned numbers; calibration.py's module docstring for why the yaw
    gate is opportunistic (only runs when calibration actually found a yaw
    axis - see docs/own_data_schema.md's "Yaw 게이트" section); and
    motion_gate.py for the low-motion gate, which is UNCONDITIONAL (always
    runs, no calibration precondition - it reuses the same main accel window
    every model score already needs, see docs/own_data_schema.md's "저모션
    게이트" section) and its second, stricter CONFIRMED-tier check (see
    docs/own_data_schema.md's "저모션 게이트 - CONFIRMED 2차 게이트" section);
    and its THIRD check, the prolonged-unnatural-stillness escalation (see
    motion_gate.StillnessDurationTracker and docs/own_data_schema.md's
    "저모션 게이트 - 장시간 무동작 에스컬레이션" section) - also unconditional,
    runs on every completed window regardless of the state machine's own
    Active/Normal decision, since its whole purpose is to catch the case
    where the state machine NEVER goes Active at all.

    Input is transport-agnostic: push_sample() takes the same `dict` shape
    fog_validation.ml.ble_codec.decode_sensor_packet() returns (keys like
    "R_raw_acc", "R_raw_gyro"), regardless of what carried the bytes here.
    """

    def __init__(self, calibration: AxisCalibration, model_name: str, artifact_dir: Path, foot: str,
                pressure_peak_force_reference: float | None = None,
                pressure_peak_combined_force_reference: float | None = None):
        """pressure_peak_force_reference/pressure_peak_combined_force_reference:
        OPTIONAL pressure-gate calibration references (see pressure_gate.py's
        top docstring - no real calibration protocol step produces these yet,
        this is a deliberately plain seam for a future one). Leave both at
        their None default until that calibration step exists AND real
        pressure hardware exists - with either omitted (or packets that never
        carry "{foot}_fsr"/"L_fsr"/"R_fsr", true for every packet in this
        project today), the two pressure gates below are unconditionally
        inert and push_sample()'s behavior is unchanged from before they
        existed (see tests/test_live_detector.py's pressure-absent tests)."""
        self.calibration = calibration
        self.foot = foot
        self.model_name = model_name
        self.windower = RealtimeWindower()
        self.i_fog = CLASS_ORDER.index(LABEL_FOG)
        self.stillness_tracker = StillnessDurationTracker()  # see motion_gate.py's
                                                              # PROLONGED-UNNATURAL-STILLNESS section
        self.pressure_peak_force_reference = pressure_peak_force_reference
        self.pressure_peak_combined_force_reference = pressure_peak_combined_force_reference
        self.footlift_tracker = PressureFootLiftTracker()          # SIGNAL 1 - see pressure_gate.py
        self.pretransition_tracker = PreTransitionPressureTracker()  # SIGNAL 2 - see pressure_gate.py
        self._was_active = False  # tracks the state machine's PREVIOUS active flag, so push_sample
                                   # can tell an Active ONSET window apart from an ongoing Active
                                   # streak - see push_sample()'s docstring for why SIGNAL 2 only
                                   # ever consults the onset window.
        self.last_fog_score: float | None = None  # most recent resolved window's fog_score -
                                   # purely a read-only convenience for external status displays
                                   # (e.g. a status-server HTTP endpoint), never read by push_sample
                                   # itself. None until the first window resolves.

        self.last_diagnostics: dict = {}
        deploy_config = json.loads((artifact_dir / "deploy_config.json").read_text(encoding="utf-8"))
        if model_name == "rf":
            self.model = load_rf(artifact_dir / "rf_model.joblib")
            self.model.n_jobs = 1  # see ensemble_investigation_summary.json / deploy_config.json's
                                    # "ensemble" note: n_jobs=-1 pays multiprocess dispatch overhead
                                    # on every single-window predict_proba() call (mean ~39ms, one-off
                                    # spikes >150ms observed); n_jobs=1 measured mean~16ms/max~32ms on
                                    # the SAME single-window call pattern used live - always applied for
                                    # RF, not just when ensembling, since it is strictly better here.
        elif model_name == "cnn":
            self.model = load_cnn(artifact_dir / "cnn_model.pt")
        elif model_name == "ensemble":
            # RF+CNN score-averaging ensemble - see scripts/ensemble_investigation.py and
            # data/processed/ml/ensemble_investigation_summary.json for the validation behind this:
            # averaging the two ALREADY-TRAINED models' fog_score probabilities raised PD_only val AUC
            # 0.7996/0.8163 (RF/CNN alone) -> 0.8343, and - at a threshold constrained to match-or-beat
            # the deployed CNN's own PD_only val FPR_stop (0.4507) - caught 2 additional real val FoG
            # episodes (37/45 -> 39/45, window-level state-machine definition) with FPR_stop unchanged
            # or improved on both val (0.4468) and held-out test (0.3178 vs CNN's 0.3464, alongside a
            # sensitivity gain 0.8408->0.8753). Both models run every window; profiled combined
            # single-window worst case (RF n_jobs=1 + CNN) ~85ms, comfortably inside the 500ms hop
            # budget (RF alone was the ONLY latency risk, see rf.n_jobs=1 note above).
            self.model = {"rf": load_rf(artifact_dir / "rf_model.joblib"),
                         "cnn": load_cnn(artifact_dir / "cnn_model.pt")}
            self.model["rf"].n_jobs = 1
        else:
            raise ValueError(f"unknown model_name {model_name!r}, expected 'rf', 'cnn', or 'ensemble'")

        model_cfg = deploy_config[model_name]
        sm_cfg = deploy_config["state_machine_defaults"]
        enter = model_cfg["threshold_fog_pd_only_youden_j"]
        self.state_machine = FogStateMachine(
            enter_threshold=enter,
            exit_threshold=max(0.0, enter - sm_cfg["exit_margin"]),
            n_consecutive=sm_cfg["n_consecutive"],
        )

        self.yaw_gate_enabled = calibration.gyro_yaw_idx is not None
        if self.yaw_gate_enabled:
            self.yaw_gate_threshold_dps = deploy_config["yaw_gate"]["threshold_dps"]
            self.yaw_windower = RealtimeWindower(n_channels=1)
        else:
            self.yaw_gate_threshold_dps = None
            self.yaw_windower = None

    def reset_stream(self) -> None:
        """Discard all temporal evidence after loss, restart or recalibration."""
        self.windower.reset()
        if self.yaw_windower is not None:
            self.yaw_windower.reset()
        self.state_machine.reset()
        self.stillness_tracker = StillnessDurationTracker()
        self.footlift_tracker = PressureFootLiftTracker()
        self.pretransition_tracker = PreTransitionPressureTracker()
        self._was_active = False
        self.last_fog_score = None
        self.last_diagnostics = {}

    def _decision(self, state: str, reason: str) -> str:
        self.last_diagnostics.update(state=state, reason=reason)
        return state

    def push_sample(self, packet: dict) -> str | None:
        """Feed one decoded sensor packet in. Returns None if still filling
        the window buffer (no decision to make yet - unchanged meaning from
        before this gate existed). Otherwise returns one of:

          STATE_NORMAL    - state machine says Normal (no alert), AND this
                            foot has NOT been continuously
                            motion_gate.is_unnaturally_still() for
                            motion_gate.STILLNESS_ESCALATION_SEC seconds.
          STATE_WARNING   - reached via EITHER of two independent paths:
                            (1) state machine says Active, but either (a) the
                            low-motion gate (motion_gate.is_active_walking)
                            sees no real walking/turning energy in this
                            window, or (b) it does, but the window fails the
                            STRICTER second check (motion_gate.
                            is_confirmed_grade_motion) that catches ordinary
                            Sit/Stand/Sit-to-Stand/Stand-to-Sit postural
                            motion that clears (a)'s looser bar without being
                            real locomotion - either way, cap actuation to
                            the weaker tier (haptic only, no laser - see
                            ble_receiver.py). Covers voluntary standing, a
                            real standing-freeze (this project cannot tell
                            those apart from kinematics alone - see
                            motion_gate.py - so a standing freeze still gets
                            this, never nothing), AND ordinary Sit/Stand
                            transitions.
                            (2) state machine says Normal (never went
                            Active), BUT this foot has been continuously
                            motion_gate.is_unnaturally_still() for at least
                            motion_gate.STILLNESS_ESCALATION_SEC seconds -
                            the prolonged-unnatural-stillness escalation (see
                            motion_gate.py's PROLONGED-UNNATURAL-STILLNESS
                            section; NO real positive-class validation, a
                            physiologically-motivated heuristic only).
          STATE_CONFIRMED - state machine says Active AND the window looks
                            like active locomotion AND clears the stricter
                            CONFIRMED-tier motion bar AND (if pressure data is
                            available - see below) this foot showed a
                            genuine, near-zero-force swing phase somewhere in
                            this window - full haptic+laser.

        The yaw gate (if enabled) still runs first and can force fog_score
        to 0.0, same as before - that can only ever prevent Active from
        triggering, never affect which of WARNING/CONFIRMED an Active
        decision gets. The stillness tracker (path (2) above) is
        UNCONDITIONAL and independent of the yaw gate/state machine/other two
        motion-gate checks - it is updated on every completed window
        regardless of any of them, since its purpose is specifically to
        catch the case where the state machine never goes Active at all.

        OPTIONAL PRESSURE (FSR) GATES - pressure_gate.py, both INERT by
        default (see __init__'s docstring and pressure_gate.py's top
        docstring: no real pressure hardware exists, every threshold comes
        from an external dataset, not this project's own data):

          - SIGNAL 1 (pressure_gate.had_genuine_footlift): only ever
            consulted once is_active_walking AND is_confirmed_grade_motion
            have ALREADY passed for this window (same "AND on top, never a
            replacement" pattern as is_confirmed_grade_motion itself) - a
            THIRD, still-stricter check that can additionally demote
            CONFIRMED->WARNING (never below WARNING) if this foot's own FSR
            data is present, a peak_force_reference was supplied, AND that
            data shows no genuine near-zero-force swing phase this window.
            If pressure data is unavailable (no "{foot}_fsr" key in `packet`,
            or no peak_force_reference configured, or this tracker's own
            window buffer isn't full yet), this check is skipped entirely -
            behaves exactly as if it did not exist, never treated as a
            silent False.
          - SIGNAL 2 (pressure_gate.is_pre_transition_low_force): consulted
            ONLY at the exact window an Active decision's ONSET fires (state
            machine just flipped Normal->Active THIS window, not an ongoing
            Active streak) - see this method's implementation for why only
            the onset window: the ~2.0s rolling pre-transition buffer this
            check reads is only meaningful as "what was force doing right
            before this decision," which stops being a meaningful question
            once several windows into an already-Active streak. If combined
            (L+R) force was very low right before the onset (the validated
            Sit-to-Stand transition pattern - see pressure_gate.py), caps
            THIS ONSET WINDOW's decision to WARNING - a DELIBERATE choice,
            after weighing it explicitly, to still respect this project's
            "never fully silence an Active decision" floor even here despite
            this signal's unusually clean external validation (Cohen's
            d=8.1, 0/61 false negatives on the external dataset): that
            validation is real but (a) comes from a different insole system/
            subject population than this project's own, (b) is a small (n=61
            windows, 7 subjects) external sample, and (c) WARNING already
            delivers most of the practical annoyance-reduction benefit (no
            laser, gentler haptic - see ble_receiver.py) without the
            categorically worse downside of a real freeze someday getting
            ZERO cue because it happened to follow a genuine stand-up. If
            pressure data is unavailable, this check is skipped entirely,
            same as Signal 1."""
        raw_acc = packet[f"{self.foot}_raw_acc"].reshape(1, 3)
        remapped = self.calibration.remap(raw_acc)
        normalized = self.calibration.normalize(remapped)[0].astype(np.float32)  # [3]
        window = self.windower.push(normalized)

        yaw_window = None
        if self.yaw_gate_enabled:
            raw_gyro = packet[f"{self.foot}_raw_gyro"].reshape(1, 3)
            yaw_sample = self.calibration.extract_gyro_yaw(raw_gyro).astype(np.float32)  # [1]
            yaw_window = self.yaw_windower.push(yaw_sample)

        # OPTIONAL pressure (FSR) tracking - see pressure_gate.py and this
        # method's own docstring. Pushed unconditionally, BEFORE the "window
        # is None" early-return below, same as the yaw windower above: both
        # pressure trackers need to advance in lockstep with every incoming
        # packet that actually carries their data, independent of whether the
        # main accel window has completed yet. `packet.get(...)` (not `[...]`)
        # is the whole mechanism that makes this a no-op today - every packet
        # built anywhere in this project right now simply has no
        # "{foot}_fsr"/"L_fsr"/"R_fsr" keys, so both `.get()` calls return
        # None and neither tracker is ever touched (verified in
        # tests/test_live_detector.py's pressure-absent tests).
        footlift_window = None
        foot_fsr = packet.get(f"{self.foot}_fsr")
        if foot_fsr is not None:
            footlift_window_raw = self.footlift_tracker.push(float(np.sum(foot_fsr)))
            if footlift_window_raw is not None:
                footlift_window = footlift_window_raw[:, 0]

        l_fsr, r_fsr = packet.get("L_fsr"), packet.get("R_fsr")
        if l_fsr is not None and r_fsr is not None:
            self.pretransition_tracker.push(float(np.sum(l_fsr) + np.sum(r_fsr)))

        if window is None:
            return None  # main windower gates the pace - both windowers share window/hop config

        # Unconditional, independent of everything below - see this method's
        # docstring and motion_gate.py's PROLONGED-UNNATURAL-STILLNESS
        # section. Must run even on windows the model scores as Normal,
        # since its entire purpose is to catch the case where the model
        # NEVER goes Active for a genuine (complete-akinesia) standing freeze.
        still_escalate = self.stillness_tracker.update(window)

        X = window[np.newaxis]  # [1, T, 3]
        if self.model_name == "rf":
            proba = predict_proba_baseline(self.model, X)
        elif self.model_name == "cnn":
            proba = predict_proba_cnn(self.model, X)
        else:  # "ensemble" - simple average of both models' fog_score, see __init__'s note
            proba_rf = predict_proba_baseline(self.model["rf"], X)
            proba_cnn = predict_proba_cnn(self.model["cnn"], X)
            proba = (proba_rf + proba_cnn) / 2.0
        fog_score = float(proba[0, self.i_fog])
        self.last_fog_score = fog_score
        self.last_diagnostics = {
            "raw_model_score": fog_score,
            "rf_score": float(proba_rf[0, self.i_fog]) if self.model_name == "ensemble" else (fog_score if self.model_name == "rf" else None),
            "cnn_score": float(proba_cnn[0, self.i_fog]) if self.model_name == "ensemble" else (fog_score if self.model_name == "cnn" else None),
            "yaw_suppressed": False, "stillness_escalated": bool(still_escalate),
            "enter_threshold": self.state_machine.enter_threshold,
            "exit_threshold": self.state_machine.exit_threshold,
            "n_consecutive": self.state_machine.n_consecutive,
        }

        if self.yaw_gate_enabled and yaw_window is not None:
            yaw_rom = float(yaw_window[:, 0].max() - yaw_window[:, 0].min())
            if yaw_rom > self.yaw_gate_threshold_dps:
                self.last_diagnostics["yaw_suppressed"] = True
                fog_score = 0.0  # suppress: this window's rotation looks like active
                                  # turning, not a freeze - see the physiological check
                                  # in test_yaw_gate.py's docstring

        was_active = self._was_active
        self.last_diagnostics["decision_score"] = fog_score
        active = self.state_machine.update(fog_score)
        self.last_diagnostics["active"] = bool(active)
        self._was_active = active
        if not active:
            # Prolonged-unnatural-stillness escalation: the ONLY path that
            # can ever turn a non-Active window into anything other than
            # STATE_NORMAL - still strictly WARNING, never CONFIRMED, and
            # only when the wearer has been continuously still for
            # motion_gate.STILLNESS_ESCALATION_SEC seconds. See
            # motion_gate.py's PROLONGED-UNNATURAL-STILLNESS section - no
            # real positive-class validation, physiologically-motivated only.
            return self._decision(STATE_WARNING if still_escalate else STATE_NORMAL,
                                  "prolonged_stillness" if still_escalate else "yaw_suppressed" if self.last_diagnostics["yaw_suppressed"] else "below_entry_or_debouncing")

        # OPTIONAL SIGNAL 2 (pressure_gate.is_pre_transition_low_force) -
        # ONLY evaluated on the exact window this Active decision turned on
        # (was_active False -> active True), never on a later window of the
        # same ongoing streak - see this method's docstring for why. A
        # low-force reading here caps THIS ONSET WINDOW's outcome to
        # STATE_WARNING regardless of what the motion/footlift gates below
        # would otherwise decide (still never below WARNING - the floor is
        # unchanged). Inert (pretransition_low is None -> False effect) unless
        # both L_fsr/R_fsr were present AND pressure_peak_combined_force_
        # reference was configured AND the rolling buffer is already full.
        is_onset = active and not was_active
        pretransition_low = False
        if is_onset:
            frac = self.pretransition_tracker.pre_transition_force_frac(
                self.pressure_peak_combined_force_reference)
            pretransition_low = is_pre_transition_low_force(frac) is True
        if pretransition_low:
            return self._decision(STATE_WARNING, "pressure_transition")

        if not is_active_walking(window):
            return self._decision(STATE_WARNING, "low_motion")
        # is_active_walking passed - a SECOND, stricter motion check now
        # decides WARNING vs CONFIRMED (never NORMAL, so the floor above is
        # untouched): catches ordinary Sit/Stand/Sit-to-Stand/Stand-to-Sit
        # postural motion that clears is_active_walking's own looser bar
        # without being real locomotion - see motion_gate.py's
        # CONFIRMED_TIER_MOTION_ENERGY_THRESHOLD docstring for why/how this
        # was validated (scripts/warning_floor_gate_investigation.py).
        if not is_confirmed_grade_motion(window):
            return self._decision(STATE_WARNING, "motion_grade")

        # OPTIONAL SIGNAL 1 (pressure_gate.had_genuine_footlift) - a THIRD,
        # still-stricter AND-condition on top of the two motion checks above,
        # same "can only demote CONFIRMED->WARNING" floor. Inert (treated as
        # passing) unless this foot's own FSR data was present this window
        # AND pressure_peak_force_reference was configured AND this foot's
        # own pressure windower has a full window buffered yet.
        if footlift_window is not None:
            if had_genuine_footlift(footlift_window, self.pressure_peak_force_reference) is False:
                return self._decision(STATE_WARNING, "no_footlift")
        return self._decision(STATE_CONFIRMED, "sustained_model_and_motion")
