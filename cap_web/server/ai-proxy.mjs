// Same-origin API for desktop and phone browsers. Python remains on loopback.
const routes = new Map([
  ['/api/ai/state', 'GET'], ['/api/ai/ping', 'GET'], ['/api/ai/events', 'GET'],
  ['/api/ai/calibration/start', 'POST'], ['/api/ai/calibration/cancel', 'POST'],
  ['/api/ai/datasets', 'GET'], ['/api/ai/datasets/validate', 'POST'], ['/api/ai/datasets/analyze', 'POST'],
  ['/api/ai/datasets/record/start', 'POST'], ['/api/ai/datasets/record/stop', 'POST'],
]);
export function createAiHandler({ baseUrl = process.env.STEPON_AI_URL || 'http://127.0.0.1:8787', fetchImpl = fetch } = {}) {
  return async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      const route = new URL(req.url, 'http://localhost').pathname;
      const datasetRead = /^\/api\/ai\/datasets\/[0-9a-f]{32}(?:\/(?:measurement\.csv|calibration\.csv|windows\.csv|result\.json|calibration\.json|manifest\.json|recording\.csv))?$/.test(route);
      if (!routes.has(route) && !datasetRead) return reply(404, { error: 'not_found' });
      if (req.method !== (routes.get(route) || 'GET')) return reply(405, { error: 'method_not_allowed' });
      let body;
      if (req.method === 'POST') {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return reply(403, { error: 'cross_origin_write_denied' });
        if (!String(req.headers['content-type']).startsWith('application/json')) return reply(415, { error: 'json_required' });
        const limit = ['/api/ai/datasets/validate', '/api/ai/datasets/analyze'].includes(route) ? 20 * 1024 * 1024 : 4096;
        const chunks = []; let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > limit) return reply(413, { error: 'body_too_large' });
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks).toString('utf8');
        try { JSON.parse(body); } catch { return reply(400, { error: 'invalid_json' }); }
      }
      const upstream = await fetchImpl(new URL(route, baseUrl), {
        method: req.method, body, headers: { 'content-type': 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(route.startsWith('/api/ai/datasets') ? 30000 : 8000),
      });
      if (upstream.ok && upstream.headers.get('content-disposition')?.startsWith('attachment;')) {
        res.writeHead(200, { 'content-type': upstream.headers.get('content-type'),
          'content-disposition': upstream.headers.get('content-disposition'), 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff' });
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } else reply(upstream.status, await upstream.json());
    } catch {
      reply(503, { service: 'stepon-ai-bridge', status: 'unavailable', error: 'ai_bridge_unavailable',
        ready: false, window_ready: false, fog_score: null, decision_score: null });
    }
  };
}
