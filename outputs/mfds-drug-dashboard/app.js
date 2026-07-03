const state = {
  rows: [],
  total: 0,
  page: 1,
  pageSize: 10,
  totalPages: 1,
  selectedSeq: "",
  detailCache: {},
  detailLoadingSeq: "",
  unitDoseLoading: false,
  listLoading: false,
  loaded: false,
  error: "",
  notice: "",
  filters: {
    itemCategory: "",
    cancelStatus: "",
    etcOtc: "",
    makeMaterial: ""
  },
  sort: {
    key: "",
    direction: "asc"
  },
  columnWidths: {}
};

const form = document.querySelector("#searchForm");
const resultBody = document.querySelector("#resultBody");
const resultCount = document.querySelector("#resultCount");
const detailPanel = document.querySelector("#detailPanel");
const csvButton = document.querySelector("#csvButton");
const changesButtons = document.querySelectorAll("[data-changes-category]");
const changesModal = document.querySelector("#changesModal");
const changesTitle = document.querySelector("#changesTitle");
const changesMeta = document.querySelector("#changesMeta");
const changesContent = document.querySelector("#changesContent");
const changesCsvLink = document.querySelector("#changesCsvLink");
const changesCloseButton = document.querySelector("#changesCloseButton");
const prevPage = document.querySelector("#prevPage");
const nextPage = document.querySelector("#nextPage");
const goPage = document.querySelector("#goPage");
const pageInput = document.querySelector("#pageInput");
const pageInfo = document.querySelector("#pageInfo");
const statusText = document.querySelector("#statusText");
const categoryTabs = document.querySelectorAll("[data-category-tab]");
const workspaceTabs = document.querySelectorAll("[data-workspace-tab]");
const homeWorkspace = document.querySelector("#homeWorkspace");
const homeButton = document.querySelector("#homeButton");
const homeSearchForm = document.querySelector("#homeSearchForm");
const homeSearchInput = document.querySelector("#homeSearchInput");
const homeSearchResults = document.querySelector("#homeSearchResults");
const searchWorkspace = document.querySelector("#searchWorkspace");
const compareWorkspace = document.querySelector("#compareWorkspace");
const groupWorkspace = document.querySelector("#groupWorkspace");
const groupForm = document.querySelector("#groupForm");
const groupSetupPanel = document.querySelector("#groupSetupPanel");
const groupDashboard = document.querySelector("#groupDashboard");
const groupBackButton = document.querySelector("#groupBackButton");
const groupCsvButton = document.querySelector("#groupCsvButton");
const groupReportModal = document.querySelector("#groupReportModal");
const groupReportContent = document.querySelector("#groupReportContent");
const groupReportCsvButton = document.querySelector("#groupReportCsvButton");
const groupReportCloseButton = document.querySelector("#groupReportCloseButton");
const vetWorkspace = document.querySelector("#vetWorkspace");
const aquaticWorkspace = document.querySelector("#aquaticWorkspace");
const addCompareSlotButton = document.querySelector("#addCompareSlot");
const compareSlots = document.querySelector("#compareSlots");
const compareSharedDetail = document.querySelector("#compareSharedDetail");
const compareSlotLimit = 5;
const API_VERSION = "group-dashboard-20260702-1";
const HOME_PREVIEW_LIMIT = 3;
const REVIEW_TYPE_OPTIONS = [
  "자료제출의약품",
  "자료제출의약품(유전자재조합의약품 및 세포배양의약품)",
  "신약",
  "개량신약",
  "제네릭",
  "희귀의약품",
  "표준제조기준",
  "안전성·유효성 심사대상",
  "생물학적동등성시험대상",
  "원료의약품",
  "수출용의약품",
  "한약(생약)제제"
];
let compareSlotSeed = 0;
const compareState = {
  kind: "human",
  slots: [],
  detailOverlayOpen: false,
  detailOverlaySlotId: ""
};
const groupState = {
  step: "setup",
  rows: [],
  detailCache: {},
  summary: null,
  loading: false,
  progress: "",
  error: "",
  query: {},
  selected: {
    compositions: {},
    doses: {},
    products: {}
  }
};
const externalStates = {
  vet: { page: 1, total: 0, totalPages: 1, rows: [], loading: false, error: "", notice: "", loaded: false, selectedKey: "", detailLoadingKey: "", detailCache: {}, columnWidths: {} },
  aquatic: { page: 1, total: 0, totalPages: 1, rows: [], loading: false, error: "", notice: "", loaded: false, selectedKey: "", detailLoadingKey: "", detailCache: {}, columnWidths: {} }
};
let activeSearchKeyword = "";
let activeCategory = "home";
let activeWorkspaceTab = "search";
const homeSearchState = {
  keyword: "",
  loading: false,
  error: "",
  groups: []
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(value, keyword = activeSearchKeyword) {
  const text = String(value ?? "");
  const needle = String(keyword || "").trim();
  if (!needle) return escapeHtml(text);
  const parts = text.split(new RegExp(`(${escapeRegExp(needle)})`, "gi"));
  return parts
    .map((part) => (part.toLowerCase() === needle.toLowerCase() ? `<mark class="keyword-hit">${escapeHtml(part)}</mark>` : escapeHtml(part)))
    .join("");
}

function slashSeparatedLineHtml(value, keyword = activeSearchKeyword) {
  const lines = String(value || "")
    .split(/\s*\/\s*/g)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!lines.length) return `<span class="muted">-</span>`;
  return lines.map((item) => `<span>${highlightText(item, keyword)}</span>`).join("");
}

function ingredientValueHtml(value, keyword = activeSearchKeyword) {
  return `<div class="ingredient-lines">${slashSeparatedLineHtml(value, keyword)}</div>`;
}

function shouldFormatIngredientField(label = "") {
  return /성분|원료|유효성분|주성분|DUR성분/i.test(String(label || ""));
}

function tableCellHtml(value, column, title = "") {
  const label = column?.label || "";
  if (shouldFormatIngredientField(label) || (/원료|성분|함량/i.test(String(title || "")) && /^(?:0|name|ingredient|성분명|성분)$/i.test(String(column?.key || "")))) {
    return ingredientValueHtml(value);
  }
  return highlightText(value || "");
}

function externalColumnCellHtml(value, column) {
  if (shouldFormatIngredientField(column?.label) || (column?.key === "note" && String(value || "").includes("/"))) {
    return ingredientValueHtml(value);
  }
  return escapeHtml(value || "-");
}

function snippet(value, limit = 82) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}...`;
}

function selectedRow() {
  return state.rows.find((row) => row.itemSeq === state.selectedSeq);
}

function selectedDrug() {
  return state.detailCache[state.selectedSeq] || selectedRow();
}

function collectReviewTypes() {
  const values = new Set(REVIEW_TYPE_OPTIONS);
  state.rows.forEach((row) => {
    const drug = rowWithCachedDetail(row);
    if (drug.reviewType) values.add(drug.reviewType);
  });
  compareState.slots.forEach((slot) => {
    slot.rows.forEach((row) => {
      const drug = slot.detailCache[row.itemSeq] ? mergeKeepNonEmpty(row, slot.detailCache[row.itemSeq]) : row;
      if (drug.reviewType) values.add(drug.reviewType);
    });
  });
  return Array.from(values).filter(Boolean).sort((a, b) => a.localeCompare(b, "ko"));
}

function populateReviewTypeSelects() {
  const options = collectReviewTypes();
  document.querySelectorAll("[data-review-type-select]").forEach((select) => {
    const selected = select.value;
    select.innerHTML = `<option value="">전체</option>${options
      .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
      .join("")}`;
    select.value = options.includes(selected) ? selected : "";
  });
}

function mergeKeepNonEmpty(base, overlay) {
  const result = { ...base };
  for (const [key, value] of Object.entries(overlay || {})) {
    if (value === "" && result[key] && result[key] !== "") continue;
    result[key] = value;
  }
  return result;
}

function friendlySearchError(error) {
  const message = String(error?.message || error || "");
  if (/fetch failed|econnreset|timeout|network|terminated/i.test(message)) {
    return "MFDS 서버 연결이 불안정합니다. 잠시 후 다시 검색해 주세요.";
  }
  return message || "검색 요청에 실패했습니다.";
}

function rowWithCachedDetail(row) {
  const detail = state.detailCache[row.itemSeq];
  return detail ? mergeKeepNonEmpty(row, detail) : row;
}

function hasOwnField(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function hasCsvDetailFields(value) {
  return hasOwnField(value, "packageInfo") && hasOwnField(value, "efficacy") && hasOwnField(value, "dosage");
}

function exportOnlyTagHtml(drug) {
  const tags = Array.isArray(drug?.tags) ? drug.tags : [];
  const hasExportOnly = Boolean(drug?.exportOnly || tags.includes("수출용") || hasExportOnlyName(drug?.itemName));
  return hasExportOnly ? `<span class="tag amber">수출용</span>` : "";
}

function getPerformanceYears() {
  const years = new Set();
  state.rows.forEach((row) => {
    const drug = rowWithCachedDetail(row);
    if (drug.performance?.rows) {
      drug.performance.rows.forEach((r) => {
        if (r.year && /^\d{4}$/.test(r.year)) {
          years.add(Number(r.year));
        }
      });
    }
  });
  return Array.from(years).sort((a, b) => a - b);
}

function formatPerformanceYearCell(performance, year) {
  if (!performance || !performance.rows || !performance.rows.length) {
    return `<span class="muted">-</span>`;
  }
  const row = performance.rows.find((r) => Number(r.year) === year);
  if (!row) {
    return `<span class="muted">-</span>`;
  }
  const unitText = performance.unit || "";
  let symbol = "";
  let suffix = "";
  if (unitText.includes("달러") || unitText.toLowerCase().includes("dollar") || unitText.includes("$")) {
    symbol = "$";
  } else if (unitText.includes("원") || unitText.includes("₩") || unitText.includes("￦")) {
    symbol = "₩";
    if (unitText.includes("천원")) {
      suffix = " (천원)";
    }
  } else {
    symbol = "₩";
    if (unitText.includes("천원")) {
      suffix = " (천원)";
    }
  }
  const badgeClass = performance.type === "생산실적" ? "tag-prod" : "tag-imp";
  const shortType = performance.type === "생산실적" ? "생산" : performance.type === "수입실적" ? "수입" : "실적";
  
  return `
    <div class="perf-cell">
      <span class="perf-badge ${badgeClass}">${shortType}</span>
      <span class="perf-amount">${symbol}${row.amount}${suffix}</span>
    </div>
  `;
}

function formatPerformanceYearText(performance, year) {
  if (!performance || !performance.rows || !performance.rows.length) return "-";
  const row = performance.rows.find((item) => Number(item.year) === Number(year));
  if (!row) return "-";
  return row.amount || "-";
}

function formatInsurancePriceText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text === "-") return "";
  const prices = Array.from(text.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*원/g))
    .map((match) => Number(String(match[1]).replaceAll(",", "")))
    .filter(Number.isFinite);
  const uniquePrices = [];
  prices.forEach((price) => {
    if (!uniquePrices.includes(price)) uniquePrices.push(price);
  });
  if (uniquePrices.length) {
    return uniquePrices.map((price) => `${price.toLocaleString("ko-KR")}원`).join(", ");
  }
  return text;
}

function insurancePriceCellHtml(value) {
  const priceText = formatInsurancePriceText(value);
  return priceText ? escapeHtml(priceText) : `<span class="muted">-</span>`;
}

function parseSortableNumber(value) {
  const text = String(value || "").replace(/,/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseInsurancePriceNumber(value) {
  const text = String(value || "");
  const match = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*원/);
  return match ? Number(match[1]) : null;
}

function performanceValueForYear(performance, year) {
  if (!performance || !performance.rows || !performance.rows.length) return null;
  const row = performance.rows.find((item) => Number(item.year) === Number(year));
  return row ? parseSortableNumber(row.amount) : null;
}

function sortValueForRow(row, key) {
  const drug = rowWithCachedDetail(row);
  if (key.startsWith("perf_")) {
    return { type: "number", value: performanceValueForYear(drug.performance, key.split("_")[1]) };
  }
  if (key === "insurancePrice") return { type: "number", value: parseInsurancePriceNumber(drug.insurancePrice) };
  if (key === "permitDate") return { type: "date", value: String(drug.permitDate || "") };
  const value = key === "rowNumber"
    ? drug.rowNumber
    : drug[key];
  return { type: "text", value: String(value || "").trim() };
}

function compareSortValues(left, right, direction) {
  const leftMissing = left.value === null || left.value === undefined || left.value === "";
  const rightMissing = right.value === null || right.value === undefined || right.value === "";
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;

  let result = 0;
  if (left.type === "number") {
    result = Number(left.value) - Number(right.value);
  } else if (left.type === "date") {
    result = String(left.value).localeCompare(String(right.value), "ko", { numeric: true });
  } else {
    result = String(left.value).localeCompare(String(right.value), "ko", { numeric: true, sensitivity: "base" });
  }
  return direction === "desc" ? -result : result;
}

function sortedResultRows(rows) {
  const key = state.sort?.key;
  if (!key) return rows;
  const direction = state.sort.direction === "desc" ? "desc" : "asc";
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const result = compareSortValues(sortValueForRow(a.row, key), sortValueForRow(b.row, key), direction);
      return result || a.index - b.index;
    })
    .map((item) => item.row);
}

function sortHeaderHtml(column) {
  const active = state.sort?.key === column.key;
  const direction = active && state.sort.direction === "desc" ? "desc" : "asc";
  const ariaSort = active ? (direction === "desc" ? "descending" : "ascending") : "none";
  const indicator = active ? (direction === "desc" ? "▼" : "▲") : "↕";
  const nextDirection = active && direction === "asc" ? "내림차순" : "오름차순";
  return {
    ariaSort,
    html: `
      <button type="button" class="sort-header ${active ? "active" : ""}" data-sort-key="${escapeHtml(column.key)}" title="${escapeHtml(`${column.label} ${nextDirection} 정렬`)}">
        <span>${escapeHtml(column.label)}</span>
        <span class="sort-indicator" aria-hidden="true">${indicator}</span>
      </button>
    `
  };
}

function withExportOnlyMode(values, root) {
  const box = root?.querySelector?.('[data-export-only-mode][name="exportOnlyMode"]');
  if (!box) return values;
  return {
    ...values,
    exportOnlyMode: box.checked ? "include" : "exclude"
  };
}

function hasExportOnlyName(value) {
  return /[\(（]\s*수출용\s*[\)）]/i.test(String(value || ""));
}

function withExportOnlyTag(row = {}) {
  const tags = Array.isArray(row.tags) ? [...row.tags] : [];
  const exportOnly = Boolean(row.exportOnly || hasExportOnlyName(row.itemName));
  if (exportOnly && !tags.includes("수출용")) tags.push("수출용");
  return { ...row, exportOnly, tags };
}

function applyClientExportOnlyMode(payload = {}, mode = "") {
  const normalizedMode = String(mode || "").toLowerCase();
  const rows = (payload.items || []).map(withExportOnlyTag);
  const items = normalizedMode === "exclude"
    ? rows.filter((row) => !row.exportOnly)
    : normalizedMode === "only"
      ? rows.filter((row) => row.exportOnly)
      : rows;
  const notices = [payload.notice || ""];
  if (normalizedMode === "exclude" && rows.length !== items.length && !notices.join(" ").includes("수출용")) {
    notices.push("수출용 불포함 조건이 현재 조회 목록에 적용되었습니다.");
  }
  return {
    ...payload,
    items,
    notice: notices.filter(Boolean).join(" ")
  };
}

async function requestHumanSearch(params) {
  const response = await fetch(`/api/search?${params}`);
  if (!response.ok) {
    let errMsg = `검색 요청 실패 (${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson?.message) errMsg += `: ${errJson.message}`;
    } catch {}
    throw new Error(errMsg);
  }
  return response.json();
}

async function normalizeHumanSearchPayload(payload, params) {
  const mode = String(params.get("exportOnlyMode") || "").toLowerCase();
  let normalized = applyClientExportOnlyMode(payload, mode);
  if ((mode === "exclude" || mode === "only") && !(normalized.items || []).length) {
    const retryParams = new URLSearchParams(params);
    retryParams.set("exportOnlyMode", "include");
    retryParams.set("_v", `${API_VERSION}-client-export-retry`);
    const retryPayload = await requestHumanSearch(retryParams);
    normalized = applyClientExportOnlyMode(retryPayload, mode);
    normalized.notice = [
      normalized.notice || "",
      "수출용 조건은 제품명 태그 기준으로 보정 적용했습니다."
    ].filter(Boolean).join(" ");
  }
  return normalized;
}

function hasPresenceToken(params) {
  return [...params.values()].some((value) => {
    const text = String(value || "").trim();
    return text === "#" || text === "$";
  });
}

function buildSearchParams() {
  const values = withExportOnlyMode(Object.fromEntries(new FormData(form).entries()), form);
  const params = new URLSearchParams({ ...values, ...state.filters, page: String(state.page), _v: API_VERSION });
  const usesPresenceToken = hasPresenceToken(params);
  if (usesPresenceToken) {
    params.set("timeoutMs", "10000");
    params.set("retries", "2");
    params.set("fastFail", "0");
    params.set("presenceScanPages", "3");
    params.set("detailCandidateLimit", "30");
    params.set("contractBudgetMs", "8000");
    params.set("detailTimeoutMs", "2500");
    params.set("detailRetries", "1");
    params.set("detailConcurrency", "5");
  } else if (params.get("contractManufacturer") || params.get("reviewType")) {
    params.set("timeoutMs", "10000");
    params.set("retries", "2");
    params.set("fastFail", "0");
    params.set("contractScanPages", "3");
    params.set("contractCandidateLimit", "45");
    params.set("contractBudgetMs", "20000");
    params.set("detailTimeoutMs", "3500");
    params.set("detailRetries", "1");
    params.set("detailConcurrency", "5");
  }
  for (const [key, value] of [...params.entries()]) {
    if (value === "") params.delete(key);
  }
  return params;
}

function defaultCompareFilters(kind = compareState.kind) {
  if (kind !== "human") return {};
  return {
    itemCategory: "",
    cancelStatus: "",
    etcOtc: "",
    makeMaterial: ""
  };
}

function defaultCompareQuery(kind = compareState.kind) {
  return {
    efficacyOperator: "AND",
    dosageOperator: "AND",
    precautionOperator: "AND"
  };
}

function createCompareSlot(kind = compareState.kind || "human") {
  compareSlotSeed += 1;
  return {
    id: String(compareSlotSeed),
    kind,
    rows: [],
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 1,
    selectedSeq: "",
    detailView: false,
    detailCache: {},
    detailLoadingSeq: "",
    detailHydrationGeneration: 0,
    listLoading: false,
    error: "",
    notice: "",
    filters: defaultCompareFilters(kind),
    query: defaultCompareQuery(kind),
    showExtra: false
  };
}

function ensureCompareSlot(kind = compareState.kind || "human") {
  if (compareState.kind !== kind) {
    compareState.kind = kind;
    compareState.slots = [];
  }
  if (!compareState.slots.length) {
    compareState.slots.push(createCompareSlot(kind));
  }
}

function getCompareSlot(slotId) {
  return compareState.slots.find((slot) => slot.id === String(slotId));
}

function compareSlotTitle(slot) {
  const index = compareState.slots.findIndex((item) => item.id === slot.id);
  return `비교 세트 ${index + 1}`;
}

function compareKindLabel(kind = compareState.kind) {
  if (kind === "vet") return "동물용 의약품";
  if (kind === "aquatic") return "수산동물용 의약품";
  return "인체용 의약품";
}

function isExternalCompare(slot) {
  return slot?.kind === "vet" || slot?.kind === "aquatic";
}

