const state = {
  drugs: [],
  filtered: [],
  selectedSeq: "",
  filters: {
    itemCategory: "",
    cancelStatus: "",
    etcOtc: "",
    makeMaterial: ""
  }
};

const form = document.querySelector("#searchForm");
const resultBody = document.querySelector("#resultBody");
const resultCount = document.querySelector("#resultCount");
const detailPanel = document.querySelector("#detailPanel");
const csvButton = document.querySelector("#csvButton");

const fieldMap = {
  productName: "itemName",
  productEngName: "itemEngName",
  companyName: "entpName",
  companyEngName: "entpEngName",
  itemSeq: "itemSeq",
  standardCode: "standardCode",
  atcCode: "atcCode"
};

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasText(source, query) {
  if (!query) return true;
  return normalize(source).includes(normalize(query));
}

function splitTerms(query) {
  return normalize(query)
    .split(/[,\s]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function matchTerms(source, query, operator = "AND") {
  const terms = splitTerms(query);
  if (!terms.length) return true;
  const haystack = normalize(source);
  return operator === "OR"
    ? terms.some((term) => haystack.includes(term))
    : terms.every((term) => haystack.includes(term));
}

function ingredientText(drug) {
  return [
    drug.mainIngredient,
    drug.mainIngredientEng,
    ...(drug.ingredients || []).map((item) => `${item.name || ""} ${item.engName || ""}`)
  ].join(" ");
}

function flatSearchText(drug) {
  return [
    drug.itemName,
    drug.itemEngName,
    drug.entpName,
    drug.entpEngName,
    drug.mainIngredient,
    drug.additives?.join(" "),
    drug.efficacy,
    drug.dosage,
    drug.precautions,
    drug.atcCode,
    drug.standardCode
  ].join(" ");
}

function collectFilters() {
  const values = Object.fromEntries(new FormData(form).entries());
  return { ...values, ...state.filters };
}

function filterDrugs() {
  const filters = collectFilters();
  state.filtered = state.drugs.filter((drug) => {
    for (const [formKey, dataKey] of Object.entries(fieldMap)) {
      if (!hasText(drug[dataKey], filters[formKey])) return false;
    }

    if (!matchTerms(ingredientText(drug), filters.ingredient1)) return false;
    if (!matchTerms(ingredientText(drug), filters.ingredient2)) return false;
    if (!matchTerms(ingredientText(drug), filters.ingredient3)) return false;
    if (!matchTerms(ingredientText(drug), filters.ingredientEngName)) return false;
    if (!hasText(drug.itemCategory, filters.itemCategory)) return false;
    if (!hasText(drug.cancelStatus, filters.cancelStatus)) return false;
    if (!hasText(drug.etcOtc, filters.etcOtc)) return false;
    if (!hasText(drug.makeMaterial, filters.makeMaterial)) return false;
    if (!matchTerms(drug.efficacy, filters.efficacyQuery, filters.efficacyOperator)) return false;
    if (!matchTerms(drug.dosage, filters.dosageQuery, filters.dosageOperator)) return false;
    if (!matchTerms(drug.precautions, filters.precautionQuery, filters.precautionOperator)) return false;

    if (filters.permitStart && drug.permitDate < filters.permitStart) return false;
    if (filters.permitEnd && drug.permitDate > filters.permitEnd) return false;

    return true;
  });

  if (!state.filtered.some((drug) => drug.itemSeq === state.selectedSeq)) {
    state.selectedSeq = state.filtered[0]?.itemSeq || "";
  }
}

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

function renderResults() {
  resultCount.innerHTML = `총 <strong>${state.filtered.length.toLocaleString("ko-KR")}</strong> 건`;

  resultBody.innerHTML = state.filtered
    .map((drug, index) => {
      const selected = drug.itemSeq === state.selectedSeq ? "selected" : "";
      const ingredients = snippet(drug.mainIngredient || ingredientText(drug), 60);
      return `
        <tr class="${selected}" data-seq="${escapeHtml(drug.itemSeq)}">
          <td>${index + 1}</td>
          <td>
            <button type="button" data-select="${escapeHtml(drug.itemSeq)}">${escapeHtml(drug.itemName)}</button>
            <div class="tag-row">
              <span class="tag blue">${escapeHtml(drug.itemSeq)}</span>
              <span class="tag">${escapeHtml(drug.itemCategory || "-")}</span>
              <span class="tag ${drug.cancelStatus === "정상" ? "green" : "amber"}">${escapeHtml(drug.cancelStatus || "-")}</span>
            </div>
            <div class="muted">${escapeHtml(snippet(drug.efficacy, 74))}</div>
          </td>
          <td>${escapeHtml(drug.entpName || "-")}</td>
          <td>${escapeHtml(ingredients || "-")}</td>
          <td>${escapeHtml(drug.etcOtc || "-")}</td>
          <td>${escapeHtml(drug.permitDate || "-")}</td>
          <td>${escapeHtml(drug.atcCode || "-")}</td>
        </tr>
      `;
    })
    .join("");
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

function renderDetail() {
  const drug = state.drugs.find((item) => item.itemSeq === state.selectedSeq);

  if (!drug) {
    detailPanel.innerHTML = `<div class="detail-empty">검색 결과에서 제품을 선택하세요.</div>`;
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
    ["허가심사유형", drug.reviewType],
    ["품목구분", drug.itemCategory],
    ["완제/원료", drug.makeMaterial]
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
      ${renderTextSection("사용상의 주의사항", drug.precautions, true)}
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
  const headers = [
    ["itemSeq", "품목기준코드"],
    ["itemName", "제품명"],
    ["entpName", "업체명"],
    ["etcOtc", "전문/일반"],
    ["permitDate", "허가일"],
    ["itemCategory", "품목구분"],
    ["cancelStatus", "취소/취하"],
    ["makeMaterial", "완제/원료"],
    ["mainIngredient", "주성분"],
    ["additives", "첨가제"],
    ["efficacy", "효능효과"],
    ["dosage", "용법용량"],
    ["precautions", "사용상의주의사항"],
    ["storage", "저장방법"],
    ["validTerm", "사용기간"],
    ["packageInfo", "포장정보"],
    ["insurancePrice", "보험약가"],
    ["atcCode", "ATC코드"]
  ];

  const lines = [
    headers.map(([, label]) => toCsvValue(label)).join(","),
    ...state.filtered.map((drug) => headers.map(([key]) => toCsvValue(drug[key])).join(","))
  ];
  const blob = new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mfds-drugs-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function loadData() {
  const endpoints = ["./data/drugs.json", "./data/drugs.sample.json"];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) continue;
      const payload = await response.json();
      state.drugs = Array.isArray(payload) ? payload : payload.items || [];
      if (state.drugs.length) break;
    } catch {
      // Try the next local data source.
    }
  }

  state.filtered = [...state.drugs];
  state.selectedSeq = state.filtered[0]?.itemSeq || "";
  render();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  filterDrugs();
  render();
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
  setTimeout(() => {
    state.filtered = [...state.drugs];
    state.selectedSeq = state.filtered[0]?.itemSeq || "";
    render();
  }, 0);
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
  state.selectedSeq = target.dataset.select || target.dataset.seq;
  render();
});

document.querySelectorAll(".view-options button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".view-options button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.body.classList.toggle("table-only", button.dataset.view === "table");
  });
});

csvButton.addEventListener("click", downloadCsv);

loadData();
