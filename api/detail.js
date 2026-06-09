const { getMfdsDetail } = require("../lib/mfds");

module.exports = async function handler(req, res) {
  try {
    const itemSeq = String(req.query?.itemSeq || "");
    const payload = await getMfdsDetail(itemSeq);
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({
      error: "mfds_detail_failed",
      message: error.message
    });
  }
};
