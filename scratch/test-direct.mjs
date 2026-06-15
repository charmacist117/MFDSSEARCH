import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { generateMfdsCsv } = require("../lib/mfds.js");
const { generateVetCsv, generateAquaticCsv } = require("../lib/public-medicines.js");

async function run() {
  console.log("Testing generateMfdsCsv directly...");
  try {
    const start = Date.now();
    const csv = await generateMfdsCsv({ productName: "타이레놀" });
    console.log("Success in", Date.now() - start, "ms");
    console.log("CSV length:", csv.length);
    console.log("CSV snippet:\n", csv.slice(0, 300));
  } catch (err) {
    console.error("Failed:", err);
  }
}
run();
