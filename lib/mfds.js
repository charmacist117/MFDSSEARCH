const dns = require("node:dns");
const https = require("node:https");
if (dns && dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}
const {
  valueOf,
  delay,
  isRetriableFetchError,
  decodeEntities,
  stripScripts,
  textFromHtml,
  normalizeText,
  includesText,
  mapConcurrent,
  MemoryCache
} = require("./utils");

const BASE_URL = "https://nedrug.mfds.go.kr";
const MFDS_FETCH_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
};
const MFDS_HTTPS_HEADERS = {
  ...MFDS_FETCH_HEADERS,
  "accept-encoding": "identity",
  "connection": "close"
};
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const DETAIL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_CACHE_LIMIT = 80;
const DETAIL_CACHE_LIMIT = 500;
const CONTRACT_SEARCH_NOTICE = "위탁제조업체는 허가자 업체명과 분리해 상세정보의 위탁제조업체 값으로만 필터링합니다.";
const searchMemoryCache = new MemoryCache(SEARCH_CACHE_LIMIT, SEARCH_CACHE_TTL_MS);
const detailMemoryCache = new MemoryCache(DETAIL_CACHE_LIMIT, DETAIL_CACHE_TTL_MS);
const CACHE_KEY_IGNORE_FIELDS = new Set([
  "_v",
  "_global",
  "timeoutMs",
  "retries",
  "fastFail",
  "detailTimeoutMs",
  "detailRetries"
]);

const DEFAULT_CRITERIA = {
  sort: "",
  sortOrder: "false",
  searchYn: "true",
  ExcelRowdata: "",
  page: "1",
  searchDivision: "detail",
  itemName: "",
  itemEngName: "",
  entpName: "",
  entpEngName: "",
  ingrName1: "",
  ingrName2: "",
  ingrName3: "",
  ingrEngName: "",
  itemSeq: "",
  stdrCodeName: "",
  atcCodeName: "",
  indutyClassCode: "",
  sClassNo: "",
  narcoticKindCode: "",
  cancelCode: "",
  etcOtcCode: "",
  makeMaterialGb: "",
  searchConEe: "AND",
  eeDocData: "",
  searchConUd: "AND",
  udDocData: "",
  searchConNb: "AND",
  nbDocData: "",
  startPermitDate: "",
  endPermitDate: ""
};

function buildQueryCacheKey(query = {}) {
  const normalized = { page: valueOf(query.page) || "1" };
  for (const key of Object.keys(query).sort()) {
    if (CACHE_KEY_IGNORE_FIELDS.has(key)) continue;
    const value = valueOf(query[key]);
    if (value) normalized[key] = value;
  }
  return JSON.stringify(normalized);
}

function buildSearchCriteria(query = {}) {
  return {
    ...DEFAULT_CRITERIA,
    page: valueOf(query.page) || "1",
    itemName: valueOf(query.productName),
    itemEngName: valueOf(query.productEngName),
    entpName: valueOf(query.companyName),
    entpEngName: valueOf(query.companyEngName),
    ingrName1: valueOf(query.ingredient1),
    ingrName2: valueOf(query.ingredient2),
    ingrName3: valueOf(query.ingredient3),
    ingrEngName: valueOf(query.ingredientEngName),
    itemSeq: valueOf(query.itemSeq),
    stdrCodeName: valueOf(query.standardCode),
    atcCodeName: valueOf(query.atcCode),
    indutyClassCode: valueOf(query.itemCategory),
    cancelCode: valueOf(query.cancelStatus),
    etcOtcCode: valueOf(query.etcOtc),
    makeMaterialGb: valueOf(query.makeMaterial),
    searchConEe: valueOf(query.efficacyOperator) || "AND",
    eeDocData: valueOf(query.efficacyQuery),
    searchConUd: valueOf(query.dosageOperator) || "AND",
    udDocData: valueOf(query.dosageQuery),
    searchConNb: valueOf(query.precautionOperator) || "AND",
    nbDocData: valueOf(query.precautionQuery),
    startPermitDate: valueOf(query.permitStart),
    endPermitDate: valueOf(query.permitEnd)
  };
}

function buildSearchUrl(query = {}) {
  return `${BASE_URL}/searchDrug?${new URLSearchParams(buildSearchCriteria(query))}`;
}

