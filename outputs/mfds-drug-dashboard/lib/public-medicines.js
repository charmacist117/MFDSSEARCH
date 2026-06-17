const { fetchMfdsText } = require("./mfds");
const { valueOf, decodeEntities, textFromHtml, includesText, MemoryCache } = require("./utils");

const VET_BASE_URL = "https://medi.qia.go.kr/searchMedicine";
const AQUATIC_BASE_URL = "https://www.nfqs.go.kr/apms/search/goodsList.ad";
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const DETAIL_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const SEARCH_CACHE_LIMIT = 80;
const DETAIL_CACHE_LIMIT = 300;
const searchMemoryCache = new MemoryCache(SEARCH_CACHE_LIMIT, SEARCH_CACHE_TTL_MS);
const detailMemoryCache = new MemoryCache(DETAIL_CACHE_LIMIT, DETAIL_CACHE_TTL_MS);
const CACHE_KEY_IGNORE_FIELDS = new Set(["_v", "_global", "timeoutMs", "retries", "fastFail"]);

function stripUiTextArtifacts(text) {
  const isUiLine = (line) =>
    /^(?:top|이전|뒤로|닫기|A\+|A-|A\s*아주작게|A\s*작게|A\s*보통|A\s*크게|A\s*아주크게)$/i.test(line) ||
    /^(?:폴딩\s*버튼|PDF\s*다운로드|XML\s*다운로드|HTML\s*다운로드)\s*-*>?$/i.test(line) ||
    /^테이블\s*정보\s*::?/i.test(line);

  return String(text || "")
    .replace(/[^\n]*폴딩\s*버튼\s*-*>?/gi, "\n")
    .replace(/\b(?:PDF|XML|HTML)\s*다운로드\s*-*>?/gi, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/\s*-+>\s*/g, " ").replace(/\s+/g, " ").trim())
    .filter((line) => line && !/^[-–—>]+$/.test(line) && !isUiLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanText(html) {
  let cleanHtml = String(html || "")
    .replace(/<span\b[^>]*class=["']s-th["'][^>]*>[\s\S]*?<\/span>/gi, "");
  return stripUiTextArtifacts(textFromHtml(cleanHtml));
}

function removeTablesForText(html) {
  return String(html || "").replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, "\n");
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

function ingredientPartCount(value) {
  return String(value || "")
    .split(/\s*[/,]\s*/)
    .map((item) => item.trim())
    .filter(Boolean).length;
}

const PUBLIC_PRESENCE_FIELDS = new Set([
  "productName",
  "productEngName",
  "companyName",
  "itemCategory",
  "ingredient1",
  "ingredient2",
  "ingredient3",
  "ingredient4",
  "ingredient5",
  "efficacyQuery",
  "dosageQuery",
  "precautionQuery",
  "fishName",
  "disease",
  "dosageForm"
]);

function extractPublicPresenceFilters(query = {}) {
  return Object.keys(query)
    .filter((field) => PUBLIC_PRESENCE_FIELDS.has(field) && isPresenceToken(query[field]))
    .map((field) => ({ field, mode: valueOf(query[field]).trim() }));
}

function publicFieldHasContent(item, field) {
  if (["efficacyQuery", "dosageQuery", "precautionQuery"].includes(field)) {
    return item.hasDetailUrl !== false || valueHasContent(item.note || item.condition);
  }
  if (/^ingredient[1-5]$/.test(field)) {
    const index = Number(field.replace("ingredient", ""));
    return ingredientPartCount(item.mainIngredient || item.note || "") >= index;
  }
  const fieldMap = {
    productName: "itemName",
    productEngName: "itemEngName",
    companyName: "entpName",
    itemCategory: "itemCategory",
    efficacyQuery: "efficacy",
    dosageQuery: "dosage",
    precautionQuery: "precaution",
    fishName: "fishName",
    disease: "disease",
    dosageForm: "dosageForm"
  };
  return valueHasContent(item[fieldMap[field] || field]);
}

function applyPublicPresenceFilters(items, filters = []) {
  if (!filters.length) return items;
  return items.filter((item) =>
    filters.every(({ field, mode }) => {
      const hasContent = publicFieldHasContent(item, field);
      return mode === "#" ? hasContent : !hasContent;
    })
  );
}

function requireVisibleMatches(item, values = []) {
  const text = rowVisibleText(item);
  return values.every((value) => includesText(text, value, true));
}

function effectiveQueryValues(query = {}, keys = []) {
  return keys
    .map((key) => normalSearchValue(query[key]).trim())
    .filter(Boolean);
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
    .map((index) => normalSearchValue(query[`ingredient${index}`]).trim())
    .filter(Boolean);
}

function buildVetUrl(query = {}) {
  const ingredients = ingredientValues(query);
  const efficacyQuery = normalSearchValue(query.efficacyQuery);
  const dosageQuery = normalSearchValue(query.dosageQuery);
  const precautionQuery = normalSearchValue(query.precautionQuery);
  const params = new URLSearchParams({
    csSignature: "/pty5cD24mE8YS6L+3jPAw==",
    sort: "",
    sortOrder: "false",
    searchYn: "true",
    ExcelRowdata: "",
    page: normalSearchValue(query.page) || "1",
    searchDivision: "detail",
    itemName: normalSearchValue(query.productName),
    itemEngName: normalSearchValue(query.productEngName),
    entpName: normalSearchValue(query.companyName),
    indutyClassCode: normalSearchValue(query.itemCategory),
    startPermitDate: normalSearchValue(query.permitStart),
    endPermitDate: normalSearchValue(query.permitEnd),
    ingrMainName: ingredients[0] || normalSearchValue(query.ingredientName),
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
    searchConEe: normalSearchValue(query.efficacyOperator) || "AND",
    searchConUd: normalSearchValue(query.dosageOperator) || "AND",
    searchConNb: normalSearchValue(query.precautionOperator) || "AND"
  });
  return `${VET_BASE_URL}?${params}`;
}

function parseVetHtml(html, sourceUrl, query = {}) {
  const presenceFilters = extractPublicPresenceFilters(query);
  const matchedRows = parseRows(html)
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
  const rows = applyPublicPresenceFilters(matchedRows, presenceFilters);

  const totalPages = parsePaginationTotalPages(html);
  const hasClientFilter = presenceFilters.length > 0 || effectiveQueryValues(query, ["ingredient1", "ingredient2", "ingredient3", "ingredient4", "ingredient5", "efficacyQuery", "dosageQuery", "precautionQuery"]).length > 0;
  const total = hasClientFilter ? rows.length : parseTotal(html, totalPages ? totalPages * Math.max(rows.length, 10) : rows.length);
  return { total, totalPages: hasClientFilter ? 1 : totalPages, items: rows };
}

function buildAquaticUrl(query = {}) {
  const ingredients = ingredientValues(query);
  const ingredientQuery = ingredients.join(" ");
  const efficacyQuery = normalSearchValue(query.efficacyQuery);
  const dosageQuery = normalSearchValue(query.dosageQuery);
  const precautionQuery = normalSearchValue(query.precautionQuery);
  const params = new URLSearchParams({
    pageNo: normalSearchValue(query.page) || "1",
    prdlstNm: normalSearchValue(query.productName),
    goodsNm: normalSearchValue(query.productName),
    bsshNm: normalSearchValue(query.companyName),
    entrpsNm: normalSearchValue(query.companyName),
    ingrNm: ingredientQuery || normalSearchValue(query.ingredientName),
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
    caution: precautionQuery,
    precaution: precautionQuery,
    nbDocData: precautionQuery,
    searchConEe: normalSearchValue(query.efficacyOperator) || "AND",
    searchConUd: normalSearchValue(query.dosageOperator) || "AND",
    searchConNb: normalSearchValue(query.precautionOperator) || "AND",
    fishNm: normalSearchValue(query.fishName),
    dissNm: normalSearchValue(query.disease),
    dosageForm: normalSearchValue(query.dosageForm)
  });
  return `${AQUATIC_BASE_URL}?${params}`;
}

function parseAquaticHtml(html, sourceUrl, query = {}) {
  const presenceFilters = extractPublicPresenceFilters(query);
  const matchedRows = parseRows(html)
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
        "precautionQuery",
        "fishName",
        "disease",
        "dosageForm"
      ]));
    });
  const rows = applyPublicPresenceFilters(matchedRows, presenceFilters);

  const totalPages = parsePaginationTotalPages(html);
  const hasClientFilter = presenceFilters.length > 0 || effectiveQueryValues(query, ["ingredient1", "ingredient2", "ingredient3", "ingredient4", "ingredient5", "efficacyQuery", "dosageQuery", "precautionQuery", "fishName", "disease", "dosageForm"]).length > 0;
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
  if (!label || !text || !isUsefulDetailPair(label, text)) return;
  const fingerprint = `${label}:${text}`;
  if (seen.has(fingerprint)) return;
  seen.add(fingerprint);
  pairs.push([label, text]);
}

