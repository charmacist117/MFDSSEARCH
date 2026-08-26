const { decodeEntities, textFromHtml, valueOf, MemoryCache } = require("./utils");

const OPEN_API_BASE_URL = "https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService07";
const OPEN_API_LIST_OPERATION = "getDrugPrdtPrmsnInq07";
const OPEN_API_DETAIL_OPERATION = "getDrugPrdtPrmsnDtlInq06";
const OPEN_API_CACHE_TTL_MS = 5 * 60 * 1000;
const OPEN_API_CACHE_LIMIT = 100;
const openApiSearchCache = new MemoryCache(OPEN_API_CACHE_LIMIT, OPEN_API_CACHE_TTL_MS);

const OPEN_API_QUERY_FIELDS = new Set([
  "productName",
  "companyName",
  "itemSeq",
  "ingredient1"
]);

const OPEN_API_IGNORED_FIELDS = new Set([
  "_v",
  "_global",
  "page",
  "timeoutMs",
  "openApiTimeoutMs",
  "retries",
  "fastFail",
  "detailTimeoutMs",
  "detailRetries",
  "detailConcurrency",
  "csvLimit",
  "maxItems",
  "presenceScanPages",
  "contractScanPages",
  "contractCandidateLimit",
  "detailCandidateLimit",
  "contractBudgetMs",
  "efficacyOperator",
  "dosageOperator",
  "precautionOperator"
]);

class MfdsOpenApiError extends Error {
  constructor(message, { code = "OPENAPI_ERROR", status = 0 } = {}) {
    super(message);
    this.name = "MfdsOpenApiError";
    this.code = code;
    this.status = status;
  }
}

function normalizeServiceKey(value) {
  const key = String(value || "").trim();
  if (!key || !/%[0-9a-f]{2}/i.test(key)) return key;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

function configuredOpenApiKey(env = process.env) {
  return normalizeServiceKey(env.MFDS_OPENAPI_SERVICE_KEY || env.DATA_GO_KR_SERVICE_KEY || "");
}

function isPresenceToken(value) {
  const token = valueOf(value).trim();
  return token === "#" || token === "$";
}

function normalValue(value) {
  return isPresenceToken(value) ? "" : valueOf(value).trim();
}

function openApiSearchEligibility(query = {}, options = {}) {
  const serviceKey = normalizeServiceKey(options.serviceKey || configuredOpenApiKey(options.env));
  if (!serviceKey) {
    return { eligible: false, reason: "key_missing", serviceKey: "", unsupportedFields: [] };
  }

  const unsupportedFields = [];
  for (const [field, rawValue] of Object.entries(query || {})) {
    const value = valueOf(rawValue).trim();
    if (!value || OPEN_API_IGNORED_FIELDS.has(field)) continue;
    if (field === "exportOnlyMode" && value.toLowerCase() === "include") continue;
    if (field === "performanceFilter" && value.toLowerCase() === "all") continue;
    if (OPEN_API_QUERY_FIELDS.has(field) && !isPresenceToken(value)) continue;
    unsupportedFields.push(field);
  }

  return {
    eligible: unsupportedFields.length === 0,
    reason: unsupportedFields.length ? "unsupported_conditions" : "",
    serviceKey,
    unsupportedFields
  };
}

function cleanOpenApiText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(cleanOpenApiText).filter(Boolean).join(" / ");
  if (typeof value === "object") return "";
  const text = decodeEntities(String(value).replace(/<br\s*\/?\s*>/gi, " / "));
  return textFromHtml(text).replace(/\s+/g, " ").trim();
}

