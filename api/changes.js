const { changesForCategory } = require("../lib/change-log");

module.exports = async function handler(req, res) {
  try {
    const payload = await changesForCategory(req.query?.category || "human");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({
      error: "changes_failed",
      message: error.message
    });
  }
};
