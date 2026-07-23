const { getMfdsDetailsBatch } = require("../lib/mfds");

module.exports = async function handler(req, res) {
  const rawSeqs = String(req.query?.itemSeqs || req.query?.itemSeq || "");
  const itemSeqs = rawSeqs.split(",").map((seq) => seq.trim()).filter(Boolean);

  try {
    const payload = await getMfdsDetailsBatch(itemSeqs, 10, {
      retries: 1,
      timeoutMs: 10000,
      fallbackOnFetchError: false
    });
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({
      error: "mfds_detail_batch_failed",
      message: error.message
    });
  }
};