function isUsefulDetailPair(label, value) {
  const cleanLabel = String(label || "").trim();
  const cleanValue = String(value || "").trim();
  if (!cleanLabel || !cleanValue) return false;
  if (/^\d+(?:[.,]\d+)?$/.test(cleanLabel)) return false;
  if (/^(?:mg|㎎|g|kg|ml|mL|L|IU|MC|유니트)$/i.test(cleanLabel)) return false;
  if (/^\d+(?:[.,]\d+)?\s*(?:mg|㎎|g|kg|ml|mL|L|IU|MC)?$/i.test(cleanLabel)) return false;
  if (/^(?:체중|용량|순번|성분명|분량|단위|규격)$/i.test(cleanLabel)) return false;
  if (/^\d+(?:\.\d+)?\s*~\s*\d+(?:\.\d+)?\s*kg/i.test(cleanLabel)) return false;
  return true;
}

function classifyTableTitle(title, rows) {
  const source = `${title || ""} ${rows.flat().join(" ")}`;
  if (/원료|성분|함량|분량|유효성분/i.test(source)) return "원료약품 및 분량";
  if (/체중|투여|용량|용법|급여/i.test(source)) return "체중별 투여량";
  if (/효능|효과|대상질병/i.test(source)) return "효능효과";
  if (/주의|금기|휴약/i.test(source)) return "주의사항";
  return title || "상세 표";
}

