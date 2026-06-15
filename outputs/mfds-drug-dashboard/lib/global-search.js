const { searchMfds } = require("./mfds");
const { searchVetMedicines, searchAquaticMedicines } = require("./public-medicines");

const GROUP_LIMIT = 12;
const GLOBAL_CACHE_TTL_MS = 2 * 60 * 1000;
const GLOBAL_CACHE_LIMIT = 80;
const QUERY_BUDGET_MS = 8200;
const FAST_OPTIONS = { page: 1, timeoutMs: 3600, retries: 1, fastFail: "1", _global: "1" };
const globalMemoryCache = new Map();
const pendingGlobalSearches = new Map();

function valueOf(value) {
  if (Array.isArray(value)) return value[0] || "";
  return value == null ? "" : String(value);
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getCached(cache, key, ttlMs) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > ttlMs) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

function setCached(cache, key, value, limit) {
  if (cache.size >= limit) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { createdAt: Date.now(), value });
  return value;
}

async function withBudget(promise, ms, label) {
  let timerId;
  const timeout = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      const error = new Error(`${label || "검색"} 시간 초과`);
      error.code = "SEARCH_BUDGET_TIMEOUT";
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timerId);
  }
}

function includesKeyword(value, keyword) {
  const haystack = String(value || "").replace(/\s+/g, "").toLowerCase();
  const needle = String(keyword || "").replace(/\s+/g, "").toLowerCase();
  return Boolean(needle && haystack.includes(needle));
}

function matchSnippet(source, keyword, fallback = "") {
  const text = compactText(source);
  const lower = text.toLowerCase();
  const needle = String(keyword || "").toLowerCase();
  if (!text || !needle) return fallback;
  const index = lower.indexOf(needle);
  if (index < 0) return fallback || text.slice(0, 120);
  const start = Math.max(0, index - 42);
  const end = Math.min(text.length, index + needle.length + 72);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}

function mergeResult(map, key, result) {
  if (!key) return;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, result);
    return;
  }
  existing.matchFields = Array.from(new Set([...(existing.matchFields || []), ...(result.matchFields || [])]));
  if (!existing.snippet && result.snippet) existing.snippet = result.snippet;
  if (!existing.searchTerm && result.searchTerm) existing.searchTerm = result.searchTerm;
}

function baseSearchQueries(keyword) {
  return [
    { label: "제품명", query: { productName: keyword } },
    { label: "업체명", query: { companyName: keyword } },
    { label: "성분명", query: { ingredient1: keyword } },
    { label: "효능효과", query: { efficacyOperator: "AND", efficacyQuery: keyword } }
  ];
}

function reliableHumanQuery(query) {
  return { ...query, timeoutMs: 6500, retries: 1, fastFail: "0" };
}

function efficacyTerms(keyword) {
  const source = compactText(keyword);
  const normalized = source.replace(/\s+/g, "");
  const terms = [source];
  const expansionMap = [
    { pattern: /발열|고열|열감/, terms: ["해열", "열성"] },
    { pattern: /통증|동통|아픔/, terms: ["진통"] },
    { pattern: /기침|해수/, terms: ["진해"] },
    { pattern: /가래|담/, terms: ["거담"] }
  ];
  for (const item of expansionMap) {
    if (item.pattern.test(normalized)) terms.push(...item.terms);
  }
  return Array.from(new Set(terms.filter(Boolean))).slice(0, 3);
}

function externalSearchQueries(keyword) {
  return [
    { label: "제품명", query: { productName: keyword } },
    { label: "업체명", query: { companyName: keyword } },
    { label: "성분명", query: { ingredient1: keyword } },
    ...efficacyTerms(keyword).map((term) => ({
      label: "효능효과",
      searchTerm: term,
      query: { efficacyOperator: "OR", efficacyQuery: term }
    }))
  ];
}

