const { fetchMfdsText } = require("./mfds");

const VET_BASE_URL = "https://medi.qia.go.kr/searchMedicine";
const AQUATIC_BASE_URL = "https://www.nfqs.go.kr/apms/search/goodsList.ad";

function valueOf(value) {
  if (Array.isArray(value)) return value[0] || "";
  return value == null ? "" : String(value);
}

function decodeEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, code) => {
    const lower = code.toLowerCase();
    if (named[lower]) return named[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return "";
  });
}

function cleanText(html) {
  return decodeEntities(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim());
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
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(html))) {
    const cells = parseCells(row[1]);
    if (cells.length) rows.push({ html: row[1], cells });
  }
  return rows;
}

function parseTotal(html, fallback) {
  const text = cleanText(html);
  const totalMatch = text.match(/총\s*([\d,]+)\s*건/);
  if (totalMatch) return Number(totalMatch[1].replace(/,/g, ""));
  return fallback;
}

function findDate(cells) {
  return cells.find((cell) => /\d{4}[-.]\d{2}[-.]\d{2}/.test(cell)) || "";
}

function includesText(source, query) {
  const needle = String(query || "").replace(/\s+/g, "").toLowerCase();
  if (!needle) return true;
  return String(source || "").replace(/\s+/g, "").toLowerCase().includes(needle);
}

function buildVetUrl(query = {}) {
  const params = new URLSearchParams({
    csSignature: "/pty5cD24mE8YS6L+3jPAw==",
    sort: "",
    sortOrder: "false",
    searchYn: "true",
    ExcelRowdata: "",
    page: valueOf(query.page) || "1",
    searchDivision: "detail",
    itemName: valueOf(query.productName),
    itemEngName: valueOf(query.productEngName),
    entpName: valueOf(query.companyName),
    indutyClassCode: valueOf(query.itemCategory),
    startPermitDate: valueOf(query.permitStart),
    endPermitDate: valueOf(query.permitEnd)
  });
  return `${VET_BASE_URL}?${params}`;
}

function parseVetHtml(html, sourceUrl) {
  const rows = parseRows(html)
    .filter((row) => row.cells.length >= 4 && !row.cells.join(" ").includes("제품명 업체명"))
    .map((row) => {
      const cells = row.cells;
      const itemName = cells[1] || cells[0] || "";
      const entpName = cells[3] || cells[2] || "";
      return {
        rowNumber: cells[0] || "",
        itemName,
        itemEngName: cells[2] || "",
        entpName,
        itemCategory: cells.find((cell) => /동물|의약|외품|보조/.test(cell)) || "",
        permitDate: findDate(cells),
        note: cells.slice(4).filter(Boolean).join(" / "),
        rawCells: cells,
        sourceUrl
      };
    })
    .filter((item) => item.itemName && item.entpName);

  const total = parseTotal(html, rows.length);
  return { total, items: rows };
}

function buildAquaticUrl(query = {}) {
  const params = new URLSearchParams({
    pageNo: valueOf(query.page) || "1",
    prdlstNm: valueOf(query.productName),
    goodsNm: valueOf(query.productName),
    bsshNm: valueOf(query.companyName),
    entrpsNm: valueOf(query.companyName),
    ingrNm: valueOf(query.ingredientName),
    fishNm: valueOf(query.fishName),
    dissNm: valueOf(query.disease),
    dosageForm: valueOf(query.dosageForm)
  });
  return `${AQUATIC_BASE_URL}?${params}`;
}

function parseAquaticHtml(html, sourceUrl, query = {}) {
  const rows = parseRows(html)
    .filter((row) => {
      const joined = row.cells.join(" ");
      return row.cells.length >= 7 && !joined.includes("허가번호 업체명 제품명");
    })
    .map((row) => {
      const cells = row.cells;
      return {
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
        sourceUrl
      };
    })
    .filter((item) => {
      if (!item.itemName || !item.entpName) return false;
      if (!includesText(item.itemName, valueOf(query.productName))) return false;
      if (!includesText(item.entpName, valueOf(query.companyName))) return false;
      if (!includesText(item.dosageForm, valueOf(query.dosageForm))) return false;
      return true;
    });

  const total = parseTotal(html, rows.length);
  return { total, items: rows };
}

function pagePayload({ page, total, items, sourceUrl, notice = "" }) {
  const pageSize = items.length || 10;
  return {
    page,
    pageSize,
    total,
    totalPages: total ? Math.max(1, Math.ceil(total / pageSize)) : 1,
    items,
    notice,
    sourceUrl
  };
}

async function searchVetMedicines(query = {}) {
  const page = Math.max(Number(valueOf(query.page) || 1), 1);
  const sourceUrl = buildVetUrl({ ...query, page });
  const { text, url } = await fetchMfdsText(sourceUrl, 2, 15000);
  const parsed = parseVetHtml(text, url || sourceUrl);
  return pagePayload({ page, ...parsed, sourceUrl: url || sourceUrl });
}

async function searchAquaticMedicines(query = {}) {
  const page = Math.max(Number(valueOf(query.page) || 1), 1);
  const sourceUrl = buildAquaticUrl({ ...query, page });
  const { text, url } = await fetchMfdsText(sourceUrl, 2, 15000);
  const parsed = parseAquaticHtml(text, url || sourceUrl, query);
  return pagePayload({
    page,
    ...parsed,
    sourceUrl: url || sourceUrl,
    notice: "수산동물용 의약품은 국립수산물품질관리원 약품편람 목록을 기준으로 표시합니다."
  });
}

module.exports = {
  searchVetMedicines,
  searchAquaticMedicines
};
