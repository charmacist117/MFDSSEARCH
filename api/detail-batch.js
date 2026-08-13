const { getMfdsDetailsBatch } = require("../lib/mfds");

module.exports = async function handler(req, res) {
  const rawSeqs = String(req.query?.itemSeqs || req.query?.itemSeq || "");
  const itemSeqs = rawSeqs.split(",").map((seq) => seq.trim()).filter(Boolean);

  try {
    const payload = await getMfdsDetailsBatch(itemSeqs, 5, {
      retries: 2,
      timeoutMs: 12000,
      fallbackOnFetchError: false
    });
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({
      error: "mfds_detail_batch_failed",
      message: error.message
    });
  }
};
