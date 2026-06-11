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
  error: "",
  notice: "",
  filters: {
    itemCategory: "",
    cancelStatus: "",
    etcOtc: "",
    makeMaterial: ""
  },
  columnWidths: {}
};

const form = document.querySelector("#searchForm");
const resultBody = document.querySelector("#resultBody");
const resultCount = document.querySelector("#resultCount");
const detailPanel = document.querySelector("#detailPanel");
const csvButton = document.querySelector("#csvButton");
const prevPage = document.querySelector("#prevPage");
const nextPage = document.querySelector("#nextPage");
const goPage = document.querySelector("#goPage");
const pageInput = document.querySelector("#pageInput");
const pageInfo = document.querySelector("#pageInfo");
const statusText = document.querySelector("#statusText");
const categoryTabs = document.querySelectorAll("[data-category-tab]");
const workspaceTabs = document.querySelectorAll("[data-workspace-tab]");
const searchWorkspace = document.querySelector("#searchWorkspace");
const compareWorkspace = document.querySelector("#compareWorkspace");
const vetWorkspace = document.querySelector("#vetWorkspace");
const aquaticWorkspace = document.querySelector("#aquaticWorkspace");
const addCompareSlotButton = document.querySelector("#addCompareSlot");
const compareSlots = document.querySelector("#compareSlots");
const compareSlotLimit = 5;
const API_VERSION = "unitdose-batch-1";
let compareSlotSeed = 0;
const compareState = {
  slots: []
};
const externalStates = {
  vet: { page: 1, total: 0, totalPages: 1, rows: [], loading: false, error: "", notice: "", loaded: false },
  aquatic: { page: 1, total: 0, totalPages: 1, rows: [], loading: false, error: "", notice: "", loaded: false }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function buildSearchParams() {
  const values = Object.fromEntries(new FormData(form).entries());
  const params = new URLSearchParams({ ...values, ...state.filters, page: String(state.page), _v: API_VERSION });
  for (const [key, value] of [...params.entries()]) {
    if (value === "") params.delete(key);
  }
  return params;
}

function defaultCompareFilters() {
  return {
    itemCategory: "",
    cancelStatus: "",
    etcOtc: "",
    makeMaterial: ""
  };
}

function defaultCompareQuery() {
  return {
    efficacyOperator: "AND",
    dosageOperator: "AND",
    precautionOperator: "AND"
  };
}

function createCompareSlot() {
  compareSlotSeed += 1;
  return {
    id: String(compareSlotSeed),
    rows: [],
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 1,
    selectedSeq: "",
    detailCache: {},
    detailLoadingSeq: "",
    detailHydrationGeneration: 0,
    listLoading: false,
    error: "",
    notice: "",
    filters: defaultCompareFilters(),
    query: defaultCompareQuery(),
    showExtra: false
  };
}

function ensureCompareSlot() {
  if (!compareState.slots.length) {
    compareState.slots.push(createCompareSlot());
  }
}

function getCompareSlot(slotId) {
  return compareState.slots.find((slot) => slot.id === String(slotId));
}

function compareSlotTitle(slot) {
  const index = compareState.slots.findIndex((item) => item.id === slot.id);
  return `제품군 ${index + 1}`;
}

function syncCompareQueryFromForm(slot, formEl) {
  if (!slot || !formEl) return;
  slot.query = {
    ...defaultCompareQuery(),
    ...Object.fromEntries(new FormData(formEl).entries())
  };
}

function compactParams(values, filters, page) {
  const params = new URLSearchParams({ ...values, ...filters, page: String(page), _v: API_VERSION });
  for (const [key, value] of [...params.entries()]) {
    if (value === "") params.delete(key);
  }
  return params;
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
    endpoint: kind === "vet" ? "/api/vet-search" : "/api/aquatic-search",
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

function renderExternalDashboard(kind) {
  const dashboard = externalDashboard(kind);
  const { state } = dashboard;
  if (!dashboard.body) return;

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
    .map(
      (row) => `
        <tr>
          ${dashboard.columns
            .map((column) => {
              const value = row[column.key] || "-";
              if (column.key === "itemName" && row.sourceUrl) {
                return `<td><a class="table-link" href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(value)}</a></td>`;
              }
              return `<td>${escapeHtml(value)}</td>`;
            })
            .join("")}
        </tr>
      `
    )
    .join("");
}

async function loadExternalResults(kind, { resetPage = false } = {}) {
  const dashboard = externalDashboard(kind);
  const { state } = dashboard;
  if (!dashboard.form) return;
  if (resetPage) state.page = 1;
  state.loading = true;
  state.error = "";
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

function compareInput(slot, label, name, type = "text") {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <input type="${escapeHtml(type)}" name="${escapeHtml(name)}" value="${escapeHtml(slot.query[name] || "")}" autocomplete="off">
    </label>
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
  return String(value || "-")
    .split(/\s*[/,]\s*/)
    .filter(Boolean)
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join("") || "-";
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
    </form>
  `;
}

function compareSelectedRow(slot) {
  return slot.rows.find((row) => row.itemSeq === slot.selectedSeq);
}

function compareSelectedDrug(slot) {
  return slot.detailCache[slot.selectedSeq] || compareSelectedRow(slot);
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

function renderCompareSlot(slot) {
  const index = compareState.slots.findIndex((item) => item.id === slot.id);
  const pageStart = slot.total && slot.rows.length ? (slot.page - 1) * slot.pageSize + 1 : 0;
  const pageEnd = slot.total && slot.rows.length ? pageStart + slot.rows.length - 1 : 0;
  return `
    <section class="compare-slot ${index === 0 ? "active" : ""}" data-slot-id="${escapeHtml(slot.id)}">
      <header class="compare-slot-head">
        <div>
          <h2>${escapeHtml(compareSlotTitle(slot))}</h2>
          <p>총 ${slot.total.toLocaleString("ko-KR")}건${slot.rows.length ? ` (${pageStart.toLocaleString("ko-KR")}-${pageEnd.toLocaleString("ko-KR")})` : ""}</p>
        </div>
        ${compareState.slots.length > 1 ? `<button type="button" data-compare-remove aria-label="${escapeHtml(compareSlotTitle(slot))} 닫기">×</button>` : ""}
      </header>
      ${renderCompareForm(slot)}
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
              <th>제품명</th>
              <th>업체명</th>
              <th>주성분</th>
              <th>단위용량</th>
              <th>전문/일반</th>
              <th>허가일</th>
            </tr>
          </thead>
          <tbody>${renderCompareRows(slot)}</tbody>
        </table>
      </div>
      ${renderCompareDetail(slot)}
    </section>
  `;
}

function renderCompareSlots() {
  if (!compareSlots) return;
  compareSlots.innerHTML = compareState.slots.map((slot) => renderCompareSlot(slot)).join("");
  if (addCompareSlotButton) {
    addCompareSlotButton.disabled = compareState.slots.length >= compareSlotLimit;
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
    const response = await fetch(`/api/search?${compactParams(slot.query, slot.filters, slot.page)}`);
    if (!response.ok) {
      let errMsg = `검색 요청 실패 (${response.status})`;
      try {
        const errJson = await response.json();
        if (errJson?.message) errMsg += `: ${errJson.message}`;
      } catch {}
      throw new Error(errMsg);
    }
    const payload = await response.json();
    slot.rows = payload.items || [];
    slot.total = Number(payload.total || 0);
    slot.notice = payload.notice || "";
    slot.page = Number(payload.page || slot.page);
    slot.pageSize = Number(payload.pageSize || slot.rows.length || 10);
    slot.totalPages = Math.max(Number(payload.totalPages || 1), 1);
    slot.selectedSeq = slot.rows[0]?.itemSeq || "";
    slot.listLoading = false;
  } catch (error) {
    slot.rows = [];
    slot.total = 0;
    slot.selectedSeq = "";
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
    const response = await fetch(`/api/search?${buildSearchParams()}`);
    if (!response.ok) {
      let errMsg = `검색 요청 실패 (${response.status})`;
      try {
        const errJson = await response.json();
        if (errJson && errJson.message) {
          errMsg += `: ${errJson.message}`;
        }
      } catch {}
      throw new Error(errMsg);
    }
    const payload = await response.json();

    state.rows = payload.items || [];
    state.total = Number(payload.total || 0);
    state.notice = payload.notice || "";
    state.page = Number(payload.page || state.page);
    state.pageSize = Number(payload.pageSize || state.rows.length || 10);
    state.totalPages = Math.max(Number(payload.totalPages || 1), 1);
    state.selectedSeq = state.rows[0]?.itemSeq || "";
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
  if (state.detailCache[itemSeq] && !state.detailCache[itemSeq].detailPartial) return;
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
  return response.json();
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
    .filter((seq) => seq && !state.detailCache[seq]?.unitDose);
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
  const totalCols = 8 + perfYears.length;

  // Dynamic header rendering
  const theadRow = document.querySelector(".result-table thead tr");
  if (theadRow) {
    const baseHeaders = ["제품명", "업체명", "주성분", "단위용량", "전문/일반", "허가일", "ATC", "위탁제조업체"];
    const BASE_WIDTHS = [200, 110, 180, 170, 80, 90, 90, 130];
    let thHtml = "";
    baseHeaders.forEach((h, i) => {
      const width = state.columnWidths[h] || BASE_WIDTHS[i];
      thHtml += `<th style="width: ${width}px;"><div class="th-wrapper">${escapeHtml(h)}</div></th>`;
    });
    perfYears.forEach((year) => {
      const h = `${year}년 실적`;
      const width = state.columnWidths[h] || 110;
      thHtml += `<th style="width: ${width}px;"><div class="th-wrapper">${escapeHtml(h)}</div></th>`;
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

  resultBody.innerHTML = state.rows
    .map((row, index) => {
      const drug = rowWithCachedDetail(row);
      const selected = drug.itemSeq === state.selectedSeq ? "selected" : "";
      const rowNumber = drug.rowNumber || String((state.page - 1) * state.pageSize + index + 1);
      const ingredientLines = String(drug.mainIngredient || "-")
        .split(/\s*[/,]\s*/)
        .filter(Boolean)
        .map((item) => `<span>${escapeHtml(item)}</span>`)
        .join("");
      
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
            </div>
          </td>
          <td>${escapeHtml(drug.entpName || "-")}</td>
          <td><div class="ingredient-lines">${ingredientLines || "-"}</div></td>
          <td><div class="unit-dose-lines">${unitDoseLineHtml(drug.unitDose, state.unitDoseLoading && !drug.unitDose)}</div></td>
          <td>${escapeHtml(drug.etcOtc || "-")}</td>
          <td>${escapeHtml(drug.permitDate || "-")}</td>
          <td>${escapeHtml(drug.atcCode || "-")}</td>
          <td>${escapeHtml(drug.contractManufacturer || "-")}</td>
          ${perfCellsHtml}
        </tr>
      `;
    })
    .join("");

  // Initialize/refresh drag handles
  initColumnResize();
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
                <dd>${escapeHtml(value)}</dd>
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
                  ${columns.map((column) => `<td>${escapeHtml(row[column.key] || "")}</td>`).join("")}
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
      <div class="text-block ${compact ? "compact" : ""}">${escapeHtml(text)}</div>
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
}