function syncCompareQueryFromForm(slot, formEl) {
  if (!slot || !formEl) return;
  slot.query = {
    ...defaultCompareQuery(slot.kind),
    ...withExportOnlyMode(Object.fromEntries(new FormData(formEl).entries()), formEl)
  };
}

function compactParams(values, filters, page) {
  const params = new URLSearchParams({ ...values, ...filters, page: String(page), _v: API_VERSION });
  const usesPresenceToken = hasPresenceToken(params);
  if (usesPresenceToken) {
    params.set("timeoutMs", "10000");
    params.set("retries", "2");
    params.set("fastFail", "0");
    params.set("presenceScanPages", "3");
    params.set("detailCandidateLimit", "30");
    params.set("contractBudgetMs", "8000");
    params.set("detailTimeoutMs", "2500");
    params.set("detailRetries", "1");
    params.set("detailConcurrency", "5");
  } else if (params.get("contractManufacturer") || params.get("reviewType")) {
    params.set("timeoutMs", "10000");
    params.set("retries", "2");
    params.set("fastFail", "0");
    params.set("contractScanPages", "3");
    params.set("contractCandidateLimit", "45");
    params.set("contractBudgetMs", "20000");
    params.set("detailTimeoutMs", "3500");
    params.set("detailRetries", "1");
    params.set("detailConcurrency", "5");
  }
  for (const [key, value] of [...params.entries()]) {
    if (value === "") params.delete(key);
  }
  return params;
}

function buildGroupParams(page = 1) {
  const values = withExportOnlyMode(Object.fromEntries(new FormData(groupForm).entries()), groupForm);
  const params = new URLSearchParams({ ...values, page: String(page), _v: API_VERSION });
  params.set("timeoutMs", "12000");
  params.set("retries", "2");
  params.set("fastFail", "0");
  params.set("presenceScanPages", "10");
  params.set("detailCandidateLimit", "120");
  params.set("contractScanPages", "10");
  params.set("contractCandidateLimit", "120");
  params.set("contractBudgetMs", "45000");
  params.set("detailTimeoutMs", "5000");
  params.set("detailRetries", "1");
  params.set("detailConcurrency", "5");
  for (const [key, value] of [...params.entries()]) {
    if (value === "") params.delete(key);
  }
  return params;
}