function tableFingerprint(table) {
  return `${table.title || ""}:${(table.rows || []).map((row) => row.join("|")).join("||")}`;
}

function isDoseHeaderRow(row = []) {
  const labels = row.map((cell) => String(cell || "").replace(/\s+/g, ""));
  return labels.includes("체중") && labels.includes("용량");
}

function looksLikeDoseRow(row = []) {
  const text = row.join(" ");
  return /\d/.test(text) && /(kg|㎏|ml|mL|밀리리터|mg|㎎)/i.test(text);
}

function extractDoseTable(rows = []) {
  const headerIndex = rows.findIndex(isDoseHeaderRow);
  if (headerIndex < 0) return null;
  const header = rows[headerIndex];
  const body = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (!row.length) continue;
    if (isDoseHeaderRow(row)) continue;
    if (!looksLikeDoseRow(row)) break;
    body.push(row);
  }
  return body.length ? { title: "체중별 투여량", rows: [header, ...body] } : null;
}

function looksLikeKeyValueTable(rows = []) {
  if (rows.length < 3) return false;
  const twoColumnRows = rows.filter((row) => row.length === 2);
  if (twoColumnRows.length < Math.ceil(rows.length * 0.65)) return false;
  return twoColumnRows.some(([label, value]) => isUsefulDetailPair(label, value));
}

function normalizeTableBlocks(blocks = []) {
  const normalized = [];
  const seen = new Set();
  const push = (table) => {
    if (!table?.rows?.length) return;
    const fingerprint = tableFingerprint(table);
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    normalized.push(table);
  };

  for (const block of blocks) {
    const doseTable = extractDoseTable(block.rows);
    if (doseTable) push(doseTable);
    if (looksLikeKeyValueTable(block.rows)) continue;
    if (doseTable && block.title === "체중별 투여량") continue;
    push(block);
  }
  return normalized.slice(0, 10);
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

const VET_SPECIES_TERMS = [
  "소",
  "송아지",
  "젖소",
  "한우",
  "돼지",
  "자돈",
  "모돈",
  "닭",
  "산란계",
  "육계",
  "오리",
  "칠면조",
  "개",
  "강아지",
  "고양이",
  "말",
  "양",
  "염소",
  "토끼",
  "사슴",
  "꿀벌",
  "밍크",
  "관상조",
  "메추리"
];

const AQUATIC_SPECIES_TERMS = [
  "어류",
  "수산동물",
  "넙치",
  "광어",
  "조피볼락",
  "우럭",
  "뱀장어",
  "송어",
  "연어",
  "잉어",
  "붕어",
  "메기",
  "틸라피아",
  "돔",
  "감성돔",
  "참돔",
  "방어",
  "새우",
  "흰다리새우",
  "전복",
  "굴",
  "조개"
];

function uniqueSpeciesMatches(text, terms) {
  const source = String(text || "");
  const found = [];
  for (const term of terms) {
    const pattern = term.length <= 1
      ? new RegExp(`(^|[^가-힣])${term}([^가-힣]|$)`)
      : new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (pattern.test(source) && !found.includes(term)) found.push(term);
  }
  return found;
}

function contextLines(text, pattern, radius = 1) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const picked = new Set();
  lines.forEach((line, index) => {
    if (!pattern.test(line)) return;
    for (let i = Math.max(0, index - radius); i <= Math.min(lines.length - 1, index + radius); i += 1) {
      picked.add(lines[i]);
    }
  });
  return [...picked].join("\n");
}

