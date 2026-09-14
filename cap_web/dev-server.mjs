import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRomHandler } from "./server/rom-store.mjs";
import { createTrendHandler } from "./server/trend-store.mjs";
import { createInsoleHub, createInsoleHandler, forwardInsoleRequest } from "./server/insole-hub.mjs";
import { createAiHandler } from "./server/ai-proxy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.argv[2] || 8000);
const host = process.argv[3] || "127.0.0.1";
const insoleHub = port === 8001 ? null : createInsoleHub();
const handleInsoles = insoleHub ? createInsoleHandler(insoleHub) : forwardInsoleRequest;
const handleAi = createAiHandler();
const sharedEditorStatePath = path.join(root, ".stepon-editor-state.json");
const handleRom = createRomHandler(process.env.STEPON_ROM_DATA_DIR || path.resolve(root, "..", ".stepon-data", "mediapipe"));
const handleTrends = createTrendHandler(process.env.STEPON_TREND_DATA_DIR || path.resolve(root, "..", ".stepon-data", "trends"));
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function resolveFile(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  // Keep the dedicated mobile surface bookmarkable while retaining this
  // dependency-free static server. The mobile app is selected by pathname in
  // main.js, so /mobile should serve the same entry document as /.
  if (pathname === "/mobile" || pathname.startsWith("/mobile/")) return path.join(root, "index.html");
  const requested = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
  const target = path.resolve(root, `.${requested}`);
  return target.startsWith(root + path.sep) ? target : null;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(JSON.stringify(payload));
}

function readSharedEditorState(callback) {
  fs.readFile(sharedEditorStatePath, "utf8", (error, contents) => {
    if (error) {
      fs.readFile(path.join(root, 'editor-state.default.json'), 'utf8', (fallbackError, fallback) => {
        try { callback(null, fallbackError ? {} : JSON.parse(fallback)); } catch { callback(null, {}); }
      });
      return;
    }
    try {
      const parsed = JSON.parse(contents);
      callback(null, parsed && typeof parsed === "object" ? parsed : {});
    } catch {
      callback(null, {});
    }
  });
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url || "/", `http://${host}`).pathname;
  if (pathname.startsWith('/api/ai/')) { void handleAi(request, response); return; }
  if (pathname.startsWith('/api/insoles/')) { void handleInsoles(request, response); return; }
  if (pathname === "/api/rom") { void handleRom(request, response); return; }
  if (pathname === "/api/trends") { void handleTrends(request, response); return; }
  if (pathname === "/api/editor-state") {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }
    if (request.method === "GET") {
      readSharedEditorState((error, state) => sendJson(response, error ? 500 : 200, state));
      return;
    }
    if (request.method === "POST") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
        if (body.length > 200_000) request.destroy();
      });
      request.on("end", () => {
        try {
          const parsed = JSON.parse(body || "{}");
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid state");
          fs.writeFile(sharedEditorStatePath, JSON.stringify(parsed), "utf8", (error) => sendJson(response, error ? 500 : 200, error ? { error: "write_failed" } : parsed));
        } catch {
          sendJson(response, 400, { error: "invalid_state" });
        }
      });
      return;
    }
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }
  const target = resolveFile(request.url || "/");
  if (!target) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }
  fs.stat(target, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": mimeTypes[path.extname(target).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" });
    fs.createReadStream(target).pipe(response);
  });
});

server.listen(port, host, () => {
  console.log(`StepOn local server listening at http://${host}:${server.address().port}/`);
});