function splitIngredientParts(value) {
  return String(value || "")
    .split(/[\/\n]+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseIngredientPart(part) {
  const text = String(part || "").trim();
  const match = text.match(/^(.+?)\((.+)\)$/);
  if (!match) return { name: text, dose: "" };
  return {
    name: match[1].trim(),
    dose: match[2].trim()
  };
}

function componentsForDrug(drug) {
  const parts = splitIngredientParts(drug.mainIngredient);
  if (!parts.length) return [{ name: "-", dose: "" }];
  return parts.map(parseIngredientPart).filter((item) => item.name);
}

function compositionKeyForComponents(components) {
  return components.map((item) => item.name).join(" / ");
}

function doseKeyForComponents(components, unitDose = "") {
  const doseText = components
    .map((item) => item.dose ? `${item.name} ${item.dose}` : item.name)
    .join(" / ");
  return [doseText, unitDose].filter(Boolean).join(" | ");
}

function packageUnitText(drug) {
  return String(drug.packageUnit || drug.packageInfo || "").trim();
}

function productPermitLabel(product) {
  return [product.entpName, product.itemName].filter(Boolean).join(" - ") || "-";
}

function productPermitList(products) {
  return products.map(productPermitLabel).filter(Boolean).join("\n");
}

function renderMultilineText(value, className = "") {
  const lines = String(value || "-")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const safeLines = lines.length ? lines : ["-"];
  return `<span class="multiline-cell ${className}">${safeLines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</span>`;
}

function componentLines(components, key) {
  const items = Array.isArray(components) && components.length ? components : [{ name: "-", dose: "" }];
  return items.map((component) => {
    if (key === "dose") return component.dose || "-";
    return component.name || "-";
  });
}

function renderComponentLines(components, key) {
  return renderMultilineText(componentLines(components, key).join("\n"), key === "dose" ? "dose-lines" : "ingredient-lines");
}

function componentCsvText(components, key) {
  return componentLines(components, key).join("\n");
}

function addPerformanceTotals(target, performance) {
  if (!performance?.rows?.length) return;
  performance.rows.forEach((row) => {
    const year = String(row.year || "").trim();
    if (!/^\d{4}$/.test(year)) return;
    const amount = parseSortableNumber(row.amount);
    if (!Number.isFinite(amount)) return;
    target[year] = (target[year] || 0) + amount;
  });
}

function formatGroupTotal(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function ensureGroupSelections(summary) {
  const next = { compositions: {}, doses: {}, products: {} };
  summary.compositions.forEach((item) => {
    next.compositions[item.key] = groupState.selected.compositions[item.key] !== false;
  });
  summary.doses.forEach((item) => {
    next.doses[item.key] = groupState.selected.doses[item.key] !== false;
  });
  summary.products.forEach((item) => {
    next.products[item.itemSeq] = groupState.selected.products[item.itemSeq] !== false;
  });
  groupState.selected = next;
}

function buildGroupSummary(rows) {
  const compositionMap = new Map();
  const doseMap = new Map();
  const productRows = rows.map((drug) => {
    const components = componentsForDrug(drug);
    const compositionKey = compositionKeyForComponents(components);
    const doseKey = doseKeyForComponents(components, drug.unitDose);
    const product = {
      ...drug,
      components,
      compositionKey,
      doseKey,
      packageUnit: packageUnitText(drug)
    };

    if (!compositionMap.has(compositionKey)) {
      compositionMap.set(compositionKey, {
        key: compositionKey,
        components,
        products: [],
        packages: new Set(),
        years: {}
      });
    }
    const composition = compositionMap.get(compositionKey);
    composition.products.push(product);
    if (product.packageUnit) composition.packages.add(product.packageUnit);
    addPerformanceTotals(composition.years, product.performance);

    if (!doseMap.has(doseKey)) {
      doseMap.set(doseKey, {
        key: doseKey,
        compositionKey,
        dose: doseKey,
        components,
        unitDose: drug.unitDose || "",
        products: [],
        packages: new Set(),
        years: {}
      });
    }
    const dose = doseMap.get(doseKey);
    dose.products.push(product);
    if (product.packageUnit) dose.packages.add(product.packageUnit);
    addPerformanceTotals(dose.years, product.performance);

    return product;
  });

  const years = new Set();
  const ingredientNames = new Set();
  productRows.forEach((product) => {
    product.components.forEach((component) => ingredientNames.add(component.name));
    product.performance?.rows?.forEach((row) => {
      if (/^\d{4}$/.test(String(row.year || ""))) years.add(String(row.year));
    });
  });

  const summary = {
    products: productRows,
    compositions: Array.from(compositionMap.values()).sort((a, b) => b.products.length - a.products.length || a.key.localeCompare(b.key, "ko")),
    doses: Array.from(doseMap.values()).sort((a, b) => b.products.length - a.products.length || a.key.localeCompare(b.key, "ko")),
    years: Array.from(years).sort(),
    ingredientCount: ingredientNames.size
  };
  ensureGroupSelections(summary);
  return summary;
}

function selectedGroupProducts() {
  const summary = groupState.summary;
  if (!summary) return [];
  return summary.products.filter((product) => (
    groupState.selected.compositions[product.compositionKey] !== false &&
    groupState.selected.doses[product.doseKey] !== false &&
    groupState.selected.products[product.itemSeq] !== false
  ));
}

function groupYearCells(years, totals) {
  return years.map((year) => `<td>${formatGroupTotal(totals?.[year] || 0)}</td>`).join("");
}

function groupYearCsvCells(years, totals) {
  return years.map((year) => toCsvValue(totals?.[year] ? formatGroupTotal(totals[year]) : ""));
}

function productPerformanceTotals(product) {
  const totals = {};
  addPerformanceTotals(totals, product.performance);
  return totals;
}

function aggregateGroupProducts(products) {
  const packages = new Set();
  const years = {};
  products.forEach((product) => {
    const packageText = packageUnitText(product);
    if (packageText) packages.add(packageText);
    addPerformanceTotals(years, product.performance);
  });
  return { packages, years };
}

function selectedProductsWithin(products, selectedSet) {
  return products.filter((product) => selectedSet.has(product.itemSeq));
}

function renderGroupProductList(products) {
  if (!products.length) {
    return `<div class="group-tree-products empty">제품이 없습니다.</div>`;
  }
  return `
    <div class="group-tree-products">
      ${products.map((product) => {
        const productKey = String(product.itemSeq || "");
        return `
          <label class="group-tree-product">
            <input type="checkbox" data-group-toggle="products" data-key="${escapeHtml(productKey)}" ${productKey && groupState.selected.products[productKey] !== false ? "checked" : ""}>
            <span>
              <strong>${escapeHtml(product.itemName || "-")}</strong>
              <em>${escapeHtml([product.entpName, productKey && `품목기준코드 ${productKey}`].filter(Boolean).join(" · ") || "-")}</em>
            </span>
          </label>
        `;
      }).join("")}
    </div>
  `;
}

function renderGroupTreeRows(summary) {
  if (!summary.compositions.length) {
    return `<div class="table-message">분석할 제품이 없습니다.</div>`;
  }

  return summary.compositions.map((composition) => {
    const compositionDoses = summary.doses.filter((dose) => dose.compositionKey === composition.key);
    const visibleDoses = compositionDoses.length ? compositionDoses : [{
      key: `${composition.key}::no-dose`,
      compositionKey: composition.key,
      dose: "-",
      components: composition.components,
      products: composition.products
    }];

    return `
      <section class="group-tree-row">
        <div class="group-tree-cell composition-cell">
          <label class="group-tree-node">
            <input type="checkbox" data-group-toggle="compositions" data-key="${escapeHtml(composition.key)}" ${groupState.selected.compositions[composition.key] !== false ? "checked" : ""}>
            <span>
              <strong>${renderComponentLines(composition.components, "name")}</strong>
              <em>${composition.products.length.toLocaleString("ko-KR")}개 제품 · ${compositionDoses.length.toLocaleString("ko-KR")}개 세부 용량</em>
            </span>
          </label>
        </div>
        <div class="group-tree-branches">
          ${visibleDoses.map((dose) => `
            <div class="group-tree-branch">
              <div class="group-tree-cell dose-cell">
                <label class="group-tree-node">
                  <input type="checkbox" data-group-toggle="doses" data-key="${escapeHtml(dose.key)}" ${groupState.selected.doses[dose.key] !== false ? "checked" : ""}>
                  <span>
                    <strong>${renderComponentLines(dose.components, "dose")}</strong>
                    <em>${dose.products.length.toLocaleString("ko-KR")}개 제품</em>
                  </span>
                </label>
              </div>
              <div class="group-tree-cell product-cell">
                ${renderGroupProductList(dose.products)}
              </div>
            </div>
          `).join("")}
        </div>
      </section>
    `;
  }).join("");
}

function renderGroupDashboard() {
  if (!groupDashboard || !groupSetupPanel) return;
  groupSetupPanel.hidden = groupState.step === "dashboard";
  groupDashboard.hidden = groupState.step !== "dashboard";
  if (groupBackButton) groupBackButton.hidden = groupState.step !== "dashboard";
  if (groupCsvButton) groupCsvButton.hidden = groupState.step !== "dashboard" || !groupState.summary;

  if (groupState.loading) {
    groupDashboard.hidden = false;
    groupDashboard.innerHTML = `<div class="group-loading">${escapeHtml(groupState.progress || "제품군 데이터를 수집하는 중입니다.")}</div>`;
    return;
  }

  if (groupState.error) {
    groupDashboard.hidden = false;
    groupDashboard.innerHTML = `<div class="table-message error">${escapeHtml(groupState.error)}</div>`;
    return;
  }

  const summary = groupState.summary;
  if (!summary) {
    groupDashboard.innerHTML = "";
    return;
  }

  const selectedProducts = selectedGroupProducts();
  const allCompositionsChecked = summary.compositions.every((item) => groupState.selected.compositions[item.key] !== false);
  const allDosesChecked = summary.doses.every((item) => groupState.selected.doses[item.key] !== false);
  const allProductsChecked = summary.products.every((item) => groupState.selected.products[item.itemSeq] !== false);

  groupDashboard.innerHTML = `
    <section class="group-tree-section">
      <header>
        <div>
          <h2>성분조합 · 세부용량조합 · 목록</h2>
          <p>
            전체 ${summary.products.length.toLocaleString("ko-KR")}개 제품 중
            ${selectedProducts.length.toLocaleString("ko-KR")}개 선택 ·
            성분조합 ${summary.compositions.length.toLocaleString("ko-KR")}개 ·
            세부용량 ${summary.doses.length.toLocaleString("ko-KR")}개
          </p>
        </div>
        <div class="group-tree-selectors">
          <label><input type="checkbox" data-group-select-all="compositions" ${allCompositionsChecked ? "checked" : ""}> 성분조합 전체</label>
          <label><input type="checkbox" data-group-select-all="doses" ${allDosesChecked ? "checked" : ""}> 세부용량 전체</label>
          <label><input type="checkbox" data-group-select-all="products" ${allProductsChecked ? "checked" : ""}> 제품 전체</label>
        </div>
      </header>
      <div class="group-tree-wrap">
        <div class="group-tree-grid">
          <div class="group-tree-head">
            <div>성분조합</div>
            <div>세부용량조합</div>
            <div>목록</div>
          </div>
          <div class="group-tree-body">${renderGroupTreeRows(summary)}</div>
        </div>
      </div>
    </section>
  `;

  if (groupReportModal && !groupReportModal.hidden) renderGroupReportDashboard();
}

function renderGroupReportDashboard() {
  if (!groupReportContent) return;
  const summary = groupState.summary;
  if (!summary) {
    groupReportContent.innerHTML = `<div class="table-message">출력할 제품군 분석 데이터가 없습니다.</div>`;
    return;
  }

  const selectedProducts = selectedGroupProducts();
  const selectedSet = new Set(selectedProducts.map((product) => product.itemSeq));
  const selectedYears = {};
  selectedProducts.forEach((product) => addPerformanceTotals(selectedYears, product.performance));
  const selectedCompositions = summary.compositions
    .map((item) => ({ item, products: selectedProductsWithin(item.products, selectedSet) }))
    .filter((entry) => entry.products.length);
  const selectedDoses = summary.doses
    .map((item) => ({ item, products: selectedProductsWithin(item.products, selectedSet) }))
    .filter((entry) => entry.products.length);
  const yearHeaders = summary.years.map((year) => `<th>${year}년</th>`).join("") || "<th>실적</th>";
  const emptyYearCells = summary.years.length ? "" : "<td>-</td>";

  const compositionRows = selectedCompositions.map(({ item, products }) => {
    const aggregate = aggregateGroupProducts(products);
    return `
      <tr>
        <td>${renderComponentLines(item.components, "name")}</td>
        <td>${products.length.toLocaleString("ko-KR")}</td>
        <td>${renderMultilineText(productPermitList(products), "permit-product-lines")}</td>
        <td>${escapeHtml(Array.from(aggregate.packages).join(" / ") || "-")}</td>
        ${summary.years.length ? groupYearCells(summary.years, aggregate.years) : emptyYearCells}
      </tr>
    `;
  }).join("");

  const doseRows = selectedDoses.map(({ item, products }) => {
    const aggregate = aggregateGroupProducts(products);
    return `
      <tr>
        <td>${renderComponentLines(item.components, "name")}</td>
        <td>${renderComponentLines(item.components, "dose")}</td>
        <td>${products.length.toLocaleString("ko-KR")}</td>
        <td>${renderMultilineText(productPermitList(products), "permit-product-lines")}</td>
        <td>${escapeHtml(Array.from(aggregate.packages).join(" / ") || "-")}</td>
        ${summary.years.length ? groupYearCells(summary.years, aggregate.years) : emptyYearCells}
      </tr>
    `;
  }).join("");

  const productRows = selectedProducts.map((product) => {
    const totals = productPerformanceTotals(product);
    return `
      <tr>
        <td>${escapeHtml(product.itemName || "-")}</td>
        <td>${escapeHtml(product.entpName || "-")}</td>
        <td>${escapeHtml(product.itemSeq || "-")}</td>
        <td>${renderComponentLines(product.components, "name")}</td>
        <td>${renderComponentLines(product.components, "dose")}</td>
        <td>${escapeHtml(product.packageUnit || product.packageInfo || "-")}</td>
        ${summary.years.length ? groupYearCells(summary.years, totals) : emptyYearCells}
      </tr>
    `;
  }).join("");

  groupReportContent.innerHTML = `
    <div class="group-report-dashboard">
      <div class="group-kpis">
        <div><strong>${summary.products.length.toLocaleString("ko-KR")}</strong><span>전체 제품</span></div>
        <div><strong>${selectedProducts.length.toLocaleString("ko-KR")}</strong><span>선택 제품</span></div>
        <div><strong>${summary.ingredientCount.toLocaleString("ko-KR")}</strong><span>고유 성분</span></div>
        <div><strong>${selectedCompositions.length.toLocaleString("ko-KR")}</strong><span>선택 성분조합</span></div>
        <div><strong>${selectedDoses.length.toLocaleString("ko-KR")}</strong><span>선택 세부용량</span></div>
      </div>

      <section class="group-section">
        <header><h2>선택 결과 연도별 총합 생산/수입실적</h2></header>
        <div class="group-table-wrap">
          <table class="result-table group-table">
            <thead><tr>${yearHeaders}</tr></thead>
            <tbody><tr>${summary.years.length ? groupYearCells(summary.years, selectedYears) : emptyYearCells}</tr></tbody>
          </table>
        </div>
      </section>

      <section class="group-section">
        <header><h2>성분 조합별 집계</h2></header>
        <div class="group-table-wrap">
          <table class="result-table group-table">
            <thead>
              <tr>
                <th>성분 조합</th>
                <th>선택 제품 수</th>
                <th>허가사-제품명</th>
                <th>포장단위</th>
                ${yearHeaders}
              </tr>
            </thead>
            <tbody>${compositionRows || `<tr><td colspan="${4 + Math.max(summary.years.length, 1)}" class="table-message">선택된 성분 조합이 없습니다.</td></tr>`}</tbody>
          </table>
        </div>
      </section>

      <section class="group-section">
        <header><h2>세부 용량 조합별 집계</h2></header>
        <div class="group-table-wrap">
          <table class="result-table group-table">
            <thead>
              <tr>
                <th>성분 조합</th>
                <th>세부 용량</th>
                <th>선택 제품 수</th>
                <th>허가사-제품명</th>
                <th>포장단위</th>
                ${yearHeaders}
              </tr>
            </thead>
            <tbody>${doseRows || `<tr><td colspan="${5 + Math.max(summary.years.length, 1)}" class="table-message">선택된 세부 용량 조합이 없습니다.</td></tr>`}</tbody>
          </table>
        </div>
      </section>

      <section class="group-section">
        <header><h2>제품 목록별 집계</h2></header>
        <div class="group-table-wrap product-table-wrap">
          <table class="result-table group-table">
            <thead>
              <tr>
                <th>제품명</th>
                <th>업체명</th>
                <th>품목기준코드</th>
                <th>성분 조합</th>
                <th>세부 용량</th>
                <th>포장단위</th>
                ${yearHeaders}
              </tr>
            </thead>
            <tbody>${productRows || `<tr><td colspan="${6 + Math.max(summary.years.length, 1)}" class="table-message">선택된 제품이 없습니다.</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function openGroupReport() {
  if (!groupState.summary || !groupReportModal) return;
  groupReportModal.hidden = false;
  renderGroupReportDashboard();
}

function closeGroupReport() {
  if (groupReportModal) groupReportModal.hidden = true;
}

async function loadGroupDashboard() {
  if (!groupForm) return;
  groupState.loading = true;
  groupState.step = "dashboard";
  groupState.error = "";
  groupState.progress = "검색 결과 목록을 수집하는 중입니다.";
  groupState.rows = [];
  groupState.detailCache = {};
  groupState.summary = null;
  groupState.query = Object.fromEntries(new FormData(groupForm).entries());
  closeGroupReport();
  renderGroupDashboard();

  try {
    const firstParams = buildGroupParams(1);
    const firstPayload = await normalizeHumanSearchPayload(await requestHumanSearch(firstParams), firstParams);
    const totalPages = Math.max(Number(firstPayload.totalPages || 1), 1);
    const allRows = [...(firstPayload.items || [])];

    for (let page = 2; page <= totalPages; page += 1) {
      groupState.progress = `검색 결과 목록을 수집하는 중입니다. (${page} / ${totalPages} 페이지)`;
      renderGroupDashboard();
      const params = buildGroupParams(page);
      const payload = await normalizeHumanSearchPayload(await requestHumanSearch(params), params);
      allRows.push(...(payload.items || []));
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    const deduped = [];
    const seen = new Set();
    allRows.forEach((row) => {
      if (!row.itemSeq || seen.has(row.itemSeq)) return;
      seen.add(row.itemSeq);
      deduped.push(row);
    });

    groupState.progress = `상세정보를 수집하는 중입니다. (0 / ${deduped.length}건)`;
    renderGroupDashboard();
    for (let i = 0; i < deduped.length; i += 30) {
      const chunk = deduped.slice(i, i + 30);
      groupState.progress = `상세정보를 수집하는 중입니다. (${Math.min(i + chunk.length, deduped.length)} / ${deduped.length}건)`;
      renderGroupDashboard();
      const details = await requestDetailBatch(chunk.map((row) => row.itemSeq));
      details.forEach((detail) => {
        const row = deduped.find((item) => item.itemSeq === detail.itemSeq);
        groupState.detailCache[detail.itemSeq] = mergeKeepNonEmpty(row, detail);
      });
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    const finalRows = deduped.map((row) => groupState.detailCache[row.itemSeq] ? mergeKeepNonEmpty(row, groupState.detailCache[row.itemSeq]) : row);
    groupState.rows = finalRows;
    groupState.summary = buildGroupSummary(finalRows);
    groupState.loading = false;
    groupState.progress = "";
    renderGroupDashboard();
  } catch (error) {
    groupState.loading = false;
    groupState.error = friendlySearchError(error);
    renderGroupDashboard();
  }
}

function downloadGroupCsv() {
  const summary = groupState.summary;
  if (!summary) return;
  const selectedProducts = selectedGroupProducts();
  const selectedSet = new Set(selectedProducts.map((product) => product.itemSeq));
  const selectedCompositions = summary.compositions
    .map((item) => ({ item, products: selectedProductsWithin(item.products, selectedSet) }))
    .filter((entry) => entry.products.length);
  const selectedDoses = summary.doses
    .map((item) => ({ item, products: selectedProductsWithin(item.products, selectedSet) }))
    .filter((entry) => entry.products.length);
  const selectedYears = {};
  selectedProducts.forEach((product) => addPerformanceTotals(selectedYears, product.performance));
  const lines = [];

  lines.push([toCsvValue("요약")].join(","));
  [
    ["전체 제품", summary.products.length],
    ["선택 제품", selectedProducts.length],
    ["고유 성분", summary.ingredientCount],
    ["선택 성분 조합", selectedCompositions.length],
    ["선택 세부 용량 조합", selectedDoses.length]
  ].forEach((row) => lines.push(row.map(toCsvValue).join(",")));
  lines.push(["선택 결과 연도별 총합", "", ...groupYearCsvCells(summary.years, selectedYears)].join(","));

  lines.push("");
  lines.push([toCsvValue("성분 조합")].join(","));
  lines.push(["성분 조합", "선택 제품 수", "허가사-제품명", "포장단위", ...summary.years.map((year) => `${year}년 생산/수입실적`)].map(toCsvValue).join(","));
  selectedCompositions.forEach(({ item, products }) => {
    const aggregate = aggregateGroupProducts(products);
    lines.push([
      toCsvValue(componentCsvText(item.components, "name")),
      toCsvValue(products.length),
      toCsvValue(productPermitList(products)),
      toCsvValue(Array.from(aggregate.packages).join(" / ")),
      ...groupYearCsvCells(summary.years, aggregate.years)
    ].join(","));
  });

  lines.push("");
  lines.push([toCsvValue("세부 용량 조합")].join(","));
  lines.push(["성분 조합", "세부 용량", "선택 제품 수", "허가사-제품명", "포장단위", ...summary.years.map((year) => `${year}년 생산/수입실적`)].map(toCsvValue).join(","));
  selectedDoses.forEach(({ item, products }) => {
    const aggregate = aggregateGroupProducts(products);
    lines.push([
      toCsvValue(componentCsvText(item.components, "name")),
      toCsvValue(componentCsvText(item.components, "dose")),
      toCsvValue(products.length),
      toCsvValue(productPermitList(products)),
      toCsvValue(Array.from(aggregate.packages).join(" / ")),
      ...groupYearCsvCells(summary.years, aggregate.years)
    ].join(","));
  });

  lines.push("");
  lines.push([toCsvValue("제품 목록")].join(","));
  const headers = ["제품명", "업체명", "품목기준코드", "성분 조합", "세부 용량", "단위용량", "제품 포장단위", ...summary.years.map((year) => `${year}년 생산/수입실적`)];
  lines.push(headers.map(toCsvValue).join(","));
  selectedProducts.forEach((product) => {
    const totals = {};
    addPerformanceTotals(totals, product.performance);
    lines.push([
      toCsvValue(product.itemName),
      toCsvValue(product.entpName),
      toCsvValue(product.itemSeq),
      toCsvValue(componentCsvText(product.components, "name")),
      toCsvValue(componentCsvText(product.components, "dose")),
      toCsvValue(product.unitDose),
      toCsvValue(product.packageUnit || product.packageInfo || ""),
      ...groupYearCsvCells(summary.years, totals)
    ].join(","));
  });
  const filename = getUniqueFilename(`product-group-dashboard-${new Date().toISOString().slice(0, 10)}.csv`);
  const blob = new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 250);
}

function externalDashboard(kind) {
  const prefix = kind === "vet" ? "vet" : "aquatic";
  return {
    kind,
    state: externalStates[kind],
    form: document.querySelector(`#${prefix}SearchForm`),
    body: document.querySelector(`#${prefix}ResultBody`),
    count: document.querySelector(`#${prefix}ResultCount`),
    status: document.querySelector(`#${prefix}StatusText`),
    pageInfo: document.querySelector(`#${prefix}PageInfo`),
    prev: document.querySelector(`#${prefix}PrevPage`),
    next: document.querySelector(`#${prefix}NextPage`),
    detailPanel: document.querySelector(`#${prefix}DetailPanel`),
    endpoint: kind === "vet" ? "/api/vet-search" : "/api/aquatic-search",
    detailEndpoint: "/api/public-detail",
    defaultStatus: kind === "vet" ? "동물용의약품 아지(AZ)트 목록" : "국립수산물품질관리원 약품편람",
    columns:
      kind === "vet"
        ? [
            { key: "itemName", label: "제품명" },
            { key: "entpName", label: "업체명" },
            { key: "itemCategory", label: "품목구분" },
            { key: "permitDate", label: "허가일" },
            { key: "note", label: "비고" }
          ]
        : [
            { key: "permitNumber", label: "허가번호" },
            { key: "itemName", label: "제품명" },
            { key: "entpName", label: "업체명" },
            { key: "dosageForm", label: "제형" },
            { key: "route", label: "투여경로" },
            { key: "firstPermitDate", label: "최초허가일" },
            { key: "permitDate", label: "최종허가일" }
          ]
  };
}

function buildExternalParams(dashboard) {
  const values = Object.fromEntries(new FormData(dashboard.form).entries());
  const params = new URLSearchParams({ ...values, page: String(dashboard.state.page), _v: API_VERSION });
  for (const [key, value] of [...params.entries()]) {
    if (value === "") params.delete(key);
  }
  return params;
}

function renderExternalHeaders(dashboard) {
  const headerRow = dashboard.body?.closest("table")?.querySelector("thead tr");
  if (!headerRow) return;
  const defaultWidths =
    dashboard.kind === "vet"
      ? [210, 150, 110, 100, 260]
      : [120, 220, 160, 100, 110, 110, 110];
  headerRow.innerHTML = dashboard.columns
    .map((column, index) => {
      const width = dashboard.state.columnWidths[column.key] || defaultWidths[index] || 120;
      return `<th data-column-key="${escapeHtml(column.key)}" style="width: ${width}px;"><div class="th-wrapper">${escapeHtml(column.label)}</div></th>`;
    })
    .join("");
}

function externalRowKey(row, index = 0) {
  return row.detailKey || row.sourceUrl || [row.permitNumber, row.itemName, row.entpName, row.permitDate, index].filter(Boolean).join("|") || String(index);
}

function externalSelectedRow(kind) {
  const dashboard = externalDashboard(kind);
  return dashboard.state.rows.find((row, index) => externalRowKey(row, index) === dashboard.state.selectedKey);
}

function externalBasicPairs(kind, row) {
  if (kind === "vet") {
    return [
      ["제품명", row.itemName],
      ["제품영문명", row.itemEngName],
      ["업체명", row.entpName],
      ["품목구분", row.itemCategory],
      ["허가일", row.permitDate],
      ["비고", row.note]
    ];
  }

  return [
    ["허가번호", row.permitNumber],
    ["제품명", row.itemName],
    ["업체명", row.entpName],
    ["제형", row.dosageForm],
    ["투여경로", row.route],
    ["최초허가일", row.firstPermitDate],
    ["최종허가일", row.permitDate],
    ["허가조건", row.condition],
    ["비고", row.note]
  ];
}

function looksLikeHeaderRow(row) {
  return row?.some((cell) => /성분|분량|함량|단위|규격|체중|투여|용량|어종|질병|순번/i.test(String(cell || "")));
}

function renderExternalTableBlock(title, rows) {
  if (!rows?.length) return "";
  const header = looksLikeHeaderRow(rows[0]) ? rows[0] : null;
  const bodyRows = header ? rows.slice(1) : rows;
  if (!bodyRows.length) return "";
  const maxColumnCount = Math.max(...rows.map((row) => row.length));
  const columns = Array.from({ length: maxColumnCount }, (_, index) => ({
    key: String(index),
    label: header?.[index] || `항목 ${index + 1}`
  }));
  const normalized = bodyRows.map((row) =>
    columns.reduce((acc, column, index) => {
      acc[column.key] = row[index] || "";
      return acc;
    }, {})
  );
  return renderTable(title || "상세 표", normalized, columns);
}

function renderExternalTablePreview(tables) {
  if (!tables?.length) return "";
  return tables
    .map((table, index) => {
      const rows = Array.isArray(table) ? table : table.rows;
      const title = Array.isArray(table) ? `상세 표 ${index + 1}` : table.title;
      return renderExternalTableBlock(title, rows);
    })
    .join("");
}

function renderExternalIngredientRows(rows) {
  if (!rows?.length) return "";
  return renderTable("원료약품 및 분량", rows, [
    { key: "name", label: "성분명" },
    { key: "amount", label: "분량" },
    { key: "unit", label: "단위" },
    { key: "note", label: "비고" }
  ]);
}

function renderExternalSections(sections) {
  if (!sections?.length) return "";
  return sections
    .filter((section) => section.title !== "원료약품 및 분량")
    .map((section) => renderTextSection(section.title, section.text, true))
    .join("");
}

function renderUsageHighlights(kind, detail = {}) {
  if (kind !== "vet" && kind !== "aquatic") return "";
  const highlights = detail.usageHighlights || {};
  const usable = Array.isArray(highlights.usable) ? highlights.usable : [];
  const unusable = Array.isArray(highlights.unusable) ? highlights.unusable : [];
  const usableLabel = kind === "aquatic" ? "사용가능한 어종" : "사용가능한 축종";
  const unusableLabel = kind === "aquatic" ? "사용불가능한 어종" : "사용불가능한 축종";
  const chipList = (items, type) =>
    items.length
      ? items.map((item) => `<span class="species-chip ${type}">${escapeHtml(item)}</span>`).join("")
      : `<span class="muted">상세 원문에서 명확한 항목을 찾지 못했습니다.</span>`;

  return `
    <section class="usage-highlight">
      <h3 class="section-title">대상 동물 정보</h3>
      <div class="usage-highlight-grid">
        <div>
          <strong>${escapeHtml(usableLabel)}</strong>
          <div class="species-chip-row">${chipList(usable, "usable")}</div>
        </div>
        <div>
          <strong>${escapeHtml(unusableLabel)}</strong>
          <div class="species-chip-row">${chipList(unusable, "blocked")}</div>
        </div>
      </div>
    </section>
  `;
}

function renderExternalDetail(kind) {
  const dashboard = externalDashboard(kind);
  const { state } = dashboard;
  const panel = dashboard.detailPanel;
  if (!panel) return;

  if (state.loading) {
    panel.innerHTML = `<div class="detail-empty">목록을 불러오는 중입니다.</div>`;
    return;
  }

  const row = externalSelectedRow(kind);
  if (!row) {
    panel.innerHTML = `<div class="detail-empty">검색 결과에서 제품을 선택하세요.</div>`;
    return;
  }

  const detail = state.detailCache[state.selectedKey] || {};
  const isLoading = state.detailLoadingKey === state.selectedKey;
  const detailPairs = Array.isArray(detail.pairs) ? detail.pairs : [];
  const basicPairs = externalBasicPairs(kind, row);
  const pairKeys = new Set(basicPairs.map(([key]) => key));
  const mergedPairs = [...basicPairs, ...detailPairs.filter(([key]) => !pairKeys.has(key))];
  const tags = [row.permitNumber || row.rowNumber, row.itemCategory || row.dosageForm, row.route, row.permitDate].filter(Boolean);

  panel.innerHTML = `
    <header class="detail-head">
      <h2>${escapeHtml(row.itemName || "-")}</h2>
      <p>${escapeHtml(row.entpName || "-")}</p>
      <div class="tag-row">${tags.map((tag) => `<span class="tag blue">${escapeHtml(tag)}</span>`).join("")}</div>
    </header>
    <div class="detail-content">
      ${isLoading ? `<p class="table-message">상세정보를 불러오는 중입니다.</p>` : ""}
      ${detail.error ? `<p class="table-message error">상세 원문을 가져오지 못했습니다: ${escapeHtml(detail.error)}</p>` : ""}
      ${renderKeyValue("기본정보", mergedPairs)}
      ${renderUsageHighlights(kind, detail)}
      ${renderExternalIngredientRows(detail.ingredientRows)}
      ${renderExternalSections(detail.sections)}
      ${detail.summary ? renderTextSection("원문 텍스트", detail.summary, true) : ""}
      ${renderExternalTablePreview((detail.tables || []).filter((table) => !(detail.ingredientRows?.length && table.title === "원료약품 및 분량")))}
      ${row.hasDetailUrl === false ? `<p class="muted">이 항목은 목록 원문에서 별도 상세 주소가 확인되지 않아 목록 정보를 우선 표시합니다.</p>` : ""}
    </div>
  `;
}

function renderExternalDashboard(kind) {
  const dashboard = externalDashboard(kind);
  const { state } = dashboard;
  if (!dashboard.body) return;
  renderExternalDetail(kind);
  renderExternalHeaders(dashboard);

  dashboard.count.innerHTML = `총 <strong>${state.total.toLocaleString("ko-KR")}</strong> 건`;
  dashboard.pageInfo.textContent = `${state.page.toLocaleString("ko-KR")} / ${state.totalPages.toLocaleString("ko-KR")}`;
  dashboard.prev.disabled = state.page <= 1 || state.loading;
  dashboard.next.disabled = state.page >= state.totalPages || state.loading;
  dashboard.status.textContent = state.loading ? "목록을 불러오는 중" : state.error || state.notice || dashboard.defaultStatus;

  const colSpan = dashboard.columns.length;
  if (state.loading) {
    dashboard.body.innerHTML = `<tr><td colspan="${colSpan}" class="table-message">목록을 불러오는 중입니다.</td></tr>`;
    return;
  }
  if (state.error) {
    dashboard.body.innerHTML = `<tr><td colspan="${colSpan}" class="table-message error">${escapeHtml(state.error)}</td></tr>`;
    return;
  }
  if (!state.rows.length) {
    dashboard.body.innerHTML = `<tr><td colspan="${colSpan}" class="table-message">검색 결과가 없습니다.</td></tr>`;
    return;
  }

  dashboard.body.innerHTML = state.rows
    .map((row, index) => {
      const rowKey = externalRowKey(row, index);
      const selected = rowKey === state.selectedKey ? "selected" : "";
      row.__key = rowKey;
      return `
        <tr class="${selected}">
          ${dashboard.columns
            .map((column) => {
              const value = row[column.key] || "-";
              if (column.key === "itemName") {
                return `<td><button class="table-link" type="button" data-external-select="${escapeHtml(rowKey)}">${escapeHtml(value)}</button></td>`;
              }
              return `<td>${externalColumnCellHtml(value, column)}</td>`;
            })
            .join("")}
        </tr>
      `;
    })
    .join("");
  initColumnResize(dashboard.body.closest("table"), state.columnWidths);
}

async function loadExternalResults(kind, { resetPage = false } = {}) {
  const dashboard = externalDashboard(kind);
  const { state } = dashboard;
  if (!dashboard.form) return;
  if (resetPage) state.page = 1;
  state.loading = true;
  state.error = "";
  state.selectedKey = "";
  state.detailLoadingKey = "";
  renderExternalDashboard(kind);

  try {
    const response = await fetch(`${dashboard.endpoint}?${buildExternalParams(dashboard)}`);
    if (!response.ok) {
      let message = `검색 요청 실패 (${response.status})`;
      try {
        const body = await response.json();
        if (body?.message) message += `: ${body.message}`;
      } catch {}
      throw new Error(message);
    }
    const payload = await response.json();
    state.rows = payload.items || [];
    state.total = Number(payload.total || state.rows.length || 0);
    state.page = Number(payload.page || state.page);
    state.totalPages = Math.max(Number(payload.totalPages || 1), 1);
    state.notice = payload.notice || "";
    state.loaded = true;
  } catch (error) {
    state.rows = [];
    state.total = 0;
    state.totalPages = 1;
    state.error = friendlySearchError(error);
  } finally {
    state.loading = false;
    renderExternalDashboard(kind);
  }
}

async function loadExternalDetail(kind, rowKey, { force = false } = {}) {
  const dashboard = externalDashboard(kind);
  const { state } = dashboard;
  const row = state.rows.find((item, index) => externalRowKey(item, index) === rowKey);
  if (!row) return;

  state.selectedKey = rowKey;
  renderExternalDashboard(kind);

  if (!force && state.detailCache[rowKey]) return;
  if (row.hasDetailUrl === false || !row.sourceUrl) {
    state.detailCache[rowKey] = { pairs: [], tables: [], summary: "" };
    renderExternalDashboard(kind);
    return;
  }

  state.detailLoadingKey = rowKey;
  renderExternalDetail(kind);

  try {
    const params = new URLSearchParams({ kind, sourceUrl: row.sourceUrl, _v: API_VERSION });
    const response = await fetch(`${dashboard.detailEndpoint}?${params}`);
    if (!response.ok) {
      let message = `상세 요청 실패 (${response.status})`;
      try {
        const body = await response.json();
        if (body?.message) message += `: ${body.message}`;
      } catch {}
      throw new Error(message);
    }
    state.detailCache[rowKey] = await response.json();
  } catch (error) {
    state.detailCache[rowKey] = { error: friendlySearchError(error), pairs: [], tables: [], summary: "" };
  } finally {
    if (state.detailLoadingKey === rowKey) state.detailLoadingKey = "";
    renderExternalDashboard(kind);
  }
}

function compactExternalCompareParams(slot) {
  const params = new URLSearchParams({ ...slot.query, page: String(slot.page), _v: API_VERSION });
  for (const [key, value] of [...params.entries()]) {
    if (value === "") params.delete(key);
  }
  return params;
}

function externalCompareEndpoint(kind) {
  return kind === "vet" ? "/api/vet-search" : "/api/aquatic-search";
}

function externalCompareRowKey(row, index = 0) {
  return row.__key || externalRowKey(row, index);
}

function externalCompareSelectedRow(slot) {
  return slot.rows.find((row, index) => externalCompareRowKey(row, index) === slot.selectedSeq);
}

function renderExternalCompareForm(slot) {
  const isVet = slot.kind === "vet";
  return `
    <form class="filter-form compare-filter">
      ${compareInput(slot, "제품명", "productName")}
      ${isVet ? compareInput(slot, "제품영문명", "productEngName") : ""}
      ${compareInput(slot, "업체명", "companyName")}
      ${isVet ? compareInput(slot, "품목구분", "itemCategory") : ""}
      ${compareInput(slot, "성분명1", "ingredient1")}
      ${compareInput(slot, "성분명2", "ingredient2")}
      ${compareInput(slot, "성분명3", "ingredient3")}
      <button type="button" class="collapse-toggle" data-compare-extra aria-expanded="${String(slot.showExtra)}">
        <span>추가 성분 검색</span>
        <span class="collapse-icon">▴</span>
      </button>
      <div class="extra-ingredients-wrap ${slot.showExtra ? "" : "collapsed"}">
        ${compareInput(slot, "성분명4", "ingredient4")}
        ${compareInput(slot, "성분명5", "ingredient5")}
      </div>
      ${compareOperator(slot, "효능효과", "efficacyOperator", "efficacyQuery")}
      ${compareOperator(slot, "용법용량", "dosageOperator", "dosageQuery")}
      ${compareOperator(slot, "주의사항", "precautionOperator", "precautionQuery")}
      ${
        isVet
          ? `<div class="date-block">
              <span>허가일</span>
              <div class="quick-dates">
                <button type="button" data-compare-range="">전체</button>
                <button type="button" data-compare-range="1m">1개월</button>
                <button type="button" data-compare-range="6m">6개월</button>
                <button type="button" data-compare-range="1y">1년</button>
                <button type="button" data-compare-range="3y">3년</button>
              </div>
              <div class="date-inputs">
                <input type="date" name="permitStart" value="${escapeHtml(slot.query.permitStart || "")}">
                <input type="date" name="permitEnd" value="${escapeHtml(slot.query.permitEnd || "")}">
              </div>
            </div>`
          : `
            ${compareInput(slot, "어종명", "fishName")}
            ${compareInput(slot, "질병", "disease")}
            ${compareInput(slot, "제형", "dosageForm")}
          `
      }
      <div class="form-actions">
        <button class="primary" type="submit">검색</button>
        <button class="secondary" type="button" data-compare-reset>초기화</button>
      </div>
      ${renderSearchSyntaxHelp()}
    </form>
  `;
}

function renderExternalCompareRows(slot) {
  const columns = slot.kind === "vet"
    ? [
        { key: "itemName", label: "제품명" },
        { key: "entpName", label: "업체명" },
        { key: "itemCategory", label: "품목구분" },
        { key: "permitDate", label: "허가일" }
      ]
    : [
        { key: "itemName", label: "제품명" },
        { key: "entpName", label: "업체명" },
        { key: "dosageForm", label: "제형" },
        { key: "route", label: "투여경로" },
        { key: "permitDate", label: "최종허가일" }
      ];
  if (slot.listLoading) {
    return `<tr><td colspan="${columns.length}" class="table-message">목록을 불러오는 중입니다.</td></tr>`;
  }
  if (slot.error) {
    return `<tr><td colspan="${columns.length}" class="table-message error">${escapeHtml(slot.error)}</td></tr>`;
  }
  if (!slot.rows.length) {
    return `<tr><td colspan="${columns.length}" class="table-message">검색 조건을 입력하고 검색하세요.</td></tr>`;
  }

  return slot.rows
    .map((row, index) => {
      const rowKey = externalCompareRowKey(row, index);
      row.__key = rowKey;
      const selected = rowKey === slot.selectedSeq ? "selected" : "";
      return `
        <tr class="${selected}" data-compare-select="${escapeHtml(rowKey)}">
          ${columns
            .map((column) => {
              const value = row[column.key] || "-";
              if (column.key === "itemName") {
                return `
                  <td>
                    <button type="button">${escapeHtml(value)}</button>
                    <div class="tag-row">
                      <span class="tag blue">${escapeHtml(row.permitNumber || row.productCode || row.rowNumber || "-")}</span>
                      <span class="tag">${escapeHtml(row.itemCategory || row.dosageForm || "-")}</span>
                    </div>
                  </td>
                `;
              }
              return `<td>${externalColumnCellHtml(value, column)}</td>`;
            })
            .join("")}
        </tr>
      `;
    })
    .join("");
}

function renderExternalCompareHeaders(slot) {
  const columns = slot.kind === "vet"
    ? ["제품명", "업체명", "품목구분", "허가일"]
    : ["제품명", "업체명", "제형", "투여경로", "최종허가일"];
  return columns.map((label) => `<th>${escapeHtml(label)}</th>`).join("");
}

function renderExternalCompareDetail(slot) {
  const row = externalCompareSelectedRow(slot);
  if (slot.detailLoadingSeq === slot.selectedSeq) {
    return `<div class="compare-detail-empty">상세정보를 불러오는 중입니다.</div>`;
  }
  if (!row) {
    return `<div class="compare-detail-empty">검색 결과에서 비교할 제품을 선택하세요.</div>`;
  }

  const detail = slot.detailCache[slot.selectedSeq] || {};
  const detailPairs = Array.isArray(detail.pairs) ? detail.pairs : [];
  const basicPairs = externalBasicPairs(slot.kind, row);
  const pairKeys = new Set(basicPairs.map(([key]) => key));
  const mergedPairs = [...basicPairs, ...detailPairs.filter(([key]) => !pairKeys.has(key))];

  return `
    <article class="compare-detail-panel">
      <header>
        <h3>${escapeHtml(row.itemName || "-")}</h3>
        <p>${escapeHtml(row.entpName || "")}</p>
      </header>
      <div class="compare-detail-content">
        ${detail.error ? `
          <div class="table-message error detail-error">
            <span>${escapeHtml(detail.error)}</span>
            <button type="button" data-compare-retry-detail="${escapeHtml(slot.selectedSeq)}">다시 시도</button>
          </div>
        ` : ""}
        ${renderKeyValue("기본정보", mergedPairs)}
        ${renderUsageHighlights(slot.kind, detail)}
        ${renderExternalIngredientRows(detail.ingredientRows)}
        ${renderExternalSections(detail.sections)}
        ${detail.summary ? renderTextSection("원문 텍스트", detail.summary, true) : ""}
        ${renderExternalTablePreview((detail.tables || []).filter((table) => !(detail.ingredientRows?.length && table.title === "원료약품 및 분량")))}
      </div>
    </article>
  `;
}

async function loadExternalCompareResults(slotId, { resetPage = false } = {}) {
  const slot = getCompareSlot(slotId);
  if (!slot || !isExternalCompare(slot)) return;
  const slotEl = compareSlots.querySelector(`[data-slot-id="${CSS.escape(slot.id)}"]`);
  syncCompareQueryFromForm(slot, slotEl?.querySelector("form"));
  if (resetPage) slot.page = 1;
  slot.listLoading = true;
  slot.error = "";
  slot.notice = "";
  slot.selectedSeq = "";
  slot.detailLoadingSeq = "";
  renderCompareSlots();

  try {
    const response = await fetch(`${externalCompareEndpoint(slot.kind)}?${compactExternalCompareParams(slot)}`);
    if (!response.ok) {
      let errMsg = `검색 요청 실패 (${response.status})`;
      try {
        const errJson = await response.json();
        if (errJson?.message) errMsg += `: ${errJson.message}`;
      } catch {}
      throw new Error(errMsg);
    }
    const payload = await response.json();
    slot.rows = (payload.items || []).map((row, index) => ({ ...row, __key: externalRowKey(row, index) }));
    slot.total = Number(payload.total || slot.rows.length || 0);
    slot.notice = payload.notice || "";
    slot.page = Number(payload.page || slot.page);
    slot.pageSize = Number(payload.pageSize || slot.rows.length || 10);
    slot.totalPages = Math.max(Number(payload.totalPages || 1), 1);
    slot.selectedSeq = slot.rows[0]?.__key || "";
    compareState.detailOverlayOpen = false;
    compareState.detailOverlaySlotId = "";
    slot.detailView = false;
  } catch (error) {
    slot.rows = [];
    slot.total = 0;
    slot.totalPages = 1;
    slot.selectedSeq = "";
    slot.detailView = false;
    slot.error = friendlySearchError(error);
  } finally {
    slot.listLoading = false;
    renderCompareSlots();
  }

  if (slot.selectedSeq) {
    setTimeout(() => loadExternalCompareDetail(slot.id, slot.selectedSeq), 0);
  }
}

async function loadExternalCompareDetail(slotId, rowKey, { force = false } = {}) {
  const slot = getCompareSlot(slotId);
  if (!slot || !isExternalCompare(slot) || !rowKey) return;
  const row = slot.rows.find((item, index) => externalCompareRowKey(item, index) === rowKey);
  if (!row) return;

  slot.selectedSeq = rowKey;
  renderCompareSlots();
  if (!force && slot.detailCache[rowKey]) return;

  if (row.hasDetailUrl === false || !row.sourceUrl) {
    slot.detailCache[rowKey] = { pairs: [], tables: [], summary: "" };
    renderCompareSlots();
    return;
  }

  slot.detailLoadingSeq = rowKey;
  renderCompareSlots();
  try {
    const params = new URLSearchParams({ kind: slot.kind, sourceUrl: row.sourceUrl, _v: API_VERSION });
    const response = await fetch(`/api/public-detail?${params}`);
    if (!response.ok) {
      let message = `상세 요청 실패 (${response.status})`;
      try {
        const body = await response.json();
        if (body?.message) message += `: ${body.message}`;
      } catch {}
      throw new Error(message);
    }
    slot.detailCache[rowKey] = await response.json();
  } catch (error) {
    slot.detailCache[rowKey] = { error: friendlySearchError(error), pairs: [], tables: [], summary: "" };
  } finally {
    if (slot.detailLoadingSeq === rowKey) slot.detailLoadingSeq = "";
    renderCompareSlots();
  }
}

function compareInput(slot, label, name, type = "text") {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <input type="${escapeHtml(type)}" name="${escapeHtml(name)}" value="${escapeHtml(slot.query[name] || "")}" autocomplete="off">
    </label>
  `;
}

function compareReviewTypeSelect(slot) {
  const options = collectReviewTypes();
  return `
    <label>
      <span>허가심사유형</span>
      <select name="reviewType" data-review-type-select>
        <option value="">전체</option>
        ${options
          .map((value) => `<option value="${escapeHtml(value)}" ${slot.query.reviewType === value ? "selected" : ""}>${escapeHtml(value)}</option>`)
          .join("")}
      </select>
    </label>
  `;
}

function compareExportOnlyMode(slot) {
  const mode = slot.query.exportOnlyMode || "include";
  return `
    <div class="control-row checkbox-row export-only-row">
      <span>&#49688;&#52636;&#50857;</span>
      <label>
        <input type="checkbox" name="exportOnlyMode" value="include" data-export-only-mode ${mode !== "exclude" && mode !== "only" ? "checked" : ""}>
        &#54252;&#54632;
      </label>
    </div>
  `;
}

function compareOperator(slot, label, operatorName, queryName) {
  const operator = slot.query[operatorName] || "AND";
  return `
    <label class="operator-line">
      <span>${escapeHtml(label)}</span>
      <select name="${escapeHtml(operatorName)}">
        <option ${operator === "AND" ? "selected" : ""}>AND</option>
        <option ${operator === "OR" ? "selected" : ""}>OR</option>
      </select>
      <input name="${escapeHtml(queryName)}" value="${escapeHtml(slot.query[queryName] || "")}" autocomplete="off">
    </label>
  `;
}

function renderSearchSyntaxHelp() {
  return `
    <div class="filter-help" tabindex="0">
      <span class="help-dot">?</span>
      <span># 값 있음 · $ 값 없음</span>
      <div class="help-tooltip">검색 칸에 #만 입력하면 해당 칸에 값이 있는 항목만 찾고, $만 입력하면 해당 칸이 비어 있는 항목만 찾습니다.</div>
    </div>
  `;
}

function compareSegmented(slot, label, field, options) {
  return `
    <div class="control-row">
      <span>${escapeHtml(label)}</span>
      <div class="segmented" data-compare-field="${escapeHtml(field)}">
        ${options
          .map(
            (option) => `
              <button type="button" class="${slot.filters[field] === option.value ? "active" : ""}" data-value="${escapeHtml(option.value)}">
                ${escapeHtml(option.label)}
              </button>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function ingredientLineHtml(value) {
  return slashSeparatedLineHtml(value);
}

function unitDoseLineHtml(value, loading = false) {
  const lines = String(value || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!lines.length && loading) return `<span class="muted">조회 중</span>`;
  if (!lines.length) return `<span class="muted">-</span>`;
  return lines.map((item) => `<span>${escapeHtml(item)}</span>`).join("");
}

function renderCompareForm(slot) {
  return `
    <form class="filter-form compare-filter">
      ${compareInput(slot, "제품명", "productName")}
      ${compareInput(slot, "제품영문명", "productEngName")}
      ${compareInput(slot, "업체명", "companyName")}
      ${compareInput(slot, "업체영문명", "companyEngName")}
      ${compareInput(slot, "위탁제조업체", "contractManufacturer")}
      ${compareReviewTypeSelect(slot)}
      ${compareExportOnlyMode(slot)}
      ${compareInput(slot, "성분명1", "ingredient1")}
      ${compareInput(slot, "성분명2", "ingredient2")}
      ${compareInput(slot, "성분명3", "ingredient3")}
      <button type="button" class="collapse-toggle" data-compare-extra aria-expanded="${String(slot.showExtra)}">
        <span>추가 성분 검색</span>
        <span class="collapse-icon">▴</span>
      </button>
      <div class="extra-ingredients-wrap ${slot.showExtra ? "" : "collapsed"}">
        ${compareInput(slot, "성분명4", "ingredient4")}
        ${compareInput(slot, "성분명5", "ingredient5")}
      </div>
      ${compareInput(slot, "성분영문명", "ingredientEngName")}
      ${compareInput(slot, "품목기준코드", "itemSeq")}
      ${compareInput(slot, "표준코드", "standardCode")}
      <label class="inline-action">
        <span>ATC코드</span>
        <input name="atcCode" value="${escapeHtml(slot.query.atcCode || "")}" autocomplete="off">
        <button class="small-button" type="submit">검색</button>
      </label>
      ${compareSegmented(slot, "품목구분", "itemCategory", [
        { label: "전체", value: "" },
        { label: "의약품", value: "A0" },
        { label: "의약외품", value: "B0" },
        { label: "생물의약품", value: "C0" },
        { label: "마약류", value: "F0" },
        { label: "첨단바이오", value: "J0" },
        { label: "한약(생약)제제", value: "E0" }
      ])}
      ${compareSegmented(slot, "취소/취하", "cancelStatus", [
        { label: "전체", value: "" },
        { label: "정상", value: "0" },
        { label: "취하", value: "2" },
        { label: "유효기간만료", value: "A" }
      ])}
      ${compareSegmented(slot, "전문/일반", "etcOtc", [
        { label: "전체", value: "" },
        { label: "전문", value: "02" },
        { label: "일반", value: "01" }
      ])}
      ${compareSegmented(slot, "완제/원료", "makeMaterial", [
        { label: "전체", value: "" },
        { label: "완제", value: "01" },
        { label: "원료", value: "03" },
        { label: "한약재", value: "02" }
      ])}
      ${compareOperator(slot, "효능효과", "efficacyOperator", "efficacyQuery")}
      ${compareOperator(slot, "용법용량", "dosageOperator", "dosageQuery")}
      ${compareOperator(slot, "사용상의주의사항", "precautionOperator", "precautionQuery")}
      <div class="date-block">
        <span>허가일</span>
        <div class="quick-dates">
          <button type="button" data-compare-range="">전체</button>
          <button type="button" data-compare-range="1m">1개월</button>
          <button type="button" data-compare-range="6m">6개월</button>
          <button type="button" data-compare-range="1y">1년</button>
          <button type="button" data-compare-range="3y">3년</button>
        </div>
        <div class="date-inputs">
          <input type="date" name="permitStart" value="${escapeHtml(slot.query.permitStart || "")}">
          <input type="date" name="permitEnd" value="${escapeHtml(slot.query.permitEnd || "")}">
        </div>
      </div>
      <div class="form-actions">
        <button class="primary" type="submit">검색</button>
        <button class="secondary" type="button" data-compare-reset>초기화</button>
      </div>
      ${renderSearchSyntaxHelp()}
    </form>
  `;
}

function compareSelectedRow(slot) {
  return slot.rows.find((row) => row.itemSeq === slot.selectedSeq);
}

function compareSelectedDrug(slot) {
  return slot.detailCache[slot.selectedSeq] || compareSelectedRow(slot);
}

function showHome() {
  closeChanges();
  activeCategory = "home";
  activeWorkspaceTab = "search";
  categoryTabs.forEach((button) => {
    button.classList.remove("active");
    button.setAttribute("aria-selected", "false");
  });
  homeButton?.classList.add("active");
  workspaceTabs.forEach((button) => {
    const active = button.dataset.workspaceTab === "search";
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelector(".workspace-tabs")?.setAttribute("hidden", "");
  if (homeWorkspace) homeWorkspace.hidden = false;
  if (searchWorkspace) searchWorkspace.hidden = true;
  if (compareWorkspace) compareWorkspace.hidden = true;
  if (groupWorkspace) groupWorkspace.hidden = true;
  if (vetWorkspace) vetWorkspace.hidden = true;
  if (aquaticWorkspace) aquaticWorkspace.hidden = true;
  document.body.classList.remove("compare-mode", "table-only");
}

function homeResultId(category, index) {
  return `${category}:${index}`;
}

function findHomeResult(category, index) {
  const group = homeSearchState.groups.find((item) => item.key === category);
  return group?.items?.[Number(index)] || null;
}

function renderHomeResults() {
  if (!homeSearchResults) return;
  if (homeSearchState.loading) {
    homeSearchResults.innerHTML = `<div class="home-result-message">세 카테고리에서 검색하는 중입니다.</div>`;
    return;
  }
  if (homeSearchState.error) {
    homeSearchResults.innerHTML = `<div class="home-result-message error">${escapeHtml(homeSearchState.error)}</div>`;
    return;
  }
  if (!homeSearchState.keyword) {
    homeSearchResults.innerHTML = "";
    return;
  }

  const groupsHtml = homeSearchState.groups
    .map((group) => {
      const items = group.items || [];
      const visible = items.slice(0, HOME_PREVIEW_LIMIT);
      const total = Math.max(Number(group.total || 0), items.length);
      const moreCount = Math.max(0, total - visible.length);
      return `
        <section class="home-result-group">
          <header>
            <h2>${escapeHtml(group.label)}</h2>
            <span>${total.toLocaleString("ko-KR")}건</span>
          </header>
          ${
            group.error
              ? `<p class="home-result-message error">${escapeHtml(group.error)}</p>`
              : visible.length
                ? `<div class="home-result-list">
                    ${visible
                      .map(
                        (item, index) => `
                          <button type="button" class="home-result-item" data-home-result="${escapeHtml(group.key)}" data-home-index="${index}">
                            <strong>${highlightText(item.title, homeSearchState.keyword)}</strong>
                            <span>${escapeHtml(item.company || "-")}</span>
                            <small>${escapeHtml(item.matchLabel || "검색 결과")} · ${highlightText(item.snippet || item.meta || "", homeSearchState.keyword)}</small>
                          </button>
                        `
                      )
                      .join("")}
                  </div>`
                : `<p class="home-result-message">검색 결과가 없습니다.</p>`
          }
          ${
            moreCount > 0
              ? `<button class="home-more-button" type="button" data-home-open-category="${escapeHtml(group.key)}">${escapeHtml(group.label)} 전체 검색결과 보기</button>`
              : ""
          }
        </section>
      `;
    })
    .join("");

  homeSearchResults.innerHTML = groupsHtml;
}

function clearSearchFormFields(formEl) {
  if (!formEl) return;
  Array.from(formEl.elements).forEach((element) => {
    if (!element.name) return;
    if (element.tagName === "SELECT") {
      element.value = "AND";
      return;
    }
    if (element.type === "checkbox" || element.type === "radio") {
      element.checked = element.defaultChecked;
      return;
    }
    element.value = "";
  });
}

function resetHumanSearchFilters() {
  state.filters = {
    itemCategory: "",
    cancelStatus: "",
    etcOtc: "",
    makeMaterial: ""
  };
  form.querySelectorAll(".segmented").forEach((group) => {
    group.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.value === "");
    });
  });
  form.querySelectorAll(".quick-dates button").forEach((button) => {
    button.classList.toggle("active", button.dataset.range === "");
  });
}

function handleExportOnlyModeChange(target) {
  if (!target?.matches?.("[data-export-only-mode]")) return;
  const group = target.closest(".export-only-row");
  if (!group) return;
  const boxes = Array.from(group.querySelectorAll("[data-export-only-mode]"));
  if (boxes.length <= 1) return;
  if (target.checked) {
    boxes.forEach((box) => {
      if (box !== target) box.checked = false;
    });
    return;
  }
  if (!boxes.some((box) => box.checked)) {
    const includeBox = boxes.find((box) => box.value === "include") || boxes[0];
    if (includeBox) includeBox.checked = true;
  }
}

function preferredHomeMatchLabel(group, fallback = "제품명") {
  if (/발열|고열|열감|통증|동통|기침|해수|가래|담|설사|구토|염증|감염|해열|진통|진해|거담/.test(homeSearchState.keyword.replace(/\s+/g, ""))) {
    return "효능효과";
  }
  const counts = new Map();
  for (const item of group?.items || []) {
    const labels = [...(item.matchFields || []), item.matchLabel].filter(Boolean);
    for (const label of labels) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  if (!counts.size) return fallback;
  const priority = ["제품명", "효능효과", "위탁생산업체", "성분명", "업체명"];
  return [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    const aPriority = priority.includes(a[0]) ? priority.indexOf(a[0]) : priority.length;
    const bPriority = priority.includes(b[0]) ? priority.indexOf(b[0]) : priority.length;
    return aPriority - bPriority;
  })[0][0];
}

function preferredHomeSearchTerm(group, label) {
  const item = (group?.items || []).find((result) => {
    const labels = [...(result.matchFields || []), result.matchLabel].filter(Boolean);
    return labels.includes(label) && result.searchTerm;
  });
  return item?.searchTerm || homeSearchState.keyword;
}

function applyHomeKeywordToForm(formEl, label, keyword) {
  clearSearchFormFields(formEl);
  if (!formEl?.elements) return;
  const fields = formEl.elements;
  if (label === "효능효과" && fields.efficacyQuery) {
    fields.efficacyOperator.value = "AND";
    fields.efficacyQuery.value = keyword || "";
  } else if (label === "위탁생산업체" && fields.contractManufacturer) {
    fields.contractManufacturer.value = keyword || "";
  } else if (label === "성분명" && fields.ingredient1) {
    fields.ingredient1.value = keyword || "";
  } else if (label === "업체명" && fields.companyName) {
    fields.companyName.value = keyword || "";
  } else if (fields.productName) {
    fields.productName.value = keyword || "";
  }
}

function openHomeHumanResult(result) {
  const group = homeSearchState.groups.find((item) => item.key === "human");
  const rows = (group?.items || []).map((item, index) => ({ ...item.row, rowNumber: String(index + 1) }));
  setCategoryTab("human", { autoLoad: false });
  setWorkspaceTab("search");
  resetHumanSearchFilters();
  applyHomeKeywordToForm(form, result.matchLabel || preferredHomeMatchLabel(group), homeSearchState.keyword);
  state.rows = rows;
  state.total = rows.length;
  state.page = 1;
  state.pageSize = rows.length || 10;
  state.totalPages = 1;
  state.error = "";
  state.notice = "홈 통합 검색 결과";
  state.selectedSeq = result.row.itemSeq;
  if (result.detail) {
    state.detailCache[result.row.itemSeq] = mergeKeepNonEmpty(result.row, result.detail);
  }
  render();
  loadDetail(result.row.itemSeq);
}

function openHomeExternalResult(category, result) {
  const group = homeSearchState.groups.find((item) => item.key === category);
  const rows = (group?.items || []).map((item, index) => ({ ...item.row, rowNumber: item.row.rowNumber || String(index + 1) }));
  const dashboard = externalDashboard(category);
  const extState = dashboard.state;
  extState.loaded = true;
  setCategoryTab(category);
  applyHomeKeywordToForm(dashboard.form, result.matchLabel || preferredHomeMatchLabel(group), result.searchTerm || homeSearchState.keyword);
  extState.rows = rows;
  extState.total = rows.length;
  extState.page = 1;
  extState.totalPages = 1;
  extState.loading = false;
  extState.error = "";
  extState.notice = "홈 통합 검색 결과";
  extState.loaded = true;
  const rowIndex = rows.findIndex(
    (row) =>
      row.detailKey === result.row.detailKey ||
      row.sourceUrl === result.row.sourceUrl ||
      (row.itemName === result.row.itemName && row.entpName === result.row.entpName)
  );
  const selectedIndex = Math.max(rowIndex, 0);
  const selectedKey = externalRowKey(rows[selectedIndex], selectedIndex);
  extState.selectedKey = selectedKey;
  renderExternalDashboard(category);
  loadExternalDetail(category, selectedKey);
}

function openHomeCategoryResults(category) {
  const group = homeSearchState.groups.find((item) => item.key === category);
  if (!group || !homeSearchState.keyword) return;
  const label = preferredHomeMatchLabel(group);
  const searchTerm = preferredHomeSearchTerm(group, label);
  activeSearchKeyword = homeSearchState.keyword;

  if (category === "human") {
    setCategoryTab("human", { autoLoad: false });
    setWorkspaceTab("search");
    resetHumanSearchFilters();
    applyHomeKeywordToForm(form, label, searchTerm);
    loadResults({ resetPage: true });
    return;
  }

  const dashboard = externalDashboard(category);
  dashboard.state.loaded = true;
  dashboard.state.page = 1;
  applyHomeKeywordToForm(dashboard.form, label, searchTerm);
  setCategoryTab(category);
  loadExternalResults(category, { resetPage: true });
}

function openHomeResult(category, index) {
  const result = findHomeResult(category, index);
  if (!result) return;
  activeSearchKeyword = homeSearchState.keyword;
  if (category === "human") {
    openHomeHumanResult(result);
    return;
  }
  openHomeExternalResult(category, result);
}

function renderChangeItems(title, items) {
  if (!items?.length) {
    return `
      <section class="changes-section">
        <h3>${escapeHtml(title)}</h3>
        <p class="empty-note">누적된 내역이 없습니다.</p>
      </section>
    `;
  }
  return `
    <section class="changes-section">
      <h3>${escapeHtml(title)} <span>${items.length.toLocaleString("ko-KR")}건</span></h3>
      <div class="changes-list">
        ${items
          .map(
            (item) => `
              <article class="change-item">
                <strong>${escapeHtml(item.name || "-")}</strong>
                <span>${escapeHtml(item.company || "-")}</span>
                <small>${escapeHtml(item.date || "-")} · ${escapeHtml(item.id || "-")} ${item.status ? `· ${escapeHtml(item.status)}` : ""}</small>
                ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

async function openChanges(category) {
  if (!changesModal || !changesContent) return;
  changesModal.hidden = false;
  changesTitle.textContent = "의약품 변동사항";
  changesMeta.textContent = "일자별 신규 등록 및 취하·만료 누적 내역";
  changesContent.innerHTML = `<p class="changes-loading">변동사항을 불러오는 중입니다.</p>`;
  if (changesCsvLink) {
    changesCsvLink.href = `/api/changes-csv?category=${encodeURIComponent(category)}`;
  }

  try {
    const response = await fetch(`/api/changes?category=${encodeURIComponent(category)}&_v=${encodeURIComponent(API_VERSION)}`);
    if (!response.ok) throw new Error(`변동사항 요청 실패 (${response.status})`);
    const payload = await response.json();
    changesTitle.textContent = `${payload.label || "의약품"} 변동사항`;
    const metaParts = [];
    if (payload.snapshot?.date) {
      metaParts.push(`자정 스냅샷: ${payload.snapshot.date} (${Number(payload.snapshot.count || 0).toLocaleString("ko-KR")}건)`);
    }
    if (payload.range) {
      metaParts.push(`최근 조회: ${payload.range.start} ~ ${payload.range.end}`);
    }
    if (payload.updatedAt) {
      metaParts.push(`마지막 갱신: ${payload.updatedAt}`);
    }
    changesMeta.textContent = metaParts.length ? metaParts.join(" · ") : "아직 기준 스냅샷이 없습니다. 다음 자정 갱신 이후 전일 대비 변동사항이 누적됩니다.";
    changesContent.innerHTML = `
      ${payload.liveError ? `<p class="changes-loading error">${escapeHtml(payload.liveError)}</p>` : ""}
      ${renderChangeItems("신규 등록된 의약품", payload.added || [])}
      ${renderChangeItems("취하·만료된 의약품", payload.removed || [])}
    `;
  } catch (error) {
    changesContent.innerHTML = `<p class="changes-loading error">${escapeHtml(error.message || "변동사항을 불러오지 못했습니다.")}</p>`;
  }
}

function closeChanges() {
  if (changesModal) changesModal.hidden = true;
}

async function runHomeSearch() {
  const query = homeSearchInput?.value.trim() || "";
  activeSearchKeyword = query;
  homeSearchState.keyword = query;
  homeSearchState.loading = Boolean(query);
  homeSearchState.error = "";
  homeSearchState.groups = [];
  renderHomeResults();
  if (!query) return;

  try {
    const params = new URLSearchParams({ q: query, _v: API_VERSION });
    const response = await fetch(`/api/global-search?${params}`);
    if (!response.ok) {
      throw new Error(`통합 검색 요청 실패 (${response.status}). 검색 범위가 넓어 시간이 초과됐습니다. 다시 검색하거나 조금 더 구체적인 단어를 입력해 주세요.`);
    }
    const payload = await response.json();
    homeSearchState.groups = payload.groups || [];
    homeSearchState.keyword = payload.keyword || query;
  } catch (error) {
    homeSearchState.error = friendlySearchError(error);
  } finally {
    homeSearchState.loading = false;
    renderHomeResults();
  }
}

function renderCompareRows(slot) {
  if (slot.listLoading) {
    return `<tr><td colspan="6" class="table-message">목록을 불러오는 중입니다.</td></tr>`;
  }
  if (slot.error) {
    return `<tr><td colspan="6" class="table-message error">${escapeHtml(slot.error)}</td></tr>`;
  }
  if (!slot.rows.length) {
    return `<tr><td colspan="6" class="table-message">검색 조건을 입력하고 검색하세요.</td></tr>`;
  }
  return slot.rows
    .map((row) => {
      const drug = slot.detailCache[row.itemSeq] ? mergeKeepNonEmpty(row, slot.detailCache[row.itemSeq]) : row;
      const selected = drug.itemSeq === slot.selectedSeq ? "selected" : "";
      return `
        <tr class="${selected}" data-compare-select="${escapeHtml(drug.itemSeq)}">
          <td>
            <button type="button">${escapeHtml(drug.itemName || "-")}</button>
            <div class="tag-row">
              <span class="tag blue">${escapeHtml(drug.itemSeq || "-")}</span>
              <span class="tag">${escapeHtml(drug.itemCategory || "-")}</span>
              ${exportOnlyTagHtml(drug)}
            </div>
          </td>
          <td>${escapeHtml(drug.entpName || "-")}</td>
          <td><div class="ingredient-lines">${ingredientLineHtml(drug.mainIngredient)}</div></td>
          <td><div class="unit-dose-lines">${unitDoseLineHtml(drug.unitDose)}</div></td>
          <td>${escapeHtml(drug.etcOtc || "-")}</td>
          <td>${escapeHtml(drug.permitDate || "-")}</td>
        </tr>
      `;
    })
    .join("");
}

function renderCompareDetail(slot) {
  const drug = compareSelectedDrug(slot);
  if (slot.detailLoadingSeq === slot.selectedSeq) {
    return `<div class="compare-detail-empty">상세정보를 불러오는 중입니다.</div>`;
  }
  if (!drug) {
    return `<div class="compare-detail-empty">검색 결과에서 비교할 제품을 선택하세요.</div>`;
  }

  const basicPairs = [
    ["제품명", drug.itemName],
    ["업체명", drug.entpName],
    ["위탁제조업체", drug.contractManufacturer],
    ["주성분", drug.mainIngredient],
    ["단위용량", drug.unitDose],
    ["전문/일반", drug.etcOtc],
    ["허가일", drug.permitDate],
    ["ATC", drug.atcCode],
    ["품목기준코드", drug.itemSeq],
    ["취소/취하", drug.cancelStatus],
    ["완제/원료", drug.makeMaterial]
  ];

  return `
    <article class="compare-detail-panel">
      <header>
        <h3>${escapeHtml(drug.itemName || "-")}</h3>
        <p>${escapeHtml(drug.entpName || "")}</p>
      </header>
      <div class="compare-detail-content">
        ${drug.detailError ? `
          <div class="table-message error detail-error">
            <span>${escapeHtml(drug.detailError)}</span>
            <button type="button" data-compare-retry-detail="${escapeHtml(drug.itemSeq || slot.selectedSeq)}">다시 시도</button>
          </div>
        ` : ""}
        ${renderKeyValue("기본정보", basicPairs)}
        ${renderTextSection("효능효과", drug.efficacy, true)}
        ${renderTextSection("용법용량", drug.dosage, true)}
      </div>
    </article>
  `;
}

function renderCompareDetailScreen(slot) {
  const external = isExternalCompare(slot);
  return `
    <div class="compare-detail-screen">
      <div class="compare-detail-toolbar">
        <button type="button" data-compare-back>← 검색 결과로</button>
        <span>${escapeHtml(compareKindLabel(slot.kind))} 상세정보</span>
      </div>
      ${external ? renderExternalCompareDetail(slot) : renderCompareDetail(slot)}
    </div>
  `;
}

function renderCompareSlot(slot) {
  const index = compareState.slots.findIndex((item) => item.id === slot.id);
  const pageStart = slot.total && slot.rows.length ? (slot.page - 1) * slot.pageSize + 1 : 0;
  const pageEnd = slot.total && slot.rows.length ? pageStart + slot.rows.length - 1 : 0;
  const external = isExternalCompare(slot);
  return `
    <section class="compare-slot ${index === 0 ? "active" : ""} ${slot.detailView ? "detail-view" : ""}" data-slot-id="${escapeHtml(slot.id)}">
      <header class="compare-slot-head">
        <div>
          <h2>${escapeHtml(compareSlotTitle(slot))}</h2>
          <p>${escapeHtml(compareKindLabel(slot.kind))} · 총 ${slot.total.toLocaleString("ko-KR")}건${slot.rows.length ? ` (${pageStart.toLocaleString("ko-KR")}-${pageEnd.toLocaleString("ko-KR")})` : ""}</p>
        </div>
        <div class="compare-slot-actions">
          <button type="button" data-compare-download ${slot.rows.length ? "" : "disabled"}>엑셀 다운로드</button>
          ${compareState.slots.length > 1 ? `<button type="button" data-compare-remove aria-label="${escapeHtml(compareSlotTitle(slot))} 닫기">×</button>` : ""}
        </div>
      </header>
      ${slot.detailView ? renderCompareDetailScreen(slot) : `
      ${external ? renderExternalCompareForm(slot) : renderCompareForm(slot)}
      ${slot.notice ? `<p class="compare-notice">${escapeHtml(slot.notice)}</p>` : ""}
      <div class="compare-pager">
        <button type="button" data-compare-page="prev" ${slot.page <= 1 ? "disabled" : ""}>이전</button>
        <span>${slot.page.toLocaleString("ko-KR")} / ${slot.totalPages.toLocaleString("ko-KR")}</span>
        <button type="button" data-compare-page="next" ${slot.page >= slot.totalPages ? "disabled" : ""}>다음</button>
      </div>
      <div class="compare-result-wrap">
        <table class="result-table compare-result-table">
          <thead>
            <tr>
              ${
                external
                  ? renderExternalCompareHeaders(slot)
                  : `
                    <th>제품명</th>
                    <th>업체명</th>
                    <th>주성분</th>
                    <th>단위용량</th>
                    <th>전문/일반</th>
                    <th>허가일</th>
                  `
              }
            </tr>
          </thead>
          <tbody>${external ? renderExternalCompareRows(slot) : renderCompareRows(slot)}</tbody>
        </table>
      </div>
      `}
    </section>
  `;
}

function downloadCompareSlotCsv(slot) {
  if (!slot?.rows?.length) return;
  const external = isExternalCompare(slot);
  const lines = [];
  let headers;
  if (external) {
    headers = slot.kind === "vet"
      ? ["제품명", "업체명", "품목구분", "허가일", "비고"]
      : ["허가번호", "제품명", "업체명", "제형", "투여경로", "최종허가일", "허가조건", "비고"];
    lines.push(headers.map(toCsvValue).join(","));
    slot.rows.forEach((row) => {
      const rowData = slot.kind === "vet"
        ? [row.itemName, row.entpName, row.itemCategory, row.permitDate, row.note]
        : [row.permitNumber, row.itemName, row.entpName, row.dosageForm, row.route, row.permitDate, row.condition, row.note];
      lines.push(rowData.map(toCsvValue).join(","));
    });
  } else {
    const years = new Set();
    const rows = slot.rows.map((row) => slot.detailCache[row.itemSeq] ? mergeKeepNonEmpty(row, slot.detailCache[row.itemSeq]) : row);
    rows.forEach((drug) => {
      drug.performance?.rows?.forEach((perf) => {
        if (/^\d{4}$/.test(String(perf.year || ""))) years.add(String(perf.year));
      });
    });
    const perfYears = Array.from(years).sort();
    headers = ["제품명", "업체명", "성분 조합", "주성분영문명", "단위용량", "전문/일반", "효능효과", "용법용량", "제품 포장단위", "허가일", ...perfYears.map((year) => `${year}년 생산/수입실적`)];
    lines.push(headers.map(toCsvValue).join(","));
    rows.forEach((drug) => {
      const totals = {};
      addPerformanceTotals(totals, drug.performance);
      lines.push([
        toCsvValue(drug.itemName),
        toCsvValue(drug.entpName),
        toCsvValue(drug.mainIngredient),
        toCsvValue(drug.mainIngredientEng),
        toCsvValue(drug.unitDose),
        toCsvValue(drug.etcOtc),
        toCsvValue(drug.efficacy),
        toCsvValue(drug.dosage),
        toCsvValue(drug.packageUnit || drug.packageInfo || ""),
        toCsvValue(drug.permitDate),
        ...groupYearCsvCells(perfYears, totals)
      ].join(","));
    });
  }

  const filename = getUniqueFilename(`compare-set-${slot.id}-${new Date().toISOString().slice(0, 10)}.csv`);
  const blob = new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 250);
}

function selectedCompareDetailSlots() {
  return compareState.slots.filter((slot) => {
    if (!slot.selectedSeq) return false;
    return isExternalCompare(slot) ? externalCompareSelectedRow(slot) : compareSelectedDrug(slot);
  });
}

function positionCompareSharedDetail() {
  if (!compareSharedDetail || !compareSlots) return;
  const selectedSlot = selectedCompareDetailSlots()[0];
  if (!compareState.detailOverlayOpen || !selectedSlot || !compareSharedDetail.innerHTML.trim()) {
    compareSharedDetail.style.left = "";
    compareSharedDetail.style.width = "";
    return;
  }
  const slotEl = compareSlots.querySelector(`[data-slot-id="${CSS.escape(selectedSlot.id)}"]`);
  const stageEl = compareSharedDetail.parentElement;
  if (!slotEl || !stageEl) return;
  const slotRect = slotEl.getBoundingClientRect();
  const stageRect = stageEl.getBoundingClientRect();
  compareSharedDetail.style.left = `${Math.max(0, slotRect.left - stageRect.left)}px`;
  compareSharedDetail.style.width = `${slotRect.width}px`;
}

function renderCompareSharedDetail() {
  if (!compareState.detailOverlayOpen) return "";

  const selectedSlots = selectedCompareDetailSlots();

  if (!selectedSlots.length) {
    return "";
  }

  return `
    <section class="compare-shared-panel">
      <header>
        <div>
          <h2>선택 제품 상세 비교</h2>
          <p>${selectedSlots.length.toLocaleString("ko-KR")}개 비교 세트의 선택 제품을 한곳에 모아 봅니다.</p>
        </div>
        <button type="button" data-compare-close-detail aria-label="상세 비교 닫기">×</button>
      </header>
      <div class="compare-shared-grid">
        ${selectedSlots.map((slot) => `
          <section class="compare-shared-card" data-slot-id="${escapeHtml(slot.id)}">
            <div class="compare-shared-card-head">
              <strong>${escapeHtml(compareSlotTitle(slot))}</strong>
              <span>${escapeHtml(compareKindLabel(slot.kind))}</span>
            </div>
            ${isExternalCompare(slot) ? renderExternalCompareDetail(slot) : renderCompareDetail(slot)}
          </section>
        `).join("")}
      </div>
    </section>
  `;
}

function renderCompareSlots() {
  if (!compareSlots) return;
  const title = compareWorkspace?.querySelector(".compare-header h1");
  const description = compareWorkspace?.querySelector(".compare-header p");
  if (title) title.textContent = `${compareKindLabel(compareState.kind)} 제품 간 비교`;
  if (description) description.textContent = "최대 5개 비교 세트를 나란히 검색하고 상세정보를 비교합니다.";
  compareSlots.innerHTML = compareState.slots.map((slot) => renderCompareSlot(slot)).join("");
  if (compareSharedDetail) {
    compareSharedDetail.innerHTML = "";
  }
  if (addCompareSlotButton) {
    addCompareSlotButton.disabled = compareState.slots.length >= compareSlotLimit;
    addCompareSlotButton.textContent = "+ 비교 세트 추가하기";
  }
}

async function loadCompareResults(slotId, { resetPage = false } = {}) {
  const slot = getCompareSlot(slotId);
  if (!slot) return;
  const slotEl = compareSlots.querySelector(`[data-slot-id="${CSS.escape(slot.id)}"]`);
  const formEl = slotEl?.querySelector("form");
  syncCompareQueryFromForm(slot, formEl);
  if (resetPage) slot.page = 1;
  slot.listLoading = true;
  slot.detailHydrationGeneration += 1;
  slot.error = "";
  slot.notice = "";
  renderCompareSlots();

  try {
    const params = compactParams(slot.query, slot.filters, slot.page);
    const payload = await normalizeHumanSearchPayload(await requestHumanSearch(params), params);
    slot.rows = payload.items || [];
    slot.total = Number(payload.total || 0);
    slot.notice = payload.notice || "";
    slot.page = Number(payload.page || slot.page);
    slot.pageSize = Number(payload.pageSize || slot.rows.length || 10);
    slot.totalPages = Math.max(Number(payload.totalPages || 1), 1);
    slot.selectedSeq = slot.rows[0]?.itemSeq || "";
    compareState.detailOverlayOpen = false;
    compareState.detailOverlaySlotId = "";
    slot.detailView = false;
    slot.listLoading = false;
  } catch (error) {
    slot.rows = [];
    slot.total = 0;
    slot.selectedSeq = "";
    slot.detailView = false;
    slot.listLoading = false;
    slot.error = friendlySearchError(error);
  }
  renderCompareSlots();
  setTimeout(() => hydrateCompareSlotDetails(slot.id, slot.detailHydrationGeneration), 0);
}

async function loadCompareDetail(slotId, itemSeq, { force = false } = {}) {
  const slot = getCompareSlot(slotId);
  if (!slot || !itemSeq) return;
  const cached = slot.detailCache[itemSeq];
  if (cached && !cached.detailError && !cached.detailPartial && !force) {
    renderCompareSlots();
    return;
  }
  if (force || cached?.detailError) {
    delete slot.detailCache[itemSeq];
  }

  slot.selectedSeq = itemSeq;
  slot.detailLoadingSeq = itemSeq;
  renderCompareSlots();

  try {
    const payload = await requestDetail(itemSeq);
    slot.detailCache[itemSeq] = mergeKeepNonEmpty(compareSelectedRow(slot), payload);
  } catch (error) {
    slot.detailCache[itemSeq] = { ...compareSelectedRow(slot), detailError: error.message };
  } finally {
    if (slot.detailLoadingSeq === itemSeq) slot.detailLoadingSeq = "";
    renderCompareSlots();
  }
}

async function loadResults({ resetPage = false } = {}) {
  if (resetPage) state.page = 1;
  state.listLoading = true;
  state.error = "";
  state.unitDoseLoading = false;
  preloadGeneration += 1;
  render();

  try {
    const params = buildSearchParams();
    const payload = await normalizeHumanSearchPayload(await requestHumanSearch(params), params);

    state.rows = payload.items || [];
    state.total = Number(payload.total || 0);
    state.notice = payload.notice || "";
    state.page = Number(payload.page || state.page);
    state.pageSize = Number(payload.pageSize || state.rows.length || 10);
    state.totalPages = Math.max(Number(payload.totalPages || 1), 1);
    state.selectedSeq = state.rows[0]?.itemSeq || "";
    state.loaded = true;
    state.listLoading = false;
    state.unitDoseLoading = false;
    render();
    setTimeout(() => hydrateCurrentPageDetails(preloadGeneration), 0);
  } catch (error) {
    state.rows = [];
    state.total = 0;
    state.selectedSeq = "";
    state.listLoading = false;
    state.unitDoseLoading = false;
    state.error = friendlySearchError(error);
    state.notice = "";
    render();
  }
}

let preloadGeneration = 0;

async function preloadAllDetails() {
  const gen = ++preloadGeneration;
  const seqs = state.rows
    .map((row) => row.itemSeq)
    .filter((seq) => seq && !state.detailCache[seq]);

  if (!seqs.length) {
    if (state.selectedSeq) {
      render();
    }
    return;
  }

  // Fetch the selected item first for immediate detail panel display
  if (state.selectedSeq && seqs.includes(state.selectedSeq)) {
    state.detailLoadingSeq = state.selectedSeq;
    render();
    await fetchAndCacheDetail(state.selectedSeq);
    if (gen !== preloadGeneration) return;
    if (state.detailLoadingSeq === state.selectedSeq) state.detailLoadingSeq = "";
    render();
  }

  // Then fetch the rest concurrently (3 at a time)
  const remaining = seqs.filter((seq) => !state.detailCache[seq]);
  const concurrency = 3;
  let index = 0;

  async function worker() {
    while (index < remaining.length) {
      if (gen !== preloadGeneration) return;
      const currentIndex = index;
      index += 1;
      await fetchAndCacheDetail(remaining[currentIndex]);
      if (gen !== preloadGeneration) return;
      render();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, remaining.length) }, worker));
}

async function fetchAndCacheDetail(itemSeq) {
  const cached = state.detailCache[itemSeq];
  if (cached && !cached.detailPartial && hasCsvDetailFields(cached)) return;
  try {
    const payload = await requestDetail(itemSeq);
    const row = state.rows.find((r) => r.itemSeq === itemSeq);
    state.detailCache[itemSeq] = mergeKeepNonEmpty(row, payload);
  } catch (error) {
    const row = state.rows.find((r) => r.itemSeq === itemSeq);
    state.detailCache[itemSeq] = { ...row, detailError: error.message };
  }
}

async function requestDetail(itemSeq) {
  const response = await fetch(`/api/detail?itemSeq=${encodeURIComponent(itemSeq)}`);
  if (!response.ok) throw new Error(`상세 요청 실패 (${response.status})`);
  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.detailError || payload.error);
  }
  return payload;
}

async function requestDetailBatch(itemSeqs) {
  const seqs = Array.from(new Set(itemSeqs.filter(Boolean)));
  if (!seqs.length) return [];
  const response = await fetch(`/api/detail-batch?itemSeqs=${encodeURIComponent(seqs.join(","))}&_v=${encodeURIComponent(API_VERSION)}`);
  if (!response.ok) throw new Error(`상세 배치 요청 실패 (${response.status})`);
  const payload = await response.json();
  return payload.items || [];
}

async function hydrateCurrentPageDetails(generation = preloadGeneration) {
  const seqs = state.rows
    .map((row) => row.itemSeq)
    .filter((seq) => seq && (!state.detailCache[seq]?.unitDose || !hasCsvDetailFields(state.detailCache[seq])));
  if (!seqs.length) return;

  state.unitDoseLoading = true;
  render();

  try {
    const items = await requestDetailBatch(seqs);
    if (generation !== preloadGeneration) return;
    items.forEach((payload) => {
      const row = state.rows.find((item) => item.itemSeq === payload.itemSeq);
      if (!row) return;
      state.detailCache[payload.itemSeq] = mergeKeepNonEmpty(row, payload);
    });
    state.unitDoseLoading = false;
    render();
  } catch {
    const firstSeq = seqs[0];
    if (!firstSeq || generation !== preloadGeneration) {
      state.unitDoseLoading = false;
      render();
      return;
    }
    try {
      const payload = await requestDetail(firstSeq);
      if (generation !== preloadGeneration) return;
      const row = state.rows.find((item) => item.itemSeq === firstSeq);
      state.detailCache[firstSeq] = mergeKeepNonEmpty(row, payload);
      state.unitDoseLoading = false;
      render();
    } catch {
      state.unitDoseLoading = false;
      render();
    }
  }
}

async function hydrateRowsWithBatch(rows, cache, generation, isActive, renderFn) {
  const seqs = rows
    .map((row) => row.itemSeq)
    .filter((seq) => seq && !cache[seq]?.unitDose);
  if (!seqs.length) return;

  try {
    const items = await requestDetailBatch(seqs);
    if (!isActive(generation)) return;
    items.forEach((payload) => {
      const row = rows.find((item) => item.itemSeq === payload.itemSeq);
      if (!row) return;
      cache[payload.itemSeq] = mergeKeepNonEmpty(row, payload);
    });
    renderFn();
  } catch {
    if (!isActive(generation)) return;
    const firstSeq = seqs[0];
    if (!firstSeq) return;
    try {
      const payload = await requestDetail(firstSeq);
      if (!isActive(generation)) return;
      const row = rows.find((item) => item.itemSeq === firstSeq);
      cache[firstSeq] = mergeKeepNonEmpty(row, payload);
      renderFn();
    } catch {}
  }
}

async function hydrateCompareSlotDetails(slotId, generation) {
  const slot = getCompareSlot(slotId);
  if (!slot || generation !== slot.detailHydrationGeneration) return;
  await hydrateRowsWithBatch(
    slot.rows,
    slot.detailCache,
    generation,
    (activeGeneration) => {
      const latestSlot = getCompareSlot(slotId);
      return Boolean(latestSlot && latestSlot.detailHydrationGeneration === activeGeneration);
    },
    () => {
      syncVisibleCompareForms();
      renderCompareSlots();
    }
  );
}

async function loadDetail(itemSeq, { force = false } = {}) {
  const cached = state.detailCache[itemSeq];
  if (!itemSeq || (cached && !cached.detailError && !cached.detailPartial && !force)) {
    render();
    return;
  }

  if (force || cached?.detailError) {
    delete state.detailCache[itemSeq];
  }

  state.detailLoadingSeq = itemSeq;
  render();

  try {
    const payload = await requestDetail(itemSeq);
    state.detailCache[itemSeq] = mergeKeepNonEmpty(selectedRow(), payload);
  } catch (error) {
    state.detailCache[itemSeq] = { ...selectedRow(), detailError: error.message };
  } finally {
    if (state.detailLoadingSeq === itemSeq) state.detailLoadingSeq = "";
    render();
  }
}

function renderResults() {
  const pageStart = state.total && state.rows.length ? (state.page - 1) * state.pageSize + 1 : 0;
  const pageEnd = state.total && state.rows.length ? pageStart + state.rows.length - 1 : 0;
  resultCount.innerHTML = `총 <strong>${state.total.toLocaleString("ko-KR")}</strong> 건 <span class="muted">(${pageStart.toLocaleString("ko-KR")}-${pageEnd.toLocaleString("ko-KR")})</span>`;
  pageInfo.textContent = `${state.page.toLocaleString("ko-KR")} / ${state.totalPages.toLocaleString("ko-KR")}`;
  pageInput.value = String(state.page);
  pageInput.max = String(state.totalPages);
  prevPage.disabled = state.page <= 1 || state.listLoading;
  nextPage.disabled = state.page >= state.totalPages || state.listLoading;
  goPage.disabled = state.listLoading;
  statusText.textContent = state.listLoading ? "목록을 불러오는 중" : state.error || state.notice || "MFDS 실시간 목록";

  const perfYears = getPerformanceYears();
  const totalCols = 10 + perfYears.length;

  // Dynamic header rendering
  const theadRow = document.querySelector("#humanResultTable thead tr");
  if (theadRow) {
    const baseColumns = [
      { key: "itemName", label: "제품명", width: 200 },
      { key: "entpName", label: "업체명", width: 110 },
      { key: "mainIngredient", label: "주성분", width: 180 },
      { key: "unitDose", label: "단위용량", width: 170 },
      { key: "etcOtc", label: "전문/일반", width: 80 },
      { key: "insurancePrice", label: "보험약가", width: 110 },
      { key: "permitDate", label: "허가일", width: 90 },
      { key: "atcCode", label: "ATC", width: 90 },
      { key: "contractManufacturer", label: "위탁제조업체", width: 130 },
      { key: "reviewType", label: "허가심사유형", width: 180 }
    ];
    let thHtml = "";
    baseColumns.forEach((column) => {
      const width = state.columnWidths[column.label] || column.width;
      const header = sortHeaderHtml(column);
      thHtml += `<th data-column-key="${escapeHtml(column.label)}" aria-sort="${header.ariaSort}" style="width: ${width}px;"><div class="th-wrapper">${header.html}</div></th>`;
    });
    perfYears.forEach((year) => {
      const h = `${year}년 실적`;
      const width = state.columnWidths[h] || 110;
      const header = sortHeaderHtml({ key: `perf_${year}`, label: h });
      thHtml += `<th data-column-key="${escapeHtml(h)}" aria-sort="${header.ariaSort}" style="width: ${width}px;"><div class="th-wrapper">${header.html}</div></th>`;
    });
    theadRow.innerHTML = thHtml;
  }

  if (state.listLoading) {
    resultBody.innerHTML = `<tr><td colspan="${totalCols}" class="table-message">MFDS 목록을 불러오는 중입니다.</td></tr>`;
    return;
  }

  if (state.error) {
    resultBody.innerHTML = `
      <tr>
        <td colspan="${totalCols}" class="table-message error">
          <div class="search-error-inline">
            <span>${escapeHtml(state.error)}</span>
            <button type="button" data-retry-search>다시 검색</button>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  if (!state.rows.length) {
    resultBody.innerHTML = `<tr><td colspan="${totalCols}" class="table-message">검색 결과가 없습니다.</td></tr>`;
    return;
  }

  resultBody.innerHTML = sortedResultRows(state.rows)
    .map((row, index) => {
      const drug = rowWithCachedDetail(row);
      const selected = drug.itemSeq === state.selectedSeq ? "selected" : "";
      const rowNumber = drug.rowNumber || String((state.page - 1) * state.pageSize + index + 1);
      
      const perfCellsHtml = perfYears
        .map((year) => `<td>${formatPerformanceYearCell(drug.performance, year)}</td>`)
        .join("");

      return `
        <tr class="${selected}" data-seq="${escapeHtml(drug.itemSeq)}">
          <td>
            <button type="button" data-select="${escapeHtml(drug.itemSeq)}">${escapeHtml(drug.itemName)}</button>
            <div class="tag-row">
              <span class="tag">${escapeHtml(rowNumber)}</span>
              <span class="tag blue">${escapeHtml(drug.itemSeq)}</span>
              <span class="tag">${escapeHtml(drug.itemCategory || "-")}</span>
              <span class="tag ${drug.cancelStatus === "정상" ? "green" : "amber"}">${escapeHtml(drug.cancelStatus || "-")}</span>
              ${exportOnlyTagHtml(drug)}
            </div>
          </td>
          <td>${escapeHtml(drug.entpName || "-")}</td>
          <td>${ingredientValueHtml(drug.mainIngredient)}</td>
          <td><div class="unit-dose-lines">${unitDoseLineHtml(drug.unitDose, state.unitDoseLoading && !drug.unitDose)}</div></td>
          <td>${escapeHtml(drug.etcOtc || "-")}</td>
          <td>${insurancePriceCellHtml(drug.insurancePrice)}</td>
          <td>${escapeHtml(drug.permitDate || "-")}</td>
          <td>${escapeHtml(drug.atcCode || "-")}</td>
          <td>${escapeHtml(drug.contractManufacturer || "-")}</td>
          <td>${escapeHtml(drug.reviewType || "-")}</td>
          ${perfCellsHtml}
        </tr>
      `;
    })
    .join("");

  // Initialize/refresh drag handles
  initColumnResize(document.querySelector("#humanResultTable"), state.columnWidths);
}

function renderKeyValue(title, pairs) {
  const filled = pairs.filter(([, value]) => String(value || "").trim());
  if (!filled.length) return "";
  return `
    <section>
      <h3 class="section-title">${escapeHtml(title)}</h3>
      <dl class="info-grid">
        ${filled
          .map(
            ([key, value]) => `
              <div>
                <dt>${escapeHtml(key)}</dt>
                <dd>${shouldFormatIngredientField(key) ? ingredientValueHtml(value) : highlightText(value)}</dd>
              </div>
            `
          )
          .join("")}
      </dl>
    </section>
  `;
}

function renderTable(title, rows, columns) {
  if (!rows?.length) return "";
  return `
    <section>
      <h3 class="section-title">${escapeHtml(title)}</h3>
      <table class="mini-table">
        <thead>
          <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  ${columns.map((column) => `<td>${tableCellHtml(row[column.key] || "", column, title)}</td>`).join("")}
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderTextSection(title, text, compact = false) {
  if (!String(text || "").trim()) return "";
  return `
    <section>
      <h3 class="section-title">${escapeHtml(title)}</h3>
      <div class="text-block ${compact ? "compact" : ""}">${highlightText(text)}</div>
    </section>
  `;
}

function renderHtmlSection(title, html, fallbackText = "", compact = false) {
  if (String(html || "").trim()) {
    return `
      <section>
        <h3 class="section-title">${escapeHtml(title)}</h3>
        <div class="text-block doc-html ${compact ? "compact" : ""}">${html}</div>
      </section>
    `;
  }
  return renderTextSection(title, fallbackText, compact);
}

function renderDetail() {
  const drug = selectedDrug();

  if (state.listLoading) {
    detailPanel.innerHTML = `<div class="detail-empty">목록을 불러오는 중입니다.</div>`;
    return;
  }

  if (!drug) {
    detailPanel.innerHTML = `<div class="detail-empty">검색 결과에서 제품을 선택하세요.</div>`;
    return;
  }

  if (state.detailLoadingSeq === state.selectedSeq) {
    detailPanel.innerHTML = `<div class="detail-empty">상세정보를 불러오는 중입니다.</div>`;
    return;
  }

  const basicPairs = [
    ["제품명", drug.itemName],
    ["성상", drug.appearance],
    ["모양", drug.shape],
    ["업체명", drug.entpName],
    ["위탁제조업체", drug.contractManufacturer],
    ["주성분", drug.mainIngredient],
    ["단위용량", drug.unitDose],
    ["전문/일반", drug.etcOtc],
    ["허가일", drug.permitDate],
    ["품목기준코드", drug.itemSeq],
    ["표준코드", drug.standardCode],
    ["허가번호", drug.permitNumber],
    ["허가심사유형", drug.reviewType],
    ["품목구분", drug.itemCategory],
    ["완제/원료", drug.makeMaterial],
    ["제조/수입", drug.manufactureImport],
    ["취소/취하", drug.cancelStatus]
  ];

  const extraPairs = [
    ["저장방법", drug.storage],
    ["사용기간", drug.validTerm],
    ["재심사대상", drug.reexamination],
    ["RMP 대상", drug.rmp],
    ["포장정보", drug.packageInfo],
    ["보험약가", drug.insurancePrice],
    ["ATC코드", drug.atcCode]
  ];

  const hasPerformance = drug.performance?.rows?.length;

  detailPanel.innerHTML = `
    <header class="detail-head">
      <h2>${escapeHtml(drug.itemName)}</h2>
      <p>${escapeHtml(drug.entpName || "")}</p>
      <div class="tag-row">
        <span class="tag blue">${escapeHtml(drug.itemSeq)}</span>
        <span class="tag">${escapeHtml(drug.etcOtc || "-")}</span>
        <span class="tag ${drug.cancelStatus === "정상" ? "green" : "amber"}">${escapeHtml(drug.cancelStatus || "-")}</span>
        <span class="tag">${escapeHtml(drug.makeMaterial || "-")}</span>
        ${exportOnlyTagHtml(drug)}
      </div>
    </header>
    <div class="detail-content">
      ${drug.detailError ? `
        <div class="table-message error detail-error">
          <span>${escapeHtml(drug.detailError)}</span>
          <button type="button" data-retry-detail="${escapeHtml(drug.itemSeq || state.selectedSeq)}">다시 시도</button>
        </div>
      ` : ""}
      ${renderKeyValue("기본정보", basicPairs)}
      ${renderTable("원료약품 및 분량", drug.ingredients || [], [
        { key: "basis", label: "기준" },
        { key: "name", label: "성분명" },
        { key: "amount", label: "분량" },
        { key: "unit", label: "단위" },
        { key: "standard", label: "규격" }
      ])}
      ${
        drug.additives?.length
          ? `<section><h3 class="section-title">첨가제</h3><div class="tag-row">${drug.additives
              .map((item) => `<span class="tag">${escapeHtml(item)}</span>`)
              .join("")}</div></section>`
          : ""
      }
      <div class="section-split">
        ${renderTextSection("효능효과", drug.efficacy)}
        ${renderTextSection("용법용량", drug.dosage)}
      </div>
      ${renderHtmlSection("사용상의 주의사항", drug.precautionsHtml, drug.precautions, true)}
      ${renderTable("의약품 적정 사용정보(DUR)", drug.dur || [], [
        { key: "composition", label: "단일/복합" },
        { key: "ingredient", label: "DUR성분" },
        { key: "type", label: "DUR유형" },
        { key: "dosageForm", label: "제형" },
        { key: "caution", label: "금기 및 주의내용" },
        { key: "note", label: "비고" }
      ])}
      ${renderKeyValue("재심사, RMP, 보험, 기타정보", extraPairs)}
      ${
        hasPerformance
          ? renderTable(`${drug.performance.type} (${drug.performance.unit})`, drug.performance.rows, [
              { key: "year", label: "년도" },
              { key: "amount", label: drug.performance.type }
            ])
          : ""
      }
      ${drug.sourceUrl ? `<p class="muted">원문: ${escapeHtml(drug.sourceUrl)}</p>` : ""}
    </div>
  `;
}

function render() {
  renderResults();
  renderDetail();
  populateReviewTypeSelects();
}

const downloadedFilenames = new Set();

function getUniqueFilename(baseName) {
  const dotIndex = baseName.lastIndexOf(".");
  const name = dotIndex !== -1 ? baseName.slice(0, dotIndex) : baseName;
  const ext = dotIndex !== -1 ? baseName.slice(dotIndex) : "";

  let uniqueName = baseName;
  let counter = 1;

  while (downloadedFilenames.has(uniqueName)) {
    uniqueName = `${name} (${counter})${ext}`;
    counter += 1;
  }

  downloadedFilenames.add(uniqueName);
  return uniqueName;
}

function toCsvValue(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function chooseCsvDownloadLimit(total, recommendedLimit = 1000) {
  if (total <= recommendedLimit) return Promise.resolve(total);

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "csv-choice-modal";
    overlay.innerHTML = `
      <div class="csv-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="csvChoiceTitle">
        <h2 id="csvChoiceTitle">CSV 다운로드 범위 선택</h2>
        <p>
          검색 결과가 ${total.toLocaleString("ko-KR")}건입니다.
          1,000건 다운로드를 권장하며, 전체 다운로드는 MFDS 목록과 상세정보를 모두 수집하므로 오래 걸릴 수 있습니다.
        </p>
        <div class="csv-choice-actions">
          <button type="button" class="primary" data-csv-choice="limited">1,000건만 다운로드</button>
          <button type="button" data-csv-choice="all">전체 다운로드</button>
          <button type="button" data-csv-choice="cancel">취소</button>
        </div>
      </div>
    `;

    const cleanup = (value) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(value);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") cleanup(null);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        cleanup(null);
        return;
      }
      const button = event.target.closest("[data-csv-choice]");
      if (!button) return;
      const choice = button.dataset.csvChoice;
      if (choice === "limited") cleanup(recommendedLimit);
      else if (choice === "all") cleanup(total);
      else cleanup(null);
    });

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeyDown);
    overlay.querySelector("[data-csv-choice='limited']")?.focus();
  });
}

function downloadCsvClientSide(category = "human") {
  let headers = [];
  const lines = [];
  let filename = "";

  if (category === "vet") {
    headers = ["순번", "제품명", "제품영문명", "업체명", "품목코드", "허가번호", "품목구분", "허가일", "비고"];
    lines.push(headers.map((h) => toCsvValue(h)).join(","));
    externalStates.vet.rows.forEach((row, index) => {
      const rowData = [
        String(index + 1),
        row.itemName,
        row.itemEngName,
        row.entpName,
        row.productCode,
        row.permitNumber,
        row.itemCategory,
        row.permitDate,
        row.note
      ].map(toCsvValue);
      lines.push(rowData.join(","));
    });
    filename = `vet-drugs-page-${externalStates.vet.page}-${new Date().toISOString().slice(0, 10)}.csv`;
  } else if (category === "aquatic") {
    headers = ["허가번호", "제품명", "업체명", "제형", "투여경로", "최초허가일", "최종허가일", "허가조건", "비고"];
    lines.push(headers.map((h) => toCsvValue(h)).join(","));
    externalStates.aquatic.rows.forEach((row) => {
      const rowData = [
        row.permitNumber,
        row.itemName,
        row.entpName,
        row.dosageForm,
        row.route,
        row.firstPermitDate,
        row.permitDate,
        row.condition,
        row.note
      ].map(toCsvValue);
      lines.push(rowData.join(","));
    });
    filename = `aquatic-drugs-page-${externalStates.aquatic.page}-${new Date().toISOString().slice(0, 10)}.csv`;
  } else {
    const perfYears = getPerformanceYears();
    headers = [
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
    
    lines.push(headers.map(([, label]) => toCsvValue(label)).join(","));
    state.rows.forEach((row, index) => {
      const drug = rowWithCachedDetail(row);
      const rowData = headers.map(([key]) => {
        if (key.startsWith("perf_")) {
          const year = Number(key.split("_")[1]);
          return toCsvValue(formatPerformanceYearText(drug.performance, year));
        }
        if (key === "insurancePrice") return toCsvValue(formatInsurancePriceText(drug[key]));
        if (key === "packageUnit") return toCsvValue(drug.packageUnit || drug.packageInfo || "");
        if (key === "performanceType") return toCsvValue(drug.performance?.type || "");
        if (key === "performanceUnit") return toCsvValue(drug.performance?.unit || "");
        return toCsvValue(drug[key]);
      });
      lines.push(rowData.join(","));
    });
    filename = `human-drugs-page-${state.page}-${new Date().toISOString().slice(0, 10)}.csv`;
  }

  const uniqueFilename = getUniqueFilename(filename);

  const blob = new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = uniqueFilename;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 250);
}

async function downloadCsvAllResults(category = "human") {
  let total = 0;
  if (category === "vet") {
    total = externalStates.vet.total || 0;
  } else if (category === "aquatic") {
    total = externalStates.aquatic.total || 0;
  } else {
    total = state.total || 0;
  }

  if (total === 0) {
    alert("다운로드할 검색 결과가 없습니다.");
    return;
  }

  const limitTotal = await chooseCsvDownloadLimit(total, 1000);
  if (!limitTotal) return;
  const downloadScope = limitTotal < total ? `first-${limitTotal}` : "all";
  const statusEl = document.querySelector("#statusText");
  const originalStatus = statusEl?.textContent || "";

  try {
    let allItems = [];
    const pageSize = 10;
    const totalPages = Math.ceil(limitTotal / pageSize);

    // Step 1: Collect list pages progressively
    if (statusEl) statusEl.textContent = `검색 결과 목록 수집 중... (0 / ${totalPages} 페이지)`;

    for (let p = 1; p <= totalPages; p += 1) {
      if (statusEl) statusEl.textContent = `검색 결과 목록 수집 중... (${p} / ${totalPages} 페이지)`;
      
      let url = "";
      if (category === "vet") {
        const dashboard = externalDashboard("vet");
        const params = buildExternalParams(dashboard);
        params.set("page", String(p));
        url = `/api/vet-search?${params}`;
      } else if (category === "aquatic") {
        const dashboard = externalDashboard("aquatic");
        const params = buildExternalParams(dashboard);
        params.set("page", String(p));
        url = `/api/aquatic-search?${params}`;
      } else {
        const params = buildSearchParams();
        params.set("page", String(p));
        url = `/api/search?${params}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`목록 조회 실패 (페이지: ${p}, 코드: ${response.status})`);
      }
      const data = await response.json();
      const items = data.items || [];
      allItems.push(...items);
      
      if (p < totalPages) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    allItems = allItems.slice(0, limitTotal);

    // Step 2: For human drugs, gather missing detail pages in batches
    if (category === "human") {
      const missingSeqs = [];
      const cache = state.detailCache;

      allItems.forEach((item) => {
        const cached = cache[item.itemSeq];
        const isCached = cached && cached.contractManufacturer !== undefined && hasCsvDetailFields(cached) && !cached.detailError;
        if (!isCached) {
          missingSeqs.push(item.itemSeq);
        }
      });

      if (missingSeqs.length > 0) {
        const batchSize = 30;
        if (statusEl) statusEl.textContent = `상세정보 조회 중... (0 / ${missingSeqs.length}개 완료)`;

        for (let i = 0; i < missingSeqs.length; i += batchSize) {
          const chunk = missingSeqs.slice(i, i + batchSize);
          const currentProgress = i;
          if (statusEl) {
            statusEl.textContent = `상세정보 조회 중... (${currentProgress} / ${missingSeqs.length}개 완료)`;
          }

          try {
            const fetchedDetails = await requestDetailBatch(chunk);
            fetchedDetails.forEach((detail) => {
              const row = allItems.find((r) => r.itemSeq === detail.itemSeq);
              cache[detail.itemSeq] = mergeKeepNonEmpty(row, detail);
            });
          } catch (batchErr) {
            console.error("Batch fetch failed, retrying items individually", batchErr);
            for (const seq of chunk) {
              try {
                const detail = await requestDetail(seq);
                const row = allItems.find((r) => r.itemSeq === seq);
                cache[seq] = mergeKeepNonEmpty(row, detail);
              } catch (singleErr) {
                console.error(`Failed to fetch detail for ${seq}`, singleErr);
              }
            }
          }

          if (i + batchSize < missingSeqs.length) {
            await new Promise((r) => setTimeout(r, 200));
          }
        }

        if (statusEl) {
          statusEl.textContent = `상세정보 조회 중... (${missingSeqs.length} / ${missingSeqs.length}개 완료)`;
        }
      }
    }

    // Step 3: Format CSV
    if (statusEl) statusEl.textContent = "CSV 파일 작성 중...";
    let headers = [];
    const lines = [];
    let filename = "";

    if (category === "vet") {
      headers = ["순번", "제품명", "제품영문명", "업체명", "품목코드", "허가번호", "품목구분", "허가일", "비고"];
      lines.push(headers.map((h) => toCsvValue(h)).join(","));
      allItems.forEach((row, index) => {
        const rowData = [
          String(index + 1),
          row.itemName,
          row.itemEngName,
          row.entpName,
          row.productCode,
          row.permitNumber,
          row.itemCategory,
          row.permitDate,
          row.note
        ].map(toCsvValue);
        lines.push(rowData.join(","));
      });
      filename = `vet-drugs-${downloadScope}-${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (category === "aquatic") {
      headers = ["허가번호", "제품명", "업체명", "제형", "투여경로", "최초허가일", "최종허가일", "허가조건", "비고"];
      lines.push(headers.map((h) => toCsvValue(h)).join(","));
      allItems.forEach((row) => {
        const rowData = [
          row.permitNumber,
          row.itemName,
          row.entpName,
          row.dosageForm,
          row.route,
          row.firstPermitDate,
          row.permitDate,
          row.condition,
          row.note
        ].map(toCsvValue);
        lines.push(rowData.join(","));
      });
      filename = `aquatic-drugs-${downloadScope}-${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
      const finalItems = allItems.map((item) => {
        const detail = state.detailCache[item.itemSeq] || {};
        return mergeKeepNonEmpty(item, detail);
      });

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

      headers = [
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

      lines.push(headers.map(([, label]) => toCsvValue(label)).join(","));

      finalItems.forEach((drug, index) => {
        const rowData = headers.map(([key]) => {
          if (key === "rowNumber") return toCsvValue(String(index + 1));
          if (key.startsWith("perf_")) {
            const year = Number(key.split("_")[1]);
            return toCsvValue(formatPerformanceYearText(drug.performance, year));
          }
          if (key === "insurancePrice") return toCsvValue(formatInsurancePriceText(drug[key]));
          if (key === "packageUnit") return toCsvValue(drug.packageUnit || drug.packageInfo || "");
          if (key === "performanceType") return toCsvValue(drug.performance?.type || "");
          if (key === "performanceUnit") return toCsvValue(drug.performance?.unit || "");
          return toCsvValue(drug[key]);
        });
        lines.push(rowData.join(","));
      });
      filename = `human-drugs-${downloadScope}-${new Date().toISOString().slice(0, 10)}.csv`;
    }

    const uniqueFilename = getUniqueFilename(filename);
    const blob = new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = uniqueFilename;
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 250);

  } catch (error) {
    console.error("Client-side CSV all download failed:", error);
    alert(`전체 검색결과 다운로드 실패: ${error.message}\n현재 페이지만 다운로드합니다.`);
    downloadCsvClientSide(category);
  } finally {
    if (statusEl) statusEl.textContent = originalStatus;
  }
}

function setupCsvDropdown(buttonId, menuId, category) {
  const button = document.querySelector(buttonId);
  const menu = document.querySelector(menuId);
  if (!button || !menu) return;

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    document.querySelectorAll(".csv-dropdown-menu").forEach((el) => {
      if (el !== menu) el.setAttribute("hidden", "");
    });
    const hidden = menu.hasAttribute("hidden");
    if (hidden) {
      menu.removeAttribute("hidden");
    } else {
      menu.setAttribute("hidden", "");
    }
  });

  menu.addEventListener("click", (event) => {
    const optButton = event.target.closest("[data-csv-opt]");
    if (!optButton) return;
    const opt = optButton.dataset.csvOpt;
    if (opt === "current") {
      downloadCsvClientSide(category);
    } else if (opt === "all") {
      downloadCsvAllResults(category);
    }
    menu.setAttribute("hidden", "");
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadResults({ resetPage: true });
});

form.addEventListener("reset", () => {
  state.filters = {
    itemCategory: "",
    cancelStatus: "",
    etcOtc: "",
    makeMaterial: ""
  };
  form.querySelectorAll(".segmented button").forEach((button) => {
    button.classList.toggle("active", button.dataset.value === "");
  });
  form.querySelectorAll(".quick-dates button").forEach((button) => {
    button.classList.toggle("active", button.dataset.range === "");
  });
  const extraWrap = document.querySelector("#extraIngredientWrap");
  const toggle = document.querySelector("#extraIngredientToggle");
  if (extraWrap && !extraWrap.classList.contains("collapsed")) {
    extraWrap.classList.add("collapsed");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }
  setTimeout(() => loadResults({ resetPage: true }), 0);
});

form.addEventListener("change", (event) => {
  handleExportOnlyModeChange(event.target);
});

form.querySelectorAll(".segmented").forEach((group) => {
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    group.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.filters[group.dataset.field] = button.dataset.value;
  });
});

form.querySelectorAll(".quick-dates button").forEach((button) => {
  button.addEventListener("click", () => {
    form.querySelectorAll(".quick-dates button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");

    const endInput = form.elements.permitEnd;
    const startInput = form.elements.permitStart;
    const range = button.dataset.range;
    if (!range) {
      startInput.value = "";
      endInput.value = "";
      return;
    }

    const end = new Date();
    const start = new Date(end);
    if (range === "1m") start.setMonth(start.getMonth() - 1);
    if (range === "6m") start.setMonth(start.getMonth() - 6);
    if (range === "1y") start.setFullYear(start.getFullYear() - 1);
    if (range === "3y") start.setFullYear(start.getFullYear() - 3);
    startInput.value = start.toISOString().slice(0, 10);
    endInput.value = end.toISOString().slice(0, 10);
  });
});

resultBody.addEventListener("click", (event) => {
  const retrySearch = event.target.closest("[data-retry-search]");
  if (retrySearch) {
    loadResults();
    return;
  }

  const target = event.target.closest("[data-select], tr[data-seq]");
  if (!target) return;
  const itemSeq = target.dataset.select || target.dataset.seq;
  state.selectedSeq = itemSeq;
  render();
  loadDetail(itemSeq);
});

document.querySelector("#humanResultTable")?.addEventListener("click", (event) => {
  const sortButton = event.target.closest("[data-sort-key]");
  if (!sortButton) return;
  const key = sortButton.dataset.sortKey;
  if (!key) return;
  if (state.sort.key === key) {
    state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
  } else {
    state.sort.key = key;
    state.sort.direction = "asc";
  }
  render();
});

detailPanel.addEventListener("click", (event) => {
  const retryButton = event.target.closest("[data-retry-detail]");
  if (!retryButton) return;
  const itemSeq = retryButton.dataset.retryDetail || state.selectedSeq;
  state.selectedSeq = itemSeq;
  loadDetail(itemSeq, { force: true });
});

function setWorkspaceTab(tabName) {
  activeWorkspaceTab = tabName === "compare" || tabName === "group" ? tabName : "search";
  if (homeWorkspace) homeWorkspace.hidden = true;
  homeButton?.classList.remove("active");
  workspaceTabs.forEach((button) => {
    const active = button.dataset.workspaceTab === activeWorkspaceTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (searchWorkspace) searchWorkspace.hidden = true;
  if (vetWorkspace) vetWorkspace.hidden = true;
  if (aquaticWorkspace) aquaticWorkspace.hidden = true;
  if (compareWorkspace) compareWorkspace.hidden = true;
  if (groupWorkspace) groupWorkspace.hidden = true;
  document.body.classList.toggle("compare-mode", activeWorkspaceTab === "compare");

  if (activeWorkspaceTab === "compare") {
    const compareKind = activeCategory === "vet" || activeCategory === "aquatic" ? activeCategory : "human";
    if (compareWorkspace) compareWorkspace.hidden = false;
    ensureCompareSlot(compareKind);
    renderCompareSlots();
    return;
  }

  if (activeWorkspaceTab === "group") {
    if (groupWorkspace) groupWorkspace.hidden = false;
    renderGroupDashboard();
    return;
  }

  if (activeCategory === "vet") {
    if (vetWorkspace) vetWorkspace.hidden = false;
    if (!externalStates.vet.loaded) loadExternalResults("vet");
  } else if (activeCategory === "aquatic") {
    if (aquaticWorkspace) aquaticWorkspace.hidden = false;
    if (!externalStates.aquatic.loaded) loadExternalResults("aquatic");
  } else {
    if (searchWorkspace) searchWorkspace.hidden = false;
    maybeAutoLoadHumanResults();
  }
}

function currentWorkspaceTab() {
  return activeWorkspaceTab || document.querySelector("[data-workspace-tab].active")?.dataset.workspaceTab || "search";
}

function maybeAutoLoadHumanResults({ force = false } = {}) {
  const humanTabActive = activeCategory === "human";
  const searchVisible = searchWorkspace && !searchWorkspace.hidden;
  if (!humanTabActive || !searchVisible || state.listLoading) return;
  const emptyStaleState = state.loaded && state.total === 0 && !state.rows.length && !state.error;
  if (!force && state.loaded && !emptyStaleState) return;
  loadResults({ resetPage: true });
}

function setCategoryTab(categoryName, { autoLoad = true } = {}) {
  closeChanges();
  activeCategory = categoryName === "vet" || categoryName === "aquatic" ? categoryName : "human";
  if (homeWorkspace) homeWorkspace.hidden = true;
  homeButton?.classList.remove("active");
  categoryTabs.forEach((button) => {
    const active = button.dataset.categoryTab === activeCategory;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  document.querySelector(".workspace-tabs")?.removeAttribute("hidden");
  setWorkspaceTab(currentWorkspaceTab());
  if (autoLoad && activeCategory === "human") maybeAutoLoadHumanResults();
}

function syncVisibleCompareForms() {
  if (!compareSlots) return;
  compareSlots.querySelectorAll("[data-slot-id]").forEach((slotEl) => {
    const slot = getCompareSlot(slotEl.dataset.slotId);
    syncCompareQueryFromForm(slot, slotEl.querySelector("form"));
  });
}

function applyRangeToForm(formEl, range) {
  const endInput = formEl?.elements?.permitEnd;
  const startInput = formEl?.elements?.permitStart;
  if (!startInput || !endInput) return;
  if (!range) {
    startInput.value = "";
    endInput.value = "";
    return;
  }

  const end = new Date();
  const start = new Date(end);
  if (range === "1m") start.setMonth(start.getMonth() - 1);
  if (range === "6m") start.setMonth(start.getMonth() - 6);
  if (range === "1y") start.setFullYear(start.getFullYear() - 1);
  if (range === "3y") start.setFullYear(start.getFullYear() - 3);
  startInput.value = start.toISOString().slice(0, 10);
  endInput.value = end.toISOString().slice(0, 10);
}

workspaceTabs.forEach((button) => {
  button.addEventListener("click", () => {
    setWorkspaceTab(button.dataset.workspaceTab);
  });
});

homeSearchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  runHomeSearch();
});

homeSearchResults?.addEventListener("click", (event) => {
  const openCategoryButton = event.target.closest("[data-home-open-category]");
  if (openCategoryButton) {
    openHomeCategoryResults(openCategoryButton.dataset.homeOpenCategory);
    return;
  }

  const resultButton = event.target.closest("[data-home-result]");
  if (!resultButton) return;
  openHomeResult(resultButton.dataset.homeResult, resultButton.dataset.homeIndex);
});

homeSearchInput?.addEventListener("focus", () => {
  if (!homeSearchInput.dataset.placeholder) {
    homeSearchInput.dataset.placeholder = homeSearchInput.placeholder || "어떤게 궁금하세요?";
  }
  homeSearchInput.placeholder = "";
});

homeSearchInput?.addEventListener("blur", () => {
  if (!homeSearchInput.value) {
    homeSearchInput.placeholder = homeSearchInput.dataset.placeholder || "어떤게 궁금하세요?";
  }
});

homeButton?.addEventListener("click", showHome);

changesButtons.forEach((button) => {
  button.addEventListener("click", () => {
    openChanges(button.dataset.changesCategory || "human");
  });
});

changesCloseButton?.addEventListener("click", closeChanges);

changesModal?.addEventListener("click", (event) => {
  if (event.target === changesModal) closeChanges();
});

categoryTabs.forEach((button) => {
  button.addEventListener("click", () => {
    setCategoryTab(button.dataset.categoryTab);
  });
});

["vet", "aquatic"].forEach((kind) => {
  const dashboard = externalDashboard(kind);
  if (!dashboard.form) return;

  dashboard.form.addEventListener("submit", (event) => {
    event.preventDefault();
    loadExternalResults(kind, { resetPage: true });
  });

  dashboard.form.addEventListener("reset", () => {
    const prefix = kind === "vet" ? "Vet" : "Aquatic";
    const extraWrap = document.querySelector(`#extraIngredientWrap${prefix}`);
    const toggle = document.querySelector(`#extraIngredientToggle${prefix}`);
    if (extraWrap && !extraWrap.classList.contains("collapsed")) {
      extraWrap.classList.add("collapsed");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    }
    setTimeout(() => loadExternalResults(kind, { resetPage: true }), 0);
  });

  dashboard.body?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-external-select]");
    if (!target) return;
    loadExternalDetail(kind, target.dataset.externalSelect);
  });

  dashboard.prev.addEventListener("click", () => {
    if (dashboard.state.page <= 1) return;
    dashboard.state.page -= 1;
    loadExternalResults(kind);
  });

  dashboard.next.addEventListener("click", () => {
    if (dashboard.state.page >= dashboard.state.totalPages) return;
    dashboard.state.page += 1;
    loadExternalResults(kind);
  });
});

if (addCompareSlotButton) {
  addCompareSlotButton.addEventListener("click", () => {
    if (compareState.slots.length >= compareSlotLimit) return;
    syncVisibleCompareForms();
    compareState.slots.push(createCompareSlot(compareState.kind));
    renderCompareSlots();
  });
}

if (compareSlots) {
  compareSlots.addEventListener("submit", (event) => {
    const formEl = event.target.closest("form.compare-filter");
    if (!formEl) return;
    event.preventDefault();
    const slotEl = formEl.closest("[data-slot-id]");
    const slot = getCompareSlot(slotEl?.dataset.slotId);
    if (isExternalCompare(slot)) {
      loadExternalCompareResults(slot.id, { resetPage: true });
    } else {
      loadCompareResults(slot?.id, { resetPage: true });
    }
  });

  compareSlots.addEventListener("change", (event) => {
    handleExportOnlyModeChange(event.target);
  });

  compareSlots.addEventListener("click", (event) => {
    const slotEl = event.target.closest("[data-slot-id]");
    if (!slotEl) return;
    const slot = getCompareSlot(slotEl.dataset.slotId);
    if (!slot) return;

    const removeButton = event.target.closest("[data-compare-remove]");
    if (removeButton) {
      syncVisibleCompareForms();
      compareState.slots = compareState.slots.filter((item) => item.id !== slot.id);
      ensureCompareSlot(compareState.kind);
      renderCompareSlots();
      return;
    }

    const downloadButton = event.target.closest("[data-compare-download]");
    if (downloadButton) {
      downloadCompareSlotCsv(slot);
      return;
    }

    const backButton = event.target.closest("[data-compare-back]");
    if (backButton) {
      slot.detailView = false;
      renderCompareSlots();
      return;
    }

    const retryButton = event.target.closest("[data-compare-retry-detail]");
    if (retryButton) {
      if (isExternalCompare(slot)) {
        loadExternalCompareDetail(slot.id, retryButton.dataset.compareRetryDetail || slot.selectedSeq, { force: true });
      } else {
        loadCompareDetail(slot.id, retryButton.dataset.compareRetryDetail || slot.selectedSeq, { force: true });
      }
      return;
    }

    const selectedRow = event.target.closest("[data-compare-select]");
    if (selectedRow) {
      slot.selectedSeq = selectedRow.dataset.compareSelect;
      slot.detailView = true;
      compareState.detailOverlayOpen = false;
      compareState.detailOverlaySlotId = "";
      renderCompareSlots();
      if (isExternalCompare(slot)) {
        loadExternalCompareDetail(slot.id, slot.selectedSeq);
      } else {
        loadCompareDetail(slot.id, slot.selectedSeq);
      }
      return;
    }

    const pageButton = event.target.closest("[data-compare-page]");
    if (pageButton) {
      if (pageButton.disabled) return;
      syncCompareQueryFromForm(slot, slotEl.querySelector("form"));
      if (pageButton.dataset.comparePage === "prev") slot.page = Math.max(1, slot.page - 1);
      if (pageButton.dataset.comparePage === "next") slot.page = Math.min(slot.totalPages, slot.page + 1);
      if (isExternalCompare(slot)) {
        loadExternalCompareResults(slot.id);
      } else {
        loadCompareResults(slot.id);
      }
      return;
    }

    const resetButton = event.target.closest("[data-compare-reset]");
    if (resetButton) {
      Object.assign(slot, {
        rows: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 1,
        selectedSeq: "",
        detailView: false,
        detailCache: {},
        detailLoadingSeq: "",
        detailHydrationGeneration: slot.detailHydrationGeneration + 1,
        listLoading: false,
        error: "",
        notice: "",
        filters: defaultCompareFilters(slot.kind),
        query: defaultCompareQuery(slot.kind),
        showExtra: false
      });
      renderCompareSlots();
      return;
    }

    const extraButton = event.target.closest("[data-compare-extra]");
    if (extraButton) {
      slot.showExtra = !slot.showExtra;
      extraButton.setAttribute("aria-expanded", String(slot.showExtra));
      slotEl.querySelector(".extra-ingredients-wrap")?.classList.toggle("collapsed", !slot.showExtra);
      return;
    }

    const segmentButton = event.target.closest("[data-compare-field] button");
    if (segmentButton) {
      const group = segmentButton.closest("[data-compare-field]");
      group.querySelectorAll("button").forEach((button) => button.classList.remove("active"));
      segmentButton.classList.add("active");
      slot.filters[group.dataset.compareField] = segmentButton.dataset.value;
      return;
    }

    const rangeButton = event.target.closest("[data-compare-range]");
    if (rangeButton) {
      const rangeGroup = rangeButton.closest(".quick-dates");
      rangeGroup.querySelectorAll("button").forEach((button) => button.classList.remove("active"));
      rangeButton.classList.add("active");
      applyRangeToForm(slotEl.querySelector("form"), rangeButton.dataset.compareRange);
    }
  });
}

if (compareSharedDetail) {
  compareSharedDetail.addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-compare-close-detail]");
    if (closeButton) {
      compareState.detailOverlayOpen = false;
      renderCompareSlots();
      return;
    }

    const retryButton = event.target.closest("[data-compare-retry-detail]");
    if (retryButton) {
      const card = retryButton.closest("[data-slot-id]");
      const slot = getCompareSlot(card?.dataset.slotId);
      if (!slot) return;
      compareState.detailOverlayOpen = true;
      if (isExternalCompare(slot)) {
        loadExternalCompareDetail(slot.id, retryButton.dataset.compareRetryDetail || slot.selectedSeq, { force: true });
      } else {
        loadCompareDetail(slot.id, retryButton.dataset.compareRetryDetail || slot.selectedSeq, { force: true });
      }
    }
  });
}

