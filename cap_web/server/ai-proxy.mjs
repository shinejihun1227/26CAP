// Same-origin API for desktop and phone browsers. Python remains on loopback.
const routes = new Map([
  ['/api/ai/state', 'GET'], ['/api/ai/ping', 'GET'], ['/api/ai/events', 'GET'],
  ['/api/ai/calibration/start', 'POST'], ['/api/ai/calibration/cancel', 'POST'],
]);
export function createAiHandler({ baseUrl = process.env.STEPON_AI_URL || 'http://127.0.0.1:8787', fetchImpl = fetch } = {}) {
  return async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      const route = new URL(req.url, 'http://localhost').pathname;
      if (!routes.has(route)) return reply(404, { error: 'not_found' });
      if (req.method !== routes.get(route)) return reply(405, { error: 'method_not_allowed' });
      let body;
      if (req.method === 'POST') {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return reply(403, { error: 'cross_origin_write_denied' });
        if (!String(req.headers['content-type']).startsWith('application/json')) return reply(415, { error: 'json_required' });
        body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 4096) return reply(413, { error: 'body_too_large' });
        }
        try { JSON.parse(body); } catch { return reply(400, { error: 'invalid_json' }); }
      }
      const upstream = await fetchImpl(new URL(route, baseUrl), {
        method: req.method, body, headers: { 'content-type': 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(8000),
      });
      reply(upstream.status, await upstream.json());
    } catch {
      reply(503, { service: 'stepon-ai-bridge', status: 'unavailable', error: 'ai_bridge_unavailable',
        ready: false, window_ready: false, fog_score: null, decision_score: null });
    }
  };
}
