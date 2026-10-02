"""Insole-pressure FoG rules layered AFTER the RF/CNN decision.

The model and its IMU gates never see pressure (the public training data has none),
so nothing validated there changes. These rules only ADD detections or upgrade a
WARNING; every rule has its own on/off switch in pressure_rules_config.json.

Per foot there are two FSRs: forefoot (GPIO34 -> pressure_raw[0]) and heel
(GPIO35 -> pressure_raw[2]). Values are divided by the wearer's own quiet-standing
level captured during the 25 s calibration, so sensor-to-sensor sensitivity
differences cancel out (1.0 = "as loaded as when standing still").

Rules (numbers in pressure_rules_config.json, tuned on the 2026-09-30 insole recording):
  forefoot_load     heel < 60% and forefoot >= 50% of standing for >= 2 s       -> CONFIRMED
  post_walk_tremor  after walking, feet planted but forefoot pressure jitters    -> WARNING upgraded to CONFIRMED
  shuffle           both feet stepping, last 3 stride times all < 60% of the calibration stride      -> WARNING
  start_hesitation  standing, weight rocks back and forth, no step for >= 2 s    -> CONFIRMED
  rhythm_irregular  both feet stepping, stride-time CV >= 0.35 (and 2x calibration CV) on 3 steps in a row           -> WARNING
"""
from __future__ import annotations

import json
from collections import deque
from pathlib import Path

import numpy as np

CONFIG_PATH = Path(__file__).with_name('pressure_rules_config.json')
DEFAULTS = {
    'enabled': True,
    # Set true for a foot whose forefoot/heel wires are swapped (GPIO34 on the heel).
    'swap_front_heel': {'left': False, 'right': False},
    'min_baseline_raw': 150,          # a sensor quieter than this while standing is treated as unusable
    'contact_on': 0.5,                # forefoot/standing ratio that counts as "loaded"
    'contact_off': 0.15,              # ... and as "unloaded" (hysteresis)
    'min_off_sec': 0.1,               # an unload shorter than this is noise, not a step
    'rules': {
        'forefoot_load': {'enabled': True, 'front_min': 0.5, 'heel_max': 0.6, 'hold_sec': 2.0},
        'post_walk_tremor': {'enabled': True, 'window_sec': 2.0, 'planted_min': 0.3, 'jitter_min': 0.08,
                             'walked_within_sec': 8.0, 'min_recent_steps': 2, 'no_step_sec': 1.0},
        'shuffle': {'enabled': True, 'ratio': 0.6, 'strides': 3, 'recent_step_sec': 1.5, 'bilateral_within_sec': 2.0},
        'start_hesitation': {'enabled': True, 'window_sec': 3.0, 'reversal_step': 0.12, 'min_reversals': 2,
                             'min_range': 0.25, 'planted_min': 0.3, 'no_step_sec': 2.0, 'hold_sec': 1.0},
        'rhythm_irregular': {'enabled': True, 'strides': 5, 'cv_min': 0.35, 'cv_baseline_factor': 2.0,
                             'confirm_updates': 3, 'recent_step_sec': 1.5, 'bilateral_within_sec': 2.0},
    },
}
SIDES = ('left', 'right')
SEVERITY = {None: 0, 'normal': 0, 'warning': 1, 'confirmed': 2}
RULE_STATE = {'forefoot_load': 'confirmed', 'start_hesitation': 'confirmed', 'shuffle': 'warning',
              'rhythm_irregular': 'warning', 'post_walk_tremor': 'confirmed'}


def load_config(path=CONFIG_PATH):
    config = json.loads(json.dumps(DEFAULTS))
    try:
        user = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return config
    for key, value in user.items():
        if key == 'rules' and isinstance(value, dict):
            for name, rule in value.items():
                if name in config['rules'] and isinstance(rule, dict):
                    config['rules'][name].update(rule)
        elif key == 'swap_front_heel' and isinstance(value, dict):
            config['swap_front_heel'].update({s: bool(v) for s, v in value.items() if s in SIDES})
        elif key in config:
            config[key] = value
    return config


