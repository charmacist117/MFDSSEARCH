const { fetchMfdsText } = require("./mfds");

const VET_BASE_URL = "https://medi.qia.go.kr/searchMedicine";
const AQUATIC_BASE_URL = "https://www.nfqs.go.kr/apms/search/goodsList.ad";
const DETAIL_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DETAIL_CACHE_LIMIT = 300;
const detailMemoryCache = new Map();

function valueOf(value) {
  if (Array.isArray(value)) return value[0] || "";
  return value == null ? "" : String(value);
}

function decodeEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, code) => {
    const lower = code.toLowerCase();
    if (named[lower]) return named[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return "";
  });
}

function cleanText(html) {
  return decodeEntities(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function parseCells(rowHtml) {
  const cells = [];
  const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let cell;
  while ((cell = cellRe.exec(rowHtml))) {
    cells.push(cleanText(cell[1]));
  }
  return cells;
}

function parseRows(html) {
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(html))) {
    const cells = parseCells(row[1]);
    if (cells.length) rows.push({ html: row[1], cells });
  }
  return rows;
}

function parseTotal(html, fallback) {
  const text = cleanText(html);
  const totalMatch = text.match(/(?:총|전체)\s*([\d,]+)\s*건/);
  if (totalMatch) return Number(totalMatch[1].replace(/,/g, ""));
  return fallback;
}

function findDate(cells) {
  return cells.find((cell) => /\d{4}[-.]\d{2}[-.]\d{2}/.test(cell)) || "";
}

function includesText(source, query) {
  const needle = String(query || "").replace(/\s+/g, "").toLowerCase();
  if (!needle) return true;
  return String(source || "").replace(/\s+/g, "").toLowerCase().includes(needle);
}

function cached(cache, key, ttlMs) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.createdAt > ttlMs) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function cacheSet(cache, key, value, limit) {
  if (cache.size >= limit) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { createdAt: Date.now(), value });
  return value;
}

function resolvePublicUrl(candidate, sourceUrl) {
  const raw = decodeEntities(candidate || "").trim();
  if (!raw || raw === "#" || /^javascript:/i.test(raw)) return "";
  try {
    return new URL(raw, sourceUrl).toString();
  } catch {
    return "";
  }
}