function inferUsageHighlights(kind, parsed, plainText) {
  const terms = kind === "aquatic" ? AQUATIC_SPECIES_TERMS : VET_SPECIES_TERMS;
  const sectionText = (titlePattern) =>
    (parsed.sections || [])
      .filter((section) => titlePattern.test(section.title))
      .map((section) => section.text)
      .join("\n");
  const tableText = (titlePattern) =>
    (parsed.tables || [])
      .filter((table) => titlePattern.test(table.title || ""))
      .map((table) => (table.rows || []).flat().join("\n"))
      .join("\n");
  const pairText = (labelPattern) =>
    (parsed.pairs || [])
      .filter(([label]) => labelPattern.test(label))
      .map(([, value]) => value)
      .join("\n");

  const usableText = [
    sectionText(/효능|효과|대상|용법|용량/i),
    tableText(/효능|효과|대상|투여|용량|어종|축종/i),
    pairText(/효능|효과|대상|축종|어종|용법|용량/i),
    contextLines(plainText, /대상\s*(?:동물|축종|어종)|사용\s*대상|적용\s*(?:축종|어종)|효능|효과|투여/i)
  ].filter(Boolean).join("\n");

  const unusableText = [
    sectionText(/주의|금기|휴약|저장/i),
    tableText(/주의|금기|휴약/i),
    pairText(/주의|금기|휴약|사용\s*불가|사용\s*금지/i),
    contextLines(plainText, /사용\s*(?:금지|불가|하지\s*말)|투여\s*(?:금지|하지\s*말)|금기|휴약|제외/i, 2)
  ].filter(Boolean).join("\n");

  const usable = uniqueSpeciesMatches(usableText, terms);
  const unusable = uniqueSpeciesMatches(unusableText, terms).filter((term) => !usable.includes(term));
  return { usable, unusable };
}

function parseGenericDetailHtml(html, sourceUrl) {
  const pairs = [];
  const seen = new Set();
  const tableBlocks = normalizeTableBlocks(parseTableBlocks(html));
  const htmlWithoutTables = removeTablesForText(html);

  for (const row of parseRows(html)) {
    const cells = row.cells.map((cell) => cleanText(cell)).filter(Boolean);
    if (cells.length === 2) {
      addPair(pairs, seen, cells[0], cells[1]);
    } else if (cells.length === 4) {
      addPair(pairs, seen, cells[0], cells[1]);
      addPair(pairs, seen, cells[2], cells[3]);
    }
  }

  const text = cleanText(htmlWithoutTables);
  const sections = extractKnownSections(text);
  const ingredientText = sections.find((section) => section.title === "원료약품 및 분량")?.text || "";
  const ingredientRows = parseIngredientRowsFromText(ingredientText);
  const summary = text.length > 2600 ? `${text.slice(0, 2600)}...` : text;

  const parsed = {
    sourceUrl,
    pairs: pairs.slice(0, 80),
    ingredientRows,
    sections,
    tables: tableBlocks,
    summary: pairs.length || tableBlocks.length || sections.length ? "" : summary
  };
  parsed._plainText = text;
  return parsed;
}

async function searchVetMedicines(query = {}) {
  const page = Math.max(Number(valueOf(query.page) || 1), 1);
  const cacheKey = buildQueryCacheKey("vet", query, page);
  const cachedValue = searchMemoryCache.get(cacheKey);
  if (cachedValue) return cachedValue;

  const sourceUrl = buildVetUrl({ ...query, page });
  const retries = Number(valueOf(query.retries) || 2);
  const timeoutMs = Number(valueOf(query.timeoutMs) || 15000);
  const fastFail = valueOf(query.fastFail) === "1";
  const { text, url } = await fetchMfdsText(sourceUrl, retries, timeoutMs, { fallbackOnFetchError: !fastFail });
  const parsed = parseVetHtml(text, url || sourceUrl, query);
  return searchMemoryCache.set(cacheKey, pagePayload({ page, ...parsed, sourceUrl: url || sourceUrl }));
}

