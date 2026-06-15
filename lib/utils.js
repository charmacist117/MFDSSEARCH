/**
 * Shared utility helpers for the MFDS search drug dashboard.
 */

// 1. Basic value coercion
function valueOf(value) {
  if (Array.isArray(value)) return value[0] || "";
  return value == null ? "" : String(value);
}

// 2. Delay promise wrapper
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 3. Retry checker for API fetches
function isRetriableFetchError(error) {
  if (error?.status && error?.status >= 400 && error?.status < 500) {
    return false; // Do not retry client errors (400-499)
  }
  return true; // Retry network/server/timeout errors
}

// 4. HTML entity decoding
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
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return "";
  });
}

// 5. Script, style, and comment tag stripping
function stripScripts(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

// 6. HTML to plain text converter
function textFromHtml(html) {
  return decodeEntities(stripScripts(html)
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

// 7. General text normalize helper
function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// 8. Text inclusion helper with optional whitespace stripping
function includesText(source, query, stripAllSpaces = false) {
  if (stripAllSpaces) {
    const needle = String(query || "").replace(/\s+/g, "").toLowerCase();
    if (!needle) return true;
    return String(source || "").replace(/\s+/g, "").toLowerCase().includes(needle);
  } else {
    const needle = normalizeText(query);
    if (!needle) return true;
    return normalizeText(source).includes(needle);
  }
}

// 9. Concurrency mapping wrapper
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

// 10. Memory Cache Manager with TTL and limit
class MemoryCache {
  constructor(limit, ttlMs) {
    this.cache = new Map();
    this.limit = limit;
    this.ttlMs = ttlMs;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value) {
    if (this.cache.size >= this.limit) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, { createdAt: Date.now(), value });
    return value;
  }
}

module.exports = {
  valueOf,
  delay,
  isRetriableFetchError,
  decodeEntities,
  stripScripts,
  textFromHtml,
  normalizeText,
  includesText,
  mapConcurrent,
  MemoryCache
};
