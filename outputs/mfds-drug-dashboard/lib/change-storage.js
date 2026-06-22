const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const neonStorage = require("./neon-storage");

const DEFAULT_PREFIX = "medicine-change-log";
const DEFAULT_TIMEOUT_MS = 10000;

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) return null;
  return {
    url: url.replace(/\/+$/, ""),
    token,
    prefix: process.env.CHANGELOG_KV_PREFIX || DEFAULT_PREFIX
  };
}

function isKvConfigured() {
  return Boolean(kvConfig());
}

function storageKey(key) {
  const config = kvConfig();
  const cleanKey = String(key || "").replace(/^:+|:+$/g, "");
  if (!config?.prefix) return cleanKey;
  return `${config.prefix}:${cleanKey}`;
}

async function kvCommand(command, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const config = kvConfig();
  if (!config) throw new Error("KV storage is not configured.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(command),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text };
    }
    if (!response.ok || payload.error) {
      throw new Error(payload.error || `KV request failed (${response.status})`);
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

function readJsonFileSync(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonStore(key, file, fallback) {
  if (neonStorage.isNeonConfigured()) {
    try {
      const neonValue = await neonStorage.readJson(key);
      if (neonValue !== undefined && neonValue !== null) return neonValue;
    } catch (error) {
      console.warn(`[change-log] Neon read failed for ${key}: ${error.message}`);
    }
  }
  if (isKvConfigured()) {
    try {
      const raw = await kvCommand(["GET", storageKey(key)]);
      if (raw) return JSON.parse(raw);
    } catch (error) {
      console.warn(`[change-log] KV read failed for ${key}: ${error.message}`);
    }
  }
  return readJsonFile(file, fallback);
}

async function writeJsonStore(key, file, value) {
  await writeJsonFile(file, value);
  if (neonStorage.isNeonConfigured()) {
    await neonStorage.writeJson(key, value);
  }
  if (isKvConfigured()) {
    await kvCommand(["SET", storageKey(key), JSON.stringify(value)]);
  }
}

module.exports = {
  isNeonConfigured: neonStorage.isNeonConfigured,
  isKvConfigured,
  storageKey,
  readJsonFileSync,
  readJsonFile,
  writeJsonFile,
  readJsonStore,
  writeJsonStore
};
