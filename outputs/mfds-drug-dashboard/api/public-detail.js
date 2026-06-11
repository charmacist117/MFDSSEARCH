const { getPublicMedicineDetail } = require("../lib/public-medicines");

module.exports = async function handler(req, res) {
  try {
    const payload = await getPublicMedicineDetail(req.query || {});
    res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate=86400");
    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({
      error: "public_detail_failed",
      message: error.message
    });
  }
};
