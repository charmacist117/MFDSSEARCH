const { searchMfds, getMfdsDetail } = require("../lib/mfds");

function toCsvValue(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function mergeKeepNonEmpty(base, overlay) {
  const result = { ...base };
  for (const [key, value] of Object.entries(overlay || {})) {
    if (value === "" && result[key] && result[key] !== "") continue;
    result[key] = value;
  }
  return result;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  const { query, cache = {} } = req.body || {};
  try {
    // 1. Fetch first page to get total items
    const firstPage = await searchMfds({ ...query, page: 1 });
    const total = firstPage.total || 0;
    let items = [...(firstPage.items || [])];

    // Limit maximum items to download to prevent server timeout
    const maxItems = 1500; 
    
    // 2. Fetch remaining pages if needed
    const pageSize = firstPage.pageSize || 15;
    if (total > items.length && items.length < maxItems) {
      const totalPages = Math.ceil(total / pageSize);
      const maxPages = Math.ceil(maxItems / pageSize);
      const pagesToFetch = [];
      for (let p = 2; p <= Math.min(totalPages, maxPages); p += 1) {
        pagesToFetch.push(p);
      }

      // Fetch in chunks of concurrency 5
      const fetchPage = async (p) => {
        try {
          const result = await searchMfds({ ...query, page: p });
          return result.items || [];
        } catch {
          return [];
        }
      };

      const concurrency = 5;
      for (let i = 0; i < pagesToFetch.length; i += concurrency) {
        const chunk = pagesToFetch.slice(i, i + concurrency);
        const results = await Promise.all(chunk.map((p) => fetchPage(p)));
        results.forEach((pageItems) => {
          items.push(...pageItems);
        });
      }
    }

    items = items.slice(0, maxItems);

    // 3. Fetch details for first 30 items if not cached to avoid timeout
    const detailedItems = [];
    const concurrencyLimit = 3;

    const fetchDetail = async (item) => {
      const cached = cache[item.itemSeq];
      if (cached && (cached.contractManufacturer || cached.performance)) {
        return mergeKeepNonEmpty(item, cached);
      }
      try {
        const detail = await getMfdsDetail(item.itemSeq);
        return mergeKeepNonEmpty(item, detail);
      } catch {
        return item;
      }
    };

    // Fetch details for up to 30 items
    const targetSubset = items.slice(0, 30);
    for (let i = 0; i < targetSubset.length; i += concurrencyLimit) {
      const chunk = targetSubset.slice(i, i + concurrencyLimit);
      const results = await Promise.all(chunk.map((item) => fetchDetail(item)));
      detailedItems.push(...results);
    }

    // Combine detailed subset and remaining basic items
    const finalItems = [
      ...detailedItems,
      ...items.slice(30).map((item) => {
        const cached = cache[item.itemSeq];
        return cached ? mergeKeepNonEmpty(item, cached) : item;
      })
    ];

    // 4. Collect all unique performance years
    const years = new Set();
    finalItems.forEach((drug) => {
      if (drug.performance?.rows) {
        drug.performance.rows.forEach((r) => {
          if (r.year && /^\d{4}$/.test(r.year)) {
            years.add(Number(r.year));
          }
        });
      }
    });
    const perfYears = Array.from(years).sort((a, b) => a - b);

    // 5. Build CSV
    const headers = [
      ["rowNumber", "순번"],
      ["itemSeq", "품목기준코드"],
      ["itemName", "제품명"],
      ["itemEngName", "제품영문명"],
      ["entpName", "업체명"],
      ["entpEngName", "업체영문명"],
      ["contractManufacturer", "위탁제조업체"],
      ["etcOtc", "전문/일반"],
      ["permitDate", "허가일"],
      ["itemCategory", "품목구분"],
      ["cancelStatus", "취소/취하"],
      ["makeMaterial", "완제/원료"],
      ["mainIngredient", "주성분"],
      ["mainIngredientEng", "주성분영문명"],
      ["additives", "첨가제"],
      ["standardCode", "표준코드"],
      ["atcCode", "ATC코드"]
    ];

    perfYears.forEach((year) => {
      headers.push([`perf_${year}`, `${year}년 실적`]);
    });

    const lines = [
      headers.map(([, label]) => toCsvValue(label)).join(",")
    ];

    finalItems.forEach((drug, index) => {
      const rowNumber = String(index + 1);
      const rowData = headers.map(([key]) => {
        if (key === "rowNumber") return toCsvValue(rowNumber);
        if (key.startsWith("perf_")) {
          const year = Number(key.split("_")[1]);
          const perf = drug.performance;
          if (!perf || !perf.rows || !perf.rows.length) return toCsvValue("-");
          const r = perf.rows.find((item) => Number(item.year) === year);
          if (!r) return toCsvValue("-");
          const unitText = perf.unit || "";
          let symbol = unitText.includes("달러") || unitText.includes("$") ? "$" : "₩";
          let suffix = symbol === "₩" && unitText.includes("천원") ? " (천원)" : "";
          return toCsvValue(`${perf.type}: ${symbol}${r.amount}${suffix}`);
        }
        return toCsvValue(drug[key]);
      });
      lines.push(rowData.join(","));
    });

    // Send CSV response with BOM for Excel Korean support
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=export.csv");
    res.status(200).send("\ufeff" + lines.join("\r\n"));
  } catch (error) {
    console.error("CSV Generation Failure:", error);
    res.status(502).json({ error: "mfds_csv_failed", message: error.message });
  }
};
