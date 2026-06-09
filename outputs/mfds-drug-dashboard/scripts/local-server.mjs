import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function readJsonData() {
  for (const name of ["drugs.json", "drugs.sample.json"]) {
    try {
      const content = await fs.readFile(path.join(root, "data", name), "utf8");
      return JSON.parse(content);
    } catch {
      // Try the next file.
    }
  }
  return [];
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function includes(source, query) {
  return !query || normalize(source).includes(normalize(query));
}

function searchItems(data, params) {
  return data.filter((drug) => {
    const ingredients = [
      drug.mainIngredient,
      drug.mainIngredientEng,
      ...(drug.ingredients || []).map((item) => `${item.name || ""} ${item.engName || ""}`)
    ].join(" ");

    return (
      includes(drug.itemName, params.get("productName")) &&
      includes(drug.entpName, params.get("companyName")) &&
      includes(ingredients, params.get("ingredient1")) &&
      includes(drug.itemSeq, params.get("itemSeq")) &&
      includes(drug.atcCode, params.get("atcCode"))
    );
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost:${port}`);

    if (url.pathname === "/api/search") {
      const data = await readJsonData();
      const items = searchItems(data, url.searchParams);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ total: items.length, items }));
      return;
    }

    if (url.pathname === "/api/detail") {
      const data = await readJsonData();
      const drug = data.find((item) => item.itemSeq === url.searchParams.get("itemSeq"));
      res.writeHead(drug ? 200 : 404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(drug || { error: "not_found" }));
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
