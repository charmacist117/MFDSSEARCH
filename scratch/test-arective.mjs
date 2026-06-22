import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { fetchMfdsText, parseDetailHtml } = require("../lib/mfds.js");

// Let's implement the modified parseDetailHtml and extractSection here to test:
function findElementIdIndex(html, id, fromIndex = 0) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\bid\\s*=\\s*(['"])${escaped}\\1`, "i");
  const match = pattern.exec(String(html || "").slice(fromIndex));
  return match ? fromIndex + match.index : -1;
}

function extractElementById(html, id) {
  const idIndex = findElementIdIndex(html, id);
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

function extractSectionModified(html, id, nextId) {
  const start = findElementIdIndex(html, id);
  if (start < 0) return "";
  const elementStart = html.lastIndexOf("<div", start);
  
  // If it is scroll_01, do NOT return exactElement because basic info is in the sibling r_sec div.
  if (id !== "scroll_01") {
    const exactElement = extractElementById(html, id);
    if (exactElement) return exactElement;
  }
  
  const next = nextId ? findElementIdIndex(html, nextId, start + 1) : -1;
  if (next > 0) return html.slice(elementStart, html.lastIndexOf("<div", next));
  return html.slice(elementStart);
}

// Helper functions from mfds.js to make parseDetailHtml work:
const {
  parseKeyValueRows,
  parseIngredients,
  parseUnitDose,
  parseAdditives,
  parseDur,
  firstValue
} = require("../lib/mfds.js");

function parseDetailHtmlModified(html, sourceUrl = "") {
  const basicSection = extractSectionModified(html, "scroll_01", "scroll_02");
  const ingredientSection = extractSectionModified(html, "scroll_02", "scroll_03");
  const durSection = extractSectionModified(html, "scroll_06", "scroll_07");
  const extraSection = extractSectionModified(html, "scroll_07");
  
  // Let's print out what basicSection contains
  console.log("--- Modified basicSection length:", basicSection.length);
  
  const basic = parseKeyValueRows(basicSection);
  const extra = parseKeyValueRows(extraSection);
  const ingredients = parseIngredients(ingredientSection);
  const title = (html.match(/<h1\b[^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>[\s\S]*?<\/h1>/i) || [])[1];

  return {
    itemSeq: basic["품목기준코드"] || (sourceUrl.match(/itemSeq=(\d+)/) || [])[1] || "",
    itemName: basic["제품명"] || title,
    entpName: basic["업체명"] || "",
    contractManufacturer: basic["위탁제조업체"] || "",
    permitDate: basic["허가일"] || "",
    basicKeys: Object.keys(basic)
  };
}

async function run() {
  try {
    const itemSeq = "202500512";
    const url = `https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=${itemSeq}`;
    const result = await fetchMfdsText(url);
    const html = result.text;
    
    console.log("Parsing with modified parser...");
    const parsed = parseDetailHtmlModified(html, url);
    console.log("Parsed result:", parsed);
  } catch (err) {
    console.error(err);
  }
}
run();
