const { getMfdsDetail } = require("../lib/mfds");

module.exports = async function handler(req, res) {
  const itemSeq = String(req.query?.itemSeq || "");
  try {
    const payload = await getMfdsDetail(itemSeq);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
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
