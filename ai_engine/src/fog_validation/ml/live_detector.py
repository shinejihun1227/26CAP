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
from fog_validation.ml.motion_gate import is_active_walking, is_confirmed_grade_motion
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
    docs/own_data_schema.md's "저모션 게이트 - CONFIRMED 2차 게이트" section).

    Input is transport-agnostic: push_sample() takes the same `dict` shape
    fog_validation.ml.ble_codec.decode_sensor_packet() returns (keys like
    "R_raw_acc", "R_raw_gyro"), regardless of what carried the bytes here.
    """

    def __init__(self, calibration: AxisCalibration, model_name: str, artifact_dir: Path, foot: str):
        self.calibration = calibration
        self.foot = foot
        self.model_name = model_name
        # Exposed as read-only telemetry for the local web bridge. These
        # fields do not change the detector's decision path.
        self.last_fog_score: float | None = None
        self.last_state: str | None = None
        self.windower = RealtimeWindower()
        self.i_fog = CLASS_ORDER.index(LABEL_FOG)

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

    def push_sample(self, packet: dict) -> str | None:
        """Feed one decoded sensor packet in. Returns None if still filling
        the window buffer (no decision to make yet - unchanged meaning from
        before this gate existed). Otherwise returns one of:

          STATE_NORMAL    - state machine says Normal, no alert.
          STATE_WARNING   - state machine says Active, but either (a) the
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
          STATE_CONFIRMED - state machine says Active AND the window looks
                            like active locomotion AND clears the stricter
                            CONFIRMED-tier motion bar - full haptic+laser.

        The yaw gate (if enabled) still runs first and can force fog_score
        to 0.0, same as before - that can only ever prevent Active from
        triggering, never affect which of WARNING/CONFIRMED an Active
        decision gets."""
        raw_acc = packet[f"{self.foot}_raw_acc"].reshape(1, 3)
        remapped = self.calibration.remap(raw_acc)
        normalized = self.calibration.normalize(remapped)[0].astype(np.float32)  # [3]
        window = self.windower.push(normalized)

        yaw_window = None
        if self.yaw_gate_enabled:
            raw_gyro = packet[f"{self.foot}_raw_gyro"].reshape(1, 3)
            yaw_sample = self.calibration.extract_gyro_yaw(raw_gyro).astype(np.float32)  # [1]
            yaw_window = self.yaw_windower.push(yaw_sample)

        if window is None:
            return None  # main windower gates the pace - both windowers share window/hop config

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

        if self.yaw_gate_enabled and yaw_window is not None:
            yaw_rom = float(yaw_window[:, 0].max() - yaw_window[:, 0].min())
            if yaw_rom > self.yaw_gate_threshold_dps:
                fog_score = 0.0  # suppress: this window's rotation looks like active
                                  # turning, not a freeze - see the physiological check
                                  # in test_yaw_gate.py's docstring

        active = self.state_machine.update(fog_score)
        if not active:
            self.last_state = STATE_NORMAL
            return STATE_NORMAL
        if not is_active_walking(window):
            self.last_state = STATE_WARNING
            return STATE_WARNING
        # is_active_walking passed - a SECOND, stricter motion check now
        # decides WARNING vs CONFIRMED (never NORMAL, so the floor above is
        # untouched): catches ordinary Sit/Stand/Sit-to-Stand/Stand-to-Sit
        # postural motion that clears is_active_walking's own looser bar
        # without being real locomotion - see motion_gate.py's
        # CONFIRMED_TIER_MOTION_ENERGY_THRESHOLD docstring for why/how this
        # was validated (scripts/warning_floor_gate_investigation.py).
        self.last_state = STATE_CONFIRMED if is_confirmed_grade_motion(window) else STATE_WARNING
        return self.last_state
