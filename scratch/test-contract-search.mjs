import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { searchMfds } = require("../lib/mfds.js");

async function test() {
  try {
    console.log("Searching with productName: '아렉티브액', contractManufacturer: '경방신약'...");
    const res = await searchMfds({ productName: "아렉티브액", contractManufacturer: "경방신약" });
    console.log("Results found:", res.items.length);
    for (const item of res.items) {
      console.log(`- ${item.itemName} (${item.itemSeq}) [Company: ${item.entpName}] -> Contract: "${item.contractManufacturer}"`);
    }

    console.log("\nSearching with companyName: '제뉴원사이언스', contractManufacturer: '경방신약'...");
    const res2 = await searchMfds({ companyName: "제뉴원사이언스", contractManufacturer: "경방신약" });
    console.log("Results found:", res2.items.length);
    for (const item of res2.items) {
      console.log(`- ${item.itemName} (${item.itemSeq}) [Company: ${item.entpName}] -> Contract: "${item.contractManufacturer}"`);
    }
  } catch (err) {
    console.error(err);
  }
}
test();
