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

function isPresenceToken(value) {
  const token = valueOf(value).trim();
  return token === "#" || token === "$";
}

function normalSearchValue(value) {
  return isPresenceToken(value) ? "" : valueOf(value);
}

function valueHasContent(value) {
  if (Array.isArray(value)) return value.some(valueHasContent);
  const text = String(value ?? "").trim();
  return Boolean(text && text !== "-");
}

const HUMAN_PRESENCE_FIELDS = new Set([
  "productName",
  "productEngName",
  "companyName",
  "companyEngName",
  "contractManufacturer",
  "reviewType",
  "ingredient1",
  "ingredient2",
  "ingredient3",
  "ingredient4",
  "ingredient5",
  "ingredientEngName",
  "itemSeq",
  "standardCode",
  "atcCode",
  "efficacyQuery",
  "dosageQuery",
  "precautionQuery"
]);

const HUMAN_DETAIL_PRESENCE_FIELDS = new Set([
  "contractManufacturer",
  "reviewType",
  "efficacyQuery",
  "dosageQuery",
  "precautionQuery"
]);

function extractHumanPresenceFilters(query = {}) {
  return Object.keys(query)
    .filter((field) => HUMAN_PRESENCE_FIELDS.has(field) && isPresenceToken(query[field]))
    .map((field) => ({ field, mode: valueOf(query[field]).trim() }));
}

function normalizeIngredientPresencePart(value) {
  return cleanText(value)
    .replace(/[（][^）]*[）]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();
}

function ingredientPartCount(value) {
  const uniqueParts = new Set();
  String(value || "")
    .split(/\s*[/,]\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const normalized = normalizeIngredientPresencePart(item);
      if (normalized && normalized !== "-") uniqueParts.add(normalized);
    });
  return uniqueParts.size;
}

function humanFieldHasContent(item, field) {
  if (/^ingredient[1-5]$/.test(field)) {
    const index = Number(field.replace("ingredient", ""));
    return ingredientPartCount(item.mainIngredient) >= index;
  }
  const fieldMap = {
    productName: "itemName",
    productEngName: "itemEngName",
    companyName: "entpName",
    companyEngName: "entpEngName",
    contractManufacturer: "contractManufacturer",
    reviewType: "reviewType",
    ingredientEngName: "mainIngredientEng",
    itemSeq: "itemSeq",
    standardCode: "standardCode",
    atcCode: "atcCode",
    efficacyQuery: "efficacy",
    dosageQuery: "dosage",
    precautionQuery: "precautions"
  };
  return valueHasContent(item[fieldMap[field] || field]);
}

function applyHumanPresenceFilters(items, filters = []) {
  if (!filters.length) return items;
  return items.filter((item) =>
    filters.every(({ field, mode }) => {
      const hasContent = humanFieldHasContent(item, field);
      return mode === "#" ? hasContent : !hasContent;
    })
  );
}

function presenceFiltersNeedDetail(filters = []) {
  return filters.some(({ field }) => HUMAN_DETAIL_PRESENCE_FIELDS.has(field));
}

function exportOnlyMode(value) {
  const mode = normalSearchValue(value).toLowerCase();
  if (mode === "exclude" || mode === "only") return mode;
  return "";
}

function needsExportOnlyDetail(mode) {
  return false;
}

function hasExportOnlyName(value) {
  return /[\(（]\s*수출용\s*[\)）]/i.test(String(value || ""));
}

function exportTagsForName(value) {
  return hasExportOnlyName(value) ? ["수출용"] : [];
}

function isExportOnlyItem(item = {}) {
  return Boolean(item.exportOnly || hasExportOnlyName(item.itemName));
}