async function searchAquaticMedicines(query = {}) {
  const page = Math.max(Number(valueOf(query.page) || 1), 1);
  const cacheKey = buildQueryCacheKey("aquatic", query, page);
  const cachedValue = searchMemoryCache.get(cacheKey);
  if (cachedValue) return cachedValue;

  const sourceUrl = buildAquaticUrl({ ...query, page });
  const retries = Number(valueOf(query.retries) || 2);
  const timeoutMs = Number(valueOf(query.timeoutMs) || 15000);
  const fastFail = valueOf(query.fastFail) === "1";
  const { text, url } = await fetchMfdsText(sourceUrl, retries, timeoutMs, { fallbackOnFetchError: !fastFail });
  const parsed = parseAquaticHtml(text, url || sourceUrl, query);
  return searchMemoryCache.set(cacheKey, pagePayload({
    page,
    ...parsed,
    sourceUrl: url || sourceUrl,
    notice: "수산동물용 의약품은 국립수산물품질관리원 약품편람 목록을 기준으로 표시합니다."
  }));
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
  const cachedValue = detailMemoryCache.get(cacheKey);
  if (cachedValue) return cachedValue;

  const { text, url } = await fetchMfdsText(targetUrl, 2, 15000);
  const parsed = parseGenericDetailHtml(text, url || targetUrl);
  const { _plainText, ...publicParsed } = parsed;
  return detailMemoryCache.set(cacheKey, {
    kind: normalizedKind,
    ...publicParsed,
    usageHighlights: inferUsageHighlights(normalizedKind, publicParsed, _plainText)
  });
}

async function generateVetCsv(query) {
  const firstPage = await searchVetMedicines({ ...query, page: 1 });
  const total = firstPage.total || 0;
  let items = [...(firstPage.items || [])];
  const maxItems = 1000;
  const pageSize = firstPage.pageSize || 10;

  if (total > items.length && items.length < maxItems) {
    const totalPages = Math.ceil(total / pageSize);
    const maxPages = Math.ceil(maxItems / pageSize);
    const pagesToFetch = [];
    for (let p = 2; p <= Math.min(totalPages, maxPages); p += 1) {
      pagesToFetch.push(p);
    }

    const fetchPage = async (p) => {
      try {
        const result = await searchVetMedicines({ ...query, page: p });
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

  const headers = ["제품명", "제품영문명", "업체명", "품목코드", "허가번호", "품목구분", "허가일", "비고"];
  const lines = [
    headers.map((label) => `"${label.replaceAll('"', '""')}"`).join(",")
  ];

  items.forEach((item) => {
    const rowData = [
      item.itemName,
      item.itemEngName,
      item.entpName,
      item.productCode,
      item.permitNumber,
      item.itemCategory,
      item.permitDate,
      item.note
    ].map((val) => `"${String(val ?? "").replaceAll('"', '""')}"`);
    lines.push(rowData.join(","));
  });

  return "\ufeff" + lines.join("\r\n");
}

async function generateAquaticCsv(query) {
  const firstPage = await searchAquaticMedicines({ ...query, page: 1 });
  const total = firstPage.total || 0;
  let items = [...(firstPage.items || [])];
  const maxItems = 1000;
  const pageSize = firstPage.pageSize || 10;

  if (total > items.length && items.length < maxItems) {
    const totalPages = Math.ceil(total / pageSize);
    const maxPages = Math.ceil(maxItems / pageSize);
    const pagesToFetch = [];
    for (let p = 2; p <= Math.min(totalPages, maxPages); p += 1) {
      pagesToFetch.push(p);
    }

    const fetchPage = async (p) => {
      try {
        const result = await searchAquaticMedicines({ ...query, page: p });
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

  const headers = ["허가번호", "제품명", "업체명", "제형", "투여경로", "최초허가일", "최종허가일", "허가조건", "비고"];
  const lines = [
    headers.map((label) => `"${label.replaceAll('"', '""')}"`).join(",")
  ];

  items.forEach((item) => {
    const rowData = [
      item.permitNumber,
      item.itemName,
      item.entpName,
      item.dosageForm,
      item.route,
      item.firstPermitDate,
      item.permitDate,
      item.condition,
      item.note
    ].map((val) => `"${String(val ?? "").replaceAll('"', '""')}"`);
    lines.push(rowData.join(","));
  });

  return "\ufeff" + lines.join("\r\n");
}

module.exports = {
  searchVetMedicines,
  searchAquaticMedicines,
  getPublicMedicineDetail,
  generateVetCsv,
  generateAquaticCsv
};
