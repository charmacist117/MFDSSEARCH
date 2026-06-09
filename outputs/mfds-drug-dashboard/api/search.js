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

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function includes(source, query) {
  if (!query) return true;
  return normalize(source).includes(normalize(query));
}

function matchTerms(source, query, operator = "AND") {
  const terms = normalize(query)
    .split(/[,\s]+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (!terms.length) return true;
  const text = normalize(source);
  return operator === "OR"
    ? terms.some((term) => text.includes(term))
    : terms.every((term) => text.includes(term));
}

module.exports = async function handler(req, res) {
  const query = req.query || {};
  const data = loadData();
  const filtered = data.filter((drug) => {
    const ingredients = [
      drug.mainIngredient,
      drug.mainIngredientEng,
      ...(drug.ingredients || []).map((item) => `${item.name || ""} ${item.engName || ""}`)
    ].join(" ");

    return (
      includes(drug.itemName, query.productName) &&
      includes(drug.itemEngName, query.productEngName) &&
      includes(drug.entpName, query.companyName) &&
      includes(drug.entpEngName, query.companyEngName) &&
      includes(drug.itemSeq, query.itemSeq) &&
      includes(drug.standardCode, query.standardCode) &&
      includes(drug.atcCode, query.atcCode) &&
      matchTerms(ingredients, query.ingredient1) &&
      matchTerms(ingredients, query.ingredient2) &&
      matchTerms(ingredients, query.ingredient3) &&
      matchTerms(ingredients, query.ingredientEngName) &&
      includes(drug.itemCategory, query.itemCategory) &&
      includes(drug.cancelStatus, query.cancelStatus) &&
      includes(drug.etcOtc, query.etcOtc) &&
      includes(drug.makeMaterial, query.makeMaterial) &&
      matchTerms(drug.efficacy, query.efficacyQuery, query.efficacyOperator) &&
      matchTerms(drug.dosage, query.dosageQuery, query.dosageOperator) &&
      matchTerms(drug.precautions, query.precautionQuery, query.precautionOperator)
    );
  });

  const limit = Math.min(Number(query.limit || 100), 1000);
  const offset = Math.max(Number(query.offset || 0), 0);
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  res.status(200).json({
    total: filtered.length,
    items: filtered.slice(offset, offset + limit)
  });
};