function extractRowUrl(rowHtml, sourceUrl) {
  const hrefMatches = [...String(rowHtml || "").matchAll(/<a\b[^>]*href=(["'])(.*?)\1/gi)];
  for (const match of hrefMatches) {
    const resolved = resolvePublicUrl(match[2], sourceUrl);
    if (resolved) return resolved;
  }

  const onclickMatches = [...String(rowHtml || "").matchAll(/\bonclick=(["'])([\s\S]*?)\1/gi)];
  for (const match of onclickMatches) {
    const quoted = [...match[2].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
    for (const candidate of quoted) {
      const looksLikeUrl =
        /^(https?:|\/|\.{1,2}\/)/i.test(candidate) ||
        /\.(?:ad|do|jsp|html?)(?:[?#]|$)/i.test(candidate);
      if (!looksLikeUrl) continue;
      const resolved = resolvePublicUrl(candidate, sourceUrl);
      if (resolved) return resolved;
    }
  }

  return "";
}

function detailKeyFor(row, index) {
  return [
    row.sourceUrl,
    row.permitNumber,
    row.itemName,
    row.entpName,
    row.permitDate,
    index
  ]
    .filter(Boolean)
    .join("|");
}

function buildVetUrl(query = {}) {
  const params = new URLSearchParams({
    csSignature: "/pty5cD24mE8YS6L+3jPAw==",
    sort: "",
    sortOrder: "false",
    searchYn: "true",
    ExcelRowdata: "",
    page: valueOf(query.page) || "1",
    searchDivision: "detail",
    itemName: valueOf(query.productName),
    itemEngName: valueOf(query.productEngName),
    entpName: valueOf(query.companyName),
    indutyClassCode: valueOf(query.itemCategory),
    startPermitDate: valueOf(query.permitStart),
    endPermitDate: valueOf(query.permitEnd)
  });
  return `${VET_BASE_URL}?${params}`;
}

function parseVetHtml(html, sourceUrl) {
  const rows = parseRows(html)
    .filter((row) => row.cells.length >= 4 && !row.cells.join(" ").includes("제품명 업체명"))
    .map((row, index) => {
      const cells = row.cells;
      const itemName = cells[1] || cells[0] || "";
      const entpName = cells[3] || cells[2] || "";
      const detailUrl = extractRowUrl(row.html, sourceUrl);
      const item = {
        rowNumber: cells[0] || "",
        itemName,
        itemEngName: cells[2] || "",
        entpName,
        itemCategory: cells.find((cell) => /동물|의약|의료|보조|외품/.test(cell)) || "",
        permitDate: findDate(cells),
        note: cells.slice(4).filter(Boolean).join(" / "),
        rawCells: cells,
        sourceUrl: detailUrl || "",
        hasDetailUrl: Boolean(detailUrl)
      };
      item.detailKey = detailKeyFor(item, index);
      return item;
    })
    .filter((item) => item.itemName && item.entpName);

  const total = parseTotal(html, rows.length);
  return { total, items: rows };
}

function buildAquaticUrl(query = {}) {
  const params = new URLSearchParams({
    pageNo: valueOf(query.page) || "1",
    prdlstNm: valueOf(query.productName),
    goodsNm: valueOf(query.productName),
    bsshNm: valueOf(query.companyName),
    entrpsNm: valueOf(query.companyName),
    ingrNm: valueOf(query.ingredientName),
    fishNm: valueOf(query.fishName),
    dissNm: valueOf(query.disease),
    dosageForm: valueOf(query.dosageForm)
  });
  return `${AQUATIC_BASE_URL}?${params}`;
}

function parseAquaticHtml(html, sourceUrl, query = {}) {
  const rows = parseRows(html)
    .filter((row) => {
      const joined = row.cells.join(" ");
      return row.cells.length >= 7 && !joined.includes("허가번호 업체명 제품명");
    })
    .map((row, index) => {
      const cells = row.cells;
      const detailUrl = extractRowUrl(row.html, sourceUrl);
      const item = {
        permitNumber: cells[0] || "",
        entpName: cells[1] || "",
        itemName: cells[2] || "",
        dosageForm: cells[3] || "",
        route: cells[4] || "",
        firstPermitDate: cells[5] || "",
        permitDate: cells[6] || "",
        condition: cells[7] || "",
        note: cells[8] || "",
        rawCells: cells,
        sourceUrl: detailUrl || "",
        hasDetailUrl: Boolean(detailUrl)
      };
      item.detailKey = detailKeyFor(item, index);
      return item;
    })
    .filter((item) => {
      if (!item.itemName || !item.entpName) return false;
      if (!includesText(item.itemName, valueOf(query.productName))) return false;
      if (!includesText(item.entpName, valueOf(query.companyName))) return false;
      if (!includesText(item.dosageForm, valueOf(query.dosageForm))) return false;
      return true;
    });

  const total = parseTotal(html, rows.length);
  return { total, items: rows };
}

function pagePayload({ page, total, items, sourceUrl, notice = "" }) {
  const pageSize = items.length || 10;
  return {
    page,
    pageSize,
    total,
    totalPages: total ? Math.max(1, Math.ceil(total / pageSize)) : 1,
    items,
    notice,
    sourceUrl
  };
}

function allowedDetailHost(kind, sourceUrl) {
  try {
    const host = new URL(sourceUrl).hostname;
    if (kind === "vet") return host === "medi.qia.go.kr";
    if (kind === "aquatic") return host === "www.nfqs.go.kr" || host === "nfqs.go.kr";
  } catch {}
  return false;
}

function addPair(pairs, seen, key, value) {
  const label = cleanText(key);
  const text = cleanText(value);
  if (!label || !text) return;
  const fingerprint = `${label}:${text}`;
  if (seen.has(fingerprint)) return;
  seen.add(fingerprint);
  pairs.push([label, text]);
}

function parseGenericDetailHtml(html, sourceUrl) {
  const pairs = [];
  const seen = new Set();
  const tables = [];

  for (const row of parseRows(html)) {
    const cells = row.cells.map((cell) => cleanText(cell)).filter(Boolean);
    if (cells.length === 2) {
      addPair(pairs, seen, cells[0], cells[1]);
    } else if (cells.length === 4) {
      addPair(pairs, seen, cells[0], cells[1]);
      addPair(pairs, seen, cells[2], cells[3]);
    } else if (cells.length > 2) {
      tables.push(cells);
    }
  }

  const text = cleanText(html);
  const summary = text.length > 2600 ? `${text.slice(0, 2600)}...` : text;

  return {
    sourceUrl,
    pairs: pairs.slice(0, 80),
    tables: tables.slice(0, 8),
    summary: pairs.length ? "" : summary
  };
}

async function searchVetMedicines(query = {}) {
  const page = Math.max(Number(valueOf(query.page) || 1), 1);
  const sourceUrl = buildVetUrl({ ...query, page });
  const { text, url } = await fetchMfdsText(sourceUrl, 2, 15000);
  const parsed = parseVetHtml(text, url || sourceUrl);
  return pagePayload({ page, ...parsed, sourceUrl: url || sourceUrl });
}

async function searchAquaticMedicines(query = {}) {
  const page = Math.max(Number(valueOf(query.page) || 1), 1);
  const sourceUrl = buildAquaticUrl({ ...query, page });
  const { text, url } = await fetchMfdsText(sourceUrl, 2, 15000);
  const parsed = parseAquaticHtml(text, url || sourceUrl, query);
  return pagePayload({
    page,
    ...parsed,
    sourceUrl: url || sourceUrl,
    notice: "수산동물용 의약품은 국립수산물품질관리원 약품편람 목록을 기준으로 표시합니다."
  });
}

async function getPublicMedicineDetail({ kind, sourceUrl } = {}) {
  const normalizedKind = kind === "aquatic" ? "aquatic" : "vet";
  const targetUrl = valueOf(sourceUrl);
  if (!targetUrl) {
    return { kind: normalizedKind, sourceUrl: "", pairs: [], tables: [], summary: "" };
  }
  if (!allowedDetailHost(normalizedKind, targetUrl)) {
    throw new Error("허용되지 않은 상세 원문 주소입니다.");
  }

  const cacheKey = `${normalizedKind}:${targetUrl}`;
  const cachedValue = cached(detailMemoryCache, cacheKey, DETAIL_CACHE_TTL_MS);
  if (cachedValue) return cachedValue;

  const { text, url } = await fetchMfdsText(targetUrl, 2, 15000);
  const parsed = parseGenericDetailHtml(text, url || targetUrl);
  return cacheSet(detailMemoryCache, cacheKey, { kind: normalizedKind, ...parsed }, DETAIL_CACHE_LIMIT);
}

module.exports = {
  searchVetMedicines,
  searchAquaticMedicines,
  getPublicMedicineDetail
};
