"""Live-only FoG output leases. CSV replay never starts this worker.

One combined decision (AI + pressure rules, see BridgeState.cue_plan) drives BOTH
insoles: CONFIRMED = strong vibration + laser, WARNING = weak vibration only.
A triple stomp (BridgeState.dismiss) silences both feet for 5 s.
"""
import json
import threading
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def wants_cue(foot, plan, enabled=True, collecting=False):
    """Should this foot output now? -> (active, level, laser)."""
    if not (enabled and not collecting and plan.get('state') and foot.get('device_connected')
            and foot.get('device_id') and foot.get('boot_id')):
        return False, 0, False
    if plan['state'] == 'warning' and not foot.get('cue_level_supported'):
        return False, 0, False  # old firmware can only do full strength + laser; keep WARNING silent there
    return True, int(plan['level']), bool(plan['laser'])


class FogCueController:
    def __init__(self, bridge, data_dir):
        self.bridge = bridge
        self.path = Path(data_dir) / 'fog-cue-settings.json'
        self.enabled = True
        try:
            self.enabled = json.loads(self.path.read_text(encoding='utf-8')).get('enabled') is True
        except FileNotFoundError:
            pass
        except (ValueError, OSError):
            self.enabled = False
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.workers = []
        self.feet = {}
        self.wake = {side: threading.Event() for side in bridge.feet}

    def request_sync(self):
        """Wake the lease workers; each worker rechecks the latest decision and stops."""
        for event in self.wake.values():
            event.set()

    def snapshot(self):
        with self.lock:
            return {'enabled': self.enabled, 'mode': 'both_feet_combined_decision', 'lease_ms': 1500,
                    'levels': {'confirmed': 70, 'warning': 30},
                    'feet': {side: dict(value) for side, value in self.feet.items()}}

    def set_enabled(self, enabled):
        if not isinstance(enabled, bool):
            raise ValueError('enabled must be boolean')
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            pending = self.path.with_suffix('.pending')
            pending.write_text(json.dumps({'enabled': enabled}), encoding='utf-8')
            pending.replace(self.path)
            self.enabled = enabled
        self.request_sync()

    def send(self, side, foot, active, level=70, laser=True):
        value = {'active': active, 'device_id': foot.get('device_id'), 'boot_id': foot.get('boot_id')}
        if foot.get('cue_level_supported'):
            value.update(level=level, laser=laser)
        if self.bridge.esp32_url:
            query = urlencode({**value, 'active': int(active), **({'laser': int(laser)} if 'laser' in value else {})})
            request = Request(f'{self.bridge.esp32_url}/api/fog-cue?{query}')
        else:
            body = json.dumps({'side': side, 'action': 'fog-cue', 'value': value}).encode()
            request = Request(f'{self.bridge.hub_url}/api/insoles/command', data=body,
                              headers={'Content-Type': 'application/json'}, method='POST')
        with urlopen(request, timeout=0.8) as response:
            result = json.loads(response.read(8192))
        if result.get('cue_api_version') != 1 or result.get('accepted') is not True:
            raise ValueError('FoG 출력용 최신 펌웨어를 업로드해 주세요.')
        return result

    def tick(self, side):
        with self.bridge.lock:
            foot = self.bridge.feet[side].snapshot()
            plan = self.bridge.cue_plan()
            capture = self.bridge.datasets.capture or {}
            collecting = capture.get('status') in ('countdown', 'recording')
        with self.lock:
            active, level, laser = wants_cue(foot, plan, self.enabled and getattr(self.bridge, 'detection_enabled', True), collecting)
        if not foot.get('device_connected'):
            with self.lock:
                self.feet[side] = {'requested': False, 'acknowledged': False, 'status': 'offline', 'error': None}
            return
        try:
            # Renew every 400ms while a cue is wanted; off commands also clear old leases
            # after service restart, calibration, dismissal, cancellation or a normal result.
            ack = self.send(side, foot, active, level, laser)
            accepted_laser = bool(ack.get('laser', laser)) if active else False
            accepted_vibration = bool(ack.get('vibration', level > 0)) if active else False
            missing = []
            if active and laser and not accepted_laser:
                missing.append('레이저')
            if active and level > 0 and not accepted_vibration:
                missing.append('진동')
            result = {'requested': active, 'acknowledged': True, 'status': 'active' if active else 'off',
                      'level': ack.get('level', level) if active else 0, 'laser': accepted_laser,
                      'vibration': accepted_vibration,
                      'cue_state': plan['state'] if active else None, 'suppressed': plan.get('suppressed', False),
                      'error': f'{"·".join(missing)} 출력을 사용할 수 없어요. 기기 설정에서 연결을 확인하세요.' if missing else None}
        except Exception as exc:
            result = {'requested': active, 'acknowledged': False, 'status': 'error',
                      'error': f'출력 연결을 확인하세요. 최신 펌웨어가 필요할 수 있어요. ({exc})'}
        with self.lock:
            self.feet[side] = result

    def run(self, side):
        while not self.stop_event.is_set():
            self.wake[side].clear()
            self.tick(side)
            self.wake[side].wait(0.4)
        # The board also expires its lease if this best-effort stop cannot arrive.
        try:
            with self.bridge.lock:
                foot = self.bridge.feet[side].snapshot()
            if foot.get('device_connected'):
                self.send(side, foot, False)
        except Exception:
            pass

    def start(self):
        for side in self.bridge.feet:
            worker = threading.Thread(target=self.run, args=(side,), daemon=True)
            self.workers.append(worker)
            worker.start()

    def close(self):
        self.stop_event.set()
        self.request_sync()
        for worker in self.workers:
            worker.join(timeout=2)
