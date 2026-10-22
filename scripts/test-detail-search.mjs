import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { searchMfds } = require("../lib/mfds.js");

const products = [
  { seq: "299900001", name: "첫번째정", contract: "", packageInfo: "110정/상자" },
  { seq: "299900002", name: "두번째정", contract: "초당약품공업(주)", packageInfo: "10정/상자" },
  { seq: "299900003", name: "세번째캡슐", contract: "초당약품공업(주)", packageInfo: "10캡슐/상자" }
];

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = new URL(input);
  const seq = url.searchParams.get("itemSeq");
  if (seq) {
    const product = products.find((item) => item.seq === seq);
    assert.ok(product);
    return new Response(`<div id="scroll_01"><table><tr><th>제품명</th><td>${product.name}</td></tr><tr><th>위탁제조업체</th><td>${product.contract}</td></tr></table></div><div id="scroll_02"></div><div id="scroll_07"><table><tr><th>포장정보</th><td>${product.packageInfo}</td></tr></table></div>`, { status: 200 });
  }
  const page = Number(url.searchParams.get("page") || 1);
  const rows = products.slice((page - 1) * 2, page * 2).map((item) => `<tr><td>1</td><td><a href="getItemDetail?itemSeq=${item.seq}">${item.name}</a></td></tr>`).join("");
  return new Response(`<span title="총 3 건"></span><table><tbody>${rows}</tbody></table>`, { status: 200 });
};

try {
  const base = { productName: "정", contractBatchPage: "1" };
  const contractFirst = await searchMfds({ ...base, contractManufacturer: "#" });
  const contractSecond = await searchMfds({ ...base, contractManufacturer: "#", contractBatchPage: "2" });
  assert.deepEqual(contractFirst.items.map((item) => item.itemSeq), ["299900002"]);
  assert.deepEqual(contractSecond.items.map((item) => item.itemSeq), ["299900003"]);
  assert.equal(contractSecond.sourceTotalPages, 2);

  const packageFirst = await searchMfds({ ...base, packageInfo: "10정" });
  assert.deepEqual(packageFirst.items.map((item) => item.itemSeq), ["299900001", "299900002"]);
  assert.equal(packageFirst.incomplete, false);
  const combined = await searchMfds({ ...base, contractManufacturer: "#", packageInfo: "10정" });
  assert.deepEqual(combined.items.map((item) => item.itemSeq), ["299900002"]);
  const capsules = await searchMfds({ ...base, packageInfo: "10캡슐", contractBatchPage: "2" });
  assert.deepEqual(capsules.items.map((item) => item.itemSeq), ["299900003"]);
  console.log("Detail search batch and package filters passed.");
} finally {
  globalThis.fetch = originalFetch;
}
