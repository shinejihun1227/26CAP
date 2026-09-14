// Download the vendor runtime/model once while online; no camera frames are uploaded.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const version = "1.0.1";
const output = fileURLToPath(new URL("../vendor/mediapipe/", import.meta.url));
const base = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/`;
const files = ["vision_bundle.mjs", "wasm/vision_wasm_internal.js", "wasm/vision_wasm_internal.wasm", "wasm/vision_wasm_nosimd_internal.js", "wasm/vision_wasm_nosimd_internal.wasm"];
const sources = files.map((name) => ({ name, url: base + name }));
sources.push({ name: "pose_landmarker_lite.task", url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" });
sources.push({ name: "LICENSE", url: "https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE" });
const manifest = { package: "@mediapipe/tasks-vision", version, model: "pose_landmarker_lite/float16/1", files: [] };
for (const { name, url } of sources) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error(`Empty download: ${name}`);
  const target = path.join(output, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  manifest.files.push({ name, url, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  console.log(`Downloaded ${name} (${bytes.length} bytes)`);
}
await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("MediaPipe is available locally. Start the web server and open view=mediapipe.");
