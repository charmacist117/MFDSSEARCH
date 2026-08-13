const { getMfdsDetail } = require("../lib/mfds");

module.exports = async function handler(req, res) {
  const itemSeq = String(req.query?.itemSeq || "");
  const refresh = String(req.query?.refresh || "") === "1";
  try {
    const payload = await getMfdsDetail(itemSeq, { refresh, retries: refresh ? 3 : 2, timeoutMs: 15000 });
    res.setHeader("Cache-Control", refresh ? "no-store" : "s-maxage=900, stale-while-revalidate=3600");
    res.status(200).json(payload);
  } catch (error) {
    console.error("Detail API Failure:", error);
    const detailMsg = error.cause ? `${error.message} (cause: ${error.cause.message || error.cause})` : error.message;
    res.status(200).json({
      itemSeq,
      error: "mfds_detail_failed",
      detailError: `상세 원문을 가져오지 못했습니다: ${detailMsg}`,
      sourceUrl: itemSeq ? `https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=${encodeURIComponent(itemSeq)}` : ""
    });
  }
};
