import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRomStore, createRomHandler, sanitizeSession, sanitizeConfig, SESSION_LIMIT } from "../server/rom-store.mjs";
import { config, session } from "./rom-fixtures.mjs";
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stepon-rom-test-"));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("stepon-rom-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
test("records survive reopening; only allowlisted angles and metadata are stored", (t) => {
  const dir = directory(t), store = createRomStore(dir);
  const input = session(); input.video = "never-save"; input.landmarks = [{ x: 1 }]; input.samples[0].image = "never-save";
  input.summary.eligible = false;
  const saved = store.saveSession(input); assert.equal(saved.summary.eligible, true);
  const loaded = createRomStore(dir).list().sessions[0]; assert.deepEqual(loaded, saved);
  assert.ok(!JSON.stringify(loaded).includes("never-save")); assert.ok(!("landmarks" in loaded));
});
test("invalid config, times and angle values are rejected", () => {
  for (const overrides of [{ participant: "" }, { setup: "a\nb" }, { view: "back" }, { width: 0 }, { confidence: 1 }, { protocol: "other" }, { posture: "other" }]) assert.throws(() => sanitizeConfig(config(overrides)));
  for (const value of [NaN, Infinity, -1, 181, "90"]) {
    const input = session(); input.samples[0].values.left_ankle = value; assert.throws(() => sanitizeSession(input));
  }
  const repeated = session(); repeated.samples[1].t = repeated.samples[0].t; assert.throws(() => sanitizeSession(repeated));
  const rapid = session(); rapid.samples[1].t = 201; assert.throws(() => sanitizeSession(rapid));
  const wrongSide = session(); wrongSide.samples[0].values.right_ankle = 90; assert.throws(() => sanitizeSession(wrongSide));
  assert.throws(() => sanitizeSession(session({ capturedAt: "not-a-date" })));
  assert.throws(() => sanitizeSession(session({ durationMs: 21000 })));
});
test("client cannot forge baseline eligibility or turn missing angles into zero", (t) => {
  const store = createRomStore(directory(t)), input = session({ samples: [] });
  input.summary = { eligible: true };
  const saved = store.saveSession(input); assert.equal(saved.summary.eligible, false);
  assert.throws(() => store.setBaseline(saved.id));
  const nullInput = session(); nullInput.samples[0].values.left_ankle = null;
  const nullRecord = store.saveSession(nullInput);
  assert.equal(nullRecord.samples[0].valid, false); assert.deepEqual(nullRecord.samples[0].values, {});
});
test("baseline can be replaced per condition and is isolated across people", (t) => {
  const store = createRomStore(directory(t));
  const a = store.saveSession(session()), b = store.saveSession(session()), c = store.saveSession(session({ config: { participant: "P02" } }));
  store.setBaseline(a.id); store.setBaseline(b.id); store.setBaseline(c.id);
  assert.deepEqual(new Set(store.list().baselineIds), new Set([b.id, c.id]));
  store.remove("session", b.id); assert.deepEqual(store.list().baselineIds, [c.id]);
});
test("reference observations persist without frames; invalid reference is rejected", (t) => {
  const store = createRomStore(directory(t));
  const record = { config: config(), capturedAt: new Date().toISOString(), estimated: 88, reference: 90, image: "never-save" };
  store.saveReference(record); const saved = store.list().references[0];
  assert.equal(saved.reference, 90); assert.equal(saved.estimated, 88); assert.equal(saved.image, undefined);
  assert.throws(() => store.saveReference({ ...record, reference: 181 }));
  assert.throws(() => store.saveReference({ ...record, estimated: null }));
  store.remove("reference", saved.id); assert.equal(store.list().references.length, 0);
});
test("30-day expiry and delete-all preserve unrelated files", (t) => {
  const dir = directory(t), store = createRomStore(dir), old = store.saveSession(session());
  const oldPath = path.join(dir, `session-${old.id}.json`);
  fs.writeFileSync(oldPath, JSON.stringify({ ...old, savedAt: new Date(Date.now() - 31 * 86400000).toISOString() }));
  const keep = path.join(dir, "unrelated.txt"); fs.writeFileSync(keep, "keep");
  assert.equal(store.list().sessions.length, 0); assert.equal(fs.existsSync(oldPath), false);
  const valid = store.saveSession(session()); store.setBaseline(valid.id);
  store.clear(); assert.equal(store.list().sessions.length, 0); assert.deepEqual(fs.readdirSync(dir), ["unrelated.txt"]);
});
test("record deletion cannot traverse directories", (t) => {
  const store = createRomStore(directory(t));
  for (const id of ["../anything", "", "../../../file.json", null]) assert.throws(() => store.remove("session", id));
  assert.throws(() => store.remove("unknown", "a".repeat(36)));
});
test("storage cap asks for export/delete and does not silently evict", (t) => {
  const store = createRomStore(directory(t));
  for (let i = 0; i < SESSION_LIMIT; i++) store.saveSession(session());
  assert.throws(() => store.saveSession(session()), (e) => e.status === 409);
  assert.equal(store.list().sessions.length, SESSION_LIMIT);
});
async function api(t) {
  const handler = createRomHandler(directory(t));
  const server = http.createServer((req, res) => void handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (method = "GET", body, headers = {}) => fetch(url, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { url, request };
}
test("HTTP save, reload, baseline, reference and deletion lifecycle", async (t) => {
  const { request } = await api(t);
  const first = await request(); assert.equal(first.status, 200);
  assert.equal(first.headers.get("access-control-allow-origin"), null); assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal((await first.json()).sessions.length, 0);
  const save = await request("POST", { action: "save_session", record: session() }); assert.equal(save.status, 200);
  const id = (await save.json()).sessions[0].id;
  const baseline = await request("POST", { action: "set_baseline", id }); assert.deepEqual((await baseline.json()).baselineIds, [id]);
  const reference = await request("POST", { action: "save_reference", record: { config: config(), capturedAt: new Date().toISOString(), estimated: 90, reference: 89 } });
  assert.equal((await reference.json()).references.length, 1);
  const remove = await request("DELETE", { kind: "session", id }); assert.equal((await remove.json()).sessions.length, 0);
  assert.equal((await request("DELETE", { kind: "all" })).status, 400);
  const clear = await request("DELETE", { kind: "all", confirm: "DELETE_ROM" }); assert.equal((await clear.json()).references.length, 0);
});
test("HTTP denies cross-origin reads/writes, remote Host, and invalid methods", async (t) => {
  const { request, url } = await api(t);
  assert.equal((await request("GET", undefined, { Origin: "https://outside.example" })).status, 403);
  assert.equal((await request("POST", { action: "save_session", record: session() }, { Origin: "https://outside.example" })).status, 403);
  // fetch normalizes Host; use the actual HTTP layer to exercise a remote Host header.
  const remoteHostStatus = await new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { Host: "192.168.4.2:8000" } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject);
  });
  assert.equal(remoteHostStatus, 403);
  assert.equal((await request("GET", undefined, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await request("GET", undefined, { Origin: url })).status, 200);
  assert.equal((await request("PUT", {})).status, 405);
  assert.equal((await request("POST", {}, { "content-type": "text/plain" })).status, 415);
});
test("HTTP malformed, null and oversized bodies fail cleanly", async (t) => {
  const { request, url } = await api(t);
  for (const body of [null, [], { action: "unknown" }]) assert.equal((await request("POST", body)).status, 400);
  assert.equal((await request("POST", { padding: "x".repeat(65000) })).status, 413);
  const bad = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{" }); assert.equal(bad.status, 400);
});
test("HTTP preserves Korean metadata when UTF-8 bytes are split across chunks", async (t) => {
  const { url, request } = await api(t);
  const bytes = Buffer.from(JSON.stringify({ action: "save_session", record: session() }));
  const split = bytes.indexOf(Buffer.from("책")) + 1;
  const status = await new Promise((resolve, reject) => {
    const req = http.request(url, { method: "POST", headers: { "content-type": "application/json" } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject); req.write(bytes.subarray(0, split)); setImmediate(() => req.end(bytes.subarray(split)));
  });
  assert.equal(status, 200); assert.equal((await (await request()).json()).sessions[0].config.setup, "책상-기본");
});
