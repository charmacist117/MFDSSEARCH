import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { searchMfds, getMfdsDetail } = require("../lib/mfds.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(res, code, payload) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost:${port}`);

    if (url.pathname === "/api/search") {
      try {
        sendJson(res, 200, await searchMfds(Object.fromEntries(url.searchParams.entries())));
      } catch (error) {
        sendJson(res, 502, { error: "mfds_search_failed", message: error.message });
      }
      return;
    }

    if (url.pathname === "/api/detail") {
      try {
        sendJson(res, 200, await getMfdsDetail(url.searchParams.get("itemSeq")));
      } catch (error) {
        sendJson(res, 502, { error: "mfds_detail_failed", message: error.message });
      }
      return;
    }

    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const target = path.resolve(root, requested.replace(/^\/+/, ""));
    if (!target.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const body = await fs.readFile(target);
    res.writeHead(200, { "content-type": mime[path.extname(target)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`MFDS dashboard running at http://localhost:${port}`);
});
