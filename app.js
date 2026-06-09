const state = {
  rows: [],
  total: 0,
  page: 1,
  pageSize: 10,
  totalPages: 1,
  selectedSeq: "",
  detailCache: {},
  detailLoadingSeq: "",
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
  const params = new URLSearchParams({ ...values, ...state.filters, page: String(state.page) });
  for (const [key, value] of [...params.entries()]) {
    if (value === "") params.delete(key);
  }
  return params;
}

async function loadResults({ resetPage = false } = {}) {
  if (resetPage) state.page = 1;
  state.listLoading = true;
  state.error = "";
  render();

  try {
    const response = await fetch(`/api/search?${buildSearchParams()}`, { cache: "no-store" });
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
    render();

    preloadAllDetails();
  } catch (error) {
    state.rows = [];
    state.total = 0;
    state.selectedSeq = "";
    state.listLoading = false;
    state.error = error.message;
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
  if (state.detailCache[itemSeq]) return;
  try {
    const response = await fetch(`/api/detail?itemSeq=${encodeURIComponent(itemSeq)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`상세 요청 실패 (${response.status})`);
    const payload = await response.json();
    const row = state.rows.find((r) => r.itemSeq === itemSeq);
    state.detailCache[itemSeq] = mergeKeepNonEmpty(row, payload);
  } catch (error) {
    const row = state.rows.find((r) => r.itemSeq === itemSeq);
    state.detailCache[itemSeq] = { ...row, detailError: error.message };
  }
}

async function loadDetail(itemSeq) {
  if (!itemSeq || state.detailCache[itemSeq]) {
    render();
    return;
  }

  state.detailLoadingSeq = itemSeq;
  render();

  try {
    const response = await fetch(`/api/detail?itemSeq=${encodeURIComponent(itemSeq)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`상세 요청 실패 (${response.status})`);
    const payload = await response.json();
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
  const totalCols = 7 + perfYears.length;

  // Dynamic header rendering
  const theadRow = document.querySelector(".result-table thead tr");
  if (theadRow) {
    const baseHeaders = ["제품명", "업체명", "주성분", "전문/일반", "허가일", "ATC", "위탁제조업체"];
    const BASE_WIDTHS = [200, 110, 180, 80, 90, 90, 130];
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
    resultBody.innerHTML = `<tr><td colspan="${totalCols}" class="table-message error">${escapeHtml(state.error)}</td></tr>`;
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
      ${drug.detailError ? `<p class="table-message error">${escapeHtml(drug.detailError)}</p>` : ""}
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
  document.querySelectorAll(".segmented button").forEach((button) => {
    button.classList.toggle("active", button.dataset.value === "");
  });
  document.querySelectorAll(".quick-dates button").forEach((button) => {
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

document.querySelectorAll(".segmented").forEach((group) => {
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    group.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.filters[group.dataset.field] = button.dataset.value;
  });
});

document.querySelectorAll(".quick-dates button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".quick-dates button").forEach((item) => item.classList.remove("active"));
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
  const target = event.target.closest("[data-select], tr[data-seq]");
  if (!target) return;
  const itemSeq = target.dataset.select || target.dataset.seq;
  state.selectedSeq = itemSeq;
  render();
  loadDetail(itemSeq);
});

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