function fieldLookup(record = {}) {
  const lookup = new Map();
  Object.entries(record || {}).forEach(([key, value]) => {
    lookup.set(String(key).toLowerCase(), value);
  });
  return (...names) => {
    for (const name of names) {
      const value = lookup.get(String(name).toLowerCase());
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return "";
  };
}

function normalizePermitDate(value) {
  const text = cleanOpenApiText(value);
  const compact = text.replace(/[^0-9]/g, "");
  if (compact.length === 8) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  return text;
}

function hasExportOnlyName(value) {
  return /[\(（]\s*수출용\s*[\)）]/i.test(String(value || ""));
}

function mapOpenApiItem(record, index, { page, pageSize }) {
  const pick = fieldLookup(record);
  const itemSeq = cleanOpenApiText(pick("ITEM_SEQ", "itemSeq", "item_seq"));
  const itemName = cleanOpenApiText(pick("ITEM_NAME", "itemName", "item_name"));
  const cancelDate = normalizePermitDate(pick("CANCEL_DATE", "cancelDate", "cancel_date"));
  const cancelName = cleanOpenApiText(pick("CANCEL_NAME", "cancelName", "cancel_name"));
  const exportOnly = hasExportOnlyName(itemName);

  return {
    rowNumber: String((page - 1) * pageSize + index + 1),
    itemSeq,
    itemName,
    exportOnly,
    tags: exportOnly ? ["수출용"] : [],
    itemEngName: cleanOpenApiText(pick("ITEM_ENG_NAME", "itemEngName", "item_eng_name")),
    entpName: cleanOpenApiText(pick("ENTP_NAME", "entpName", "entp_name")),
    entpEngName: cleanOpenApiText(pick("ENTP_ENG_NAME", "entpEngName", "entp_eng_name")),
    permitNumber: cleanOpenApiText(pick("PERMIT_NO", "PRDLST_PRMSN_NO", "permitNumber")),
    permitDate: normalizePermitDate(pick("ITEM_PERMIT_DATE", "PRDLST_PRMSN_YMD", "itemPermitDate")),
    itemCategory: cleanOpenApiText(pick("GBN_NAME", "INDUTY_CLASS_NAME", "ITEM_CATEGORY", "itemCategory")),
    cancelStatus: cancelName || (cancelDate ? "취소/취하" : "정상"),
    cancelDate,
    mainIngredient: cleanOpenApiText(pick("MAIN_ITEM_INGR", "MATERIAL_NAME", "INGR_NAME", "mainItemIngr")),
    mainIngredientEng: cleanOpenApiText(pick("MAIN_INGR_ENG", "INGR_ENG_NAME", "mainIngredientEng")),
    unitDose: "",
    additives: [],
    itemClass: cleanOpenApiText(pick("CLASS_NAME", "ITEM_CLASS", "itemClass")),
    etcOtc: cleanOpenApiText(pick("ETC_OTC_CODE", "ETC_OTC_NAME", "etcOtcCode")),
    makeMaterial: cleanOpenApiText(pick("MAKE_MATERIAL_FLAG", "MAKE_MATERIAL_NAME", "makeMaterialFlag")),
    approvalType: cleanOpenApiText(pick("PERMIT_KIND_NAME", "approvalType")),
    reviewType: cleanOpenApiText(pick("PERMIT_KIND_NAME", "REVIEW_TYPE", "reviewType")),
    contractManufacturer: cleanOpenApiText(pick("CNSGN_MANUF", "contractManufacturer")),
    manufactureImport: cleanOpenApiText(pick("MANUFACTURE_IMPORT", "INDUTY_TYPE", "manufactureImport")),
    importCountry: cleanOpenApiText(pick("IMPORT_COUNTRY", "importCountry")),
    narcoticType: cleanOpenApiText(pick("NARCOTIC_KIND_CODE", "narcoticType")),
    newDrug: cleanOpenApiText(pick("NEWDRUG_CLASS_NAME", "newDrug")),
    standardCode: cleanOpenApiText(pick("BAR_CODE", "STANDARD_CODE", "standardCode")),
    insuranceCode: cleanOpenApiText(pick("EDI_CODE", "insuranceCode")),
    atcCode: cleanOpenApiText(pick("ATC_CODE", "atcCode")),
    sourceUrl: itemSeq ? `https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=${encodeURIComponent(itemSeq)}` : ""
  };
}

function unwrapOpenApiPayload(payload) {
  const response = payload?.response || payload || {};
  const header = response.header || payload?.header || {};
  const resultCode = String(header.resultCode ?? header.result_code ?? "").trim();
  const resultMessage = String(header.resultMsg ?? header.resultMessage ?? header.result_msg ?? "").trim();
  const normalCodes = new Set(["", "00", "0000", "NORMAL_SERVICE"]);
  if (!normalCodes.has(resultCode.toUpperCase())) {
    throw new MfdsOpenApiError(resultMessage || `공식 OpenAPI 오류 (${resultCode})`, { code: resultCode });
  }

  const body = response.body || payload?.body || {};
  const itemContainer = body.items ?? response.items ?? payload?.items ?? [];
  const rawItems = Array.isArray(itemContainer)
    ? itemContainer
    : Array.isArray(itemContainer?.item)
      ? itemContainer.item
      : itemContainer?.item
        ? [itemContainer.item]
        : [];
  const page = Math.max(Number(body.pageNo ?? body.page_no ?? 1) || 1, 1);
  const pageSize = Math.max(Number(body.numOfRows ?? body.num_of_rows ?? rawItems.length ?? 15) || 15, 1);
  const total = Math.max(Number(body.totalCount ?? body.total_count ?? rawItems.length) || 0, 0);
  return { rawItems, page, pageSize, total };
}

function xmlError(text) {
  const code = String(text || "").match(/<(?:returnReasonCode|resultCode)>\s*([^<]+)\s*<\//i)?.[1] || "";
  const message = String(text || "").match(/<(?:returnAuthMsg|resultMsg)>\s*([^<]+)\s*<\//i)?.[1] || "";
  return { code: cleanOpenApiText(code), message: cleanOpenApiText(message) };
}

async function fetchOpenApiJson(url, { fetchImpl = fetch, timeoutMs = 7000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(Number(timeoutMs) || 7000, 1000));
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      redirect: "follow",
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new MfdsOpenApiError(`공식 OpenAPI HTTP 오류 (${response.status})`, {
        code: `HTTP_${response.status}`,
        status: response.status
      });
    }
    try {
      return JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
      const error = xmlError(text);
      throw new MfdsOpenApiError(error.message || "공식 OpenAPI가 JSON 응답을 반환하지 않았습니다.", {
        code: error.code || "INVALID_RESPONSE"
      });
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new MfdsOpenApiError("공식 OpenAPI 응답 시간이 초과되었습니다.", { code: "TIMEOUT" });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function openApiPageSize(query = {}) {
  return valueOf(query._global) === "1" ? 100 : 15;
}

function buildOpenApiSearchRequest(query = {}, options = {}) {
  const eligibility = openApiSearchEligibility(query, options);
  if (!eligibility.eligible) return { ...eligibility, url: "", safeUrl: "", operation: "" };

  const page = Math.max(Number(valueOf(query.page) || 1), 1);
  const pageSize = openApiPageSize(query);
  const ingredient = normalValue(query.ingredient1);
  const operation = ingredient ? OPEN_API_DETAIL_OPERATION : OPEN_API_LIST_OPERATION;
  const params = new URLSearchParams({
    serviceKey: eligibility.serviceKey,
    pageNo: String(page),
    numOfRows: String(pageSize),
    type: "json"
  });
  const mappings = [
    ["productName", "item_name"],
    ["companyName", "entp_name"],
    ["itemSeq", "item_seq"]
  ];
  mappings.forEach(([queryName, apiName]) => {
    const value = normalValue(query[queryName]);
    if (value) params.set(apiName, value);
  });
  if (ingredient) params.set("main_item_ingr", ingredient);

  const url = `${OPEN_API_BASE_URL}/${operation}?${params}`;
  const safeParams = new URLSearchParams(params);
  safeParams.set("serviceKey", "[REDACTED]");
  return {
    ...eligibility,
    page,
    pageSize,
    operation,
    url,
    safeUrl: `${OPEN_API_BASE_URL}/${operation}?${safeParams}`
  };
}

function openApiCacheKey(query = {}, operation = "") {
  const values = {};
  ["page", "productName", "companyName", "itemSeq", "ingredient1", "_global"].forEach((key) => {
    const value = normalValue(query[key]);
    if (value) values[key] = value;
  });
  return JSON.stringify({ operation, values });
}

function normalizedMatchText(value) {
  return cleanOpenApiText(value).replace(/\s+/g, "").toLowerCase();
}

function openApiItemsMatchQuery(items, query = {}) {
  const checks = [
    ["productName", "itemName", false],
    ["companyName", "entpName", false],
    ["itemSeq", "itemSeq", true],
    ["ingredient1", "mainIngredient", false]
  ].filter(([queryField]) => normalValue(query[queryField]));
  if (!checks.length || !items.length) return true;
  return items.every((item) => checks.every(([queryField, itemField, exact]) => {
    const needle = normalizedMatchText(query[queryField]);
    const haystack = normalizedMatchText(item[itemField]);
    return exact ? haystack === needle : Boolean(haystack && haystack.includes(needle));
  }));
}

async function searchMfdsOpenApi(query = {}, options = {}) {
  const request = buildOpenApiSearchRequest(query, options);
  if (!request.eligible) {
    throw new MfdsOpenApiError("현재 검색 조건은 공식 OpenAPI 우선 조회 대상이 아닙니다.", {
      code: request.reason || "NOT_ELIGIBLE"
    });
  }

  const cacheKey = openApiCacheKey(query, request.operation);
  if (!options.bypassCache) {
    const cached = openApiSearchCache.get(cacheKey);
    if (cached) return cached;
  }

  const payload = await fetchOpenApiJson(request.url, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs || valueOf(query.openApiTimeoutMs) || 7000
  });
  const parsed = unwrapOpenApiPayload(payload);
  const page = parsed.page || request.page;
  const pageSize = parsed.pageSize || request.pageSize;
  const items = parsed.rawItems
    .map((item, index) => mapOpenApiItem(item, index, { page, pageSize }))
    .filter((item) => item.itemSeq || item.itemName);
  const total = parsed.total || items.length;
  if ((parsed.rawItems.length && !items.length) || (total > 0 && !items.length)) {
    throw new MfdsOpenApiError("공식 OpenAPI 응답 필드를 검색 결과로 변환하지 못했습니다.", {
      code: "SCHEMA_MISMATCH"
    });
  }
  if (!openApiItemsMatchQuery(items, query)) {
    throw new MfdsOpenApiError("공식 OpenAPI가 요청한 검색 조건과 일치하지 않는 결과를 반환했습니다.", {
      code: "FILTER_MISMATCH"
    });
  }
  const result = {
    page,
    pageSize,
    total,
    totalPages: total ? Math.ceil(total / pageSize) : 1,
    items,
    notice: "공식 OpenAPI 우선 조회 결과입니다.",
    dataSource: "mfds-openapi",
    dataSourceLabel: "식약처 공식 OpenAPI",
    fallbackUsed: false,
    openApiOperation: request.operation,
    sourceUrl: request.safeUrl
  };
  return openApiSearchCache.set(cacheKey, result);
}

module.exports = {
  OPEN_API_BASE_URL,
  OPEN_API_LIST_OPERATION,
  OPEN_API_DETAIL_OPERATION,
  MfdsOpenApiError,
  configuredOpenApiKey,
  normalizeServiceKey,
  openApiSearchEligibility,
  buildOpenApiSearchRequest,
  unwrapOpenApiPayload,
  mapOpenApiItem,
  openApiItemsMatchQuery,
  searchMfdsOpenApi
};
