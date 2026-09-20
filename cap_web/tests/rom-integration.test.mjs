import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { renderMediaPipeContent } from "../src/views/mediapipe-view.js";
const root = fileURLToPath(new URL("../", import.meta.url));
function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((item) => item.isDirectory() ? filesIn(path.join(directory, item.name)) : [path.join(directory, item.name)]);
}
test("all app JS parses and relative module imports resolve", () => {
  const files = [...filesIn(path.join(root, "src")), ...filesIn(path.join(root, "server"))].filter((p) => /\.m?js$/.test(p));
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, `${file}\n${result.stderr}`);
    const code = fs.readFileSync(file, "utf8");
    for (const match of code.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)) assert.ok(fs.existsSync(path.resolve(path.dirname(file), match[1])), `${file}: ${match[1]}`);
  }
});
test("camera UI has consent, three views, explicit save, stop, reference, and no autoplay permission request", () => {
  const html = renderMediaPipeContent();
  for (const value of ["front", "left", "right"]) assert.ok(html.includes(`name="rom-view" value="${value}"`));
  for (const action of ["start", "stop", "record", "abort", "save", "baseline", "freeze", "reference", "export-json", "export-csv", "clear"]) assert.equal(html.split(`data-rom-action="${action}"`).length - 1, 1);
  assert.match(html, /data-rom-consent/); assert.match(html, /임상 검증 아님/); assert.match(html, /영상·음성은 저장하지 않습니다/);
  assert.doesNotMatch(html, /<script|onload=|getUserMedia/);
  const controller = fs.readFileSync(path.join(root, "src/mediapipe/rom-controller.js"), "utf8");
  for (const [, action] of controller.matchAll(/button\("([a-z-]+)"\)/g)) assert.ok(html.includes(`data-rom-action="${action}"`), `Missing required controller button: ${action}`);
});
test("worker protocol initializes local CPU model and releases frame resources (mock inference)", async () => {
  let options, filesPath, bitmapClosed = 0, shouldThrow = false;
  const messages = [], landmarks = [[{ x: .5, y: .5, visibility: .9 }]];
  const code = fs.readFileSync(path.join(root, "src/mediapipe/pose-worker.js"), "utf8")
    .replace('await import("/vendor/mediapipe/vision_bundle.mjs")', "fakeVision");
  const context = { URL, self: { location: { origin: "http://127.0.0.1:8000" }, postMessage: (message) => messages.push(message) },
    fakeVision: { FilesetResolver: { forVisionTasks: async (p) => { filesPath = p; return {}; } }, PoseLandmarker: { createFromOptions: async (_, o) => {
      options = o; return { detectForVideo: () => { if (shouldThrow) throw new Error("lost frame"); return { landmarks, worldLandmarks: ["not-forwarded"], segmentationMasks: [] }; } };
    } } } };
  vm.runInNewContext(code, context);
  await context.self.onmessage({ data: { type: "init" } });
  assert.equal(messages[0].type, "ready"); assert.equal(options.baseOptions.delegate, "CPU"); assert.equal(options.numPoses, 2);
  assert.equal(options.runningMode, "VIDEO"); assert.equal(options.outputSegmentationMasks, false);
  assert.match(filesPath, /^http:\/\/127\.0\.0\.1:8000\/vendor\//); assert.match(options.baseOptions.modelAssetPath, /pose_landmarker_lite\.task$/);
  const bitmap = { close: () => bitmapClosed++ };
  await context.self.onmessage({ data: { type: "frame", timestamp: 200, bitmap } });
  assert.equal(messages[1].timestamp, 200); assert.equal(messages[1].poses, landmarks); assert.deepEqual(Object.keys(messages[1]).sort(), ["poses", "timestamp", "type"]);
  shouldThrow = true; await context.self.onmessage({ data: { type: "frame", timestamp: 400, bitmap } });
  assert.equal(messages[2].type, "error"); assert.equal(bitmapClosed, 2);
});
test("self-hosted model assets match setup manifest", () => {
  const dir = path.join(root, "vendor/mediapipe"), manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  for (const entry of manifest.files) {
    const data = fs.readFileSync(path.join(dir, entry.name));
    assert.equal(data.length, entry.bytes); assert.equal(createHash("sha256").update(data).digest("hex"), entry.sha256);
  }
});
test("real dev server serves app, model, MIME types and private ROM API", { timeout: 20000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "stepon-rom-http-"));
  const child = spawn(process.execPath, [path.join(root, "dev-server.mjs"), "0", "127.0.0.1"], { cwd: root, env: { ...process.env, STEPON_ROM_DATA_DIR: temp, STEPON_TREND_DATA_DIR: path.join(temp, 'trends') }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => {
    if (child.exitCode === null) { const done = once(child, "exit"); child.kill(); await done; }
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("stepon-rom-http-"));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("dev server startup timed out")), 10000);
    child.on("error", reject);
    child.stdout.on("data", (chunk) => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
  });
  for (const route of ["/?view=mediapipe&preview=1&mobile=0", "/mobile?view=mediapipe", "/?mode=editor&screen=mediapipe", "/?view=trends&preview=1", "/mobile?view=trends", "/?mode=editor&screen=trends"]) {
    const response = await fetch(url + route); assert.equal(response.status, 200); assert.match(await response.text(), /mediapipe-rom\.css/);
  }
  const localFiles = filesIn(path.join(root, "src")).filter((file) => /\.(js|css)$/.test(file));
  for (const file of localFiles) {
    const response = await fetch(url + "/" + path.relative(root, file).split(path.sep).join("/"));
    assert.equal(response.status, 200, file); assert.equal(await response.text(), fs.readFileSync(file, "utf8"));
  }
  for (const [file, mime] of [["vision_bundle.mjs", "text/javascript"], ["wasm/vision_wasm_internal.wasm", "application/wasm"], ["pose_landmarker_lite.task", "application/octet-stream"]]) {
    const response = await fetch(`${url}/vendor/mediapipe/${file}`); assert.equal(response.status, 200); assert.ok(response.headers.get("content-type").startsWith(mime)); await response.arrayBuffer();
  }
  const response = await fetch(`${url}/api/rom`); assert.equal(response.status, 200); assert.deepEqual((await response.json()).sessions, []);
  const trendsResponse = await fetch(`${url}/api/trends`); assert.equal(trendsResponse.status, 200); assert.deepEqual((await trendsResponse.json()).rows, []);
  for (const route of ["/.stepon-data/mediapipe/", "/%2e%2e%2f.stepon-data/mediapipe/"]) assert.notEqual((await fetch(url + route)).status, 200);
});