function humanSearchQueries(keyword) {
  return [
    ...baseSearchQueries(keyword).map((item) => ({
      ...item,
      query: reliableHumanQuery(item.query)
    })),
    {
      label: "위탁생산업체",
      query: reliableHumanQuery({ contractManufacturer: keyword, contractCandidateLimit: 2, detailTimeoutMs: 3200, detailRetries: 1 })
    }
  ];
}

function humanSnippet(row, keyword, label) {
  const fields = [
    ["제품명", row.itemName],
    ["업체명", row.entpName],
    ["성분명", row.mainIngredient],
    ["위탁생산업체", row.contractManufacturer],
    ["허가일", row.permitDate]
  ];
  const matched = fields.find(([, value]) => includesKeyword(value, keyword));
  if (matched) return { matchLabel: matched[0], snippet: matchSnippet(matched[1], keyword, `${matched[0]}에서 검색됨`) };
  return { matchLabel: label, snippet: compactText(row.mainIngredient || row.entpName || row.itemName || `${label}에서 검색됨`) };
}

function externalSnippet(row, keyword, label) {
  const fields = [
    ["제품명", row.itemName],
    ["업체명", row.entpName],
    ["성분명", row.mainIngredient || row.note],
    ["품목정보", row.itemCategory || row.dosageForm || row.route],
    ["비고", row.note || row.condition]
  ];
  const matched = fields.find(([, value]) => includesKeyword(value, keyword));
  if (matched) return { matchLabel: matched[0], snippet: matchSnippet(matched[1], keyword, `${matched[0]}에서 검색됨`) };
  return { matchLabel: label, snippet: compactText(row.note || row.itemCategory || row.dosageForm || row.entpName || row.itemName || `${label}에서 검색됨`) };
}

function externalVisibleText(row) {
  return [
    row.itemName,
    row.entpName,
    row.itemEngName,
    row.mainIngredient,
    row.note,
    row.itemCategory,
    row.dosageForm,
    row.route,
    row.condition,
    row.permitNumber,
    ...(row.rawCells || [])
  ].filter(Boolean).join(" ");
}

function isTrustedExternalRow(row, searchTerm) {
  return includesKeyword(externalVisibleText(row), searchTerm);
}

async function settledSearches(searchFn, keyword, queryBuilder = baseSearchQueries) {
  const searches = queryBuilder(keyword);
  const pages = await Promise.allSettled(
    searches.map((item) => withBudget(searchFn({ ...FAST_OPTIONS, ...item.query }), QUERY_BUDGET_MS, item.label))
  );
  return { searches, pages };
}

async function buildHumanGroup(keyword) {
  const map = new Map();
  const { searches, pages } = await settledSearches(searchMfds, keyword, humanSearchQueries);
  let total = 0;
  let fulfilledCount = 0;

  for (let i = 0; i < pages.length; i += 1) {
    const result = pages[i];
    if (result.status !== "fulfilled") continue;
    fulfilledCount += 1;
    total = Math.max(total, Number(result.value.total || 0));
    const label = searches[i].label;
    for (const row of (result.value.items || []).slice(0, GROUP_LIMIT)) {
      const matched = humanSnippet(row, keyword, label);
      mergeResult(map, row.itemSeq, {
        id: `human:${row.itemSeq}`,
        category: "human",
        title: row.itemName || "-",
        company: row.entpName || "",
        meta: [row.itemSeq, row.etcOtc, row.permitDate].filter(Boolean).join(" / "),
        matchFields: [label],
        matchLabel: matched.matchLabel,
        snippet: matched.snippet,
        row
      });
      if (map.size >= GROUP_LIMIT) break;
    }
  }
  if (!fulfilledCount) {
    throw new Error("인체용 의약품 검색 연결이 지연되었습니다. 다시 검색해 주세요.");
  }

  return {
    key: "human",
    label: "인체용 의약품",
    total: Math.max(total, map.size),
    items: Array.from(map.values()).slice(0, GROUP_LIMIT)
  };
}

