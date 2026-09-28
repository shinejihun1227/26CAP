"""Live-only FoG output leases. CSV replay never starts this worker."""
import json
import threading
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def wants_cue(foot, enabled=True, collecting=False, now_ms=None):
    now_ms = time.time() * 1000 if now_ms is None else now_ms
    timestamp = foot.get('last_window_at_ms')
    return bool(enabled and not collecting and foot.get('ready') and foot.get('device_connected')
                and foot.get('state') == 'confirmed' and isinstance(timestamp, (int, float))
                and 0 <= now_ms - timestamp <= 2000 and foot.get('device_id') and foot.get('boot_id'))


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

    def snapshot(self):
        with self.lock:
            return {'enabled': self.enabled, 'mode': 'while_confirmed', 'lease_ms': 1500,
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

    def send(self, side, foot, active):
        value = {'active': active, 'device_id': foot.get('device_id'), 'boot_id': foot.get('boot_id')}
        if self.bridge.esp32_url:
            query = urlencode({**value, 'active': int(active)})
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
            capture = self.bridge.datasets.capture or {}
            collecting = capture.get('status') in ('countdown', 'recording')
        with self.lock:
            active = wants_cue(foot, self.enabled, collecting)
        if not foot.get('device_connected'):
            with self.lock:
                self.feet[side] = {'requested': False, 'acknowledged': False, 'status': 'offline', 'error': None}
            return
        try:
            # Renew every 400ms while confirmed; off commands also clear old leases
            # after service restart, calibration, cancellation or a normal result.
            self.send(side, foot, active)
            result = {'requested': active, 'acknowledged': True, 'status': 'active' if active else 'off', 'error': None}
        except Exception as exc:
            result = {'requested': active, 'acknowledged': False, 'status': 'error',
                      'error': f'출력 연결을 확인하세요. 최신 펌웨어가 필요할 수 있어요. ({exc})'}
        with self.lock:
            self.feet[side] = result

    def run(self, side):
        while not self.stop_event.is_set():
            self.tick(side)
            self.stop_event.wait(0.4)
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
        for worker in self.workers:
            worker.join(timeout=2)
