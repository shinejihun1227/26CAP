"""Per-wearer AI thresholds from the calibration walk (never lower than the validated ones).

The public-data model scores this insole's ordinary walking higher than the datasets'
sensors (2026-09-30 recording: right foot walking up to 0.37 vs the 0.26 entry), so
normal walking kept raising WARNING. After the 25 s calibration the 20 s walk is scored
with the wearer's new calibration and the entry threshold is raised just above that
foot's own walking scores. It can only RAISE the thresholds; with too few walk windows
the validated defaults stay. Tuned on the StepOn recording only (no public-data check).
"""
from __future__ import annotations

import numpy as np

SETTINGS = {'quantile': 0.95, 'margin': 0.03, 'max_enter': 0.45, 'confirmed_gap': 0.10,
            'max_confirmed': 0.60, 'min_windows': 10}


def personal_thresholds(walk_scores, base_enter, base_confirmed, settings=SETTINGS):
    """-> {'enter', 'confirmed', 'walk_q', 'windows'} or None when the walk was too short."""
    scores = np.asarray([s for s in walk_scores if s is not None and np.isfinite(s)], dtype=float)
    if len(scores) < settings['min_windows']:
        return None
    q = float(np.quantile(scores, settings['quantile']))
    enter = min(settings['max_enter'], max(base_enter, q + settings['margin']))
    confirmed = base_confirmed
    if base_confirmed is not None:
        confirmed = min(settings['max_confirmed'], max(base_confirmed, enter + settings['confirmed_gap']))
    return {'enter': round(enter, 4), 'confirmed': None if confirmed is None else round(confirmed, 4),
            'walk_q': round(q, 4), 'quantile': settings['quantile'], 'windows': int(len(scores))}


def apply(detector, profile, exit_margin):
    """Raise a LiveFogDetector's entry/confirmed thresholds to a stored profile."""
    if not profile or detector is None:
        return False
    sm = detector.state_machine
    enter = max(sm.enter_threshold, float(profile['enter']))
    sm.enter_threshold, sm.exit_threshold = enter, max(0.0, enter - exit_margin)
    if detector.confirmed_threshold is not None and profile.get('confirmed') is not None:
        detector.confirmed_threshold = max(detector.confirmed_threshold, float(profile['confirmed']))
    return True
