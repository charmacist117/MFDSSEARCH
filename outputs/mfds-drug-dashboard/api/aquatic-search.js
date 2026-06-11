const { searchAquaticMedicines } = require("../lib/public-medicines");

module.exports = async function handler(req, res) {
  try {
    const payload = await searchAquaticMedicines(req.query || {});
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=1800");
    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({
      error: "aquatic_search_failed",
      message: error.message
    });
  }
};
