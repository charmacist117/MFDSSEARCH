const { fetchMfdsText } = require("./mfds");

const VET_BASE_URL = "https://medi.qia.go.kr/searchMedicine";
const AQUATIC_BASE_URL = "https://www.nfqs.go.kr/apms/search/goodsList.ad";
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const DETAIL_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const SEARCH_CACHE_LIMIT = 80;
const DETAIL_CACHE_LIMIT = 300;
const searchMemoryCache = new Map();
const detailMemoryCache = new Map();
const CACHE_KEY_IGNORE_FIELDS = new Set(["_v", "_global", "timeoutMs", "retries", "fastFail"]);

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

function stripUiTextArtifacts(text) {
  return String(text || "")
    .replace(/[^\n]*폴딩\s*버튼\s*-*>?/gi, "\n")
    .replace(/\b(?:PDF|XML|HTML)\s*다운로드\s*-*>?/gi, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/\s*-+>\s*/g, " ").replace(/\s+/g, " ").trim())
    .filter((line) => line && !/^[-–—>]+$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanText(html) {
  let cleanHtml = String(html || "")
    .replace(/<span\b[^>]*class=["']s-th["'][^>]*>[\s\S]*?<\/span>/gi, "");
  return stripUiTextArtifacts(decodeEntities(cleanHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()));
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
  const cleanHtml = String(html || "").replace(/<!--[\s\S]*?-->/g, "");
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(cleanHtml))) {
    const cells = parseCells(row[1]);
    if (cells.length) rows.push({ html: row[1], cells });
  }
  return rows;
}

function parsePaginationTotalPages(html) {
  const source = String(html || "");
  const numbers = [
    ...[...source.matchAll(/[?&]page(?:No)?=([0-9]+)/gi)].map((match) => Number(match[1])),
    ...[...source.matchAll(/pageNo\s*[:=]\s*['"]?([0-9]+)/gi)].map((match) => Number(match[1])),
    ...[...source.matchAll(/fn_egov_link_page\s*\(\s*([0-9]+)/gi)].map((match) => Number(match[1])),
    ...[...source.matchAll(/doPage\s*\(\s*([0-9]+)/gi)].map((match) => Number(match[1]))
  ].filter((page) => Number.isFinite(page) && page > 0);
  return numbers.length ? Math.max(...numbers) : 0;
}

function parseTotal(html, fallback) {
  const text = cleanText(html);
  const totalPatterns = [
    /(?:\uCD1D|\uC804\uCCB4)\s*([\d,]+)\s*\uAC74/,
    /total\s*[:=]?\s*([\d,]+)/i,
    /tot(?:al)?Cnt\s*[:=]\s*['"]?([\d,]+)/i
  ];
  for (const pattern of totalPatterns) {
    const totalMatch = text.match(pattern) || String(html || "").match(pattern);
    if (totalMatch) return Number(totalMatch[1].replace(/,/g, ""));
  }
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

function rowVisibleText(item) {
  return [
    item.itemName,
    item.itemEngName,
    item.entpName,
    item.itemCategory,
    item.dosageForm,
    item.route,
    item.condition,
    item.note,
    item.permitNumber,
    ...(item.rawCells || [])
  ].filter(Boolean).join(" ");
}

function requireVisibleMatches(item, values = []) {
  const text = rowVisibleText(item);
  return values.every((value) => includesText(text, value));
}

function effectiveQueryValues(query = {}, keys = []) {
  return keys
    .map((key) => valueOf(query[key]).trim())
    .filter(Boolean);
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

function buildQueryCacheKey(kind, query = {}, page = 1) {
  const normalized = { kind, page: String(page) };
  for (const key of Object.keys(query).sort()) {
    if (CACHE_KEY_IGNORE_FIELDS.has(key)) continue;
    const value = valueOf(query[key]);
    if (value) normalized[key] = value;
  }
  return JSON.stringify(normalized);
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
  const doViewMatch = /doView\s*\(\s*(['"]?)(\d+)\1/i.exec(rowHtml);
  if (doViewMatch) {
    const seq = doViewMatch[2];
    if (sourceUrl && sourceUrl.includes("nfqs.go.kr")) {
      return `https://www.nfqs.go.kr/apms/search/schGoodsView.ad?SEQ=${seq}`;
    }
  }

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

function ingredientValues(query = {}) {
  return [1, 2, 3, 4, 5]
    .map((index) => valueOf(query[`ingredient${index}`]).trim())
    .filter(Boolean);
}

function buildVetUrl(query = {}) {
  const ingredients = ingredientValues(query);
  const efficacyQuery = valueOf(query.efficacyQuery);
  const dosageQuery = valueOf(query.dosageQuery);
  const precautionQuery = valueOf(query.precautionQuery);
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
    endPermitDate: valueOf(query.permitEnd),
    ingrMainName: ingredients[0] || valueOf(query.ingredientName),
    ingrName1: ingredients[0] || "",
    ingrName2: ingredients[1] || "",
    ingrName3: ingredients[2] || "",
    ingrName4: ingredients[3] || "",
    ingrName5: ingredients[4] || "",
    eeDocData: efficacyQuery,
    effectDocData: efficacyQuery,
    effect: efficacyQuery,
    efficacy: efficacyQuery,
    efcyQesitm: efficacyQuery,
    udDocData: dosageQuery,
    usageDocData: dosageQuery,
    usage: dosageQuery,
    dosage: dosageQuery,
    nbDocData: precautionQuery,
    cautionDocData: precautionQuery,
    caution: precautionQuery,
    precaution: precautionQuery,
    searchConEe: valueOf(query.efficacyOperator) || "AND",
    searchConUd: valueOf(query.dosageOperator) || "AND",
    searchConNb: valueOf(query.precautionOperator) || "AND"
  });
  return `${VET_BASE_URL}?${params}`;
}

function parseVetHtml(html, sourceUrl, query = {}) {
  const rows = parseRows(html)
    .filter((row) => row.cells.length >= 4 && !row.cells.includes("순번"))
    .map((row, index) => {
      const cells = row.cells;
      const detailUrl = extractRowUrl(row.html, sourceUrl);
      const item = {
        rowNumber: cells[0] || "",
        itemName: cells[1] || "",
        itemEngName: cells[2] || "",
        entpName: cells[3] || "",
        productCode: cells[4] || "",
        permitNumber: cells[5] || "",
        itemCategory: cells.length >= 8 ? (cells[7] || "") : "",
        permitDate: cells.length >= 7 ? (cells[6] || "") : "",
        approvalKind: cells[10] || "",
        manufactureImport: cells[11] || "",
        importCountry: cells[12] || "",
        note: cells.length >= 13 ? [
          cells[4] ? `품목코드: ${cells[4]}` : "",
          cells[5] ? `허가번호: ${cells[5]}` : "",
          cells[10] ? `허가/신고: ${cells[10]}` : "",
          cells[11] ? `제조/수입: ${cells[11]}` : "",
          cells[12] ? `수입국: ${cells[12]}` : ""
        ].filter(Boolean).join(" / ") : cells.slice(4).filter(Boolean).join(" / "),
        rawCells: cells,
        sourceUrl: detailUrl || "",
        hasDetailUrl: Boolean(detailUrl)
      };
      item.detailKey = detailKeyFor(item, index);
      return item;
    })
    .filter((item) => item.itemName && item.entpName)
    .filter((item) =>
      requireVisibleMatches(item, effectiveQueryValues(query, [
        "productName",
        "productEngName",
        "companyName",
        "ingredient1",
        "ingredient2",
        "ingredient3",
        "ingredient4",
        "ingredient5",
        "efficacyQuery",
        "dosageQuery",
        "precautionQuery"
      ]))
    );

  const totalPages = parsePaginationTotalPages(html);
  const hasClientFilter = effectiveQueryValues(query, ["ingredient1", "ingredient2", "ingredient3", "ingredient4", "ingredient5", "efficacyQuery", "dosageQuery", "precautionQuery"]).length > 0;
  const total = hasClientFilter ? rows.length : parseTotal(html, totalPages ? totalPages * Math.max(rows.length, 10) : rows.length);
  return { total, totalPages: hasClientFilter ? 1 : totalPages, items: rows };
}

function buildAquaticUrl(query = {}) {
  const ingredients = ingredientValues(query);
  const ingredientQuery = ingredients.join(" ");
  const efficacyQuery = valueOf(query.efficacyQuery);
  const dosageQuery = valueOf(query.dosageQuery);
  const params = new URLSearchParams({
    pageNo: valueOf(query.page) || "1",
    prdlstNm: valueOf(query.productName),
    goodsNm: valueOf(query.productName),
    bsshNm: valueOf(query.companyName),
    entrpsNm: valueOf(query.companyName),
    ingrNm: ingredientQuery || valueOf(query.ingredientName),
    ingrNm1: ingredients[0] || "",
    ingrNm2: ingredients[1] || "",
    ingrNm3: ingredients[2] || "",
    ingrNm4: ingredients[3] || "",
    ingrNm5: ingredients[4] || "",
    effect: efficacyQuery,
    efficacy: efficacyQuery,
    efcyQesitm: efficacyQuery,
    usage: dosageQuery,
    dosage: dosageQuery,
    searchConEe: valueOf(query.efficacyOperator) || "AND",
    searchConUd: valueOf(query.dosageOperator) || "AND",
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
      return requireVisibleMatches(item, effectiveQueryValues(query, [
        "productName",
        "companyName",
        "ingredient1",
        "ingredient2",
        "ingredient3",
        "ingredient4",
        "ingredient5",
        "efficacyQuery",
        "dosageQuery",
        "fishName",
        "disease",
        "dosageForm"
      ]));
    });

  const totalPages = parsePaginationTotalPages(html);
  const hasClientFilter = effectiveQueryValues(query, ["ingredient1", "ingredient2", "ingredient3", "ingredient4", "ingredient5", "efficacyQuery", "dosageQuery", "fishName", "disease", "dosageForm"]).length > 0;
  const total = hasClientFilter ? rows.length : parseTotal(html, totalPages ? totalPages * Math.max(rows.length, 10) : rows.length);
  return { total, totalPages: hasClientFilter ? 1 : totalPages, items: rows };
}

function pagePayload({ page, total, totalPages, items, sourceUrl, notice = "" }) {
  const pageSize = items.length || 10;
  return {
    page,
    pageSize,
    total,
    totalPages: totalPages ? Math.max(1, totalPages) : total ? Math.max(1, Math.ceil(total / pageSize)) : 1,
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

function classifyTableTitle(title, rows) {
  const source = `${title || ""} ${rows.flat().join(" ")}`;
  if (/원료|성분|함량|분량|유효성분/i.test(source)) return "원료약품 및 분량";
  if (/체중|투여|용량|용법|급여/i.test(source)) return "체중별 투여량";
  if (/효능|효과|대상질병/i.test(source)) return "효능효과";
  if (/주의|금기|휴약/i.test(source)) return "주의사항";
  return title || "상세 표";
}

function parseTableBlocks(html) {
  const blocks = [];
  let currentTitle = "";
  const tokenRe = /<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>|<caption\b[^>]*>[\s\S]*?<\/caption>|<table\b[^>]*>[\s\S]*?<\/table>/gi;
  let token;
  while ((token = tokenRe.exec(html))) {
    const value = token[0];
    if (/^<table/i.test(value)) {
      const rows = parseRows(value).map((row) => row.cells.map((cell) => cleanText(cell)).filter(Boolean)).filter((row) => row.length);
      if (rows.length) {
        blocks.push({ title: classifyTableTitle(currentTitle, rows), rows });
      }
      currentTitle = "";
    } else {
      const title = cleanText(value);
      if (title) currentTitle = title;
    }
  }
  return blocks;
}

function extractKnownSections(text) {
  const headings = [
    ["원료약품 및 분량", /원료\s*약품\s*및\s*분량|성분\s*함량|유효\s*성분/i],
    ["효능효과", /효능\s*효과|효능\s*및\s*효과|대상\s*질병/i],
    ["용법용량", /용법\s*용량|용법\s*및\s*용량|투여\s*방법/i],
    ["저장방법", /저장\s*상\s*주의\s*사항|저장\s*방법|보관\s*방법/i],
    ["주의사항", /주의\s*사항|사용상\s*주의|금기|휴약/i]
  ];
  const matches = [];
  for (const [title, pattern] of headings) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (title === "주의사항" && /저장\s*상\s*$/.test(text.slice(Math.max(0, match.index - 12), match.index))) {
      continue;
    }
    matches.push({ title, index: match.index, length: match[0].length });
  }
  matches.sort((a, b) => a.index - b.index);
  return matches
    .map((match, index) => {
      const next = matches[index + 1];
      const body = text.slice(match.index + match.length, next ? next.index : undefined).trim();
      return { title: match.title, text: body };
    })
    .filter((section) => section.text && section.text.length > 6)
    .slice(0, 8);
}

function parseIngredientRowsFromText(text) {
  const unitPattern = "(?:mg|㎎|g|㎍|mcg|kg|mL|ml|L|IU|유니트|그램|밀리그램|마이크로그램|리터|밀리리터|%)";
  const rows = [];
  for (const rawLine of String(text || "").split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line || /성분명|함량|분량|단위|규격|순번/.test(line)) continue;
    const match = new RegExp(`^(.{2,}?)\\s+([\\d,.]+)\\s*(${unitPattern})\\b\\s*(.*)$`, "i").exec(line);
    if (!match) continue;
    rows.push({
      name: match[1].trim(),
      amount: match[2].trim(),
      unit: match[3].trim(),
      note: match[4].trim()
    });
  }
  return rows.slice(0, 80);
}

function parseGenericDetailHtml(html, sourceUrl) {
  const pairs = [];
  const seen = new Set();
  const tableBlocks = parseTableBlocks(html);

  for (const row of parseRows(html)) {
    const cells = row.cells.map((cell) => cleanText(cell)).filter(Boolean);
    if (cells.length === 2) {
      addPair(pairs, seen, cells[0], cells[1]);
    } else if (cells.length === 4) {
      addPair(pairs, seen, cells[0], cells[1]);
      addPair(pairs, seen, cells[2], cells[3]);
    }
  }

  const text = cleanText(html);
  const sections = extractKnownSections(text);
  const ingredientText = sections.find((section) => section.title === "원료약품 및 분량")?.text || "";
  const ingredientRows = parseIngredientRowsFromText(ingredientText);
  const summary = text.length > 2600 ? `${text.slice(0, 2600)}...` : text;

  return {
    sourceUrl,
    pairs: pairs.slice(0, 80),
    ingredientRows,
    sections,
    tables: tableBlocks.slice(0, 10),
    summary: pairs.length || tableBlocks.length || sections.length ? "" : summary
  };
}

async function searchVetMedicines(query = {}) {
  const page = Math.max(Number(valueOf(query.page) || 1), 1);
  const cacheKey = buildQueryCacheKey("vet", query, page);
  const cachedValue = cached(searchMemoryCache, cacheKey, SEARCH_CACHE_TTL_MS);
  if (cachedValue) return cachedValue;

  const sourceUrl = buildVetUrl({ ...query, page });
  const retries = Number(valueOf(query.retries) || 2);
  const timeoutMs = Number(valueOf(query.timeoutMs) || 15000);
  const fastFail = valueOf(query.fastFail) === "1";
  const { text, url } = await fetchMfdsText(sourceUrl, retries, timeoutMs, { fallbackOnFetchError: !fastFail });
  const parsed = parseVetHtml(text, url || sourceUrl, query);
  return cacheSet(searchMemoryCache, cacheKey, pagePayload({ page, ...parsed, sourceUrl: url || sourceUrl }), SEARCH_CACHE_LIMIT);
}

async function searchAquaticMedicines(query = {}) {
  const page = Math.max(Number(valueOf(query.page) || 1), 1);
  const cacheKey = buildQueryCacheKey("aquatic", query, page);
  const cachedValue = cached(searchMemoryCache, cacheKey, SEARCH_CACHE_TTL_MS);
  if (cachedValue) return cachedValue;

  const sourceUrl = buildAquaticUrl({ ...query, page });
  const retries = Number(valueOf(query.retries) || 2);
  const timeoutMs = Number(valueOf(query.timeoutMs) || 15000);
  const fastFail = valueOf(query.fastFail) === "1";
  const { text, url } = await fetchMfdsText(sourceUrl, retries, timeoutMs, { fallbackOnFetchError: !fastFail });
  const parsed = parseAquaticHtml(text, url || sourceUrl, query);
  return cacheSet(searchMemoryCache, cacheKey, pagePayload({
    page,
    ...parsed,
    sourceUrl: url || sourceUrl,
    notice: "수산동물용 의약품은 국립수산물품질관리원 약품편람 목록을 기준으로 표시합니다."
  }), SEARCH_CACHE_LIMIT);
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
