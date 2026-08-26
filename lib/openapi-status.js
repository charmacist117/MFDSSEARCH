const OFFICIAL_OPEN_API_SERVICES = Object.freeze([
  {
    id: "drug-permit",
    name: "의약품 제품 허가정보",
    provider: "식품의약품안전처",
    serviceCode: "DrugPrdtPrmsnInfoService07",
    baseUrl: "https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService07",
    updateCycle: "실시간",
    role: "제품명·업체명·품목기준코드·단일 성분 검색 우선 경로",
    operations: [
      "getDrugPrdtPrmsnInq07",
      "getDrugPrdtPrmsnDtlInq06",
      "getDrugPrdtMcpnDtlInq07"
    ]
  },
  {
    id: "production-import",
    name: "의약품 생산·수입실적현황",
    provider: "식품의약품안전처",
    serviceCode: "MdcinPrdctnImportAcmsltService02",
    baseUrl: "https://apis.data.go.kr/1471000/MdcinPrdctnImportAcmsltService02",
    updateCycle: "연간",
    role: "공식 생산금액·수입금액·실적연도 연결 대상",
    operations: ["getMdcinPrdctnImportrstList02"]
  }
]);

const SUPPORT_DATA_SOURCES = Object.freeze([
  {
    id: "nedrug-detail",
    name: "의약품안전나라 상세정보",
    provider: "식품의약품안전처",
    serviceCode: "nedrug.mfds.go.kr",
    role: "OpenAPI 미지원 조건·오류 시 자동 대체, 상세정보와 과거 실적 보완",
    status: "active",
    statusLabel: "자동 대체 사용"
  }
]);

function configuredKeyName(env) {
  if (String(env.MFDS_OPENAPI_SERVICE_KEY || "").trim()) return "MFDS_OPENAPI_SERVICE_KEY";
  if (String(env.DATA_GO_KR_SERVICE_KEY || "").trim()) return "DATA_GO_KR_SERVICE_KEY";
  return "MFDS_OPENAPI_SERVICE_KEY";
}

function getOpenApiStatus(env = process.env) {
  const keyEnvironmentVariable = configuredKeyName(env);
  const keyConfigured = Boolean(String(env[keyEnvironmentVariable] || "").trim());
  const serviceStatus = keyConfigured ? "active" : "waiting";
  const services = OFFICIAL_OPEN_API_SERVICES.map((service) => ({
    ...service,
    status: serviceStatus,
    statusLabel: keyConfigured
      ? (service.id === "drug-permit" ? "검색 우선 사용" : "키 등록됨")
      : "연결 대기"
  }));

  return {
    overallStatus: serviceStatus,
    overallStatusLabel: keyConfigured ? "OpenAPI 우선 검색 준비됨" : "기존 검색 자동 사용",
    checkedAt: new Date().toISOString(),
    searchStrategy: {
      mode: keyConfigured ? "openapi-first" : "legacy-only",
      primary: keyConfigured ? "식약처 공식 OpenAPI" : "의약품안전나라 기존 검색",
      fallback: "의약품안전나라 기존 검색",
      fallbackEnabled: true
    },
    key: {
      configured: keyConfigured,
      environmentVariable: keyEnvironmentVariable,
      displayValue: keyConfigured ? "등록됨 (원문 비공개)" : "미설정",
      storage: keyConfigured
        ? (String(env.VERCEL || "").trim() ? "Vercel 환경변수" : "서버 환경변수")
        : "환경변수 미설정"
    },
    summary: {
      activeServiceCount: services.filter((service) => service.status === "active").length,
      registeredServiceCount: services.length,
      operationCount: services.reduce((total, service) => total + service.operations.length, 0),
      supportSourceCount: SUPPORT_DATA_SOURCES.length
    },
    services,
    supportSources: SUPPORT_DATA_SOURCES
  };
}

module.exports = {
  OFFICIAL_OPEN_API_SERVICES,
  SUPPORT_DATA_SOURCES,
  getOpenApiStatus
};
