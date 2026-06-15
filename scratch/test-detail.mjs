import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { getMfdsDetail } = require("../lib/mfds.js");

async function test() {
  console.log("Testing detail API...");
  try {
    const start = Date.now();
    const detail = await getMfdsDetail("202008139");
    console.log("Time taken:", Date.now() - start, "ms");
    console.log("Name:", detail.itemName);
    console.log("Efficacy length:", detail.efficacy?.length);
  } catch (err) {
    console.error("Error:", err);
  }
}
test();
