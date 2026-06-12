const { globalSearch } = require("../lib/global-search");

module.exports = async function handler(req, res) {
  try {
    const payload = await globalSearch(req.query || {});
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({
      error: "global_search_failed",
      message: error.message
    });
  }
};