if (groupForm) {
  groupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadGroupDashboard();
  });

  groupForm.addEventListener("reset", () => {
    setTimeout(() => {
      groupState.step = "setup";
      groupState.rows = [];
      groupState.summary = null;
      groupState.error = "";
      groupState.progress = "";
      groupState.selected = { compositions: {}, doses: {}, products: {} };
      closeGroupReport();
      renderGroupDashboard();
    }, 0);
  });
}

if (groupDashboard) {
  groupDashboard.addEventListener("change", (event) => {
    const selectAll = event.target.closest("[data-group-select-all]");
    if (selectAll) {
      const group = selectAll.dataset.groupSelectAll;
      Object.keys(groupState.selected[group] || {}).forEach((key) => {
        groupState.selected[group][key] = selectAll.checked;
      });
      renderGroupDashboard();
      return;
    }

    const toggle = event.target.closest("[data-group-toggle]");
    if (toggle) {
      const group = toggle.dataset.groupToggle;
      const key = toggle.dataset.key;
      if (groupState.selected[group] && key) {
        groupState.selected[group][key] = toggle.checked;
        renderGroupDashboard();
      }
    }
  });
}

if (groupBackButton) {
  groupBackButton.addEventListener("click", () => {
    groupState.step = "setup";
    groupState.loading = false;
    groupState.error = "";
    closeGroupReport();
    renderGroupDashboard();
  });
}

