"""Internal worker. Only server-generated job paths are passed on the command line."""
import hashlib
import json
from pathlib import Path
import sys

import server  # Initializes the engine import path and CPU settings.
from csv_pipeline import parse_csv, replay, windows_csv, write_json


def run(folder, artifacts):
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    try:
        recording = parse_csv((folder / 'measurement.csv').read_text(encoding='utf-8-sig'), manifest['metadata'])
        def progress(done, total):
            manifest['progress'] = round(100 * done / total, 1)
            write_json(folder / 'manifest.json', manifest)
        result = replay(recording, folder / 'calibration.json', manifest['metadata']['side'], manifest['model'], artifacts, progress)
        result.update(artifact_id=manifest['artifact_id'], job_id=manifest['id'],
                      calibration_id=hashlib.sha256((folder / 'calibration.json').read_bytes()).hexdigest(),
                      source_quality=manifest['measurement_quality'], calibration_quality=manifest['calibration_quality'])
        write_json(folder / 'result.json', result)
        (folder / 'windows.csv').write_text(windows_csv(result), encoding='utf-8-sig', newline='')
        manifest.update(status='complete', progress=100)
    except Exception as exc:
        manifest.update(status='failed', error=str(exc))
    write_json(folder / 'manifest.json', manifest)


if __name__ == '__main__':
    run(Path(sys.argv[1]), Path(sys.argv[2]))
