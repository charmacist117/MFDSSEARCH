import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { getMfdsDetail } = require("../lib/mfds.js");

async function run() {
  const start = Date.now();
  console.log("Fetching detail...");
  try {
    const res = await getMfdsDetail("202005623");
    console.log("Success in", Date.now() - start, "ms");
    console.log("Item Name:", res.itemName);
  } catch (err) {
    console.error("Error:", err);
  }
}
run();