def front_heel(payload, side, config):
    """(forefoot_raw, heel_raw) from an ESP32 /api/state payload, or None."""
    raw = payload.get('pressure_raw')
    if payload.get('pressure_ready') is False or not isinstance(raw, list) or len(raw) < 4:
        return None
    try:
        front, heel = (float(raw[0]) + float(raw[1])) / 2, (float(raw[2]) + float(raw[3])) / 2
    except (TypeError, ValueError):
        return None
    if not (np.isfinite(front) and np.isfinite(heel)):
        return None
    return (heel, front) if config['swap_front_heel'].get(side) else (front, heel)


def contact_steps(times, front_ratio, config):
    """Step times = forefoot unloaded -> loaded transitions (hysteresis, min unload time)."""
    steps, loaded, off_since = [], True, None
    for t, f in zip(times, front_ratio):
        if loaded and f < config['contact_off']:
            loaded, off_since = False, t
        elif not loaded and f > config['contact_on']:
            loaded = True
            if t - off_since >= config['min_off_sec']:
                steps.append(t)
    return steps


def stride_stats(steps):
    intervals = np.diff(steps)
    intervals = intervals[(intervals >= 0.3) & (intervals <= 3.0)]  # drop turns/pauses and glitches
    if len(intervals) < 3:
        return None, None
    median = float(np.median(intervals))
    return median, float(np.std(intervals) / np.mean(intervals))


def baseline_from_rows(rows, config=None, still_sec=5.0):
    """rows: [(t_sec, forefoot_raw, heel_raw)] from the 25 s calibration (5 s still + 20 s walk)."""
    config = config or load_config()
    if len(rows) < 20:
        return None
    arr = np.asarray(rows, dtype=float)
    t = arr[:, 0] - arr[0, 0]
    still = arr[(t >= 1.0) & (t <= still_sec - 0.5)]
    walk = arr[t >= still_sec + 1.0]
    if len(still) < 5:
        return None
    front_still, heel_still = float(np.median(still[:, 1])), float(np.median(still[:, 2]))
    minimum = config['min_baseline_raw']
    result = {'front_still': front_still, 'heel_still': heel_still,
              'front_ok': front_still >= minimum, 'heel_ok': heel_still >= minimum,
              'stride_median': None, 'stride_cv': None, 'steps': 0}
    # Steps come from whichever FSR fully unloads during the walk: in a snug shoe one of
    # the two often stays pre-loaded (2026-10-01: right forefoot never below 40%).
    best = None
    for name, column, still_value, ok in (('front', 1, front_still, result['front_ok']), ('heel', 2, heel_still, result['heel_ok'])):
        if not ok or len(walk) < 20:
            continue
        steps = contact_steps(walk[:, 0], walk[:, column] / still_value, config)
        median, cv = stride_stats(steps)
        # Prefer the sensor whose strides are most regular (a shifting FSR gives noisy steps).
        if median is not None and len(steps) >= 5 and (best is None or cv < best[3]):
            best = (name, len(steps), median, cv)
    if best:
        result['step_sensor'], result['steps'], result['stride_median'], result['stride_cv'] = best
    return result


class _Foot:
    def __init__(self):
        self.baseline = None
        self.reset()

    def reset(self):
        self.samples = deque()      # (t, front_ratio, heel_ratio)
        self.loaded, self.off_since = True, None
        self.steps = deque(maxlen=20)
        self.irregular_updates = 0
        self.last_step_checked = None


