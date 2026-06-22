import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { getMfdsDetail } = require("../lib/mfds.js");

async function test() {
  try {
    for (const seq of ["202008139", "202500512"]) {
      console.log(`--- Detail for ${seq} ---`);
      const detail = await getMfdsDetail(seq);
      console.log("itemName:", detail.itemName);
      console.log("entpName:", detail.entpName);
      console.log("contractManufacturer:", detail.contractManufacturer);
      console.log("permitDate:", detail.permitDate);
      console.log("itemSeq:", detail.itemSeq);
    }
  } catch (err) {
    console.error(err);
  }
}
test();
