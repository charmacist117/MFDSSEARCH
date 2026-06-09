const BASE_URL = "https://nedrug.mfds.go.kr";

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

function valueOf(value) {
  if (Array.isArray(value)) return value[0] || "";
  return value == null ? "" : String(value);
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

async function fetchMfdsText(url, retries = 1) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 26000);
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 MFDS dashboard",
          accept: "text/html,application/xhtml+xml"
        },
        redirect: "follow",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return { url: response.url, text: await response.text() };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function decodeEntities(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " "
  };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, code) => {
    const lower = code.toLowerCase();
    if (named[lower]) return named[lower];
    if (lower.startsWith("#x")) return String.fromCharCode(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCharCode(parseInt(lower.slice(1), 10));
    return "";
  });
}

function stripScripts(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function textFromHtml(html) {
  return decodeEntities(stripScripts(html)
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
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

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function includesText(source, query) {
  const needle = normalizeText(query);
  if (!needle) return true;
  return normalizeText(source).includes(needle);
}

async function mapConcurrent(items, concurrency, task) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await task(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
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

function parseIngredients(sectionHtml) {
  const ingredients = [];
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

async function searchMfds(query = {}) {
  const page = Math.max(Number(valueOf(query.page) || 1), 1);
  const url = buildSearchUrl({ ...query, page });
  const { text } = await fetchMfdsText(url);
  const parsed = parseSearchHtml(text);
  let items = parsed.items;
  let total = parsed.total;
  let notice = "";
  const contractManufacturer = valueOf(query.contractManufacturer);

  if (contractManufacturer) {
    const detailed = await mapConcurrent(items, 3, async (item) => {
      try {
        const detail = await getMfdsDetail(item.itemSeq);
        return { ...item, contractManufacturer: detail.contractManufacturer || "" };
      } catch {
        return item;
      }
    });
    items = detailed.filter((item) => includesText(item.contractManufacturer, contractManufacturer));
    total = items.length;
    notice = "위탁제조업체 검색은 원본 목록 조건에 없어 현재 페이지 상세 확인 기준으로 필터링됩니다. 전체 정확 검색은 상세 수집 DB가 필요합니다.";
  }

  const pageSize = items.length || parsed.items.length || 10;
  return {
    page,
    pageSize,
    total,
    totalPages: total ? Math.ceil(total / pageSize) : 1,
    items,
    notice,
    sourceUrl: url
  };
}

async function getMfdsDetail(itemSeq) {
  if (!itemSeq) throw new Error("itemSeq is required");
  const { url, text } = await fetchMfdsText(`${BASE_URL}/pbp/CCBBB01/getItemDetail?itemSeq=${encodeURIComponent(itemSeq)}`);
  return parseDetailHtml(text, url);
}

module.exports = {
  BASE_URL,
  buildSearchCriteria,
  buildSearchUrl,
  fetchMfdsText,
  parseSearchHtml,
  parseDetailHtml,
  searchMfds,
  getMfdsDetail
};
