import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { searchMfds } = require("../lib/mfds.js");
const { searchVetMedicines, searchAquaticMedicines } = require("../lib/public-medicines.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.CHANGELOG_DATA_DIR || path.join(root, "data");
const snapshotDir = path.join(dataDir, "snapshots");
const changeLogFile = path.join(dataDir, "change-log.json");
const categories = ["human", "vet", "aquatic"];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function todayKst() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function normalize(category, item) {
  if (category === "human") {
    return {
      id: item.itemSeq || "",
      name: item.itemName || "",
      company: item.entpName || "",
      status: item.cancelStatus || "",
      permitDate: item.permitDate || "",
      raw: item
    };
  }
  if (category === "vet") {
    return {
      id: item.detailKey || item.sourceUrl || `${item.itemName}:${item.entpName}:${item.permitDate}`,
      name: item.itemName || "",
      company: item.entpName || "",
      status: item.note || "",
      permitDate: item.permitDate || "",
      raw: item
    };
  }
  return {
    id: item.permitNumber || item.detailKey || `${item.itemName}:${item.entpName}`,
    name: item.itemName || "",
    company: item.entpName || "",
    status: item.condition || item.note || "",
    permitDate: item.permitDate || "",
    raw: item
  };
}

async function mapConcurrent(items, concurrency, task) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function collectCategory(category, { maxPages = 0, concurrency = 4 } = {}) {
  const search =
    category === "human"
      ? searchMfds
      : category === "vet"
        ? searchVetMedicines
        : searchAquaticMedicines;
  const first = await search({ page: 1 });
  const totalPages = maxPages ? Math.min(first.totalPages || 1, maxPages) : first.totalPages || 1;
  const pageNumbers = Array.from({ length: Math.max(totalPages - 1, 0) }, (_, index) => index + 2);
  const pages = await mapConcurrent(pageNumbers, concurrency, async (page) => {
    try {
      return await search({ page });
    } catch (error) {
      console.warn(`[${category}] page ${page} skipped: ${error.message}`);
      return { items: [] };
    }
  });
  const items = [...(first.items || []), ...pages.flatMap((page) => page.items || [])];
  const unique = new Map();
  for (const item of items.map((entry) => normalize(category, entry))) {
    if (item.id) unique.set(item.id, item);
  }
  return Array.from(unique.values()).sort((a, b) => a.id.localeCompare(b.id));
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function entry(date, category, type, item, note = "") {
  return {
    date,
    category,
    type,
    id: item.id,
    name: item.name,
    company: item.company,
    status: item.status,
    permitDate: item.permitDate,
    note
  };
}

function compareSnapshots(date, category, previous, current) {
  const previousMap = new Map(previous.map((item) => [item.id, item]));
  const currentMap = new Map(current.map((item) => [item.id, item]));
  const added = current.filter((item) => !previousMap.has(item.id)).map((item) => entry(date, category, "added", item));
  const removed = previous.filter((item) => !currentMap.has(item.id)).map((item) => entry(date, category, "removed", item, "전일 스냅샷에는 있었으나 금일 목록에서 확인되지 않음"));
  const canceled = current
    .filter((item) => /취하|만료|취소|폐지/i.test(item.status || "") && !/취하|만료|취소|폐지/i.test(previousMap.get(item.id)?.status || ""))
    .map((item) => entry(date, category, "removed", item, "상태가 취하·만료 계열로 변경됨"));
  return [...added, ...removed, ...canceled];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetCategories = args.category ? args.category.split(",").map((item) => item.trim()).filter(Boolean) : categories;
  const date = args.date || todayKst();
  const maxPages = Number(args.maxPages || process.env.CHANGELOG_MAX_PAGES || 0);
  const concurrency = Number(args.concurrency || process.env.CHANGELOG_CONCURRENCY || 4);
  const log = await readJson(changeLogFile, { updatedAt: "", changes: { human: [], vet: [], aquatic: [] } });

  for (const category of targetCategories) {
    if (!categories.includes(category)) continue;
    console.log(`[${category}] collecting snapshot`);
    const snapshotFile = path.join(snapshotDir, `${category}.json`);
    const previous = await readJson(snapshotFile, { date: "", items: [] });
    const currentItems = await collectCategory(category, { maxPages, concurrency });
    const changes = previous.items?.length ? compareSnapshots(date, category, previous.items, currentItems) : [];
    const existingKeys = new Set((log.changes[category] || []).map((item) => `${item.date}:${item.type}:${item.id}:${item.note || ""}`));
    const uniqueChanges = changes.filter((item) => !existingKeys.has(`${item.date}:${item.type}:${item.id}:${item.note || ""}`));
    log.changes[category] = [...(log.changes[category] || []), ...uniqueChanges];
    await writeJson(snapshotFile, { date, updatedAt: new Date().toISOString(), items: currentItems });
    console.log(`[${category}] items=${currentItems.length}, changes=${uniqueChanges.length}`);
  }

  log.updatedAt = new Date().toISOString();
  await writeJson(changeLogFile, log);
  console.log(`change log saved: ${changeLogFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
