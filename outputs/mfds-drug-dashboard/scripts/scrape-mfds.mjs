import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://nedrug.mfds.go.kr";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const defaultCriteria = {
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

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, retries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
          "cache-control": "no-cache"
        },
        redirect: "follow"
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return {
        url: response.url,
        text: await response.text()
      };
    } catch (error) {
      lastError = error;
      await sleep(800 * attempt);
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

function cleanText(html) {
  return textFromHtml(html).replace(/\s+/g, " ").trim();
}

function extractSection(html, id, nextId) {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return "";
  const elementStart = html.lastIndexOf("<div", start);
  const next = nextId ? html.indexOf(`id="${nextId}"`, start + 1) : -1;
  if (next > 0) {
    return html.slice(elementStart, html.lastIndexOf("<div", next));
  }
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

function parseCells(rowHtml) {
  const cells = [];
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let match;
  while ((match = cellRe.exec(rowHtml))) {
    const value = cleanText(match[1])
      .replace(/^(제품명|성상|모양|업체명|업체명\(영문\)|위탁제조업체|전문\/일반|허가일|품목기준코드|표준코드|허가심사유형|기타식별표시|저장방법|사용기간|재심사대상|RMP대상|포장정보|보험약가|ATC코드)\s+/, "$1 ");
    cells.push(value);
  }
  return cells;
}

function parseTableRows(tableHtml) {
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowRe.exec(tableHtml))) {
    const cells = parseCells(match[1]).filter((cell) => cell !== "");
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function parseTables(sectionHtml) {
  const tables = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let match;
  while ((match = tableRe.exec(sectionHtml))) {
    tables.push(parseTableRows(match[0]));
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

function parseList(html) {
  const tbodyStart = html.indexOf("<tbody");
  const tbodyEnd = html.indexOf("</tbody>", tbodyStart);
  const tbody = tbodyStart >= 0 && tbodyEnd > tbodyStart ? html.slice(tbodyStart, tbodyEnd) : html;
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;

  while ((match = rowRe.exec(tbody))) {
    const rowHtml = match[1];
    const href = rowHtml.match(/getItemDetail\?itemSeq=(\d+)/);
    if (!href) continue;
    const itemSeq = href[1];
    const anchor = rowHtml.match(/<a\b[^>]*getItemDetail\?itemSeq=\d+[^>]*>([\s\S]*?)<\/a>/i);
    const pairs = {};
    const pairRe = /<span[^>]*class="[^"]*s-th[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/gi;
    let pair;
    while ((pair = pairRe.exec(rowHtml))) {
      const label = cleanText(pair[1]).replace(/\s+/g, "");
      const value = cleanText(pair[2]);
      if (label) pairs[label] = value;
    }

    rows.push({
      itemSeq,
      itemName: anchor ? cleanText(anchor[1]) : pairs["제품명"],
      itemEngName: pairs["제품영문명"],
      entpName: pairs["업체명"],
      entpEngName: pairs["업체명(영문)"],
      permitDate: pairs["허가일"],
      itemCategory: pairs["품목구분"],
      cancelStatus: pairs["취소/취하구분"] || pairs["취소/취하"],
      cancelDate: pairs["취소/취하일자"],
      mainIngredient: pairs["주성분"] || pairs["주성분/주원료"],
      mainIngredientEng: pairs["주성분영문명"],
      additives: pairs["첨가제"] ? pairs["첨가제"].split(/\s*,\s*/).filter(Boolean) : [],
      etcOtc: pairs["전문의약품"],
      makeMaterial: pairs["완제/원료구분"],
      standardCode: pairs["표준코드"],
      atcCode: pairs["ATC코드"]
    });
  }

  return rows;
}

function parseIngredients(sectionHtml) {
  const ingredients = [];
  const headingRe = /<h3\b[^>]*class="[^"]*cont_title3[^"]*"[^>]*>([\s\S]*?)<\/h3>/gi;
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
  const text = cleanText(sectionHtml);
  const match = text.match(/첨가제\s*:\s*([^|]+)/) || text.match(/첨가제\s*:\s*(.+)$/);
  if (!match) return [];
  return match[1]
    .split(/\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDur(sectionHtml) {
  const labels = {
    "단일/복합": "composition",
    "DUR성분(성분1/성분2..[병용성분])": "ingredient",
    "DUR성분": "ingredient",
    "DUR유형": "type",
    "제형": "dosageForm",
    "금기및주의내용": "caution",
    "금기 및 주의내용": "caution",
    "비고": "note"
  };
  const records = [];
  for (const table of parseTables(sectionHtml)) {
    for (const row of table) {
      if (row.includes("DUR유형") || row.length < 2) continue;
      const record = {};
      for (let i = 0; i < row.length - 1; i += 2) {
        const rawLabel = row[i].replace(/\s+/g, "");
        const key = labels[rawLabel] || labels[row[i]];
        if (key) record[key] = row[i + 1];
      }
      if (!record.type && row.length >= 6) {
        Object.assign(record, {
          composition: row[0],
          ingredient: row[1],
          type: row[2],
          dosageForm: row[3],
          caution: row[4],
          note: row[5]
        });
      }
      if (record.ingredient || record.type) records.push(record);
    }
  }
  return records;
}

function parsePerformance(sectionHtml) {
  const sectionText = cleanText(sectionHtml);
  const type = sectionText.includes("수입실적") ? "수입실적" : sectionText.includes("생산실적") ? "생산실적" : "";
  if (!type) return null;
  const unitMatch = sectionText.match(new RegExp(`${type}\\s*\\((단위\\s*:\\s*[^)]+)\\)`));
  const rows = [];

  for (const table of parseTables(sectionHtml)) {
    const header = table[0]?.join(" ");
    if (!header || !header.includes("년도") || !header.includes(type)) continue;
    for (const row of table.slice(1)) {
      if (/^\d{4}$/.test(row[0] || "") && row[1]) {
        rows.push({ year: row[0], amount: row[1] });
      }
    }
  }

  return rows.length ? { type, unit: unitMatch?.[1] || "", rows } : null;
}

function parseDetail(html, sourceUrl = "") {
  const basicSection = extractSection(html, "scroll_01", "scroll_02");
  const ingredientSection = extractSection(html, "scroll_02", "scroll_03");
  const durSection = extractSection(html, "scroll_06", "scroll_07");
  const extraSection = extractSection(html, "scroll_07");
  const basic = parseKeyValueRows(basicSection);
  const extra = parseKeyValueRows(extraSection);
  const ingredients = parseIngredients(ingredientSection);
  const additives = parseAdditives(ingredientSection);
  const performance = parsePerformance(extraSection);
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
    mainIngredient: ingredients.map((item) => item.name).join("/"),
    mainIngredientEng: "",
    ingredients,
    additives,
    efficacy: textFromHtml(extractElementById(html, "_ee_doc")),
    dosage: textFromHtml(extractElementById(html, "_ud_doc")),
    precautions: textFromHtml(extractElementById(html, "_nb_doc")),
    dur: parseDur(durSection),
    storage: extra["저장방법"] || "",
    validTerm: extra["사용기간"] || "",
    reexamination: extra["재심사대상"] || "",
    rmp: extra["RMP대상"] || "",
    packageInfo: extra["포장정보"] || "",
    insurancePrice: extra["보험약가"] || "",
    atcCode: extra["ATC코드"] || "",
    performance,
    sourceUrl,
    fetchedAt: new Date().toISOString()
  };
}

function buildSearchUrl(page, overrides = {}) {
  const params = new URLSearchParams({ ...defaultCriteria, ...overrides, page: String(page) });
  return `${BASE_URL}/searchDrug?${params}`;
}

function parsePageRange(value = "1-1") {
  const [start, end = start] = value.split("-").map((item) => Number(item));
  return { start, end };
}

async function mapConcurrent(items, concurrency, task) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await task(items[currentIndex], currentIndex);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function collectItemSeqs(args) {
  if (args.itemSeq) {
    return args.itemSeq.split(",").map((item) => item.trim()).filter(Boolean);
  }

  const { start, end } = parsePageRange(args.pages || "1-1");
  const itemSeqs = [];
  for (let page = start; page <= end; page += 1) {
    const { text } = await fetchText(buildSearchUrl(page, args));
    const rows = parseList(text);
    itemSeqs.push(...rows.map((row) => row.itemSeq));
    console.log(`page ${page}: ${rows.length} items`);
    if (args.limit && itemSeqs.length >= Number(args.limit)) break;
  }

  return [...new Set(itemSeqs)].slice(0, args.limit ? Number(args.limit) : undefined);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const itemSeqs = await collectItemSeqs(args);
  const concurrency = Number(args.concurrency || 3);
  console.log(`detail crawl target: ${itemSeqs.length} items`);

  const records = await mapConcurrent(itemSeqs, concurrency, async (itemSeq, index) => {
    const detailUrl = `${BASE_URL}/pbp/CCBBB01/getItemDetail?itemSeq=${encodeURIComponent(itemSeq)}`;
    const { url, text } = await fetchText(detailUrl);
    const record = parseDetail(text, url);
    console.log(`${index + 1}/${itemSeqs.length} ${record.itemSeq} ${record.itemName}`);
    await sleep(Number(args.delay || 250));
    return record;
  });

  const output = path.resolve(root, args.out || "data/drugs.json");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  console.log(`saved ${records.length} records to ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
