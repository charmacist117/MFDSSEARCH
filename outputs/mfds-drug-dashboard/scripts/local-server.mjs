import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import dns from "node:dns";

if (dns && dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}

const require = createRequire(import.meta.url);
const { searchMfds, getMfdsDetail, getMfdsDetailsBatch } = require("../lib/mfds.js");
const { searchVetMedicines, searchAquaticMedicines, getPublicMedicineDetail } = require("../lib/public-medicines.js");
const { globalSearch } = require("../lib/global-search.js");
const { changesForCategory, changesCsv, CATEGORY_LABELS } = require("../lib/change-log.js");

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
        console.error("Search API Failure:", error);
        const detailMsg = error.cause ? `${error.message} (cause: ${error.cause.message || error.cause})` : error.message;
        sendJson(res, 502, { error: "mfds_search_failed", message: detailMsg });
      }
      return;
    }

    if (url.pathname === "/api/vet-search") {
      try {
        sendJson(res, 200, await searchVetMedicines(Object.fromEntries(url.searchParams.entries())));
      } catch (error) {
        console.error("Vet Search API Failure:", error);
        const detailMsg = error.cause ? `${error.message} (cause: ${error.cause.message || error.cause})` : error.message;
        sendJson(res, 502, { error: "vet_search_failed", message: detailMsg });
      }
      return;
    }

    if (url.pathname === "/api/aquatic-search") {
      try {
        sendJson(res, 200, await searchAquaticMedicines(Object.fromEntries(url.searchParams.entries())));
      } catch (error) {
        console.error("Aquatic Search API Failure:", error);
        const detailMsg = error.cause ? `${error.message} (cause: ${error.cause.message || error.cause})` : error.message;
        sendJson(res, 502, { error: "aquatic_search_failed", message: detailMsg });
      }
      return;
    }

    if (url.pathname === "/api/global-search") {
      try {
        sendJson(res, 200, await globalSearch(Object.fromEntries(url.searchParams.entries())));
      } catch (error) {
        console.error("Global Search API Failure:", error);
        const detailMsg = error.cause ? `${error.message} (cause: ${error.cause.message || error.cause})` : error.message;
        sendJson(res, 502, { error: "global_search_failed", message: detailMsg });
      }
      return;
    }

    if (url.pathname === "/api/public-detail") {
      try {
        sendJson(res, 200, await getPublicMedicineDetail(Object.fromEntries(url.searchParams.entries())));
      } catch (error) {
        console.error("Public Detail API Failure:", error);
        const detailMsg = error.cause ? `${error.message} (cause: ${error.cause.message || error.cause})` : error.message;
        sendJson(res, 502, { error: "public_detail_failed", message: detailMsg });
      }
      return;
    }

    if (url.pathname === "/api/detail") {
      try {
        sendJson(res, 200, await getMfdsDetail(url.searchParams.get("itemSeq")));
      } catch (error) {
        console.error("Detail API Failure:", error);
        const detailMsg = error.cause ? `${error.message} (cause: ${error.cause.message || error.cause})` : error.message;
        sendJson(res, 502, { error: "mfds_detail_failed", message: detailMsg });
      }
      return;
    }

    if (url.pathname === "/api/detail-batch") {
      try {
        const rawSeqs = url.searchParams.get("itemSeqs") || url.searchParams.get("itemSeq") || "";
        const itemSeqs = rawSeqs.split(",").map((seq) => seq.trim()).filter(Boolean);
        sendJson(res, 200, await getMfdsDetailsBatch(itemSeqs, 5));
      } catch (error) {
        console.error("Detail Batch API Failure:", error);
        const detailMsg = error.cause ? `${error.message} (cause: ${error.cause.message || error.cause})` : error.message;
        sendJson(res, 502, { error: "mfds_detail_batch_failed", message: detailMsg });
      }
      return;
    }

    if (url.pathname === "/api/changes") {
      sendJson(res, 200, await changesForCategory(url.searchParams.get("category") || "human", {
        live: url.searchParams.get("live") === "1",
        days: url.searchParams.get("days")
      }));
      return;
    }

    if (url.pathname === "/api/changes-csv") {
      const category = CATEGORY_LABELS[url.searchParams.get("category")] ? url.searchParams.get("category") : "human";
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename=medicine-changes-${category}.csv`
      });
      res.end(await changesCsv(category));
      return;
    }

    if (url.pathname === "/api/csv" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const { query = {}, cache = {} } = parsed;

          // Inline CSV generation (mirrors api/csv.js logic)
          function toCsvVal(value) {
            const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
            return `"${text.replaceAll('"', '""')}"`;
          }
          function mergeNonEmpty(base, overlay) {
            const result = { ...base };
            for (const [key, value] of Object.entries(overlay || {})) {
              if (value === "" && result[key] && result[key] !== "") continue;
              result[key] = value;
            }
            return result;
          }

          const firstPage = await searchMfds({ ...query, page: 1 });
          const total = firstPage.total || 0;
          let items = [...(firstPage.items || [])];
          const maxItems = 1500;
          const pageSize = firstPage.pageSize || 15;

          if (total > items.length && items.length < maxItems) {
            const totalPages = Math.ceil(total / pageSize);
            const maxPages = Math.ceil(maxItems / pageSize);
            for (let p = 2; p <= Math.min(totalPages, maxPages); p += 5) {
              const chunk = [];
              for (let i = p; i < Math.min(p + 5, Math.min(totalPages, maxPages) + 1); i++) chunk.push(i);
              const results = await Promise.all(chunk.map(async (pg) => {
                try { return (await searchMfds({ ...query, page: pg })).items || []; } catch { return []; }
              }));
              results.forEach((pageItems) => items.push(...pageItems));
            }
          }
          items = items.slice(0, maxItems);

          // Fetch details for first 30 items
          const detailed = [];
          const subset = items.slice(0, 30);
          for (let i = 0; i < subset.length; i += 3) {
            const chunk = subset.slice(i, i + 3);
            const results = await Promise.all(chunk.map(async (item) => {
              const c = cache[item.itemSeq];
              if (c && (c.contractManufacturer || c.performance)) return mergeNonEmpty(item, c);
              try { return mergeNonEmpty(item, await getMfdsDetail(item.itemSeq)); } catch { return item; }
            }));
            detailed.push(...results);
          }
          const finalItems = [
            ...detailed,
            ...items.slice(30).map((item) => { const c = cache[item.itemSeq]; return c ? mergeNonEmpty(item, c) : item; })
          ];

          // Collect performance years
          const years = new Set();
          finalItems.forEach((drug) => {
            if (drug.performance?.rows) drug.performance.rows.forEach((r) => { if (/^\d{4}$/.test(r.year)) years.add(Number(r.year)); });
          });
          const perfYears = Array.from(years).sort((a, b) => a - b);

          const headers = [
            ["rowNumber","순번"],["itemSeq","품목기준코드"],["itemName","제품명"],["itemEngName","제품영문명"],
            ["entpName","업체명"],["entpEngName","업체영문명"],["contractManufacturer","위탁제조업체"],
            ["etcOtc","전문/일반"],["permitDate","허가일"],["itemCategory","품목구분"],
            ["cancelStatus","취소/취하"],["makeMaterial","완제/원료"],["mainIngredient","주성분"],
            ["mainIngredientEng","주성분영문명"],["additives","첨가제"],["standardCode","표준코드"],["atcCode","ATC코드"]
          ];
          perfYears.forEach((y) => headers.push([`perf_${y}`, `${y}년 실적`]));

          const lines = [headers.map(([,l]) => toCsvVal(l)).join(",")];
          finalItems.forEach((drug, idx) => {
            lines.push(headers.map(([key]) => {
              if (key === "rowNumber") return toCsvVal(String(idx + 1));
              if (key.startsWith("perf_")) {
                const y = Number(key.split("_")[1]);
                const p = drug.performance;
                if (!p?.rows?.length) return toCsvVal("-");
                const r = p.rows.find((x) => Number(x.year) === y);
                if (!r) return toCsvVal("-");
                const sym = (p.unit||"").includes("달러") || (p.unit||"").includes("$") ? "$" : "₩";
                const suf = sym === "₩" && (p.unit||"").includes("천원") ? " (천원)" : "";
                return toCsvVal(`${p.type}: ${sym}${r.amount}${suf}`);
              }
              return toCsvVal(drug[key]);
            }).join(","));
          });

          res.writeHead(200, {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": "attachment; filename=export.csv"
          });
          res.end("\ufeff" + lines.join("\r\n"));
        } catch (error) {
          console.error("CSV API Failure:", error);
          sendJson(res, 502, { error: "mfds_csv_failed", message: error.message });
        }
      });
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
