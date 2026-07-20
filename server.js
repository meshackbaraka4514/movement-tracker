const http = require("http");
const fs = require("fs/promises");
const path = require("path");

const DEFAULT_PORT = 4173;
const DEFAULT_HOST = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const MAX_POINTS = 1000;
const MAX_BODY_BYTES = 64 * 1024;
const rootDir = __dirname;
const tracks = new Map();

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
]);

function createServer() {
  return http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", `http://${DEFAULT_HOST}:${DEFAULT_PORT}`);

      if (requestUrl.pathname.startsWith("/api/tracks/")) {
        await handleApi(request, response, requestUrl);
        return;
      }

      await serveStatic(response, requestUrl.pathname);
    } catch (error) {
      sendJson(response, 500, { error: "Server error" });
    }
  });
}

async function handleApi(request, response, requestUrl) {
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  const code = sanitizeSessionId(parts[2]);
  const action = parts[3] || "";

  if (!code) {
    sendJson(response, 400, { error: "Missing session code" });
    return;
  }

  if (request.method === "GET" && action === "") {
    sendJson(response, 200, getTrackSnapshot(code));
    return;
  }

  if (request.method === "POST" && action === "points") {
    const body = await readJsonBody(request);
    const point = normalizePoint(body.point);

    if (!point) {
      sendJson(response, 400, { error: "Invalid point" });
      return;
    }

    const track = getOrCreateTrack(code);
    track.points.push(point);
    track.points = track.points.slice(-MAX_POINTS);
    track.active = true;
    track.updatedAt = Date.now();
    sendJson(response, 200, { ok: true, count: track.points.length });
    return;
  }

  if (request.method === "POST" && action === "status") {
    const body = await readJsonBody(request);
    const track = getOrCreateTrack(code);
    track.active = Boolean(body.active);
    track.updatedAt = Date.now();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "DELETE" && action === "") {
    tracks.delete(code);
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

function getOrCreateTrack(code) {
  if (!tracks.has(code)) {
    tracks.set(code, {
      code,
      active: false,
      updatedAt: null,
      points: [],
    });
  }

  return tracks.get(code);
}

function getTrackSnapshot(code) {
  return tracks.get(code) || {
    code,
    active: false,
    updatedAt: null,
    points: [],
  };
}

function normalizePoint(point) {
  if (!point || typeof point !== "object") {
    return null;
  }

  const next = {
    id: String(point.id || `${Date.now()}`),
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
    accuracy: numberOrNull(point.accuracy),
    altitude: numberOrNull(point.altitude),
    heading: numberOrNull(point.heading),
    speed: numberOrNull(point.speed),
    timestamp: Number(point.timestamp || Date.now()),
  };

  if (
    !Number.isFinite(next.latitude) ||
    !Number.isFinite(next.longitude) ||
    !Number.isFinite(next.timestamp) ||
    Math.abs(next.latitude) > 90 ||
    Math.abs(next.longitude) > 180
  ) {
    return null;
  }

  return next;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeSessionId(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 24);
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Body too large");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(response, pathname) {
  let safePath = decodeURIComponent(pathname);

  if (safePath === "/") {
    safePath = "/index.html";
  }

  if (safePath === "/dashboard") {
    safePath = "/dashboard.html";
  }

  const targetPath = path.resolve(rootDir, `.${safePath}`);
  const rootWithSeparator = rootDir.endsWith(path.sep) ? rootDir : `${rootDir}${path.sep}`;

  if (targetPath !== rootDir && !targetPath.startsWith(rootWithSeparator)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(targetPath);
    send(response, 200, data, mimeTypes.get(path.extname(targetPath)) || "application/octet-stream");
  } catch {
    sendText(response, 404, "Not found");
  }
}

function sendJson(response, status, payload) {
  send(response, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function sendText(response, status, text) {
  send(response, status, text, "text/plain; charset=utf-8");
}

function send(response, status, body, contentType) {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

if (require.main === module) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  createServer().listen(port, DEFAULT_HOST, () => {
    console.log(`Movement Tracker running at http://${DEFAULT_HOST}:${port}/`);
  });
}

module.exports = { createServer };
