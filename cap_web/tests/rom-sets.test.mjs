import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRomStore, createRomHandler } from "../server/rom-store.mjs";
import { buildSetReport, exportSetJson, csvForSet } from "../src/mediapipe/rom-sets.js";
import { renderIntegratedReport, renderSetViews } from "../src/mediapipe/set-view.js";
import { renderMediaPipeContent } from "../src/views/mediapipe-view.js";
import { session } from "./rom-fixtures.mjs";

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stepon-multiview-test-"));
  t.after(() => { assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith("stepon-multiview-test-")); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, store: createRomStore(dir) };
}
const recordFor = (view, extra = {}) => session({ ...extra, config: { view, metric: view === "front" ? "left_shoulder" : `${view}_ankle`, ...extra.config } });
const create = (store, extra = {}) => store.createSet({ participant: "P01", label: "오전 관절 관찰", ...extra });
test("new persistent set is empty and does not imply three completed views", (t) => {
  const { dir, store } = setup(t), set = create(store);
  assert.deepEqual(set.sessionIds, []); assert.equal(set.revision, 1);
  assert.deepEqual(createRomStore(dir).list().sets, [set]);
  const report = buildSetReport(set, []); assert.equal(report.complete, false); assert.equal(report.coveredViews.length, 0);
  assert.equal(store.list().setSchemaVersion, 1);
});
test("front, left, and right saves attach to one set and preserve each original", (t) => {
  const { store } = setup(t); let set = create(store);
  for (const view of ["front", "left", "right"]) {
    const record = store.saveSession(recordFor(view), { setId: set.id, setRevision: set.revision });
    set = store.list().sets[0]; assert.ok(set.sessionIds.includes(record.id));
  }
  const data = store.list(), report = buildSetReport(set, data.sessions);
  assert.equal(set.revision, 4); assert.equal(report.complete, true); assert.equal(report.rows.length, 3);
  assert.deepEqual(report.coveredViews, ["front", "left", "right"]);
  assert.equal(report.conditionCount, 1); assert.equal(data.sessions.length, 3);
  assert.deepEqual(new Set(report.rows.map((r) => r.metric)), new Set(["left_shoulder", "left_ankle", "right_ankle"]));
});
test("legacy records can be grouped; many joints per view are retained", (t) => {
  const { store } = setup(t);
  const ankle = store.saveSession(recordFor("left")), knee = store.saveSession(recordFor("left", { config: { metric: "left_knee" } }));
  const set = create(store, { sessionIds: [ankle.id, knee.id] });
  const report = buildSetReport(set, store.list().sessions);
  assert.equal(report.views.left.count, 2); assert.equal(report.rows.length, 2); assert.equal(report.complete, false);
});
test("set creation validates label, participant, unique IDs and size", (t) => {
  const { store } = setup(t); const saved = store.saveSession(recordFor("front"));
  for (const input of [{ label: "" }, { label: "x".repeat(61) }, { participant: "" }, { sessionIds: [saved.id, saved.id] }, { sessionIds: ["../secret"] }, { sessionIds: Array(31).fill(saved.id) }]) assert.throws(() => create(store, input));
  assert.equal(store.list().sets.length, 0);
});
test("different people cannot be attached or leaked by JSON/CSV/report", (t) => {
  const { store } = setup(t), foreign = store.saveSession(recordFor("left", { config: { participant: "P02" } })), set = create(store);
  assert.throws(() => store.updateSet({ id: set.id, revision: 1, sessionIds: [foreign.id] }));
  assert.throws(() => store.saveSession(recordFor("right", { config: { participant: "P02" } }), { setId: set.id, setRevision: 1 }));
  const invalid = { ...set, sessionIds: [foreign.id] };
  assert.equal(exportSetJson(invalid, [foreign]).sessions.length, 0);
  assert.equal(buildSetReport(invalid, [foreign]).rows.length, 0);
  assert.equal(csvForSet(invalid, [foreign]).split("\r\n").length, 1);
  assert.equal(store.list().sessions.length, 1);
});
test("stale revision rejects changes and grouped save before creating an orphan", (t) => {
  const { store } = setup(t), set = create(store), record = store.saveSession(recordFor("front"));
  store.updateSet({ id: set.id, revision: 1, sessionIds: [record.id] });
  assert.throws(() => store.updateSet({ id: set.id, revision: 1, sessionIds: [] }), (e) => e.status === 409);
  assert.throws(() => store.saveSession(recordFor("left"), { setId: set.id, setRevision: 1 }), (e) => e.status === 409);
  assert.throws(() => store.remove("set", set.id, 1), (e) => e.status === 409);
  assert.equal(store.list().sessions.length, 1); assert.deepEqual(store.list().sets[0].sessionIds, [record.id]);
});
test("failed grouped save rolls back only its new record and releases lock", (t) => {
  const { dir, store } = setup(t), set = create(store), old = store.saveSession(recordFor("front"));
  const stub = t.mock.method(fs, "renameSync", () => { throw new Error("simulated disk error"); });
  assert.throws(() => store.saveSession(recordFor("left"), { setId: set.id, setRevision: 1 }), /simulated/);
  stub.mock.restore();
  assert.deepEqual(store.list().sessions.map((s) => s.id), [old.id]); assert.deepEqual(store.list().sets[0].sessionIds, []);
  assert.equal(fs.existsSync(path.join(dir, ".rom-write.lock")), false);
  assert.equal(fs.readdirSync(dir).some((f) => f.endsWith(".tmp")), false);
});
test("process-wide write lock is respected rather than stolen", (t) => {
  const { dir, store } = setup(t), lock = path.join(dir, ".rom-write.lock");
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
  assert.throws(() => create(store), (e) => e.status === 409); assert.equal(store.list().sets.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(lock)).pid, process.pid);
});
test("removing a link or deleting a set never deletes original observations", (t) => {
  const { store } = setup(t), original = store.saveSession(recordFor("front"));
  const a = create(store, { sessionIds: [original.id] }), b = create(store, { sessionIds: [original.id] });
  const updated = store.updateSet({ id: a.id, revision: 1, sessionIds: [] });
  store.remove("set", a.id, updated.revision);
  assert.equal(store.list().sessions[0].id, original.id); assert.equal(store.list().sets[0].id, b.id);
});
test("deleted/expired originals remain visibly missing, never silently complete", (t) => {
  const { dir, store } = setup(t);
  const records = ["front", "left", "right"].map((view) => store.saveSession(recordFor(view)));
  const set = create(store, { sessionIds: records.map((s) => s.id) });
  store.remove("session", records[0].id);
  fs.writeFileSync(path.join(dir, `session-${records[1].id}.json`), JSON.stringify({ ...records[1], savedAt: new Date(Date.now() - 31 * 86400000).toISOString() }));
  const report = buildSetReport(store.list().sets[0], store.list().sessions);
  assert.equal(report.complete, false); assert.equal(report.missingIds.length, 2);
  const cleaned = store.updateSet({ id: set.id, revision: 1, sessionIds: [records[2].id] });
  assert.equal(buildSetReport(cleaned, store.list().sessions).missingIds.length, 0);
});
test("set expiry does not extend with updates and leaves originals untouched", (t) => {
  const { dir, store } = setup(t), record = store.saveSession(recordFor("left")), set = create(store, { sessionIds: [record.id] });
  const updated = store.updateSet({ id: set.id, revision: 1, sessionIds: [] }); assert.equal(updated.savedAt, set.savedAt);
  fs.writeFileSync(path.join(dir, `set-${set.id}.json`), JSON.stringify({ ...updated, savedAt: new Date(Date.now() - 31 * 86400000).toISOString() }));
  assert.equal(store.list().sets.length, 0); assert.equal(store.list().sessions.length, 1);
});
test("poor-quality direction is recorded but does not count toward coverage", (t) => {
  const { store } = setup(t);
  const records = [store.saveSession(recordFor("front")), store.saveSession(recordFor("left")), store.saveSession(recordFor("right", { interrupted: true }))];
  const set = create(store, { sessionIds: records.map((s) => s.id) }), report = buildSetReport(set, records);
  assert.equal(report.views.right.count, 1); assert.equal(report.views.right.eligibleCount, 0); assert.equal(report.complete, false);
});
test("condition and time differences are disclosed, not averaged into fake 3D", (t) => {
  const { store } = setup(t), a = store.saveSession(recordFor("front", { capturedAt: new Date(Date.now() - 3 * 3600000).toISOString() }));
  const b = store.saveSession(recordFor("left", { config: { setup: "다른 위치", posture: "standing" } }));
  const set = create(store, { sessionIds: [a.id, b.id] }), report = buildSetReport(set, [a, b]);
  assert.equal(report.conditionCount, 2); assert.equal(report.spanMinutes, 180);
  assert.ok(!("averageAngle" in report)); assert.equal(report.rows[0].stats, a.summary.byMetric.left_shoulder);
  const html = renderIntegratedReport(set, [a, b]); assert.match(html, /조건|환경/); assert.match(html, /180분/);
});
test("one export includes all source time series with per-record times and CSV escaping", (t) => {
  const { store } = setup(t), records = ["front", "left", "right"].map((view) => store.saveSession(recordFor(view)));
  const set = create(store, { label: '="관찰"', sessionIds: records.map((s) => s.id) });
  const json = exportSetJson(set, records); assert.equal(json.sessions.length, 3); assert.equal(json.report.complete, true);
  assert.match(json.caution, /3D/); assert.equal(json.sessions[0].samples.length, 75);
  const csv = csvForSet(set, records); assert.equal(csv.split("\r\n").length, 226); assert.match(csv, /time_ms_within_record/);
  assert.ok(csv.includes('"\'=\"\"관찰\"\""')); assert.ok(csv.includes('"front"')); assert.ok(csv.includes('"right"'));
});
test("set UI escapes user labels and exposes grouping plus recovery controls", () => {
  const html = renderMediaPipeContent();
  for (const action of ["set-create", "set-json", "set-csv", "set-delete", "discard", "save-alone"]) assert.equal(html.split(`data-rom-action="${action}"`).length - 1, 1);
  assert.equal(html.split('data-rom-action="set-capture"').length - 1, 3);
  const set = { participant: "P01", label: '<img src=x onerror="x">', sessionIds: [] };
  assert.doesNotMatch(renderIntegratedReport(set, []), /<img/); assert.match(renderIntegratedReport(set, []), /&lt;img/);
  assert.equal(renderSetViews(set, []).split('data-rom-action="set-capture"').length - 1, 3);
});
test("set quota and delete-all are bounded to app files", (t) => {
  const { dir, store } = setup(t);
  for (let i = 0; i < 30; i++) create(store);
  assert.throws(() => create(store), (e) => e.status === 409);
  fs.writeFileSync(path.join(dir, "unrelated.txt"), "keep"); store.clear(); assert.deepEqual(fs.readdirSync(dir), ["unrelated.txt"]);
});
test("HTTP sets work across two servers and reject stale attachments", async (t) => {
  const { dir } = setup(t), servers = [];
  t.after(async () => { for (const server of servers) await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }); });
  for (let i = 0; i < 2; i++) { const handle = createRomHandler(dir), server = http.createServer((req, res) => void handle(req, res)); await new Promise((r) => server.listen(0, "127.0.0.1", r)); servers.push(server); }
  const request = (n, body, method = "POST") => fetch(`http://127.0.0.1:${servers[n].address().port}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const created = await request(0, { action: "create_set", record: { participant: "P01", label: "공유 세트" } });
  assert.equal(created.status, 200); const first = await created.json(), id = first.createdSetId; assert.equal(first.sets[0].id, id);
  const outcomes = await Promise.all([0, 1].map((n) => request(n, { action: "save_session", setId: id, setRevision: 1, record: recordFor(n ? "right" : "front") })));
  assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
  const winner = await outcomes.find((r) => r.status === 200).json(); assert.equal(winner.sets[0].sessionIds.length, 1); assert.equal(winner.sessions.length, 1);
  assert.equal(winner.savedSessionId, winner.sessions[0].id);
  const deleted = await request(1, { kind: "set", id, revision: winner.sets[0].revision }, "DELETE"); assert.equal(deleted.status, 200);
  const data = await deleted.json(); assert.equal(data.sets.length, 0); assert.equal(data.sessions.length, 1);
});