function toCsvValue(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv() {
  const perfYears = getPerformanceYears();
  const headers = [
    ["rowNumber", "순번"],
    ["itemSeq", "품목기준코드"],
    ["itemName", "제품명"],
    ["itemEngName", "제품영문명"],
    ["entpName", "업체명"],
    ["entpEngName", "업체영문명"],
    ["contractManufacturer", "위탁제조업체"],
    ["mainIngredient", "주성분"],
    ["unitDose", "단위용량"],
    ["etcOtc", "전문/일반"],
    ["permitDate", "허가일"],
    ["itemCategory", "품목구분"],
    ["cancelStatus", "취소/취하"],
    ["makeMaterial", "완제/원료"],
    ["mainIngredientEng", "주성분영문명"],
    ["additives", "첨가제"],
    ["standardCode", "표준코드"],
    ["atcCode", "ATC코드"]
  ];

  perfYears.forEach((year) => {
    headers.push([`perf_${year}`, `${year}년 실적`]);
  });

  const lines = [
    headers.map(([, label]) => toCsvValue(label)).join(","),
    ...state.rows.map((row) => {
      const drug = rowWithCachedDetail(row);
      return headers.map(([key]) => {
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
      }).join(",");
    })
  ];
  const blob = new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mfds-drugs-page-${state.page}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
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

detailPanel.addEventListener("click", (event) => {
  const retryButton = event.target.closest("[data-retry-detail]");
  if (!retryButton) return;
  const itemSeq = retryButton.dataset.retryDetail || state.selectedSeq;
  state.selectedSeq = itemSeq;
  loadDetail(itemSeq, { force: true });
});

function setWorkspaceTab(tabName) {
  workspaceTabs.forEach((button) => {
    const active = button.dataset.workspaceTab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (searchWorkspace) searchWorkspace.hidden = tabName !== "search";
  if (compareWorkspace) compareWorkspace.hidden = tabName !== "compare";
  document.body.classList.toggle("compare-mode", tabName === "compare");
  if (tabName === "compare") {
    ensureCompareSlot();
    renderCompareSlots();
  }
}

function currentHumanTab() {
  return document.querySelector("[data-workspace-tab].active")?.dataset.workspaceTab || "search";
}

function setCategoryTab(categoryName) {
  categoryTabs.forEach((button) => {
    const active = button.dataset.categoryTab === categoryName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  const isHuman = categoryName === "human";
  document.querySelector(".workspace-tabs")?.toggleAttribute("hidden", !isHuman);
  if (vetWorkspace) vetWorkspace.hidden = categoryName !== "vet";
  if (aquaticWorkspace) aquaticWorkspace.hidden = categoryName !== "aquatic";

  if (isHuman) {
    setWorkspaceTab(currentHumanTab());
    return;
  }

  if (searchWorkspace) searchWorkspace.hidden = true;
  if (compareWorkspace) compareWorkspace.hidden = true;
  document.body.classList.remove("compare-mode");

  if (categoryName === "vet" && !externalStates.vet.loaded) {
    loadExternalResults("vet");
  }
  if (categoryName === "aquatic" && !externalStates.aquatic.loaded) {
    loadExternalResults("aquatic");
  }
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
    setTimeout(() => loadExternalResults(kind, { resetPage: true }), 0);
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
    compareState.slots.push(createCompareSlot());
    renderCompareSlots();
  });
}

if (compareSlots) {
  compareSlots.addEventListener("submit", (event) => {
    const formEl = event.target.closest("form.compare-filter");
    if (!formEl) return;
    event.preventDefault();
    const slotEl = formEl.closest("[data-slot-id]");
    loadCompareResults(slotEl?.dataset.slotId, { resetPage: true });
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
      ensureCompareSlot();
      renderCompareSlots();
      return;
    }

    const retryButton = event.target.closest("[data-compare-retry-detail]");
    if (retryButton) {
      loadCompareDetail(slot.id, retryButton.dataset.compareRetryDetail || slot.selectedSeq, { force: true });
      return;
    }

    const selectedRow = event.target.closest("[data-compare-select]");
    if (selectedRow) {
      slot.selectedSeq = selectedRow.dataset.compareSelect;
      renderCompareSlots();
      loadCompareDetail(slot.id, slot.selectedSeq);
      return;
    }

    const pageButton = event.target.closest("[data-compare-page]");
    if (pageButton) {
      if (pageButton.disabled) return;
      syncCompareQueryFromForm(slot, slotEl.querySelector("form"));
      if (pageButton.dataset.comparePage === "prev") slot.page = Math.max(1, slot.page - 1);
      if (pageButton.dataset.comparePage === "next") slot.page = Math.min(slot.totalPages, slot.page + 1);
      loadCompareResults(slot.id);
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
        detailCache: {},
        detailLoadingSeq: "",
        detailHydrationGeneration: slot.detailHydrationGeneration + 1,
        listLoading: false,
        error: "",
        notice: "",
        filters: defaultCompareFilters(),
        query: defaultCompareQuery(),
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

csvButton.addEventListener("click", downloadCsv);

/* ── Collapsible extra ingredients toggle ── */

const extraToggle = document.querySelector("#extraIngredientToggle");
const extraWrap = document.querySelector("#extraIngredientWrap");

if (extraToggle && extraWrap) {
  extraToggle.addEventListener("click", () => {
    const isCollapsed = extraWrap.classList.toggle("collapsed");
    extraToggle.setAttribute("aria-expanded", String(!isCollapsed));
  });
}

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

function initColumnResize() {
  const table = document.querySelector(".result-table");
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
      const thName = th.textContent.trim();
      state.columnWidths[thName] = newWidth;
      
      if (nextTh) {
        const newNext = Math.max(40, nextStartWidth - consumed);
        nextTh.style.width = `${newNext}px`;
        const nextThName = nextTh.textContent.trim();
        state.columnWidths[nextThName] = newNext;
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

loadResults();
