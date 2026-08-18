const { getOpenApiStatus } = require("../lib/openapi-status");

module.exports = function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(200).json(getOpenApiStatus());
};
