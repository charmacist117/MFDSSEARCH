import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { searchMfds } = require("../lib/mfds.js");

async function run() {
  const res = await searchMfds({ productName: "타이레놀" });
  console.log("Total:", res.total);
  console.log("Items:", res.items.map(i => ({ name: i.itemName, seq: i.itemSeq })));
}
run();
