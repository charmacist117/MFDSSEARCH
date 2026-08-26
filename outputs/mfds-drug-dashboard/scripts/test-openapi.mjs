import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildOpenApiSearchRequest,
  normalizeServiceKey,
  openApiSearchEligibility,
  searchMfdsOpenApi
} = require("../lib/mfds-openapi.js");

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "https://apis.data.go.kr/mock",
    text: async () => JSON.stringify(payload)
  };
}

function searchHtml({ itemSeq = "202600001", itemName = "대체시험정", entpName = "시험제약" } = {}) {
  const cells = Array.from({ length: 26 }, () => "");
  cells[0] = "1";
  cells[1] = `<a href="/pbp/CCBBB01/getItemDetail?itemSeq=${itemSeq}">${itemName}</a>`;
  cells[3] = entpName;
  cells[7] = "2026-01-02";
  cells[8] = "의약품";
  cells[9] = "정상";
  cells[11] = "시험성분(100밀리그램)";
  cells[17] = "일반의약품";
  return `<div title="총 1 건"></div><table><tbody><tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr></tbody></table>`;
}

const originalKey = process.env.MFDS_OPENAPI_SERVICE_KEY;
const originalFallbackKey = process.env.DATA_GO_KR_SERVICE_KEY;
const originalFetch = global.fetch;

try {
  assert.equal(normalizeServiceKey("abc%2Fdef%3D"), "abc/def=");
  assert.equal(openApiSearchEligibility({ productName: "테스트" }, { serviceKey: "" }).reason, "key_missing");
  assert.equal(openApiSearchEligibility({ productName: "테스트" }, { serviceKey: "key" }).eligible, true);
  assert.equal(
    openApiSearchEligibility(
      { productName: "테스트", openApiTimeoutMs: "4000", csvLimit: "1000", maxItems: "1000" },
      { serviceKey: "key" }
    ).eligible,
    true
  );
  assert.deepEqual(
    openApiSearchEligibility({ contractManufacturer: "위탁사" }, { serviceKey: "key" }).unsupportedFields,
    ["contractManufacturer"]
  );

  const request = buildOpenApiSearchRequest(
    { ingredient1: "이부프로펜", page: "2" },
    { serviceKey: "abc%2Fdef%3D" }
  );
  assert.match(request.url, /getDrugPrdtPrmsnDtlInq06/);
  assert.equal(new URL(request.url).searchParams.get("main_item_ingr"), "이부프로펜");
  assert.equal(new URL(request.url).searchParams.get("serviceKey"), "abc/def=");
  assert.doesNotMatch(request.safeUrl, /abc(?:%2F|\/)def/);

  const apiPayload = {
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE" },
      body: {
        pageNo: 1,
        numOfRows: 15,
        totalCount: 1,
        items: [{
          ITEM_SEQ: "202600123",
          ITEM_NAME: "오픈에이피아이시험정",
          ENTP_NAME: "공식제약",
          ITEM_PERMIT_DATE: "20260825",
          MAIN_ITEM_INGR: "시험성분(100밀리그램)",
          ETC_OTC_CODE: "일반의약품",
          ATC_CODE: "A01AA"
        }]
      }
    }
  };
  const apiResult = await searchMfdsOpenApi(
    { productName: "오픈에이피아이", page: "1" },
    { serviceKey: "test-key", fetchImpl: async () => jsonResponse(apiPayload), bypassCache: true }
  );
  assert.equal(apiResult.dataSource, "mfds-openapi");
  assert.equal(apiResult.items[0].itemSeq, "202600123");
  assert.equal(apiResult.items[0].permitDate, "2026-08-25");
  assert.equal(apiResult.items[0].mainIngredient, "시험성분(100밀리그램)");
  assert.doesNotMatch(apiResult.sourceUrl, /test-key/);

  process.env.MFDS_OPENAPI_SERVICE_KEY = "integration-test-key";
  delete process.env.DATA_GO_KR_SERVICE_KEY;
  global.fetch = async (url) => {
    const target = String(url);
    if (target.includes("apis.data.go.kr")) return jsonResponse(apiPayload);
    throw new Error(`Unexpected URL: ${target}`);
  };
  const { searchMfds } = require("../lib/mfds.js");
  const integratedApiResult = await searchMfds({ productName: "오픈에이피아이", page: "1" });
  assert.equal(integratedApiResult.dataSource, "mfds-openapi");
  assert.equal(integratedApiResult.openApiAttempted, true);

  global.fetch = async (url) => {
    const target = String(url);
    if (target.includes("apis.data.go.kr")) return jsonResponse({ error: "temporary" }, 503);
    if (target.includes("nedrug.mfds.go.kr/searchDrug")) {
      return {
        ok: true,
        status: 200,
        url: target,
        text: async () => searchHtml({ itemName: "대체시험정" })
      };
    }
    return jsonResponse({ error: "not found" }, 404);
  };
  const fallbackResult = await searchMfds({ productName: "대체시험", page: "1", retries: "1" });
  assert.equal(fallbackResult.dataSource, "nedrug");
  assert.equal(fallbackResult.fallbackUsed, true);
  assert.equal(fallbackResult.openApiAttempted, true);
  assert.match(fallbackResult.notice, /자동 전환/);
  assert.equal(fallbackResult.items[0].itemName, "대체시험정");

  const contractResult = await searchMfds({
    contractManufacturer: "위탁사",
    page: "1",
    retries: "1",
    contractScanPages: "1",
    contractCandidateLimit: "1",
    detailRetries: "1",
    detailTimeoutMs: "1000",
    detailFallback: "0"
  });
  assert.equal(contractResult.dataSource, "nedrug");
  assert.equal(contractResult.totalPages, 1);

  const mfdsSource = fs.readFileSync(new URL("../lib/mfds.js", import.meta.url), "utf8");
  assert.match(mfdsSource, /const\s+nativeTotalPages\s*=\s*firstPage\.parsed\.total/);
  assert.match(mfdsSource, /const\s+scannedTotalPages\s*=\s*nativeTotalPages/);
  assert.match(mfdsSource, /defaultScanPages\s*=\s*nativeTotalPages\s*<=\s*12\s*\?\s*nativeTotalPages\s*:\s*3/);

  const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /maybeAutoLoadHumanResults/);
  assert.match(appSource, /검색 조건을 입력하고 검색 버튼을 눌러주세요/);
  assert.match(appSource, /contractCandidateLimit",\s*"15"/);
  assert.match(mfdsSource, /sort:\s*requestedSort\s*\|\|\s*"ITEM_PERMIT_DATE"/);
} finally {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.MFDS_OPENAPI_SERVICE_KEY;
  else process.env.MFDS_OPENAPI_SERVICE_KEY = originalKey;
  if (originalFallbackKey === undefined) delete process.env.DATA_GO_KR_SERVICE_KEY;
  else process.env.DATA_GO_KR_SERVICE_KEY = originalFallbackKey;
}

console.log("OpenAPI priority and fallback tests passed");
