const MAX_BODY_BYTES = 4096;
const ALLOWED_METRICS = new Set(["left_ankle", "right_ankle"]);

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(value));
}

function validSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!ALLOWED_METRICS.has(value.metric)) return false;
  if (!Number.isFinite(value.medianDeg) || value.medianDeg < 0 || value.medianDeg > 180) return false;
  if (!Number.isFinite(value.observedRangeDeg) || value.observedRangeDeg < 0 || value.observedRangeDeg > 180) return false;
  if (!Number.isFinite(value.validRatio) || value.validRatio < 0 || value.validRatio > 1) return false;
  if (value.previousRangeDeltaDeg !== null && value.previousRangeDeltaDeg !== undefined
      && (!Number.isFinite(value.previousRangeDeltaDeg) || Math.abs(value.previousRangeDeltaDeg) > 180)) return false;
  return true;
}

export function createLocalMotionAiHandler({ fetchImpl = fetch, model = process.env.STEPON_LOCAL_LLM_MODEL || "qwen2.5:3b", timeoutMs = 60_000 } = {}) {
  return async function handleLocalMotionAi(request, response) {
    if (request.method !== "POST") return json(response, 405, { error: "method_not_allowed" });
    const host = String(request.headers.host || "").split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
    if (!new Set(["localhost", "127.0.0.1", "::1"]).has(host)) return json(response, 403, { error: "local_only" });
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}`) return json(response, 403, { error: "same_origin_only" });
    if (request.headers["sec-fetch-site"] === "cross-site") return json(response, 403, { error: "same_origin_only" });
    if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) return json(response, 415, { error: "json_required" });

    let body = "";
    request.setEncoding("utf8");
    try {
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > MAX_BODY_BYTES) return json(response, 413, { error: "request_too_large" });
      }
    } catch { return json(response, 400, { error: "invalid_request" }); }
    let summary;
    try { summary = JSON.parse(body); } catch { return json(response, 400, { error: "invalid_json" }); }
    if (!validSummary(summary)) return json(response, 400, { error: "invalid_summary" });

    const safe = {
      metric: summary.metric,
      medianDeg: summary.medianDeg,
      observedRangeDeg: summary.observedRangeDeg,
      validRatio: summary.validRatio,
      previousRangeDeltaDeg: summary.previousRangeDeltaDeg ?? null,
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const upstream = await fetchImpl("http://127.0.0.1:11434/api/chat", {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          options: { temperature: 0.2 },
          messages: [
            { role: "system", content: "너는 발목 움직임 측정의 관찰 요약 도우미다. 입력된 숫자만 설명하고 임상 정상범위, 질환, 진단, 원인, 치료효과를 추정하거나 운동·치료를 처방하지 않는다. 숫자를 만들어내지 않는다. 2D 웹캠 추정값은 임상 각도계와 다르며 정확도 검증되지 않았음을 명시한다. 짧은 한국어 2~3문장으로 현재 기록, 전 기록 대비(제공된 경우), 안전한 다음 행동(같은 조건으로 재측정하거나 불편하면 중단하고 전문가에게 문의)을 안내한다. 입력값이 부족하면 모른다고 말한다." },
            { role: "user", content: JSON.stringify(safe) },
          ],
        }),
      });
      if (!upstream.ok) return json(response, 502, { error: "local_model_error", detail: `Ollama HTTP ${upstream.status}` });
      const payload = await upstream.json();
      const text = payload?.message?.content;
      if (typeof text !== "string" || !text.trim()) return json(response, 502, { error: "local_model_empty" });
      return json(response, 200, { text: text.trim().slice(0, 2400), model });
    } catch (error) {
      const offline = error?.name === "AbortError" ? "local_model_timeout" : "local_model_unavailable";
      return json(response, 503, { error: offline, message: "이 PC에서 Ollama를 실행하고 qwen2.5:3b 모델을 준비해 주세요." });
    } finally { clearTimeout(timer); }
  };
}