function applyExportOnlyFilter(items, mode) {
  if (!mode) return items;
  return items.filter((item) => {
    const exportOnly = isExportOnlyItem(item);
    if (mode === "exclude") return !exportOnly;
    if (mode === "only") return exportOnly;
    return true;
  });
}

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
    sort: normalSearchValue(query.sort),
    sortOrder: normalSearchValue(query.sortOrder) || "false",
    page: normalSearchValue(query.page) || "1",
    itemName: normalSearchValue(query.productName),
    itemEngName: normalSearchValue(query.productEngName),
    entpName: normalSearchValue(query.companyName),
    entpEngName: normalSearchValue(query.companyEngName),
    ingrName1: normalSearchValue(query.ingredient1),
    ingrName2: normalSearchValue(query.ingredient2),
    ingrName3: normalSearchValue(query.ingredient3),
    ingrEngName: normalSearchValue(query.ingredientEngName),
    itemSeq: normalSearchValue(query.itemSeq),
    stdrCodeName: normalSearchValue(query.standardCode),
    atcCodeName: normalSearchValue(query.atcCode),
    indutyClassCode: normalSearchValue(query.itemCategory),
    cancelCode: normalSearchValue(query.cancelStatus),
    etcOtcCode: normalSearchValue(query.etcOtc),
    makeMaterialGb: normalSearchValue(query.makeMaterial),
    searchConEe: normalSearchValue(query.efficacyOperator) || "AND",
    eeDocData: normalSearchValue(query.efficacyQuery),
    searchConUd: normalSearchValue(query.dosageOperator) || "AND",
    udDocData: normalSearchValue(query.dosageQuery),
    searchConNb: normalSearchValue(query.precautionOperator) || "AND",
    nbDocData: normalSearchValue(query.precautionQuery),
    startPermitDate: normalSearchValue(query.permitStart),
    endPermitDate: normalSearchValue(query.permitEnd)
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
  delete clean.reviewType;
  delete clean.exportOnlyMode;
  delete clean.performanceFilter;
  delete clean.ingredient4;
  delete clean.ingredient5;
  return clean;
}

function mergeListDetail(item, detail) {
  return {
    ...item,
    contractManufacturer: detail.contractManufacturer || item.contractManufacturer || "",
    manufactureImport: detail.manufactureImport || item.manufactureImport || "",
    mainIngredient: detail.mainIngredient || item.mainIngredient || "",
    unitDose: detail.unitDose || item.unitDose || "",
    standardCode: detail.standardCode || item.standardCode || "",
    atcCode: detail.atcCode || item.atcCode || "",
    reviewType: detail.reviewType || item.reviewType || "",
    insurancePrice: detail.insurancePrice || item.insurancePrice || "",
    packageInfo: detail.packageInfo || item.packageInfo || "",
    packageUnit: detail.packageUnit || detail.packageInfo || item.packageUnit || item.packageInfo || "",
    performance: detail.performance || item.performance || null,
    efficacy: detail.efficacy || item.efficacy || "",
    dosage: detail.dosage || item.dosage || "",
    precautions: detail.precautions || item.precautions || ""
  };
}

function contractSearchMatches(item, contractManufacturer) {
  return includesText(item.contractManufacturer, contractManufacturer);
}

function reviewTypeMatches(item, reviewType) {
  return includesText(item.reviewType, reviewType, true);
}

function filterExtraIngredients(items, ingredient4, ingredient5) {
  ingredient4 = normalSearchValue(ingredient4);
  ingredient5 = normalSearchValue(ingredient5);
  if (!ingredient4 && !ingredient5) return items;
  return items.filter((item) => {
    const src = item.mainIngredient || "";
    if (ingredient4 && !includesText(src, ingredient4)) return false;
    if (ingredient5 && !includesText(src, ingredient5)) return false;
    return true;
  });
}

function performanceFilterKinds(value) {
  const allowed = new Set(["production", "import", "unknown"]);
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item, index, values) => allowed.has(item) && values.indexOf(item) === index);
}

function itemPerformanceKind(item = {}) {
  const detailType = normalSearchValue(item.performance?.type);
  if (detailType.includes("수입실적")) return "import";
  if (detailType.includes("생산실적")) return "production";

  const manufactureImport = normalSearchValue(item.manufactureImport);
  if (manufactureImport.includes("수입")) return "import";
  if (manufactureImport.includes("제조")) return "production";
  return "unknown";
}

function humanClientFilters(query = {}) {
  return {
    presenceFilters: extractHumanPresenceFilters(query),
    ingredient4: normalSearchValue(query.ingredient4),
    ingredient5: normalSearchValue(query.ingredient5),
    reviewType: normalSearchValue(query.reviewType),
    exportMode: exportOnlyMode(query.exportOnlyMode),
    performanceKinds: performanceFilterKinds(query.performanceFilter)
  };
}

function hasHumanClientFilters(filters = {}) {
  return Boolean(
    filters.presenceFilters?.length ||
    filters.ingredient4 ||
    filters.ingredient5 ||
    filters.reviewType ||
    filters.exportMode ||
    filters.performanceKinds?.length
  );
}

function humanClientFiltersNeedDetail(filters = {}) {
  return Boolean(
    presenceFiltersNeedDetail(filters.presenceFilters || []) ||
    filters.reviewType ||
    needsExportOnlyDetail(filters.exportMode)
  );
}

