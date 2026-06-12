const { changesForCategory } = require("../lib/change-log");

module.exports = async function handler(req, res) {
  try {
    const payload = changesForCategory(req.query?.category || "human");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=1800");
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({
      error: "changes_failed",
      message: error.message
    });
  }
};
