const { changesCsv, CATEGORY_LABELS } = require("../lib/change-log");

module.exports = async function handler(req, res) {
  try {
    const category = CATEGORY_LABELS[req.query?.category] ? req.query.category : "human";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=medicine-changes-${category}.csv`);
    res.status(200).send(await changesCsv(category));
  } catch (error) {
    res.status(500).json({
      error: "changes_csv_failed",
      message: error.message
    });
  }
};