if (groupCsvButton) {
  groupCsvButton.addEventListener("click", () => {
    openGroupReport();
  });
}

if (groupReportCsvButton) {
  groupReportCsvButton.addEventListener("click", () => {
    downloadGroupCsv();
  });
}

if (groupReportCloseButton) {
  groupReportCloseButton.addEventListener("click", () => {
    closeGroupReport();
  });
}

if (groupReportModal) {
  groupReportModal.addEventListener("click", (event) => {
    if (event.target === groupReportModal) closeGroupReport();
  });
}

document.querySelectorAll(".view-options button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".view-options button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.body.classList.toggle("table-only", button.dataset.view === "table");
  });
});

prevPage.addEventListener("click", () => {
  if (state.page <= 1) return;
  state.page -= 1;
  loadResults();
});

nextPage.addEventListener("click", () => {
  if (state.page >= state.totalPages) return;
  state.page += 1;
  loadResults();
});

goPage.addEventListener("click", () => {
  const page = Math.max(1, Math.min(Number(pageInput.value || 1), state.totalPages));
  if (page === state.page) return;
  state.page = page;
  loadResults();
});

pageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    goPage.click();
  }
});

setupCsvDropdown("#csvButton", "#csvDropdown", "human");
setupCsvDropdown("#vetCsvButton", "#vetCsvDropdown", "vet");
setupCsvDropdown("#aquaticCsvButton", "#aquaticCsvDropdown", "aquatic");