async function buildExternalGroup(kind, keyword) {
  const searchFn = kind === "aquatic" ? searchAquaticMedicines : searchVetMedicines;
  const map = new Map();
  const { searches, pages } = await settledSearches(searchFn, keyword, externalSearchQueries);
  let total = 0;
  let fulfilledCount = 0;

  for (let i = 0; i < pages.length; i += 1) {
    const result = pages[i];
    if (result.status !== "fulfilled") continue;
    fulfilledCount += 1;
    const label = searches[i].label;
    const searchTerm = searches[i].searchTerm || keyword;
    let acceptedCount = 0;
    for (const row of (result.value.items || []).slice(0, GROUP_LIMIT)) {
      if (!isTrustedExternalRow(row, searchTerm)) continue;
      const key = row.detailKey || row.sourceUrl || `${row.permitNumber || ""}:${row.itemName}:${row.entpName}`;
      const matched = externalSnippet(row, searchTerm, label);
      const synonymPrefix = searchTerm !== keyword ? `${searchTerm} 기준 검색 결과 · ` : "";
      mergeResult(map, key, {
        id: `${kind}:${key}`,
        category: kind,
        title: row.itemName || "-",
        company: row.entpName || "",
        meta: [row.permitNumber || row.rowNumber, row.itemCategory || row.dosageForm, row.permitDate].filter(Boolean).join(" / "),
        matchFields: [label],
        matchLabel: matched.matchLabel,
        snippet: `${synonymPrefix}${matched.snippet}`,
        searchTerm,
        row
      });
      acceptedCount += 1;
      if (map.size >= GROUP_LIMIT) break;
    }
    if (acceptedCount) {
      total = Math.max(total, label === "제품명" || label === "업체명" ? Number(result.value.total || acceptedCount) : map.size);
    }
  }
  if (!fulfilledCount) {
    throw new Error(`${kind === "aquatic" ? "수산동물용" : "동물용"} 의약품 검색 연결이 지연되었습니다. 다시 검색해 주세요.`);
  }

  return {
    key: kind,
    label: kind === "aquatic" ? "수산동물용 의약품" : "동물용 의약품",
    total: Math.max(total, map.size),
    items: Array.from(map.values()).slice(0, GROUP_LIMIT)
  };
}

async function runGlobalSearch(keyword) {
  const [human, vet, aquatic] = await Promise.all([
    buildHumanGroup(keyword).catch((error) => ({ key: "human", label: "인체용 의약품", total: 0, items: [], error: error.message })),
    buildExternalGroup("vet", keyword).catch((error) => ({ key: "vet", label: "동물용 의약품", total: 0, items: [], error: error.message })),
    buildExternalGroup("aquatic", keyword).catch((error) => ({ key: "aquatic", label: "수산동물용 의약품", total: 0, items: [], error: error.message }))
  ]);

  return {
    keyword,
    groups: [human, vet, aquatic],
    fetchedAt: new Date().toISOString(),
    mode: "fast"
  };
}

async function globalSearch(query = {}) {
  const keyword = compactText(valueOf(query.q || query.keyword || query.homeQuery));
  if (!keyword) {
    return { keyword: "", groups: [] };
  }

  const cacheKey = `${keyword.toLowerCase()}:${compactText(valueOf(query._v || query.version || ""))}`;
  const cached = getCached(globalMemoryCache, cacheKey, GLOBAL_CACHE_TTL_MS);
  if (cached) return { ...cached, cache: "memory" };

  if (pendingGlobalSearches.has(cacheKey)) {
    return pendingGlobalSearches.get(cacheKey);
  }

  const searchPromise = runGlobalSearch(keyword)
    .then((payload) => setCached(globalMemoryCache, cacheKey, payload, GLOBAL_CACHE_LIMIT))
    .finally(() => pendingGlobalSearches.delete(cacheKey));

  pendingGlobalSearches.set(cacheKey, searchPromise);
  return searchPromise;
}

module.exports = {
  globalSearch
};
