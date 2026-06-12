const { searchMfds, getMfdsDetail } = require("./mfds");
const { searchVetMedicines, searchAquaticMedicines } = require("./public-medicines");

const GROUP_LIMIT = 12;

function valueOf(value) {
  if (Array.isArray(value)) return value[0] || "";
  return value == null ? "" : String(value);
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function includesKeyword(value, keyword) {
  const haystack = String(value || "").replace(/\s+/g, "").toLowerCase();
  const needle = String(keyword || "").replace(/\s+/g, "").toLowerCase();
  return needle && haystack.includes(needle);
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
  if (!existing.detail && result.detail) existing.detail = result.detail;
}

function humanSearchQueries(keyword) {
  return [
    { label: "제품명", query: { productName: keyword } },
    { label: "업체명", query: { companyName: keyword } },
    { label: "성분명", query: { ingredient1: keyword } },
    { label: "효능효과", query: { efficacyOperator: "AND", efficacyQuery: keyword } },
    { label: "용법용량", query: { dosageOperator: "AND", dosageQuery: keyword } },
    { label: "주의사항", query: { precautionOperator: "AND", precautionQuery: keyword } }
  ];
}

function externalSearchQueries(keyword) {
  return [
    { label: "제품명", query: { productName: keyword } },
    { label: "업체명", query: { companyName: keyword } },
    { label: "성분명", query: { ingredient1: keyword } },
    { label: "효능효과", query: { efficacyOperator: "AND", efficacyQuery: keyword } },
    { label: "용법용량", query: { dosageOperator: "AND", dosageQuery: keyword } }
  ];
}

function humanSnippet(row, detail, keyword, label) {
  const fields = [
    ["제품명", row.itemName],
    ["업체명", row.entpName],
    ["성분명", detail?.mainIngredient || row.mainIngredient],
    ["효능효과", detail?.efficacy],
    ["용법용량", detail?.dosage],
    ["주의사항", detail?.precautions]
  ];
  const matched = fields.find(([, value]) => includesKeyword(value, keyword));
  if (matched) return { matchLabel: matched[0], snippet: matchSnippet(matched[1], keyword, `${matched[0]}에서 검색됨`) };
  return { matchLabel: label, snippet: compactText(row.mainIngredient || row.entpName || row.itemName) };
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
  return { matchLabel: label, snippet: compactText(row.note || row.itemCategory || row.dosageForm || row.entpName || row.itemName) };
}

async function buildHumanGroup(keyword) {
  const map = new Map();
  const searches = humanSearchQueries(keyword);
  const pages = await Promise.allSettled(searches.map((item) => searchMfds({ ...item.query, page: 1, _global: "1" })));

  for (let i = 0; i < pages.length; i += 1) {
    const result = pages[i];
    if (result.status !== "fulfilled") continue;
    const label = searches[i].label;
    for (const row of (result.value.items || []).slice(0, GROUP_LIMIT)) {
      mergeResult(map, row.itemSeq, {
        id: `human:${row.itemSeq}`,
        category: "human",
        title: row.itemName || "-",
        company: row.entpName || "",
        meta: [row.itemSeq, row.etcOtc, row.permitDate].filter(Boolean).join(" / "),
        matchFields: [label],
        matchLabel: label,
        snippet: compactText(row.mainIngredient || row.entpName || row.itemName),
        row
      });
      if (map.size >= GROUP_LIMIT) break;
    }
  }

  const items = Array.from(map.values()).slice(0, GROUP_LIMIT);
  const detailTargets = items.slice(0, 5).filter((item) => item.row.itemSeq);
  await Promise.allSettled(
    detailTargets.map(async (item) => {
      const detail = await getMfdsDetail(item.row.itemSeq);
      item.detail = detail;
      const matched = humanSnippet(item.row, detail, keyword, item.matchLabel);
      item.matchLabel = matched.matchLabel;
      item.snippet = matched.snippet;
    })
  );

  return {
    key: "human",
    label: "인체용 의약품",
    total: items.length,
    items
  };
}

async function buildExternalGroup(kind, keyword) {
  const searchFn = kind === "aquatic" ? searchAquaticMedicines : searchVetMedicines;
  const map = new Map();
  const searches = externalSearchQueries(keyword);
  const pages = await Promise.allSettled(searches.map((item) => searchFn({ ...item.query, page: 1, _global: "1" })));

  for (let i = 0; i < pages.length; i += 1) {
    const result = pages[i];
    if (result.status !== "fulfilled") continue;
    const label = searches[i].label;
    for (const row of (result.value.items || []).slice(0, GROUP_LIMIT)) {
      const key = row.detailKey || row.sourceUrl || `${row.permitNumber || ""}:${row.itemName}:${row.entpName}`;
      const matched = externalSnippet(row, keyword, label);
      mergeResult(map, key, {
        id: `${kind}:${key}`,
        category: kind,
        title: row.itemName || "-",
        company: row.entpName || "",
        meta: [row.permitNumber || row.rowNumber, row.itemCategory || row.dosageForm, row.permitDate].filter(Boolean).join(" / "),
        matchFields: [label],
        matchLabel: matched.matchLabel,
        snippet: matched.snippet,
        row
      });
      if (map.size >= GROUP_LIMIT) break;
    }
  }

  return {
    key: kind,
    label: kind === "aquatic" ? "수산동물용 의약품" : "동물용 의약품",
    total: map.size,
    items: Array.from(map.values()).slice(0, GROUP_LIMIT)
  };
}

async function globalSearch(query = {}) {
  const keyword = compactText(valueOf(query.q || query.keyword || query.homeQuery));
  if (!keyword) {
    return { keyword: "", groups: [] };
  }

  const [human, vet, aquatic] = await Promise.all([
    buildHumanGroup(keyword).catch((error) => ({ key: "human", label: "인체용 의약품", total: 0, items: [], error: error.message })),
    buildExternalGroup("vet", keyword).catch((error) => ({ key: "vet", label: "동물용 의약품", total: 0, items: [], error: error.message })),
    buildExternalGroup("aquatic", keyword).catch((error) => ({ key: "aquatic", label: "수산동물용 의약품", total: 0, items: [], error: error.message }))
  ]);

  return {
    keyword,
    groups: [human, vet, aquatic],
    fetchedAt: new Date().toISOString()
  };
}

module.exports = {
  globalSearch
};
