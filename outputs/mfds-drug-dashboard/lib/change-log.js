const fs = require("node:fs");
const path = require("node:path");

const CATEGORY_LABELS = {
  human: "인체용 의약품",
  vet: "동물용 의약품",
  aquatic: "수산동물용 의약품"
};

const CHANGE_LABELS = {
  added: "신규 등록",
  removed: "취하·만료"
};

function dataRoot() {
  return process.env.CHANGELOG_DATA_DIR || path.resolve(__dirname, "..", "data");
}

function changeLogPath() {
  return path.join(dataRoot(), "change-log.json");
}

function emptyLog() {
  return {
    updatedAt: "",
    changes: {
      human: [],
      vet: [],
      aquatic: []
    }
  };
}

function readChangeLog() {
  try {
    const parsed = JSON.parse(fs.readFileSync(changeLogPath(), "utf8"));
    return {
      ...emptyLog(),
      ...parsed,
      changes: {
        ...emptyLog().changes,
        ...(parsed.changes || {})
      }
    };
  } catch {
    return emptyLog();
  }
}

function changesForCategory(category = "human") {
  const key = CATEGORY_LABELS[category] ? category : "human";
  const log = readChangeLog();
  const changes = [...(log.changes[key] || [])].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return {
    category: key,
    label: CATEGORY_LABELS[key],
    updatedAt: log.updatedAt || "",
    changes,
    added: changes.filter((item) => item.type === "added"),
    removed: changes.filter((item) => item.type === "removed")
  };
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function changesCsv(category = "human") {
  const payload = changesForCategory(category);
  const rows = [
    ["일자", "카테고리", "변동구분", "제품ID", "제품명", "업체명", "상태", "비고"],
    ...payload.changes.map((item) => [
      item.date || "",
      payload.label,
      CHANGE_LABELS[item.type] || item.type || "",
      item.id || "",
      item.name || "",
      item.company || "",
      item.status || "",
      item.note || ""
    ])
  ];
  return `\ufeff${rows.map((row) => row.map(csvValue).join(",")).join("\r\n")}`;
}

module.exports = {
  CATEGORY_LABELS,
  CHANGE_LABELS,
  readChangeLog,
  changesForCategory,
  changesCsv
};
