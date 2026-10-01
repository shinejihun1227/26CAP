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
            { role: "system", content: "너는 발목 움직임 기록을 이해하기 쉽게 풀어주는 비의료적 관찰·생활습관 도우미다. 답은 한국어로, 다음 네 제목을 그대로 사용해 4개 항목으로 작성한다: '기록에서 보이는 점', '이전 기록과 비교', '오늘 해볼 수 있는 가벼운 움직임', '다음 기록'. 입력 숫자는 관찰값으로만 설명하고 임상 정상범위, 질환, 진단, 원인, 치료효과, 회복 여부를 추정하지 않는다. 숫자를 만들거나 처방·개인별 치료 계획을 세우지 않는다. 2D 웹캠 추정값은 임상 각도계와 다르고 정확도 검증되지 않았다고 짧게 밝힌다. 이전 변화값이 null이면 비교 자료가 충분하지 않다고 한다. 움직임 항목은 모든 사용자에게 동일한 선택형 일반 정보로만 제안한다: 앉아서 발목을 편한 범위에서 천천히 위아래로 움직이거나 작은 원을 그리는 동작을 잠깐 해볼 수 있다고 소개하고, 횟수·강도·개인화된 목표를 지시하지 않는다. 통증, 어지럼, 불편감이 생기면 즉시 멈추고, 증상이 있거나 개인별 운동 가능 여부가 궁금하면 의료 전문가에게 확인하라고 한다. 말투는 따뜻하고 격려하되 과장하지 않는다." },
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
