const { generateMfdsCsv } = require("../lib/mfds");
const { generateVetCsv, generateAquaticCsv } = require("../lib/public-medicines");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  const { query, cache = {}, category = "human" } = req.body || {};
  try {
    let csvContent;
    if (category === "vet") {
      csvContent = await generateVetCsv(query);
    } else if (category === "aquatic") {
      csvContent = await generateAquaticCsv(query);
    } else {
      csvContent = await generateMfdsCsv(query, cache);
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Content-Disposition", `attachment; filename=export-${category}.csv`);
    res.status(200).send(csvContent);
  } catch (error) {
    console.error("CSV Generation Failure:", error);
    res.status(502).json({ error: "mfds_csv_failed", message: error.message });
  }
};
