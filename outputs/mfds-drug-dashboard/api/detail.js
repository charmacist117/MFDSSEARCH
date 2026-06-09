const fs = require("fs");
const path = require("path");

const DATA_FILES = [
  path.join(__dirname, "..", "data", "drugs.json"),
  path.join(__dirname, "..", "data", "drugs.sample.json")
];

function loadData() {
  const file = DATA_FILES.find((candidate) => fs.existsSync(candidate));
  if (!file) return [];
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

module.exports = async function handler(req, res) {
  const itemSeq = String(req.query.itemSeq || "");
  const drug = loadData().find((item) => item.itemSeq === itemSeq);

  if (!drug) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  res.status(200).json(drug);
};
