"""Hysteresis debouncer turning a per-window fog probability stream into a
stable Active/Normal decision - the missing piece between "a window's raw
model score" and "should the haptic/laser actually fire right now."

Mechanism ported UNCHANGED from the 3차 검증 state-machine round
(3차결과_상태머신.zip: step3_statemachine/runA.py's run_state_machine()):

    Normal --(N consecutive windows with score >= enter_threshold)--> Active
    Active --(ONE window with score < exit_threshold)--> Normal

Asymmetric on purpose: cautious to enter (debounced against single-window
noise), quick to release.

WHAT DID NOT PORT: that round's actual tuned numbers (enter 0.70-0.80 with
N=1-6, margin 0.05-0.25) were fit against a DIFFERENT risk score - a
5-feature (FI/logBandPower/SpectralEntropy/StepCV/JerkRMS) logistic
regression from an earlier pipeline (step3_window), not this project's
current RF/CNN 3-class softmax fog probability. Scale does not transfer
across differently-trained scores - the same lesson this project already
learned the hard way about cross-dataset FI scale, and about Youden's J
tuned on the wrong subpopulation. Porting the OLD NUMBERS onto the NEW score
would silently misfire (likely almost always "Active", or almost never -
no way to know without checking, so don't guess).

What IS carried over honestly: scripts/train_final_model.py sets
enter_threshold to THIS pipeline's own validated operating point (Youden's J
tuned on PD_only val - see evaluate.py). n_consecutive/exit_margin are
reasonable ported defaults, NOT re-swept against the new score - a real 3D
sweep (same method as runA.py, just pointed at this pipeline's fog
probability instead of the old risk score) should replace them before any
number derived from this state machine goes on a poster.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class FogStateMachine:
    enter_threshold: float
    exit_threshold: float
    n_consecutive: int = 2
    _consec_count: int = 0
    _active: bool = False

    def update(self, score: float) -> bool:
        """Feed one new window's fog score in. Returns the Active state
        AFTER this update (True = fire/hold haptic+laser, False = clear)."""
        if not self._active:
            self._consec_count = self._consec_count + 1 if score >= self.enter_threshold else 0
            if self._consec_count >= self.n_consecutive:
                self._active = True
                self._consec_count = 0
        else:
            if score < self.exit_threshold:
                self._active = False
                self._consec_count = 0
        return self._active

    def reset(self) -> None:
        self._active = False
        self._consec_count = 0