function applyHumanClientFilters(items, filters = {}) {
  let filtered = items;
  filtered = filterExtraIngredients(filtered, filters.ingredient4, filters.ingredient5);
  
  const needsDetail = humanClientFiltersNeedDetail(filters);
  if (needsDetail) {
    filtered = filtered.filter((item) => !item.detailError);
  }

  filtered = applyHumanPresenceFilters(filtered, filters.presenceFilters || []);
  if (filters.reviewType) {
    filtered = filtered.filter((item) => reviewTypeMatches(item, filters.reviewType));
  }
  if (filters.exportMode) {
    filtered = applyExportOnlyFilter(filtered, filters.exportMode);
  }
  if (filters.performanceKinds?.length) {
    const selectedKinds = new Set(filters.performanceKinds);
    filtered = filtered.filter((item) => selectedKinds.has(itemPerformanceKind(item)));
  }
  return filtered;
}

async function enrichItemsWithDetails(items, detailOptions = {}) {
  const concurrency = Math.max(Number(detailOptions.concurrency || 4), 1);
  const deadlineAt = Number(detailOptions.deadlineAt || 0);
  let timedOut = false;
  const detailed = await mapConcurrent(items, concurrency, async (item) => {
    if (deadlineAt && Date.now() > deadlineAt) {
      timedOut = true;
      return { ...item, detailError: true };
    }
    const cachedDetail = detailMemoryCache.get(String(item.itemSeq));
    if (cachedDetail) return mergeListDetail(item, cachedDetail);
    try {
      const detail = await getMfdsDetail(item.itemSeq, detailOptions);
      return mergeListDetail(item, detail);
    } catch {
      return { ...item, detailError: true };
    }
  });
  return { items: detailed, timedOut };
}

async function collectSearchPages(query, firstPage, maxPages = 12, concurrency = 3) {
  const firstItems = firstPage.parsed.items || [];
  const pageSize = firstItems.length || 15;
  const nativeTotalPages = firstPage.parsed.total ? Math.ceil(firstPage.parsed.total / pageSize) : 1;
  const pagesToFetch = [];
  for (let page = 2; page <= Math.min(nativeTotalPages, maxPages); page += 1) {
    pagesToFetch.push(page);
  }
  const extraPages = await mapConcurrent(pagesToFetch, concurrency, async (page) => {
    try {
      return await fetchSearchPage(query, page);
    } catch {
      return { parsed: { items: [] } };
    }
  });
  return [firstPage, ...extraPages].flatMap((result) => result.parsed.items || []);
}

