const fs = require("node:fs");
const path = require("node:path");
const { searchMfds } = require("./mfds");
const { searchVetMedicines } = require("./public-medicines");

const CATEGORY_LABELS = {
  human: "인체용 의약품",
  vet: "동물용 의약품",
  aquatic: "수산동물용 의약품"
};

const CHANGE_LABELS = {
  added: "신규 등록",
  removed: "취하·만료"
};
const LIVE_CACHE_TTL_MS = 5 * 60 * 1000;
const LIVE_CACHE_LIMIT = 20;
const DEFAULT_RECENT_DAYS = 10;
const liveMemoryCache = new Map();

function dataRoot() {
  return process.env.CHANGELOG_DATA_DIR || path.resolve(__dirname, "..", "data");
}

function changeLogPath() {
  return path.join(dataRoot(), "change-log.json");
}

function emptyLog() {
  return {
    updatedAt: "",
    changes: {
      human: [],
      vet: [],
      aquatic: []
    }
  };
}

function readChangeLog() {
  try {
    const parsed = JSON.parse(fs.readFileSync(changeLogPath(), "utf8"));
    return {
      ...emptyLog(),
      ...parsed,
      changes: {
        ...emptyLog().changes,
        ...(parsed.changes || {})
      }
    };
  } catch {
    return emptyLog();
  }
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

function kstDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function compactDate(value) {
  const match = String(value || "").match(/\d{4}[-.]\d{2}[-.]\d{2}/);
  return match ? match[0].replaceAll(".", "-") : "";
}

function recentRange(days = DEFAULT_RECENT_DAYS) {
  return {
    start: kstDate(-(Math.max(Number(days || DEFAULT_RECENT_DAYS), 1) - 1)),
    end: kstDate(0)
  };
}

function inRange(date, start, end) {
  const value = compactDate(date);
  return Boolean(value && value >= start && value <= end);
}

function changeEntry(category, date, type, item, note = "") {
  if (category === "vet") {
    const permitNumber = item.permitNumber || (String(item.note || "").match(/허가번호:\s*([^/]+)/) || [])[1]?.trim() || "";
    const productCode = item.productCode || (String(item.note || "").match(/품목코드:\s*([^/]+)/) || [])[1]?.trim() || "";
    return {
      date,
      category,
      type,
      id: permitNumber || productCode || item.detailKey || item.sourceUrl || `${item.itemName || ""}:${item.entpName || ""}:${item.permitDate || ""}`,
      name: item.itemName || "",
      company: item.entpName || "",
      status: item.note || "",
      permitDate: item.permitDate || "",
      note
    };
  }
  return {
    date,
    category,
    type,
    id: item.itemSeq || "",
    name: item.itemName || "",
    company: item.entpName || "",
    status: item.cancelStatus || "",
    permitDate: item.permitDate || "",
    note
  };
}

async function fetchMfdsPages(query, maxPages = 6) {
  const first = await searchMfds({ ...query, page: 1, timeoutMs: 10000, retries: 2 });
  const totalPages = Math.min(Number(first.totalPages || 1), maxPages);
  const pageNumbers = Array.from({ length: Math.max(totalPages - 1, 0) }, (_, index) => index + 2);
  const pages = await mapConcurrent(pageNumbers, 3, async (page) => {
    try {
      return await searchMfds({ ...query, page, timeoutMs: 10000, retries: 2 });
    } catch {
      return { items: [] };
    }
  });
  return [first, ...pages].flatMap((page) => page.items || []);
}

async function fetchVetPages(query, maxPages = 6) {
  const first = await searchVetMedicines({ ...query, page: 1, timeoutMs: 10000, retries: 2 });
  const totalPages = Math.min(Number(first.totalPages || 1), maxPages);
  const pageNumbers = Array.from({ length: Math.max(totalPages - 1, 0) }, (_, index) => index + 2);
  const pages = await mapConcurrent(pageNumbers, 3, async (page) => {
    try {
      return await searchVetMedicines({ ...query, page, timeoutMs: 10000, retries: 2 });
    } catch {
      return { items: [] };
    }
  });
  return [first, ...pages].flatMap((page) => page.items || []);
}

async function mapConcurrent(items, concurrency, task) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function safeFetchMfdsPages(query, maxPages = 6) {
  try {
    return await fetchMfdsPages(query, maxPages);
  } catch {
    return [];
  }
}

async function safeFetchVetPages(query, maxPages = 6) {
  try {
    return await fetchVetPages(query, maxPages);
  } catch {
    return [];
  }
}

function uniqueChanges(items = []) {
  const map = new Map();
  for (const item of items) {
    const key = `${item.date}:${item.type}:${item.id}`;
    if (item.id && !map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

async function liveHumanChanges(days = DEFAULT_RECENT_DAYS) {
  const { start, end } = recentRange(days);
  const cacheKey = `human:${start}:${end}`;
  const cached = getCached(liveMemoryCache, cacheKey, LIVE_CACHE_TTL_MS);
  if (cached) return cached;

  const addedRows = await safeFetchMfdsPages({ permitStart: start, permitEnd: end }, 8);
  const added = addedRows
    .filter((item) => inRange(item.permitDate, start, end))
    .map((item) => changeEntry("human", compactDate(item.permitDate), "added", item, "허가일 기준 최근 등록"));

  const removedRows = [
    ...(await safeFetchMfdsPages({ cancelStatus: "A" }, 12)),
    ...(await safeFetchMfdsPages({ cancelStatus: "2" }, 12))
  ];
  const removed = removedRows
    .filter((item) => inRange(item.cancelDate, start, end) || /취하|만료|취소|폐지/i.test(item.cancelStatus || "") && inRange(item.permitDate, start, end))
    .map((item) => changeEntry("human", compactDate(item.cancelDate) || compactDate(item.permitDate) || end, "removed", item, "취소/취하일자 기준 최근 변동"));

  return setCached(liveMemoryCache, cacheKey, {
    updatedAt: new Date().toISOString(),
    start,
    end,
    changes: uniqueChanges([...added, ...removed])
  }, LIVE_CACHE_LIMIT);
}

async function liveVetChanges(days = DEFAULT_RECENT_DAYS) {
  const { start, end } = recentRange(days);
  const cacheKey = `vet:${start}:${end}`;
  const cached = getCached(liveMemoryCache, cacheKey, LIVE_CACHE_TTL_MS);
  if (cached) return cached;

  const addedRows = await safeFetchVetPages({ permitStart: start, permitEnd: end }, 8);
  const added = addedRows
    .filter((item) => inRange(item.permitDate, start, end))
    .map((item) => changeEntry("vet", compactDate(item.permitDate), "added", item, "허가일 기준 최근 등록"));

  return setCached(liveMemoryCache, cacheKey, {
    updatedAt: new Date().toISOString(),
    start,
    end,
    changes: uniqueChanges(added)
  }, LIVE_CACHE_LIMIT);
}

async function changesForCategory(category = "human", options = {}) {
  const key = CATEGORY_LABELS[category] ? category : "human";
  const log = readChangeLog();
  let live = { changes: [], updatedAt: "" };
  const includeLive = options.live === true || options.live === "1";
  if (includeLive && key === "human") {
    try {
      live = await liveHumanChanges(Number(options.days || process.env.CHANGELOG_RECENT_DAYS || DEFAULT_RECENT_DAYS));
    } catch (error) {
      live = { changes: [], updatedAt: "", error: error.message };
    }
  } else if (includeLive && key === "vet") {
    try {
      live = await liveVetChanges(Number(options.days || process.env.CHANGELOG_RECENT_DAYS || DEFAULT_RECENT_DAYS));
    } catch (error) {
      live = { changes: [], updatedAt: "", error: error.message };
    }
  }
  const changes = uniqueChanges([...(log.changes[key] || []), ...(live.changes || [])])
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return {
    category: key,
    label: CATEGORY_LABELS[key],
    updatedAt: live.updatedAt || log.updatedAt || "",
    source: includeLive ? "snapshot+live" : "snapshot",
    range: live.start && live.end ? { start: live.start, end: live.end } : null,
    snapshot: log.snapshots?.[key] || null,
    liveError: live.error || "",
    changes,
    added: changes.filter((item) => item.type === "added"),
    removed: changes.filter((item) => item.type === "removed")
  };
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

async function changesCsv(category = "human") {
  const payload = await changesForCategory(category, { live: false });
  const rows = [
    ["일자", "카테고리", "변동구분", "제품ID", "제품명", "업체명", "상태", "비고"],
    ...payload.changes.map((item) => [
      item.date || "",
      payload.label,
      CHANGE_LABELS[item.type] || item.type || "",
      item.id || "",
      item.name || "",
      item.company || "",
      item.status || "",
      item.note || ""
    ])
  ];
  return `\ufeff${rows.map((row) => row.map(csvValue).join(",")).join("\r\n")}`;
}

module.exports = {
  CATEGORY_LABELS,
  CHANGE_LABELS,
  readChangeLog,
  changesForCategory,
  changesCsv
};
