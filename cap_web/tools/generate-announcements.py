"""Build fixed Korean announcements; optional build dependency: edge-tts==7.2.8.

Run from the repository root with an isolated tool installation:
  .venv-ai/Scripts/python -m pip install --target .codex-build/tts-runtime edge-tts==7.2.8
  .venv-ai/Scripts/python cap_web/tools/generate-announcements.py --runtime .codex-build/tts-runtime

Generation uses Microsoft's online TTS service. The web app plays the resulting
bundled MP3s locally and does not need this package or an online TTS connection.
"""

import argparse
import asyncio
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys

WEB_ROOT = Path(__file__).resolve().parents[1]
VOICE = "ko-KR-InJoonNeural"
RATE = "-3%"
PITCH = "+0Hz"


async def generate():
    import edge_tts

    catalog_uri = (WEB_ROOT / "src/services/announcement-catalog.js").as_uri()
    catalog = subprocess.check_output([
        "node", "--input-type=module", "-e",
        f"import {{ ANNOUNCEMENTS }} from {json.dumps(catalog_uri)}; console.log(JSON.stringify(ANNOUNCEMENTS));",
    ], encoding="utf-8")
    messages = json.loads(catalog)
    target = WEB_ROOT / "assets/audio/announcer-v1"
    target.mkdir(parents=True, exist_ok=True)
    for item in messages:
        filename = f"{item['id']}.mp3"
        destination = target / filename
        temporary = target / f"{filename}.tmp"
        await edge_tts.Communicate(item["text"], VOICE, rate=RATE, pitch=PITCH).save(str(temporary))
        if temporary.stat().st_size < 1024:
            raise RuntimeError(f"Empty audio: {filename}")
        temporary.replace(destination)
        item["file"] = filename
        item["sha256"] = hashlib.sha256(destination.read_bytes()).hexdigest()
        print(f"Generated {filename}: {destination.stat().st_size} bytes", flush=True)
    manifest = {
        "voice": VOICE, "rate": RATE, "pitch": PITCH,
        "generator": f"edge-tts {importlib.metadata.version('edge-tts')}",
        "messages": messages,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, help="Optional isolated edge-tts installation directory")
    args = parser.parse_args()
    if args.runtime:
        sys.path.insert(0, str(args.runtime.resolve()))
    asyncio.run(generate())
