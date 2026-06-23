import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { searchMfds } = require("../lib/mfds.js");

async function run() {
  try {
    const query = {
      ingredient1: "아르기닌",
      itemCategory: "A0",
      cancelStatus: "0",
      etcOtc: "01",
      makeMaterial: "01",
      contractManufacturer: "$",
      exportOnlyMode: "include"
    };
    console.log("Searching with query:", query);
    const res = await searchMfds(query);
    console.log("Total found:", res.total);
    console.log("Items:");
    for (const item of res.items) {
      console.log(`- ${item.itemName} (${item.itemSeq}) [Company: ${item.entpName}] -> Contract: "${item.contractManufacturer}"`);
    }
  } catch (err) {
    console.error(err);
  }
}
run();
