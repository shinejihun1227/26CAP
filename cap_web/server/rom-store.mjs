// Local-only, file-backed observations. Stored OUTSIDE the static web root.
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { METRICS, PROTOCOL, comparisonKey, summarizeSession } from "../src/mediapipe/rom-math.js";
import { SET_PROTOCOL } from "../src/mediapipe/rom-sets.js";

export const RETENTION_DAYS = 30;
export const SESSION_LIMIT = 300;
const ID = /^[a-f0-9-]{36}$/;
const FILE = /^(session|reference|set)-([a-f0-9-]{36})\.json$/;
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function number(n, min, max) { return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max; }
function text(value, limit) { return typeof value === "string" && value.trim() && value.length <= limit && !/[\u0000-\u001f]/.test(value); }
export function sanitizeConfig(c) {
  if (!c || !text(c.participant, 30) || !text(c.setup, 60) || !METRICS[c.metric]?.views.includes(c.view)
      || !["seated", "standing"].includes(c.posture) || c.protocol !== PROTOCOL
      || !text(c.modelVersion, 80) || !number(c.width, 100, 4096) || !number(c.height, 100, 4096)
      || !number(c.confidence, 0.5, 0.95)) fail("측정 설정이 올바르지 않습니다.");
  return { participant: c.participant.trim(), setup: c.setup.trim(), view: c.view, metric: c.metric,
    posture: c.posture, protocol: PROTOCOL, modelVersion: c.modelVersion, width: c.width, height: c.height, confidence: c.confidence };
}
function safeTime(value) {
  const t = Date.parse(value);
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > RETENTION_DAYS * 86400000) fail("기록 시각이 올바르지 않습니다.");
  return new Date(t).toISOString();
}
export function sanitizeSession(input) {
  const config = sanitizeConfig(input?.config);
  if (!number(input.durationMs, 0, 20000) || !Array.isArray(input.samples) || input.samples.length > 100) fail("기록 길이가 올바르지 않습니다.");
  let last = -1;
  const samples = input.samples.map((s) => {
    if (!number(s?.t, 0, input.durationMs + 250) || s.t <= last || (last >= 0 && s.t - last < 100)) fail("표본 시간 간격이 올바르지 않습니다.");
    last = s.t;
    const values = {};
    for (const [id, value] of Object.entries(s.values ?? {})) {
      if (!METRICS[id]?.views.includes(config.view) || !(value === null || number(value, 0, 180))) fail("각도 값이 올바르지 않습니다.");
      values[id] = value;
    }
    const valid = s.valid === true && Number.isFinite(values[config.metric]);
    return { t: Math.round(s.t), valid, values: valid ? values : {} };
  });
  const interrupted = input.interrupted === true;
  return { schemaVersion: 1, config, capturedAt: safeTime(input.capturedAt), durationMs: input.durationMs,
    interrupted, samples, summary: summarizeSession(samples, config.metric, input.durationMs, interrupted) };
}
export function createRomStore(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const fileFor = (kind, id) => {
    if (!["session", "reference", "set"].includes(kind) || !ID.test(id ?? "")) fail("기록 ID가 올바르지 않습니다.");
    return path.join(directory, `${kind}-${id}.json`);
  };
  function list() {
    const sessions = [], references = [], sets = [], baselineIds = [];
    for (const name of fs.readdirSync(directory)) {
      if (FILE.test(name)) {
        const file = path.join(directory, name);
        let record;
        try { record = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
        if (Date.now() - Date.parse(record.savedAt) > RETENTION_DAYS * 86400000) { fs.rmSync(file, { force: true }); continue; }
        (name.startsWith("session-") ? sessions : name.startsWith("set-") ? sets : references).push(record);
      } else if (/^baseline-[a-f0-9]{64}\.json$/.test(name)) {
        try { baselineIds.push(JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")).id); } catch { /* keep corrupt data for recovery */ }
      }
    }
    const sort = (a, b) => b.savedAt.localeCompare(a.savedAt);
    return { sessions: sessions.sort(sort), references: references.sort(sort), sets: sets.sort(sort), setSchemaVersion: 1,
      baselineIds: baselineIds.filter((id) => sessions.some((s) => s.id === id)), retentionDays: RETENTION_DAYS, metricIds: Object.keys(METRICS) };
  }
  function save(kind, record) {
    const current = list();
    const collection = kind === "session" ? current.sessions : kind === "set" ? current.sets : current.references;
    if (collection.length >= (kind === "reference" ? 100 : kind === "session" ? SESSION_LIMIT : 30)) fail("저장 한도에 도달했습니다. 내보낸 뒤 필요 없는 기록을 삭제해 주세요.", 409);
    const result = { ...record, id: randomUUID(), savedAt: new Date().toISOString() };
    fs.writeFileSync(fileFor(kind, result.id), JSON.stringify(result), { flag: "wx", mode: 0o600 });
    return result;
  }
  function withWriteLock(action) {
    // 8000 and 8001 share files: serialize mutations across both Node processes.
    const lock = path.join(directory, ".rom-write.lock");
    try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      // Do not automatically delete a stale-looking lock: another server may own it now.
      fail("다른 창에서 저장 중이거나 이전 저장 잠금이 남아 있습니다. 잠시 후 다시 시도하고, 계속되면 사용 안내의 저장 잠금 복구를 확인하세요.", 409);
    }
    try { return action(); } finally { fs.rmSync(lock, { force: true }); }
  }
  function checkedSet(id, revision) {
    fileFor("set", id);
    const set = list().sets.find((item) => item.id === id);
    if (!set) fail("측정 세트가 삭제되었거나 보관 기간이 지났습니다. 새로고침해 주세요.", 404);
    if (!Number.isInteger(revision) || set.revision !== revision) fail("다른 창에서 세트를 변경했습니다. 새로고침 후 다시 시도하세요.", 409);
    return set;
  }
  function checkedIds(ids, participant, allowMissing = []) {
    if (!Array.isArray(ids) || ids.length > 30 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !ID.test(id))) fail("세트에는 중복 없이 최대 30개 기록을 연결할 수 있습니다.");
    const sessions = list().sessions;
    for (const id of ids) {
      const record = sessions.find((s) => s.id === id);
      if (!record && !allowMissing.includes(id)) fail("연결할 원본 기록을 찾지 못했습니다. 새로고침해 주세요.", 404);
      if (record && record.config.participant !== participant) fail("다른 측정 코드의 기록을 같은 세트에 넣을 수 없습니다.");
    }
    return [...ids];
  }
  function replaceSet(set, sessionIds) {
    const next = { ...set, sessionIds, revision: set.revision + 1, updatedAt: new Date().toISOString() };
    const temporary = path.join(directory, `set-${set.id}-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, JSON.stringify(next), { flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, fileFor("set", set.id));
    } finally { fs.rmSync(temporary, { force: true }); }
    return next;
  }
  const methods = {
    list,
    saveSession(input, attachment = {}) {
      const sanitized = sanitizeSession(input);
      const set = attachment.setId ? checkedSet(attachment.setId, attachment.setRevision) : null;
      if (set && set.participant !== sanitized.config.participant) fail("측정 코드가 세트와 다릅니다.");
      if (set && set.sessionIds.length >= 30) fail("세트의 기록 연결 한도에 도달했습니다.", 409);
      const record = save("session", sanitized);
      if (set) {
        try { replaceSet(set, [...set.sessionIds, record.id]); }
        catch (error) { fs.rmSync(fileFor("session", record.id), { force: true }); throw error; }
      }
      return record;
    },
    createSet(input) {
      if (!text(input?.participant, 30) || !text(input?.label, 60)) fail("측정 코드와 세트 이름을 입력하세요.");
      const participant = input.participant.trim(), sessionIds = checkedIds(input.sessionIds ?? [], participant);
      return save("set", { schemaVersion: 1, protocol: SET_PROTOCOL, participant, label: input.label.trim(), sessionIds, revision: 1, updatedAt: new Date().toISOString() });
    },
    updateSet(input) {
      const set = checkedSet(input?.id, input?.revision);
      return replaceSet(set, checkedIds(input.sessionIds, set.participant, set.sessionIds));
    },
    saveReference(input) {
      const config = sanitizeConfig(input?.config);
      if (!number(input.estimated, 0, 180) || !number(input.reference, 0, 180)) fail("비교 각도는 0~180° 숫자여야 합니다.");
      return save("reference", { schemaVersion: 1, config, capturedAt: safeTime(input.capturedAt),
        estimated: input.estimated, reference: input.reference, method: "manual-goniometer-same-pose" });
    },
    setBaseline(id) {
      const record = list().sessions.find((s) => s.id === id);
      if (!record?.summary?.eligible) fail("품질 기준을 통과한 기록만 개인 기준으로 지정할 수 있습니다.");
      const key = createHash("sha256").update(comparisonKey(record)).digest("hex");
      const destination = path.join(directory, `baseline-${key}.json`);
      const temporary = path.join(directory, `baseline-${key}-${randomUUID()}.tmp`);
      fs.writeFileSync(temporary, JSON.stringify({ id }), { flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, destination);
    },
    remove(kind, id, revision) {
      if (kind === "set") checkedSet(id, revision);
      fs.rmSync(fileFor(kind, id), { force: true });
    },
    clear() {
      for (const name of fs.readdirSync(directory)) {
        if (FILE.test(name) || /^baseline-[a-f0-9]{64}\.json$/.test(name)) fs.unlinkSync(path.join(directory, name));
      }
    },
  };
  return Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, name === "list" ? method : (...args) => withWriteLock(() => method(...args))]));
}

export function createRomHandler(directory) {
  let store;
  const reply = (res, code, body) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(JSON.stringify(body)); };
  return async (request, response) => {
    try {
      // No cross-origin access to sensitive local observations, including GET.
      const host = new URL(`http://${request.headers.host || "invalid"}`);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(host.hostname)
          || (request.headers.origin && request.headers.origin !== host.origin)
          || request.headers["sec-fetch-site"] === "cross-site") fail("관절 기록은 이 PC의 localhost 화면에서만 사용할 수 있습니다.", 403);
      store ??= createRomStore(directory);
      if (request.method === "GET") { reply(response, 200, store.list()); return; }
      if (!["POST", "DELETE"].includes(request.method)) fail("지원하지 않는 요청입니다.", 405);
      if (!request.headers["content-type"]?.startsWith("application/json")) fail("JSON 요청이 필요합니다.", 415);
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size <= 64000) chunks.push(chunk);
      }
      if (size > 64000) fail("기록이 너무 큽니다.", 413);
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail("올바른 JSON이 아닙니다."); }
      if (!body || typeof body !== "object" || Array.isArray(body)) fail("JSON 객체가 필요합니다.");
      const resultIds = {};
      if (request.method === "POST") {
        if (body.action === "save_session") resultIds.savedSessionId = store.saveSession(body.record, { setId: body.setId, setRevision: body.setRevision }).id;
        else if (body.action === "create_set") resultIds.createdSetId = store.createSet(body.record).id;
        else if (body.action === "update_set") store.updateSet(body.record);
        else if (body.action === "save_reference") store.saveReference(body.record);
        else if (body.action === "set_baseline") store.setBaseline(body.id);
        else fail("알 수 없는 저장 요청입니다.");
      } else if (body.kind === "all" && body.confirm === "DELETE_ROM") store.clear();
      else store.remove(body.kind, body.id, body.revision);
      reply(response, 200, { ...store.list(), ...resultIds });
    } catch (error) {
      reply(response, error.status || 500, { error: error.status ? error.message : "로컬 기록 저장에 실패했습니다. 디스크 권한과 공간을 확인하세요." });
    }
  };
}