async function searchMfdsWithClientFilters(query, page, cacheKey) {
  const filters = humanClientFilters(query);
  const nativeQuery = {
    ...stripDerivedSearchFields(query),
    timeoutMs: valueOf(query.timeoutMs) || "10000",
    retries: valueOf(query.retries) || "2",
    fastFail: valueOf(query.fastFail) || "0"
  };
  const firstPage = await fetchSearchPage(nativeQuery, 1);
  const nativePageSize = firstPage.parsed.items.length || 15;
  const nativeTotalPages = firstPage.parsed.total ? Math.ceil(firstPage.parsed.total / nativePageSize) : 1;
  const requestedScanPages = Number(valueOf(query.presenceScanPages) || valueOf(query.clientFilterPages) || 12);
  const completeListScan = Boolean(filters.exportMode || filters.performanceKinds?.length);
  const maxScanPages = completeListScan
    ? nativeTotalPages
    : Math.min(Math.max(requestedScanPages, page), 25);
  const candidates = await collectSearchPages(nativeQuery, firstPage, maxScanPages, completeListScan ? 8 : 3);
  const searchStartedAt = Date.now();
  const budgetMs = Math.max(Number(valueOf(query.contractBudgetMs) || 8000), 4000);
  const needsDetail = humanClientFiltersNeedDetail(filters);
  const requestedDetailLimit = Number(valueOf(query.detailCandidateLimit) || valueOf(query.presenceDetailLimit) || 30);
  const pageCandidateFloor = page * nativePageSize * 2;
  const detailCandidateLimit = Math.max(requestedDetailLimit, pageCandidateFloor);
  const candidatesToCheck = needsDetail ? candidates.slice(0, detailCandidateLimit) : candidates;

  let checkedItems = candidatesToCheck;
  let timedOut = false;
  if (needsDetail) {
    const enriched = await enrichItemsWithDetails(candidatesToCheck, {
      retries: Number(valueOf(query.detailRetries) || 1),
      timeoutMs: Number(valueOf(query.detailTimeoutMs) || 2500),
      fallbackOnFetchError: valueOf(query.detailFallback) === "1",
      concurrency: Number(valueOf(query.detailConcurrency) || 4),
      deadlineAt: searchStartedAt + budgetMs
    });
    checkedItems = enriched.items;
    timedOut = enriched.timedOut;
  }

  const filteredItems = applyHumanClientFilters(checkedItems, filters);
  const total = filteredItems.length;
  const pageSize = nativePageSize;
  const start = (page - 1) * pageSize;
  const items = filteredItems.slice(start, start + pageSize);
  const scannedTotalPages = firstPage.parsed.total ? Math.ceil(firstPage.parsed.total / nativePageSize) : 1;
  const hasPresenceFilter = Boolean(filters.presenceFilters?.length);
  const filterLabel = hasPresenceFilter
    ? "#/$ 조건"
    : filters.performanceKinds?.length
      ? "실적구분 조건"
      : "추가 필터";
  const noticeParts = [
    `${filterLabel}은 원본 목록 ${Math.min(maxScanPages, scannedTotalPages)}페이지 ${candidates.length}건 중 ${checkedItems.length}건을 확인해 적용했습니다.`
  ];
  if (candidatesToCheck.length < candidates.length) {
    noticeParts.push(`응답 속도를 위해 상세 확인은 먼저 ${candidatesToCheck.length}건까지만 수행했습니다.`);
  }
  if (scannedTotalPages > maxScanPages) {
    noticeParts.push("검색 범위가 넓어 일부 후보만 확인했습니다. 제품명, 업체명, 성분명 등으로 조건을 좁히면 더 정확합니다.");
  }
  if (timedOut) {
    noticeParts.push("일부 상세정보 확인은 시간이 초과되어 목록 값 기준으로 처리했습니다.");
  }

  return searchMemoryCache.set(cacheKey, {
    page,
    pageSize,
    total,
    totalPages: total ? Math.ceil(total / pageSize) : 1,
    items,
    notice: noticeParts.join(" "),
    sourceUrl: firstPage.url
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

const DETAIL_LABELS = [
  "제품명",
  "성상",
  "모양",
  "업체명",
  "위탁제조업체",
  "전문/일반",
  "허가일",
  "품목기준코드",
  "표준코드",
  "허가번호",
  "허가심사유형",
  "품목구분",
  "완제/원료",
  "제조/수입",
  "취소/취하구분",
  "취소/취하",
  "취소취하구분",
  "취소/취하일자",
  "취소취하일자",
  "저장방법",
  "사용기간",
  "재심사대상",
  "RMP대상",
  "포장정보",
  "보험약가",
  "ATC코드"
];

function normalizedDetailText(sectionHtml) {
  return decodeEntities(stripScripts(sectionHtml)
    .replace(/<span\b[^>]*class=["'][^"']*s-th[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, "")
    .replace(/<(br|tr|li|dt|dd|th|td|p|div|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<\/(tr|li|dt|dd|th|td|p|div|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim());
}

function parseKnownLabelValues(sectionHtml) {
  const lines = normalizedDetailText(sectionHtml)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const labelSet = new Set(DETAIL_LABELS.map((label) => label.replace(/\s+/g, "")));
  const result = {};

  for (let index = 0; index < lines.length; index += 1) {
    const normalized = lines[index].replace(/\s+/g, "");
    if (!labelSet.has(normalized)) continue;
    const parts = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const nextNormalized = lines[next].replace(/\s+/g, "");
      if (labelSet.has(nextNormalized)) break;
      parts.push(lines[next]);
    }
    const value = parts.join(" ").trim();
    if (value && !result[normalized]) result[normalized] = value;
  }

  const flat = lines.join(" ");
  const labelAlternatives = DETAIL_LABELS.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  for (const label of DETAIL_LABELS) {
    const normalizedLabel = label.replace(/\s+/g, "");
    if (result[normalizedLabel]) continue;
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${escapedLabel}\\s*[:：|]?\\s*(.*?)(?=\\s*(?:${labelAlternatives})\\s*[:：|]?|$)`);
    const match = pattern.exec(flat);
    if (match?.[1]?.trim()) result[normalizedLabel] = match[1].trim();
  }

  return result;
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
  const dtDdRe = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  let dtDd;
  while ((dtDd = dtDdRe.exec(sectionHtml))) {
    const key = cleanText(dtDd[1]).replace(/\s+/g, "");
    const value = cleanText(dtDd[2]);
    if (key && value && !values[key]) values[key] = value;
  }
  for (const [key, value] of Object.entries(parseKnownLabelValues(sectionHtml))) {
    const normalizedKey = key.replace(/\s+/g, "");
    if (normalizedKey && value && !values[normalizedKey]) values[normalizedKey] = value;
  }
  return values;
}

function findElementIdIndex(html, id, fromIndex = 0) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\bid\\s*=\\s*(['"])${escaped}\\1`, "i");
  const match = pattern.exec(String(html || "").slice(fromIndex));
  return match ? fromIndex + match.index : -1;
}

function firstValue(source, keys = [], fallback = "") {
  for (const key of keys) {
    const value = source[key];
    if (String(value || "").trim()) return value;
  }
  return fallback;
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

    const itemName = anchor ? cleanText(anchor[1]) : cells[1] || "";
    const exportOnly = hasExportOnlyName(itemName);

    items.push({
      rowNumber: cells[0] || "",
      itemSeq,
      itemName,
      exportOnly,
      tags: exportTagsForName(itemName),
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
  const start = findElementIdIndex(html, id);
  if (start < 0) return "";
  const elementStart = html.lastIndexOf("<div", start);
  if (id !== "scroll_01") {
    const exactElement = extractElementById(html, id);
    if (exactElement) return exactElement;
  }
  const next = nextId ? findElementIdIndex(html, nextId, start + 1) : -1;
  if (next > 0) return html.slice(elementStart, html.lastIndexOf("<div", next));
  return html.slice(elementStart);
}

function extractElementById(html, id) {
  const idIndex = findElementIdIndex(html, id);
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

function extractPerformanceSection(html) {
  const seen = new Set();
  const sectionIdRe = /<div\b[^>]*\bid=["'](scroll_\d+)["'][^>]*>/gi;
  let match;
  while ((match = sectionIdRe.exec(html))) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const section = extractElementById(html, id);
    const text = cleanText(section);
    if (text.includes("생산실적") || text.includes("수입실적")) return section;
  }
  return "";
}

function parseDetailHtml(html, sourceUrl = "") {
  const basicSection = extractSection(html, "scroll_01", "scroll_02");
  const ingredientSection = extractSection(html, "scroll_02", "scroll_03");
  const durSection = extractSection(html, "scroll_06", "scroll_07");
  const extraSection = extractSection(html, "scroll_07");
  const performanceSection = extractPerformanceSection(html);
  const basic = parseKeyValueRows(basicSection);
  const extra = parseKeyValueRows(extraSection);
  const ingredients = parseIngredients(ingredientSection);
  const title = cleanText((html.match(/<h1\b[^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>[\s\S]*?<\/h1>/i) || [])[1]);

  const itemName = basic["제품명"] || title;

  return {
    itemSeq: basic["품목기준코드"] || (sourceUrl.match(/itemSeq=(\d+)/) || [])[1] || "",
    itemName,
    exportOnly: hasExportOnlyName(itemName),
    tags: exportTagsForName(itemName),
    itemEngName: "",
    appearance: basic["성상"] || "",
    shape: basic["모양"] || "",
    entpName: basic["업체명"] || "",
    entpEngName: "",
    contractManufacturer: basic["위탁제조업체"] || "",
    etcOtc: basic["전문/일반"] || "",
    permitDate: basic["허가일"] || "",
    itemCategory: basic["품목구분"] || "의약품",
    cancelStatus: firstValue(basic, ["취소/취하구분", "취소/취하", "취소취하구분"], "정상"),
    cancelDate: firstValue(basic, ["취소/취하일자", "취소취하일자"], ""),
    makeMaterial: basic["완제/원료"] || "완제의약품",
    manufactureImport: firstValue(basic, ["제조/수입", "제조수입"], ""),
    standardCode: basic["표준코드"] || "",
    reviewType: basic["허가심사유형"] || "",
      mainIngredient: ingredients.map((item) => {
        const amt = String(item.amount || "").trim();
        const ut = String(item.unit || "").trim();
        return amt ? `${item.name}(${amt}${ut})` : item.name;
      }).filter(Boolean).join("/"),
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
    performance: parsePerformance(performanceSection || extraSection),
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
  const concurrency = Math.max(Number(detailOptions.concurrency || 4), 1);
  const deadlineAt = Number(detailOptions.deadlineAt || 0);
  let timedOut = false;
  const detailed = await mapConcurrent(items, concurrency, async (item) => {
    if (deadlineAt && Date.now() > deadlineAt) {
      timedOut = true;
      return item;
    }
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
  return {
    items: detailed.filter((item) => contractSearchMatches(item, contractManufacturer)),
    timedOut
  };
}

async function searchMfdsByContractManufacturer(query, page, cacheKey) {
  const contractManufacturer = normalSearchValue(query.contractManufacturer);
  const reviewType = normalSearchValue(query.reviewType);
  const exportMode = exportOnlyMode(query.exportOnlyMode);
  const ingredient4 = normalSearchValue(query.ingredient4);
  const ingredient5 = normalSearchValue(query.ingredient5);
  const presenceFilters = extractHumanPresenceFilters(query);
  const searchStartedAt = Date.now();
  const budgetMs = Math.max(Number(valueOf(query.contractBudgetMs) || 8000), 3500);
  const nativeQuery = {
    ...stripDerivedSearchFields(query),
    timeoutMs: valueOf(query.timeoutMs) || "6500",
    retries: valueOf(query.retries) || "1",
    fastFail: valueOf(query.fastFail) || "1"
  };

  const firstPage = await fetchSearchPage(nativeQuery, 1);
  const nativePageSize = firstPage.parsed.items.length || 15;
  const requestedScanPages = Number(valueOf(query.contractScanPages) || valueOf(query.presenceScanPages) || 3);
  const maxScanPages = Math.min(Math.max(requestedScanPages, page), 25);
  const allCandidates = await collectSearchPages(nativeQuery, firstPage, maxScanPages);
  const candidateLimit = Math.max(Number(valueOf(query.contractCandidateLimit) || 30), 0);
  const pageCandidateFloor = page * nativePageSize * 2;
  const detailCandidateLimit = candidateLimit ? Math.max(candidateLimit, pageCandidateFloor) : allCandidates.length;
  const candidateItems = candidateLimit ? allCandidates.slice(0, detailCandidateLimit) : allCandidates;
  const fastGlobal = valueOf(query._global) === "1";
  const remainingBudget = Math.max(budgetMs - (Date.now() - searchStartedAt), 1200);
  const detailTimeoutMs = Math.min(
    Number(valueOf(query.detailTimeoutMs) || (fastGlobal ? 2200 : 1800)),
    Math.max(remainingBudget - 400, 1000)
  );
  const detailOptions = fastGlobal
    ? {
        retries: Number(valueOf(query.detailRetries) || 1),
        timeoutMs: detailTimeoutMs,
        fallbackOnFetchError: false,
        concurrency: Number(valueOf(query.detailConcurrency) || 4),
        deadlineAt: searchStartedAt + budgetMs
      }
    : {
        retries: Number(valueOf(query.detailRetries) || 1),
        timeoutMs: detailTimeoutMs,
        fallbackOnFetchError: valueOf(query.detailFallback) === "1",
        concurrency: Number(valueOf(query.detailConcurrency) || 4),
        deadlineAt: searchStartedAt + budgetMs
      };
  const enriched = await enrichContractCandidates(candidateItems, contractManufacturer, detailOptions);
  let items = enriched.items;
  let total = items.length;
  let sourceUrl = firstPage.url;
  const scannedTotalPages = nativeTotalPages;
  let notice = `${CONTRACT_SEARCH_NOTICE} 원본 목록 ${Math.min(maxScanPages, scannedTotalPages)}페이지 ${allCandidates.length}건 중 ${candidateItems.length}건의 상세정보 기준으로 확인합니다.`;
  if (allCandidates.length > candidateItems.length) {
    notice = `${notice} 응답 속도를 위해 먼저 ${candidateItems.length}건만 확인했습니다.`;
  }
  if (scannedTotalPages > maxScanPages) {
    notice = `${notice} 검색 범위가 넓어 일부 후보만 확인했습니다. 제품명, 업체명, 성분명 등으로 조건을 좁히면 더 정확합니다.`;
  }
  if (enriched.timedOut) {
    notice = `${notice} 일부 상세 확인은 시간이 초과되어 건너뛰었습니다. 조건을 더 좁히면 더 정확합니다.`;
  }

  const filteredItems = filterExtraIngredients(items, ingredient4, ingredient5);
  if (filteredItems.length !== items.length) {
    items = filteredItems;
    total = items.length;
    notice = `${notice} 성분명4/5는 후보 결과 안에서 추가 필터링했습니다.`;
  }
  const presenceFilteredItems = applyHumanPresenceFilters(items, presenceFilters);
  if (presenceFilteredItems.length !== items.length) {
    items = presenceFilteredItems;
    total = items.length;
    notice = `${notice} #/$ 조건은 현재 확인된 후보 결과 안에서 적용했습니다.`;
  }
  if (reviewType) {
    const reviewFilteredItems = items.filter((item) => reviewTypeMatches(item, reviewType));
    if (reviewFilteredItems.length !== items.length) {
      items = reviewFilteredItems;
      total = items.length;
      notice = `${notice} 허가심사유형 조건을 추가 적용했습니다.`;
    }
  }

  if (exportMode) {
    const beforeCount = items.length;
    items = applyExportOnlyFilter(items, exportMode);
    total = items.length;
    if (!notice) {
      notice = `수출용 ${exportMode === "exclude" ? "불포함" : "전용"} 조건이 현재 조회 목록에 적용되었습니다.`;
    } else if (beforeCount !== items.length) {
      notice = `${notice} 수출용 ${exportMode === "exclude" ? "불포함" : "전용"} 조건을 추가 적용했습니다.`;
    }
  }

  total = items.length;
  const pageSize = nativePageSize;
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  return searchMemoryCache.set(cacheKey, {
    page,
    pageSize,
    total,
    totalPages: total ? Math.ceil(total / pageSize) : 1,
    items: pageItems,
    notice,
    sourceUrl
  });
}

async function searchMfds(query = {}) {
  const page = Math.max(Number(valueOf(query.page) || 1), 1);
  const cacheKey = buildQueryCacheKey({ ...query, page });
  const cached = searchMemoryCache.get(cacheKey);
  if (cached) return cached;
  const presenceFilters = extractHumanPresenceFilters(query);

  if (normalSearchValue(query.contractManufacturer)) {
    return searchMfdsByContractManufacturer(query, page, cacheKey);
  }

  const clientFilters = humanClientFilters(query);
  if (hasHumanClientFilters(clientFilters)) {
    return searchMfdsWithClientFilters(query, page, cacheKey);
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
  const ingredient4 = normalSearchValue(query.ingredient4);
  const ingredient5 = normalSearchValue(query.ingredient5);
  const reviewType = normalSearchValue(query.reviewType);
  const exportMode = exportOnlyMode(query.exportOnlyMode);

  if (ingredient4 || ingredient5) {
    items = filterExtraIngredients(items, ingredient4, ingredient5);
    if (!notice) notice = "성분명4/5 검색은 현재 페이지 주성분 텍스트 기준으로 필터링됩니다.";
  }
  if (presenceFilters.length || reviewType || exportMode) {
    if (presenceFiltersNeedDetail(presenceFilters) || reviewType || needsExportOnlyDetail(exportMode)) {
      const enrichStartedAt = Date.now();
      const budgetMs = Math.max(Number(valueOf(query.contractBudgetMs) || 8000), 3500);
      const enriched = await enrichItemsWithDetails(items, {
        retries: Number(valueOf(query.detailRetries) || 1),
        timeoutMs: Number(valueOf(query.detailTimeoutMs) || 2200),
        fallbackOnFetchError: valueOf(query.detailFallback) === "1",
        concurrency: Number(valueOf(query.detailConcurrency) || 4),
        deadlineAt: enrichStartedAt + budgetMs
      });
      items = enriched.items;
      if (enriched.timedOut) {
        notice = `${notice ? `${notice} ` : ""}#/$ 상세 필드 확인 중 일부 항목은 시간이 초과되어 목록 값 기준으로 표시했습니다.`;
      }
    }
    if (presenceFilters.length) {
      const beforeCount = items.length;
      items = applyHumanPresenceFilters(items, presenceFilters);
      if (!notice) {
        notice = "#/$ 조건은 현재 조회된 목록에서 값 있음/값 없음 기준으로 적용했습니다.";
      } else if (beforeCount !== items.length) {
        notice = `${notice} #/$ 조건을 추가 적용했습니다.`;
      }
    }
  }
  if (reviewType) {
    const beforeCount = items.length;
    items = items.filter((item) => reviewTypeMatches(item, reviewType));
    if (!notice) {
      notice = "허가심사유형은 상세정보를 확인한 뒤 현재 조회된 목록에서 필터링됩니다.";
    } else if (beforeCount !== items.length) {
      notice = `${notice} 허가심사유형 조건을 추가 적용했습니다.`;
    }
  }

  if (exportMode) {
    const beforeCount = items.length;
    items = applyExportOnlyFilter(items, exportMode);
    if (!notice) {
      notice = `수출용 ${exportMode === "exclude" ? "불포함" : "전용"} 조건이 현재 조회 목록에 적용되었습니다.`;
    } else if (beforeCount !== items.length) {
      notice = `${notice} 수출용 ${exportMode === "exclude" ? "불포함" : "전용"} 조건을 추가 적용했습니다.`;
    }
  }

  const pageSize = parsed.items.length || 15;
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
  const retries = Number(options.retries ?? 3);
  const timeoutMs = Number(options.timeoutMs ?? 12000);
  const { url, text } = await fetchMfdsText(detailUrl, retries, timeoutMs, {
    fallbackOnFetchError: options.fallbackOnFetchError !== false
  });
  return detailMemoryCache.set(cacheKey, parseDetailHtml(text, url));
}

async function getMfdsDetailsBatch(itemSeqs = [], concurrency = 5, detailOptions = {}) {
  const uniqueSeqs = Array.from(new Set(itemSeqs.map((seq) => String(seq || "").trim()).filter(Boolean))).slice(0, 30);
  const safeDetailOptions = {
    retries: Math.max(Number(detailOptions.retries ?? 1), 1),
    timeoutMs: Number(detailOptions.timeoutMs ?? 10000),
    fallbackOnFetchError: detailOptions.fallbackOnFetchError === true
  };
  const rows = await mapConcurrent(uniqueSeqs, concurrency, async (itemSeq) => {
    try {
      const detail = await getMfdsDetail(itemSeq, safeDetailOptions);
      return {
        itemSeq,
        ok: true,
        detailPartial: true,
        itemName: detail.itemName || "",
        entpName: detail.entpName || "",
        contractManufacturer: detail.contractManufacturer || "",
        reviewType: detail.reviewType || "",
        insurancePrice: detail.insurancePrice || "",
        packageInfo: detail.packageInfo || "",
        packageUnit: detail.packageInfo || "",
        efficacy: detail.efficacy || "",
        dosage: detail.dosage || "",
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
        detailError: error?.message || "상세 요청 실패"
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

function hasOwnField(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function hasCsvDetailFields(value) {
  return hasOwnField(value, "packageInfo") && hasOwnField(value, "efficacy") && hasOwnField(value, "dosage");
}

async function generateMfdsCsv(query, cache = {}) {
  const firstPage = await searchMfds({ ...query, page: 1 });
  const total = firstPage.total || 0;
  const limitValue = String(query.csvLimit || query.maxItems || "").trim().toLowerCase();
  const maxItems = limitValue === "all" || limitValue === "전체"
    ? Number.POSITIVE_INFINITY
    : Math.max(Number(limitValue) || 1000, 1);
  const pageSize = firstPage.pageSize || 15;
  let items = [...(firstPage.items || [])];

  if (total > items.length && items.length < maxItems) {
    const totalPages = Math.ceil(total / pageSize);
    const maxPages = Number.isFinite(maxItems) ? Math.ceil(maxItems / pageSize) : totalPages;
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

  items = Number.isFinite(maxItems) ? items.slice(0, maxItems) : items;

  const detailedItems = [];
  const concurrencyLimit = 3;

  const fetchDetail = async (item) => {
    const cached = cache[item.itemSeq];
    if (cached && hasCsvDetailFields(cached) && (cached.contractManufacturer || cached.performance)) {
      return mergeKeepNonEmpty(item, cached);
    }
    try {
      const detail = await getMfdsDetail(item.itemSeq, { retries: 2, timeoutMs: 12000 });
      return mergeKeepNonEmpty(item, detail);
    } catch {
      // Fall back to cache-only or raw item
      return cached ? mergeKeepNonEmpty(item, cached) : item;
    }
  };

  for (let i = 0; i < items.length; i += concurrencyLimit) {
    const chunk = items.slice(i, i + concurrencyLimit);
    const results = await Promise.all(chunk.map((item) => fetchDetail(item)));
    detailedItems.push(...results);
    // Small delay between batches to avoid rate-limiting on government servers
    if (i + concurrencyLimit < items.length) {
      await delay(120);
    }
  }

  const finalItems = detailedItems;

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
    ["reviewType", "허가심사유형"],
    ["mainIngredient", "주성분"],
    ["mainIngredientEng", "주성분영문명"],
    ["unitDose", "단위용량"],
    ["etcOtc", "전문/일반"],
    ["efficacy", "효능효과"],
    ["dosage", "용법용량"],
    ["insurancePrice", "보험약가"],
    ["packageUnit", "제품 포장단위"],
    ["permitDate", "허가일"],
    ["itemCategory", "품목구분"],
    ["cancelStatus", "취소/취하"],
    ["makeMaterial", "완제/원료"],
    ["additives", "첨가제"],
    ["standardCode", "표준코드"],
    ["atcCode", "ATC코드"],
    ["performanceType", "실적구분"],
    ["performanceUnit", "실적단위"]
  ];

  perfYears.forEach((year) => {
    headers.push([`perf_${year}`, `${year}년 생산/수입실적`]);
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
        return toCsvValue(r.amount || "-");
      }
      if (key === "packageUnit") return toCsvValue(drug.packageUnit || drug.packageInfo || "");
      if (key === "performanceType") return toCsvValue(drug.performance?.type || "");
      if (key === "performanceUnit") return toCsvValue(drug.performance?.unit || "");
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