function httpsTextRequest(url, timeoutMs = 15000, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: MFDS_HTTPS_HEADERS,
        timeout: timeoutMs,
        rejectUnauthorized: false, // Bypass SSL validation for GPKI / government certs
        lookup(hostname, options, callback) {
          dns.lookup(hostname, { ...options, family: 4 }, callback);
        }
      },
      (res) => {
        const location = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && location && redirectCount < 4) {
          res.resume();
          const redirected = new URL(location, target).toString();
          httpsTextRequest(redirected, timeoutMs, redirectCount + 1).then(resolve, reject);
          return;
        }

        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const error = new Error(`${res.statusCode} ${res.statusMessage || "HTTP error"}`);
            error.status = res.statusCode;
            reject(error);
            return;
          }
          resolve({ url: target.toString(), text });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("MFDS request timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

async function fetchMfdsText(url, retries = 2, timeoutMs = 15000, options = {}) {
  const fallbackOnFetchError = options.fallbackOnFetchError !== false;
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: MFDS_FETCH_HEADERS,
        redirect: "follow",
        signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error(`${response.status} ${response.statusText}`);
        error.status = response.status;
        throw error;
      }
      return { url: response.url, text: await response.text() };
    } catch (error) {
      lastError = error;
      if (fallbackOnFetchError && isRetriableFetchError(error)) {
        try {
          return await httpsTextRequest(url, timeoutMs);
        } catch (fallbackError) {
          lastError = fallbackError;
        }
      }
      if (attempt < retries && isRetriableFetchError(error)) {
        await delay(450 * attempt);
      } else {
        break;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function sanitizeDocHtml(html) {
  const allowed = new Set([
    "br",
    "p",
    "div",
    "span",
    "strong",
    "b",
    "em",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td"
  ]);

  return decodeEntities(stripScripts(html))
    .replace(/<a\b[^>]*>/gi, "<span>")
    .replace(/<\/a>/gi, "</span>")
    .replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (match, slash, tag, attrs) => {
      const lowerTag = tag.toLowerCase();
      if (!allowed.has(lowerTag)) return "";
      if (slash) return `</${lowerTag}>`;
      if (lowerTag === "td" || lowerTag === "th") {
        const colspan = String(attrs || "").match(/\bcolspan=["']?(\d+)/i)?.[1];
        const rowspan = String(attrs || "").match(/\browspan=["']?(\d+)/i)?.[1];
        const safeAttrs = [
          colspan ? `colspan="${colspan}"` : "",
          rowspan ? `rowspan="${rowspan}"` : ""
        ].filter(Boolean).join(" ");
        return `<${lowerTag}${safeAttrs ? ` ${safeAttrs}` : ""}>`;
      }
      return `<${lowerTag}>`;
    })
    .replace(/\s(?:on\w+|style|class|id|href|src|th:[\w-]+)=["'][^"']*["']/gi, "")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();
}

function cleanText(html) {
  return textFromHtml(html).replace(/\s+/g, " ").trim();
}


function stripDerivedSearchFields(query = {}) {
  const clean = { ...query };
  delete clean.contractManufacturer;
  delete clean.ingredient4;
  delete clean.ingredient5;
  return clean;
}

function mergeListDetail(item, detail) {
  return {
    ...item,
    contractManufacturer: detail.contractManufacturer || item.contractManufacturer || "",
    mainIngredient: detail.mainIngredient || item.mainIngredient || "",
    unitDose: detail.unitDose || item.unitDose || "",
    standardCode: detail.standardCode || item.standardCode || "",
    atcCode: detail.atcCode || item.atcCode || "",
    performance: detail.performance || item.performance || null
  };
}

function contractSearchMatches(item, contractManufacturer) {
  return includesText(item.contractManufacturer, contractManufacturer);
}

function filterExtraIngredients(items, ingredient4, ingredient5) {
  if (!ingredient4 && !ingredient5) return items;
  return items.filter((item) => {
    const src = item.mainIngredient || "";
    if (ingredient4 && !includesText(src, ingredient4)) return false;
    if (ingredient5 && !includesText(src, ingredient5)) return false;
    return true;
  });
}


function stripMobileHeader(cellHtml) {
  return String(cellHtml || "").replace(/<span[^>]*class=["'][^"']*s-th[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, "");
}

function parseCells(rowHtml) {
  const cells = [];
  const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let match;
  while ((match = cellRe.exec(rowHtml))) {
    cells.push(cleanText(stripMobileHeader(match[1])));
  }
  return cells;
}

function parseTables(sectionHtml) {
  const tables = [];
  const source = stripScripts(sectionHtml);
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let table;
  while ((table = tableRe.exec(source))) {
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let row;
    while ((row = rowRe.exec(table[0]))) {
      const cells = parseCells(row[1]).filter((cell) => cell !== "");
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

function parseKeyValueRows(sectionHtml) {
  const values = {};
  for (const table of parseTables(sectionHtml)) {
    for (const row of table) {
      for (let i = 0; i < row.length - 1; i += 2) {
        const key = row[i].replace(/\s+/g, "");
        const value = row[i + 1]?.trim();
        if (key && value && !values[key]) values[key] = value;
      }
    }
  }
  return values;
}

function parseTotal(html) {
  const titleMatch = html.match(/title=["']총\s*([\d,]+)\s*건["']/);
  if (titleMatch) return Number(titleMatch[1].replace(/,/g, ""));
  const strongMatch = html.match(/총\s*<strong>\s*([\d,]+)\s*<\/strong>\s*건/);
  if (strongMatch) return Number(strongMatch[1].replace(/,/g, ""));
  return 0;
}

function parseTableCellBlocks(rowHtml) {
  const cells = [];
  const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let match;
  while ((match = tdRe.exec(rowHtml))) cells.push(match[1]);
  return cells;
}

function cellValue(cellHtml) {
  return cleanText(stripMobileHeader(cellHtml)).replace(/^\s*-\s*$/, "");
}

function parseSearchHtml(html) {
  const total = parseTotal(html);
  const tbodyStart = html.indexOf("<tbody");
  const tbodyEnd = html.indexOf("</tbody>", tbodyStart);
  const tbody = tbodyStart >= 0 && tbodyEnd > tbodyStart ? html.slice(tbodyStart, tbodyEnd) : html;
  const items = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;

  while ((row = rowRe.exec(tbody))) {
    const rowHtml = stripScripts(row[1]);
    const href = rowHtml.match(/getItemDetail\?itemSeq=(\d+)/);
    if (!href) continue;
    const itemSeq = href[1];
    const cells = parseTableCellBlocks(rowHtml).map(cellValue);
    const anchor = rowHtml.match(/<a\b[^>]*getItemDetail\?itemSeq=\d+[^>]*>([\s\S]*?)<\/a>/i);

    items.push({
      rowNumber: cells[0] || "",
      itemSeq,
      itemName: anchor ? cleanText(anchor[1]) : cells[1] || "",
      itemEngName: cells[2] || "",
      entpName: cells[3] || "",
      entpEngName: cells[4] || "",
      permitNumber: cells[6] || "",
      permitDate: cells[7] || "",
      itemCategory: cells[8] || "",
      cancelStatus: cells[9] || "",
      cancelDate: cells[10] || "",
      mainIngredient: cells[11] || "",
      mainIngredientEng: cells[12] || "",
      unitDose: "",
      additives: (cells[13] || "").split(/\s*,\s*/).filter(Boolean),
      itemClass: cells[16] || "",
      etcOtc: cells[17] || "",
      makeMaterial: cells[18] || "",
      approvalType: cells[19] || "",
      manufactureImport: cells[20] || "",
      importCountry: cells[21] || "",
      narcoticType: cells[22] || "",
      newDrug: cells[23] || "",
      standardCode: cells[24] || "",
      atcCode: cells[25] || "",
      sourceUrl: `${BASE_URL}/pbp/CCBBB01/getItemDetail?itemSeq=${itemSeq}`
    });
  }

  return { total, items };
}

function extractSection(html, id, nextId) {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return "";
  const elementStart = html.lastIndexOf("<div", start);
  const next = nextId ? html.indexOf(`id="${nextId}"`, start + 1) : -1;
  if (next > 0) return html.slice(elementStart, html.lastIndexOf("<div", next));
  return html.slice(elementStart);
}

function extractElementById(html, id) {
  const idIndex = html.indexOf(`id="${id}"`);
  if (idIndex < 0) return "";
  const start = html.lastIndexOf("<div", idIndex);
  if (start < 0) return "";
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tagRe.exec(html))) {
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return html.slice(start, tagRe.lastIndex);
    } else {
      depth += 1;
    }
  }
  return html.slice(start);
}

function extractIngredientHeadings(sectionHtml) {
  const headingRe = /<h3\b[^>]*class=["'][^"']*cont_title3[^"']*["'][^>]*>([\s\S]*?)<\/h3>/gi;
  const headings = [];
  let heading;
  while ((heading = headingRe.exec(sectionHtml))) {
    headings.push({
      basis: cleanText(heading[1]).replace(/-$/, "").trim(),
      index: heading.index
    });
  }

  if (!headings.length) headings.push({ basis: "", index: 0 });
  return headings;
}

function normalizeUnitDoseBasis(value) {
  return cleanText(value)
    .replace(/\s*-\s*$/, "")
    .replace(/\s*중\s*(?:-\s*.*)?$/, "")
    .trim();
}

function formatUnitDoseValues(values) {
  const unique = [];
  values.forEach((value) => {
    const normalized = normalizeUnitDoseBasis(value);
    if (normalized && !unique.includes(normalized)) unique.push(normalized);
  });
  if (unique.length <= 1) return unique[0] || "";
  return unique
    .map((value, index) => (/^\(?\d+\)/.test(value) ? value : `(${index + 1}) ${value}`))
    .join("\n");
}

function parseUnitDose(sectionHtml, ingredients = []) {
  const fromIngredients = ingredients.map((item) => item.basis);
  const fromHeadings = extractIngredientHeadings(sectionHtml).map((item) => item.basis);
  return formatUnitDoseValues([...fromIngredients, ...fromHeadings]);
}

function parseIngredients(sectionHtml) {
  const ingredients = [];
  const headings = extractIngredientHeadings(sectionHtml);
  headings.forEach((item, index) => {
    const end = headings[index + 1]?.index ?? sectionHtml.length;
    const chunk = sectionHtml.slice(item.index, end);
    for (const table of parseTables(chunk)) {
      for (const row of table) {
        if (row.includes("성분명") || row.length < 5) continue;
        const [order, name, amount, unit, standard, ingredientInfo, comparison] = row;
        if (!/^\d+$/.test(order || "")) continue;
        ingredients.push({
          basis: item.basis,
          order,
          name,
          amount,
          unit,
          standard,
          ingredientInfo,
          comparison
        });
      }
    }
  });

  return ingredients;
}

function parseAdditives(sectionHtml) {
  const text = textFromHtml(sectionHtml);
  const match = text.match(/첨가제\s*:\s*([^\n]+)/);
  if (!match) return [];
  return match[1].split(/\s*,\s*/).map((item) => item.trim()).filter(Boolean);
}

function parseDur(sectionHtml) {
  const records = [];
  for (const table of parseTables(sectionHtml)) {
    for (const row of table) {
      if (row.includes("DUR유형") || row.length < 3) continue;
      const [composition, ingredient, type, dosageForm, caution, note] = row;
      if (!ingredient && !type) continue;
      records.push({ composition, ingredient, type, dosageForm, caution, note });
    }
  }
  return records;
}

function parsePerformance(sectionHtml) {
  const text = cleanText(sectionHtml);
  const type = text.includes("수입실적") ? "수입실적" : text.includes("생산실적") ? "생산실적" : "";
  if (!type) return null;
  const unitMatch = text.match(new RegExp(`${type}\\s*\\((단위\\s*:\\s*[^)]+)\\)`));
  const rows = [];

  for (const table of parseTables(sectionHtml)) {
    const header = table[0]?.join(" ");
    if (!header || !header.includes("년도") || !header.includes(type)) continue;
    for (const row of table.slice(1)) {
      if (/^\d{4}$/.test(row[0] || "") && row[1]) rows.push({ year: row[0], amount: row[1] });
    }
  }

  return rows.length ? { type, unit: unitMatch?.[1] || "", rows } : null;
}

function parseDetailHtml(html, sourceUrl = "") {
  const basicSection = extractSection(html, "scroll_01", "scroll_02");
  const ingredientSection = extractSection(html, "scroll_02", "scroll_03");
  const durSection = extractSection(html, "scroll_06", "scroll_07");
  const extraSection = extractSection(html, "scroll_07");
  const basic = parseKeyValueRows(basicSection);
  const extra = parseKeyValueRows(extraSection);
  const ingredients = parseIngredients(ingredientSection);
  const title = cleanText((html.match(/<h1\b[^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>[\s\S]*?<\/h1>/i) || [])[1]);

  return {
    itemSeq: basic["품목기준코드"] || (sourceUrl.match(/itemSeq=(\d+)/) || [])[1] || "",
    itemName: basic["제품명"] || title,
    itemEngName: "",
    appearance: basic["성상"] || "",
    shape: basic["모양"] || "",
    entpName: basic["업체명"] || "",
    entpEngName: "",
    contractManufacturer: basic["위탁제조업체"] || "",
    etcOtc: basic["전문/일반"] || "",
    permitDate: basic["허가일"] || "",
    itemCategory: "의약품",
    cancelStatus: "정상",
    makeMaterial: "완제의약품",
    standardCode: basic["표준코드"] || "",
    reviewType: basic["허가심사유형"] || "",
      mainIngredient: ingredients.map((item) => item.name).filter(Boolean).join("/"),
      mainIngredientEng: "",
      unitDose: parseUnitDose(ingredientSection, ingredients),
      ingredients,
    additives: parseAdditives(ingredientSection),
    efficacy: textFromHtml(extractElementById(html, "_ee_doc")),
    dosage: textFromHtml(extractElementById(html, "_ud_doc")),
    precautions: textFromHtml(extractElementById(html, "_nb_doc")),
    precautionsHtml: sanitizeDocHtml(extractElementById(html, "_nb_doc")),
    dur: parseDur(durSection),
    storage: extra["저장방법"] || "",
    validTerm: extra["사용기간"] || "",
    reexamination: extra["재심사대상"] || "",
    rmp: extra["RMP대상"] || "",
    packageInfo: extra["포장정보"] || "",
    insurancePrice: extra["보험약가"] || "",
    atcCode: extra["ATC코드"] || "",
    performance: parsePerformance(extraSection),
    sourceUrl,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchSearchPage(query, page) {
  const url = buildSearchUrl({ ...query, page });
  const timeoutMs = Number(valueOf(query.timeoutMs) || 15000);
  const retries = Number(valueOf(query.retries) || 2);
  const fastFail = valueOf(query.fastFail) === "1";
  const { text } = await fetchMfdsText(url, retries, timeoutMs, { fallbackOnFetchError: !fastFail });
  return { url, parsed: parseSearchHtml(text) };
}

async function enrichContractCandidates(items, contractManufacturer, detailOptions = {}) {
  const detailed = await mapConcurrent(items, 3, async (item) => {
    const cachedDetail = detailMemoryCache.get(String(item.itemSeq));
    if (cachedDetail) {
      return mergeListDetail(item, cachedDetail);
    }
    try {
      const detail = await getMfdsDetail(item.itemSeq, detailOptions);
      return mergeListDetail(item, detail);
    } catch {
      return item;
    }
  });
  return detailed.filter((item) => contractSearchMatches(item, contractManufacturer));
}

async function searchMfdsByContractManufacturer(query, page, cacheKey) {
  const contractManufacturer = valueOf(query.contractManufacturer);
  const ingredient4 = valueOf(query.ingredient4);
  const ingredient5 = valueOf(query.ingredient5);
  const nativeQuery = stripDerivedSearchFields(query);

  let { url, parsed } = await fetchSearchPage(nativeQuery, page);
  const candidateLimit = Math.max(Number(valueOf(query.contractCandidateLimit) || 0), 0);
  const candidateItems = candidateLimit ? parsed.items.slice(0, candidateLimit) : parsed.items;
  const fastGlobal = valueOf(query._global) === "1";
  const detailOptions = fastGlobal
    ? {
        retries: Number(valueOf(query.detailRetries) || 1),
        timeoutMs: Number(valueOf(query.detailTimeoutMs) || 3200),
        fallbackOnFetchError: false
      }
    : {};
  let items = await enrichContractCandidates(candidateItems, contractManufacturer, detailOptions);
  let total = items.length;
  let sourceUrl = url;
  let notice = `${CONTRACT_SEARCH_NOTICE} MFDS 목록 검색 조건에 없는 필드라 현재 조회된 목록의 상세정보 기준으로 확인합니다.`;

  const filteredItems = filterExtraIngredients(items, ingredient4, ingredient5);
  if (filteredItems.length !== items.length) {
    items = filteredItems;
    total = items.length;
    notice = `${notice} 성분명4/5는 조회된 후보 결과 안에서 추가 필터링합니다.`;
  }

  const pageSize = items.length || parsed.items.length || 10;
  return searchMemoryCache.set(cacheKey, {
    page,
    pageSize,
    total,
    totalPages: total ? Math.ceil(total / pageSize) : 1,
    items,
    notice,
    sourceUrl
  });
}

async function searchMfds(query = {}) {
  const page = Math.max(Number(valueOf(query.page) || 1), 1);
  const cacheKey = buildQueryCacheKey({ ...query, page });
  const cached = searchMemoryCache.get(cacheKey);
  if (cached) return cached;

  if (valueOf(query.contractManufacturer)) {
    return searchMfdsByContractManufacturer(query, page, cacheKey);
  }

  const url = buildSearchUrl({ ...query, page });
  const timeoutMs = Number(valueOf(query.timeoutMs) || 15000);
  const retries = Number(valueOf(query.retries) || 2);
  const fastFail = valueOf(query.fastFail) === "1";
  const { text } = await fetchMfdsText(url, retries, timeoutMs, { fallbackOnFetchError: !fastFail });
  const parsed = parseSearchHtml(text);
  let items = parsed.items;
  let total = parsed.total;
  let notice = "";
  const ingredient4 = valueOf(query.ingredient4);
  const ingredient5 = valueOf(query.ingredient5);

  if (ingredient4 || ingredient5) {
    items = filterExtraIngredients(items, ingredient4, ingredient5);
    total = items.length;
    if (!notice) notice = "성분명4/5 검색은 현재 페이지 주성분 텍스트 기준으로 필터링됩니다.";
  }

  const pageSize = items.length || parsed.items.length || 10;
  return searchMemoryCache.set(cacheKey, {
    page,
    pageSize,
    total,
    totalPages: total ? Math.ceil(total / pageSize) : 1,
    items,
    notice,
    sourceUrl: url
  });
}

async function getMfdsDetail(itemSeq, options = {}) {
  if (!itemSeq) throw new Error("itemSeq is required");
  const cacheKey = String(itemSeq);
  const cached = detailMemoryCache.get(cacheKey);
  if (cached) return cached;

  const detailUrl = `${BASE_URL}/pbp/CCBBB01/getItemDetail?itemSeq=${encodeURIComponent(itemSeq)}`;
  const retries = Number(options.retries || 3);
  const timeoutMs = Number(options.timeoutMs || 12000);
  const { url, text } = await fetchMfdsText(detailUrl, retries, timeoutMs, {
    fallbackOnFetchError: options.fallbackOnFetchError !== false
  });
  return detailMemoryCache.set(cacheKey, parseDetailHtml(text, url));
}

async function getMfdsDetailsBatch(itemSeqs = [], concurrency = 5) {
  const uniqueSeqs = Array.from(new Set(itemSeqs.map((seq) => String(seq || "").trim()).filter(Boolean))).slice(0, 30);
  const rows = await mapConcurrent(uniqueSeqs, concurrency, async (itemSeq) => {
    try {
      const detail = await getMfdsDetail(itemSeq);
      return {
        itemSeq,
        ok: true,
        detailPartial: true,
        itemName: detail.itemName || "",
        entpName: detail.entpName || "",
        contractManufacturer: detail.contractManufacturer || "",
        mainIngredient: detail.mainIngredient || "",
        unitDose: detail.unitDose || "",
        etcOtc: detail.etcOtc || "",
        permitDate: detail.permitDate || "",
        atcCode: detail.atcCode || "",
        performance: detail.performance || null
      };
    } catch (error) {
      return {
        itemSeq,
        ok: false,
        detailPartial: true,
        detailError: error.message || "상세 요청 실패"
      };
    }
  });

  return {
    items: rows,
    fetchedAt: new Date().toISOString()
  };
}

function toCsvValue(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function mergeKeepNonEmpty(base, overlay) {
  const result = { ...base };
  for (const [key, value] of Object.entries(overlay || {})) {
    if (value === "" && result[key] && result[key] !== "") continue;
    result[key] = value;
  }
  return result;
}

async function generateMfdsCsv(query, cache = {}) {
  const firstPage = await searchMfds({ ...query, page: 1 });
  const total = firstPage.total || 0;
  const maxItems = 300;
  const pageSize = firstPage.pageSize || 15;
  let items = [...(firstPage.items || [])];

  if (total > items.length && items.length < maxItems) {
    const totalPages = Math.ceil(total / pageSize);
    const maxPages = Math.ceil(maxItems / pageSize);
    const pagesToFetch = [];
    for (let p = 2; p <= Math.min(totalPages, maxPages); p += 1) {
      pagesToFetch.push(p);
    }

    const fetchPage = async (p) => {
      try {
        const result = await searchMfds({ ...query, page: p });
        return result.items || [];
      } catch {
        return [];
      }
    };

    const concurrency = 5;
    for (let i = 0; i < pagesToFetch.length; i += concurrency) {
      const chunk = pagesToFetch.slice(i, i + concurrency);
      const results = await Promise.all(chunk.map((p) => fetchPage(p)));
      results.forEach((pageItems) => {
        items.push(...pageItems);
      });
    }
  }

  items = items.slice(0, maxItems);

  const detailedItems = [];
  const concurrencyLimit = 3;

  const fetchDetail = async (item) => {
    const cached = cache[item.itemSeq];
    if (cached && (cached.contractManufacturer || cached.performance)) {
      return mergeKeepNonEmpty(item, cached);
    }
    try {
      const detail = await getMfdsDetail(item.itemSeq);
      return mergeKeepNonEmpty(item, detail);
    } catch {
      return item;
    }
  };

  const targetSubset = items.slice(0, 30);
  for (let i = 0; i < targetSubset.length; i += concurrencyLimit) {
    const chunk = targetSubset.slice(i, i + concurrencyLimit);
    const results = await Promise.all(chunk.map((item) => fetchDetail(item)));
    detailedItems.push(...results);
  }

  const finalItems = [
    ...detailedItems,
    ...items.slice(30).map((item) => {
      const cached = cache[item.itemSeq];
      return cached ? mergeKeepNonEmpty(item, cached) : item;
    })
  ];

  const years = new Set();
  finalItems.forEach((drug) => {
    if (drug.performance?.rows) {
      drug.performance.rows.forEach((r) => {
        if (r.year && /^\d{4}$/.test(r.year)) {
          years.add(Number(r.year));
        }
      });
    }
  });
  const perfYears = Array.from(years).sort((a, b) => a - b);

  const headers = [
    ["rowNumber", "순번"],
    ["itemSeq", "품목기준코드"],
    ["itemName", "제품명"],
    ["itemEngName", "제품영문명"],
    ["entpName", "업체명"],
    ["entpEngName", "업체영문명"],
    ["contractManufacturer", "위탁제조업체"],
    ["etcOtc", "전문/일반"],
    ["permitDate", "허가일"],
    ["itemCategory", "품목구분"],
    ["cancelStatus", "취소/취하"],
    ["makeMaterial", "완제/원료"],
    ["mainIngredient", "주성분"],
    ["mainIngredientEng", "주성분영문명"],
    ["additives", "첨가제"],
    ["standardCode", "표준코드"],
    ["atcCode", "ATC코드"]
  ];

  perfYears.forEach((year) => {
    headers.push([`perf_${year}`, `${year}년 실적`]);
  });

  const lines = [
    headers.map(([, label]) => toCsvValue(label)).join(",")
  ];

  finalItems.forEach((drug, index) => {
    const rowNumber = String(index + 1);
    const rowData = headers.map(([key]) => {
      if (key === "rowNumber") return toCsvValue(rowNumber);
      if (key.startsWith("perf_")) {
        const year = Number(key.split("_")[1]);
        const perf = drug.performance;
        if (!perf || !perf.rows || !perf.rows.length) return toCsvValue("-");
        const r = perf.rows.find((item) => Number(item.year) === year);
        if (!r) return toCsvValue("-");
        const unitText = perf.unit || "";
        let symbol = unitText.includes("달러") || unitText.includes("$") ? "$" : "₩";
        let suffix = symbol === "₩" && unitText.includes("천원") ? " (천원)" : "";
        return toCsvValue(`${perf.type}: ${symbol}${r.amount}${suffix}`);
      }
      return toCsvValue(drug[key]);
    });
    lines.push(rowData.join(","));
  });

  return "\ufeff" + lines.join("\r\n");
}

module.exports = {
  BASE_URL,
  buildSearchCriteria,
  buildSearchUrl,
  fetchMfdsText,
  parseSearchHtml,
  parseDetailHtml,
  searchMfds,
  getMfdsDetail,
  getMfdsDetailsBatch,
  generateMfdsCsv
};
