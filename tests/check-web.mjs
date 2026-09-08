// Package smoke checks only; not a visual browser or physical-device test.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { calculateFootMetrics } from "../cap_web/src/data/gait-algorithms.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const web = path.join(root, "cap_web");
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
const sources = [...files(path.join(web, "src")), path.join(web, "dev-server.mjs"),
  path.join(root, "scripts/run-web.mjs")];
for (const source of sources.filter((file) => /\.(mjs|js)$/.test(file))) {
  const checked = spawnSync(process.execPath, ["--check", source], { encoding: "utf8", windowsHide: true });
  assert.equal(checked.status, 0, `${source}: ${checked.stderr}`);
  for (const match of fs.readFileSync(source, "utf8").matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g)) {
    assert.ok(fs.existsSync(path.resolve(path.dirname(source), match[1])), `Missing import: ${source} -> ${match[1]}`);
  }
}
assert.equal(calculateFootMetrics(null, {}).available, false);
assert.equal(calculateFootMetrics(Array(8).fill(0), {}).loaded, false);
assert.equal(calculateFootMetrics(Array(8).fill(2), {}).loaded, true);
assert.equal(calculateFootMetrics(Array(8).fill(10), {}).total, 80);

const probe = net.createServer();
await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const server = spawn(process.execPath, [path.join(web, "dev-server.mjs"), String(port), "127.0.0.1"],
  { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
server.stdout.on("data", (chunk) => { logs += chunk; });
server.stderr.on("data", (chunk) => { logs += chunk; });
const exited = new Promise((resolve) => server.once("exit", resolve));
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch(base, { signal: AbortSignal.timeout(500) })).ok; } catch { /* booting */ }
    if (ready || server.exitCode !== null) break;
    await delay(100);
  }
  assert.ok(ready, `Server failed to start: ${logs}`);
  const html = await (await fetch(base)).text();
  const urls = new Set(["/", "/?mode=editor&screen=overview", "/mobile", "/api/editor-state",
    "/manifest.webmanifest", "/editor-state.default.json", "/assets/foot-left-silhouette.png", "/assets/foot-right-silhouette.png"]);
  for (const match of html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)) urls.add(match[1]);
  for (const source of sources.filter((file) => file.startsWith(path.join(web, "src")))) {
    urls.add(`/${path.relative(web, source).split(path.sep).join("/")}`);
  }
  for (const url of urls) {
    const response = await fetch(base + url, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200, `HTTP ${response.status}: ${url}`);
    await response.arrayBuffer();
  }
  assert.equal((await fetch(base + "/missing-check-file")).status, 404);
  if (!fs.existsSync(path.join(web, ".stepon-editor-state.json"))) {
    const state = await (await fetch(base + "/api/editor-state")).json();
    assert.deepEqual(state, JSON.parse(fs.readFileSync(path.join(web, "editor-state.default.json"), "utf8")));
  }
  console.log(`PASS: syntax/imports, pressure rules, ${urls.size} HTTP routes/assets. No device commands sent.`);
} finally {
  if (server.exitCode === null) server.kill();
  await exited;
}
