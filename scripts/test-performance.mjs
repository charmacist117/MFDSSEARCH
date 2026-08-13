import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseDetailHtml } = require("../lib/mfds.js");

function detailHtml(performanceSection) {
  return `
    <h1><strong>실적파서시험정</strong></h1>
    <div id="scroll_01">
      <table><tr><th>제품명</th><td>실적파서시험정</td><th>품목기준코드</th><td>TEST001</td></tr></table>
    </div>
    <div id="scroll_02"></div>
    <div id="scroll_03"></div>
    <div id="scroll_06"></div>
    <div id="scroll_07"></div>
    <div id="scroll_08">${performanceSection}</div>
  `;
}

const imported = parseDetailHtml(detailHtml(`
  <h3>수입실적 <span>(단위 : $)</span></h3>
  <table>
    <thead><tr><th>년도</th><th>수입실적</th></tr></thead>
    <tbody><tr><td>2025</td><td>304,926</td></tr><tr><td>2024</td><td>273,095</td></tr></tbody>
  </table>
`));
assert.equal(imported.performanceChecked, true);
assert.equal(imported.performance.type, "수입실적");
assert.equal(imported.performance.unit, "단위 : $");
assert.deepEqual(imported.performance.rows, [
  { year: "2025", amount: "304,926" },
  { year: "2024", amount: "273,095" }
]);

const shifted = parseDetailHtml(detailHtml(`
  <h3>생산 실적 <span>(단위：천원)</span></h3>
  <table>
    <tr><th>순번</th><th>연도</th><th>비고</th><th>생산 실적</th></tr>
    <tr><td>1</td><td>2025년</td><td>확정</td><td>1,234,567</td></tr>
    <tr><td>2</td><td>2024</td><td>정정 전</td><td>-</td></tr>
    <tr><td>3</td><td>2024</td><td>확정</td><td>765,432</td></tr>
  </table>
`));
assert.equal(shifted.performanceChecked, true);
assert.equal(shifted.performance.type, "생산실적");
assert.equal(shifted.performance.unit, "단위 : 천원");
assert.deepEqual(shifted.performance.rows, [
  { year: "2025", amount: "1,234,567" },
  { year: "2024", amount: "765,432" }
]);

const mixedAmountCells = parseDetailHtml(detailHtml(`
  <h3>생산실적 <span>(단위 : 천원)</span></h3>
  <table>
    <tr><th>연도</th><th>잠정값</th><th>생산실적</th></tr>
    <tr><td>2025</td><td>-</td><td>998,877</td></tr>
  </table>
`));
assert.deepEqual(mixedAmountCells.performance.rows, [{ year: "2025", amount: "998,877" }]);

const amountBeforeYear = parseDetailHtml(detailHtml(`
  <h3>생산실적 <span>(단위 : 천원)</span></h3>
  <table>
    <tr><th>생산실적</th><th>연도</th></tr>
    <tr><td>887,766</td><td>2025</td></tr>
  </table>
`));
assert.deepEqual(amountBeforeYear.performance.rows, [{ year: "2025", amount: "887,766" }]);

const serialBeforeMalformedAmount = parseDetailHtml(detailHtml(`
  <h3>생산실적 <span>(단위 : 천원)</span></h3>
  <table>
    <tr><th>순번</th><th>연도</th><th>생산실적</th></tr>
    <tr><td>1</td><td>2025</td><td>집계 중</td></tr>
  </table>
`));
assert.equal(serialBeforeMalformedAmount.performance, null);
assert.equal(serialBeforeMalformedAmount.performanceChecked, false);

const noPublishedRows = parseDetailHtml(detailHtml(`
  <h3>생산실적 <span>(단위 : 천원)</span></h3>
  <table><tr><th>년도</th><th>생산실적</th></tr><tr><td colspan="2">조회 결과가 없습니다.</td></tr></table>
`));
assert.equal(noPublishedRows.performance, null);
assert.equal(noPublishedRows.performanceChecked, true);
assert.equal(noPublishedRows.performanceParseWarning, "");

const malformed = parseDetailHtml(detailHtml(`
  <h3>생산실적 <span>(단위 : 천원)</span></h3>
  <table><tr><th>연도</th><th>생산실적</th></tr><tr><td>2025</td><td>집계 중</td></tr></table>
`));
assert.equal(malformed.performance, null);
assert.equal(malformed.performanceChecked, false);
assert.match(malformed.performanceParseWarning, /해석하지 못했습니다/);

console.log("performance parser tests passed");
