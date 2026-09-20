"""Private CSV recordings and isolated, bounded offline analysis jobs."""
from __future__ import annotations

import csv
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
import uuid

if __package__:
    from .csv_pipeline import COLUMNS, MAX_ROWS, metadata, validate_pair, write_json
else:
    from csv_pipeline import COLUMNS, MAX_ROWS, metadata, validate_pair, write_json

BODY_LIMIT = 20 * 1024 * 1024
DOWNLOADS = {'measurement.csv', 'calibration.csv', 'windows.csv', 'result.json', 'calibration.json', 'manifest.json', 'recording.csv'}


class DatasetService:
    def __init__(self, data_dir, artifact_dir, artifact_id, model):
        self.root = Path(data_dir) / 'datasets'
        self.artifact_dir, self.artifact_id, self.model = Path(artifact_dir), artifact_id, model
        self.lock = threading.RLock()
        self.process = None
        self.active_job = None
        self.capture = None
        self.output = None
        self.writer = None

    def path(self, identifier):
        if not re.fullmatch(r'[0-9a-f]{32}', identifier):
            raise ValueError('invalid_dataset_id')
        return self.root / identifier

    def manifest(self, identifier):
        path = self.path(identifier) / 'manifest.json'
        if not path.is_file():
            raise ValueError('dataset_not_found')
        result = json.loads(path.read_text(encoding='utf-8'))
        # A process restart cannot turn incomplete data into a completed run.
        if result['status'] in ('running', 'countdown', 'recording') and identifier not in (self.active_job, (self.capture or {}).get('id')):
            result.update(status='interrupted', error='프로그램이 종료되어 작업이 중단되었습니다. 다시 시작해 주세요.')
        return result

    def list(self):
        self.tick()
        with self.lock:
            files = sorted(self.root.glob('*/manifest.json'), key=lambda p: p.stat().st_mtime, reverse=True)[:20]
            items = []
            for file in files:
                try:
                    items.append(self.manifest(file.parent.name))
                except (ValueError, OSError):
                    continue
            return {'items': items, 'active_recording': self.capture['id'] if self.capture and self.capture['status'] in ('countdown', 'recording') else None,
                    'active_job': self.active_job}

    def status(self, identifier):
        self.tick()
        with self.lock:
            result = self.manifest(identifier)
            if self.capture and self.capture['id'] == identifier:
                result = dict(self.capture)
                if result['status'] == 'countdown':
                    result['countdown_s'] = max(0, self.starts_at - time.monotonic())
            if result['kind'] == 'analysis' and result['status'] == 'complete':
                report = json.loads((self.path(identifier) / 'result.json').read_text(encoding='utf-8'))
                result['result'] = {k: v for k, v in report.items() if k != 'windows'}
            return result

    def validate(self, body):
        calibration, measurement, cal = validate_pair(body)
        return {'calibration': calibration.quality, 'measurement': measurement.quality,
                'metadata': measurement.context,
                'calibration_confidence': {'vertical': cal['vertical_confidence'], 'forward': cal['forward_confidence']},
                'gap_policy': '100ms 초과 누락 뒤에는 이전 판단을 버리고 새 4초 창부터 분석합니다.'}

    def analyze(self, body):
        with self.lock:
            self.tick()
            if self.active_job:
                raise ValueError('이미 CSV를 분석 중입니다. 현재 작업이 끝난 뒤 시작하세요.')
            if self.capture and self.capture['status'] in ('countdown', 'recording'):
                raise ValueError('실제 데이터 수집을 마친 뒤 CSV 분석을 시작하세요.')
            calibration, measurement, cal = validate_pair(body)
            identifier = uuid.uuid4().hex
            folder = self.path(identifier)
            folder.mkdir(parents=True)
            (folder / 'source-calibration.csv').write_text(body['calibration_csv'], encoding='utf-8', newline='')
            (folder / 'source-measurement.csv').write_text(body['measurement_csv'], encoding='utf-8', newline='')
            (folder / 'calibration.csv').write_text(calibration.csv_text(), encoding='utf-8-sig', newline='')
            (folder / 'measurement.csv').write_text(measurement.csv_text(), encoding='utf-8-sig', newline='')
            write_json(folder / 'calibration.json', cal)
            manifest = {'id': identifier, 'kind': 'analysis', 'status': 'running', 'created_at_ms': int(time.time()*1000),
                        'metadata': measurement.context, 'model': self.model, 'artifact_id': self.artifact_id,
                        'calibration_quality': calibration.quality, 'measurement_quality': measurement.quality,
                        'progress': 0, 'error': None}
            write_json(folder / 'manifest.json', manifest)
            self.active_job = identifier
            try:
                # A separate process keeps replay's model and temporal state away from live inference.
                with (folder / 'worker.log').open('wb') as log:
                    self.process = subprocess.Popen([sys.executable, str(Path(__file__).with_name('dataset_worker.py')),
                                                     str(folder), str(self.artifact_dir)], stdout=log, stderr=log,
                                                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            except OSError:
                self.active_job = None
                manifest.update(status='failed', error='분석 프로세스를 시작할 수 없습니다. Python 환경을 확인하세요.')
                write_json(folder / 'manifest.json', manifest)
                raise ValueError(manifest['error'])
            return manifest

    def start_recording(self, body, runtime):
        context = metadata(body)
        purpose = body.get('purpose')
        if purpose not in ('calibration', 'measurement'):
            raise ValueError('purpose: calibration 또는 measurement가 필요합니다.')
        duration = 25 if purpose == 'calibration' else body.get('duration_s', 60)
        if isinstance(duration, bool) or not isinstance(duration, int) or not 10 <= duration <= 600:
            raise ValueError('측정 시간은 10~600초 정수입니다.')
        with self.lock:
            self.tick()
            if self.capture and self.capture['status'] in ('countdown', 'recording'):
                raise ValueError('이미 데이터를 수집 중입니다.')
            if self.active_job:
                raise ValueError('CSV 분석이 끝난 뒤 데이터 수집을 시작하세요.')
            snap = runtime.snapshot()
            if not snap['device_connected'] or not runtime.identity or runtime.error:
                raise ValueError('먼저 웹의 기기 연결에서 해당 발의 실제 IMU를 연결하세요.')
            if snap.get('capture', {}).get('status') in ('countdown', 'recording'):
                raise ValueError('실시간 개인 보정이 끝난 뒤 수집을 시작하세요.')
            context.update(device_id=runtime.identity[0], boot_id=runtime.identity[1])
            identifier = uuid.uuid4().hex
            folder = self.path(identifier)
            folder.mkdir(parents=True)
            self.output = (folder / 'recording.csv').open('w', encoding='utf-8-sig', newline='')
            self.writer = csv.writer(self.output)
            self.writer.writerow(COLUMNS)
            self.output.flush()
            self.capture = {'id': identifier, 'kind': 'recording', 'purpose': purpose, 'status': 'countdown',
                            'metadata': context, 'duration_s': duration, 'rows': 0, 'elapsed_s': 0,
                            'created_at_ms': int(time.time()*1000), 'starts_at_ms': int((time.time()+3)*1000),
                            'error': None}
            self.starts_at = time.monotonic() + 3
            self.last_received = time.monotonic()
            self.first_t = self.last_t = None
            self.last_flush = time.monotonic()
            self._save_capture()
            return dict(self.capture)

    def _save_capture(self):
        write_json(self.path(self.capture['id']) / 'manifest.json', self.capture)

    def finish_recording(self, identifier, error=None):
        with self.lock:
            if not self.capture or self.capture['id'] != identifier:
                raise ValueError('active_recording_not_found')
            if self.capture['status'] not in ('countdown', 'recording'):
                return dict(self.capture)
            if self.capture['purpose'] == 'calibration' and self.capture['elapsed_s'] < 24.9:
                error = error or '25초 보정 동작을 완료하지 못했습니다. 다시 기록하세요.'
            if self.capture['rows'] < 2:
                error = error or '기록된 센서 데이터가 없습니다.'
            self.capture.update(status='failed' if error else 'complete', error=error)
            if self.output:
                self.output.close()
                self.output = None
            self._save_capture()
            return dict(self.capture)

    def ingest(self, side, payload):
        with self.lock:
            c = self.capture
            if not c or c['status'] not in ('countdown', 'recording') or c['metadata']['side'] != side:
                return
            if (payload.get('device_id'), payload.get('boot_id', 'legacy')) != (c['metadata']['device_id'], c['metadata']['boot_id']):
                self.finish_recording(c['id'], '장치 또는 부팅이 변경되었습니다. 파일을 나누어 다시 기록하세요.')
                return
            now = time.monotonic()
            self.last_received = now
            if now < self.starts_at:
                return
            t = payload['millis']
            if self.last_t is not None and (t <= self.last_t or t - self.last_t > 100.000001):
                self.finish_recording(c['id'], '100ms 초과 누락 또는 시각 역순이 발생했습니다. 연결을 확인하고 다시 기록하세요.')
                return
            if self.first_t is None:
                self.first_t = t
            self.last_t = t
            elapsed = (t - self.first_t) / 1000
            label = ('calibration_still' if elapsed < 5 else 'calibration_walk') if c['purpose'] == 'calibration' else 'unlabeled'
            self.writer.writerow([t, *(payload[k][axis] for k in ('accel', 'gyro') for axis in 'xyz'),
                                  *(c['metadata'][k] for k in ('device_id', 'boot_id', 'side', 'participant_id', 'session_id', 'placement')), label])
            c.update(status='recording', rows=c['rows']+1, elapsed_s=round(elapsed, 3))
            if elapsed >= c['duration_s'] or c['rows'] >= MAX_ROWS:
                self.finish_recording(c['id'])
            elif now - self.last_flush >= 1:
                self.output.flush()
                self.last_flush = now
                self._save_capture()

    def tick(self):
        with self.lock:
            if self.active_job and self.process and self.process.poll() is not None:
                manifest = self.manifest(self.active_job)
                if manifest['status'] == 'running':
                    manifest.update(status='failed', error='분석 프로세스가 종료되었습니다. 작업 폴더의 worker.log를 확인하세요.')
                    write_json(self.path(self.active_job) / 'manifest.json', manifest)
                self.active_job = None
                self.process = None
            if self.capture and self.capture['status'] in ('countdown', 'recording') and time.monotonic() - self.last_received > 2:
                self.finish_recording(self.capture['id'], '2초 동안 유효한 IMU 데이터가 들어오지 않아 기록을 중단했습니다.')

    def download(self, identifier, name):
        if name not in DOWNLOADS:
            raise ValueError('download_not_allowed')
        manifest = self.status(identifier)
        if manifest['status'] in ('running', 'countdown', 'recording'):
            raise ValueError('작업을 마친 뒤 다운로드하세요.')
        path = self.path(identifier) / name
        if not path.is_file():
            raise ValueError('file_not_found')
        return path.read_bytes()

    def close(self):
        with self.lock:
            if self.capture and self.capture['status'] in ('countdown', 'recording'):
                self.finish_recording(self.capture['id'], '프로그램 종료로 수집이 중단되었습니다.')
            if self.process and self.process.poll() is None:
                self.process.terminate()
                self.process.wait(timeout=5)