class PressureRules:
    def __init__(self, config=None):
        self.config = config or load_config()
        self.feet = {side: _Foot() for side in SIDES}
        self.since = {}             # rule/foot condition start times for hold_sec
        self.last = {'state': None, 'rules': {}, 'reasons': []}

    # ---------------------------------------------------------------- input --
    def set_baseline(self, side, baseline):
        self.feet[side].baseline = baseline if isinstance(baseline, dict) else None
        self.reset_side(side)

    def reset_side(self, side):
        self.feet[side].reset()
        self.since.clear()
        self.last = {'state': None, 'rules': {}, 'reasons': []}

    def reset(self):
        for foot in self.feet.values():
            foot.reset()
        self.since.clear()
        self.last = {'state': None, 'rules': {}, 'reasons': []}

    def push(self, side, t, front_raw, heel_raw):
        foot = self.feet[side]
        b = foot.baseline
        if not b or not b.get('front_ok'):
            return
        if foot.samples and t <= foot.samples[-1][0]:
            return
        if foot.samples and t - foot.samples[-1][0] > 1.0:
            self.reset_side(side)
        f = front_raw / b['front_still']
        h = heel_raw / b['heel_still'] if b.get('heel_ok') else None
        foot.samples.append((t, f, h))
        while foot.samples and t - foot.samples[0][0] > 10.0:
            foot.samples.popleft()
        c = self.config
        contact = h if b.get('step_sensor') == 'heel' and h is not None else f
        if foot.loaded and contact < c['contact_off']:
            foot.loaded, foot.off_since = False, t
        elif not foot.loaded and contact > c['contact_on']:
            foot.loaded = True
            if t - foot.off_since >= c['min_off_sec']:
                foot.steps.append(t)

    # ------------------------------------------------------------- helpers --
    def _window(self, foot, now, sec):
        return [s for s in foot.samples if now - s[0] <= sec]

    def _held(self, key, condition, now, hold):
        if not condition:
            self.since.pop(key, None)
            return False
        start = self.since.setdefault(key, now)
        return now - start >= hold

    def _usable(self, now):
        return [s for s, foot in self.feet.items()
                if foot.baseline and foot.baseline.get('front_ok') and foot.samples and now - foot.samples[-1][0] <= 1.0]

    # ------------------------------------------------------------- rules --
    def _forefoot_load(self, now, sides):
        r = self.config['rules']['forefoot_load']
        hits = []
        for side in sides:
            foot = self.feet[side]
            if not foot.baseline.get('heel_ok'):
                continue
            # Sample-based hold: >= 90% of the last hold_sec of samples are forefoot-only
            # (independent of how often evaluate() runs, tolerant of single glitches).
            w = self._window(foot, now, r['hold_sec'])
            if not w or now - w[0][0] < r['hold_sec'] - 0.15:
                continue
            ok = sum(1 for s in w if s[1] >= r['front_min'] and s[2] < r['heel_max'])
            if ok >= 0.9 * len(w):
                hits.append(side)
        return hits

    def _walking_bilaterally(self, side, sides, now, within):
        """True when every other usable foot also stepped recently (real gait, not one foot tapping)."""
        return all(self.feet[o].steps and now - self.feet[o].steps[-1] <= within for o in sides if o != side)

    def _last_step(self, sides):
        times = [self.feet[s].steps[-1] for s in sides if self.feet[s].steps]
        return max(times) if times else None

    def _post_walk_tremor(self, now, sides):
        r = self.config['rules']['post_walk_tremor']
        last = self._last_step(sides)
        recent_steps = sum(1 for s in sides for t in self.feet[s].steps if now - t <= r['walked_within_sec'])
        if last is None or now - last < r['no_step_sec'] or recent_steps < r['min_recent_steps']:
            return []
        hits = []
        for side in sides:
            w = self._window(self.feet[side], now, r['window_sec'])
            if len(w) < 10:
                continue
            f = np.array([s[1] for s in w])
            jitter = float(np.sqrt(np.mean(np.diff(f) ** 2)))
            if f.min() >= r['planted_min'] and jitter >= r['jitter_min']:
                hits.append(side)
        return hits

    def _shuffle(self, now, sides):
        r = self.config['rules']['shuffle']
        hits = []
        for side in sides:
            foot = self.feet[side]
            ref = foot.baseline.get('stride_median')
            steps = list(foot.steps)
            if (not ref or len(steps) < r['strides'] + 1 or now - steps[-1] > r['recent_step_sec']
                    or not self._walking_bilaterally(side, sides, now, r['bilateral_within_sec'])):
                continue
            intervals = np.diff(steps[-(r['strides'] + 1):])
            if (intervals < r['ratio'] * ref).all() and (intervals >= 0.2).all():
                hits.append(side)
        return hits

    def _start_hesitation(self, now, sides):
        r = self.config['rules']['start_hesitation']
        last = self._last_step(sides)
        planted = True
        rocking = []
        for side in sides:
            w = self._window(self.feet[side], now, r['window_sec'])
            if len(w) < 10:
                planted = False
                continue
            f = np.array([s[1] for s in w])
            planted &= bool(f.min() >= r['planted_min'])
            # Load index: forefoot + heel (heel only when that sensor is usable).
            load = np.array([(s[1] + s[2]) / 2 if s[2] is not None else s[1] for s in w])
            if load.max() - load.min() < r['min_range']:
                continue
            # Zig-zag count: each swing of at least reversal_step against the current
            # direction is one reversal (down-up-down = 2).
            reversals, direction, hi, lo, step = 0, 0, load[0], load[0], r['reversal_step']
            for value in load[1:]:
                if direction == 0:
                    hi, lo = max(hi, value), min(lo, value)
                    if hi - value >= step:
                        direction, lo = -1, value
                    elif value - lo >= step:
                        direction, hi = 1, value
                elif direction == 1:
                    if value > hi:
                        hi = value
                    elif hi - value >= step:
                        direction, lo, reversals = -1, value, reversals + 1
                else:
                    if value < lo:
                        lo = value
                    elif value - lo >= step:
                        direction, hi, reversals = 1, value, reversals + 1
            if reversals >= r['min_reversals']:
                rocking.append(side)
        still_feet = last is None or now - last >= r['no_step_sec']
        ok = self._held(('start_hesitation',), bool(sides) and planted and still_feet and bool(rocking), now, r['hold_sec'])
        return rocking if ok else []

    def _rhythm_irregular(self, now, sides):
        r = self.config['rules']['rhythm_irregular']
        hits = []
        for side in sides:
            foot = self.feet[side]
            steps = list(foot.steps)
            if (len(steps) < r['strides'] + 1 or now - steps[-1] > r['recent_step_sec']
                    or not self._walking_bilaterally(side, sides, now, r['bilateral_within_sec'])):
                foot.irregular_updates = 0
                continue
            if foot.last_step_checked != steps[-1]:
                foot.last_step_checked = steps[-1]
                intervals = np.diff(steps[-(r['strides'] + 1):])
                cv = float(np.std(intervals) / np.mean(intervals))
                base_cv = foot.baseline.get('stride_cv') or 0.0
                irregular = cv >= max(r['cv_min'], r['cv_baseline_factor'] * base_cv)
                foot.irregular_updates = foot.irregular_updates + 1 if irregular else 0
            if foot.irregular_updates >= r['confirm_updates']:
                hits.append(side)
        return hits

    # ------------------------------------------------------------ decision --
    def evaluate(self, now, ai_state=None):
        """Returns {'state', 'rules': {name: [sides]}, 'reasons': [names that changed the output]}."""
        if not self.config.get('enabled', True):
            self.last = {'state': None, 'rules': {}, 'reasons': [], 'enabled': False}
            return self.last
        sides = self._usable(now)
        checks = {'forefoot_load': self._forefoot_load, 'post_walk_tremor': self._post_walk_tremor,
                  'shuffle': self._shuffle, 'start_hesitation': self._start_hesitation,
                  'rhythm_irregular': self._rhythm_irregular}
        rules = {}
        for name, check in checks.items():
            rules[name] = check(now, sides) if self.config['rules'][name].get('enabled', True) and sides else []
        state, reasons = None, []
        for name, hit in rules.items():
            if not hit:
                continue
            level = RULE_STATE[name]
            if name == 'post_walk_tremor' and ai_state != 'warning':
                continue  # upgrade-only rule: pressure tremor confirms what the model already flagged
            reasons.append(name)
            if SEVERITY[level] > SEVERITY[state]:
                state = level
        self.last = {'state': state, 'rules': rules, 'reasons': reasons, 'enabled': True,
                     'usable_feet': sides}
        return self.last

    def snapshot(self):
        baselines = {s: f.baseline for s, f in self.feet.items()}
        return {**self.last, 'baselines': baselines,
                'switches': {n: bool(r.get('enabled', True)) for n, r in self.config['rules'].items()},
                'swap_front_heel': dict(self.config['swap_front_heel'])}