/* ── Collapsible extra ingredients toggle ── */

function initCollapsible(toggleId, wrapId) {
  const toggle = document.querySelector(toggleId);
  const wrap = document.querySelector(wrapId);
  if (toggle && wrap) {
    toggle.addEventListener("click", () => {
      const isCollapsed = wrap.classList.toggle("collapsed");
      toggle.setAttribute("aria-expanded", String(!isCollapsed));
    });
  }
}
initCollapsible("#extraIngredientToggle", "#extraIngredientWrap");
initCollapsible("#extraIngredientToggleVet", "#extraIngredientWrapVet");
initCollapsible("#extraIngredientToggleAquatic", "#extraIngredientWrapAquatic");
populateReviewTypeSelects();

/* ── Draggable layout splitter ── */

const splitter = document.querySelector("#layoutSplitter");
const contentGrid = document.querySelector(".content-grid");

if (splitter && contentGrid) {
  let dragging = false;

  splitter.addEventListener("mousedown", (event) => {
    event.preventDefault();
    dragging = true;
    splitter.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    const rect = contentGrid.getBoundingClientRect();
    const offset = event.clientX - rect.left;
    const total = rect.width;
    const minLeft = 300;
    const minRight = 200;
    const splitterWidth = 8;
    const clamped = Math.max(minLeft, Math.min(offset, total - minRight - splitterWidth));
    contentGrid.style.gridTemplateColumns = `${clamped}px ${splitterWidth}px minmax(${minRight}px, 1fr)`;
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
}

/* ── Resizable table column headers ── */

function initColumnResize(table = document.querySelector(".result-table"), widthStore = state.columnWidths) {
  if (!table) return;
  const headerRow = table.querySelector("thead tr");
  if (!headerRow) return;

  const ths = Array.from(headerRow.querySelectorAll("th"));
  if (!ths.length) return;

  // Add handles to all columns except the last
  ths.forEach((th, index) => {
    if (index === ths.length - 1) return;
    
    // Create handle inside .th-wrapper if it doesn't exist
    const wrapper = th.querySelector(".th-wrapper");
    if (!wrapper) return;

    let handle = wrapper.querySelector(".col-resize-handle");
    if (!handle) {
      handle = document.createElement("div");
      handle.className = "col-resize-handle";
      wrapper.appendChild(handle);
    }
    if (handle.dataset.resizeBound === "true") return;
    handle.dataset.resizeBound = "true";

    let startX = 0;
    let startWidth = 0;
    let nextTh = null;
    let nextStartWidth = 0;
    let colDragging = false;

    const onMouseMove = (event) => {
      if (!colDragging) return;
      const delta = event.clientX - startX;
      const newWidth = Math.max(60, startWidth + delta);
      const consumed = newWidth - startWidth;
      
      th.style.width = `${newWidth}px`;
      const thName = th.dataset.columnKey || th.textContent.trim();
      widthStore[thName] = newWidth;
      
      if (nextTh) {
        const newNext = Math.max(40, nextStartWidth - consumed);
        nextTh.style.width = `${newNext}px`;
        const nextThName = nextTh.dataset.columnKey || nextTh.textContent.trim();
        widthStore[nextThName] = newNext;
      }
    };

    const onMouseUp = () => {
      if (!colDragging) return;
      colDragging = false;
      handle.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      colDragging = true;
      startX = event.clientX;
      startWidth = th.offsetWidth;
      nextTh = ths[index + 1] || null;
      nextStartWidth = nextTh ? nextTh.offsetWidth : 0;
      
      handle.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  });
}

showHome();
