// Test: verify contractManufacturer is populated for ALL items in the CSV output
async function test() {
  console.log("Requesting CSV for ingredient: 세티리진 ...");
  const start = Date.now();
  const response = await fetch("http://localhost:4173/api/csv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: { ingredient1: "세티리진" },
      category: "human",
      cache: {}
    })
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Status: ${response.status}, Time: ${elapsed}s`);

  if (!response.ok) {
    console.error("FAILED:", await response.text());
    return;
  }

  const csvText = await response.text();
  const rows = csvText.split("\r\n").filter(Boolean);
  console.log(`Total CSV rows (including header): ${rows.length}`);

  // Parse header to find contractManufacturer column index
  const header = rows[0];
  const headerCols = header.match(/"[^"]*"/g) || [];
  const cmIndex = headerCols.findIndex((col) => col.includes("위탁제조업체"));
  console.log(`위탁제조업체 column index: ${cmIndex}`);

  if (cmIndex < 0) {
    console.error("Column not found!");
    return;
  }

  let filledCount = 0;
  let emptyCount = 0;
  const dataRows = rows.slice(1);

  for (const row of dataRows) {
    const cols = row.match(/"[^"]*"/g) || [];
    const cmValue = (cols[cmIndex] || '""').replace(/^"|"$/g, "").trim();
    if (cmValue && cmValue !== "-" && cmValue !== "") {
      filledCount += 1;
    } else {
      emptyCount += 1;
    }
  }

  console.log(`\n=== 위탁제조업체 결과 ===`);
  console.log(`총 데이터 행: ${dataRows.length}`);
  console.log(`위탁제조업체 있음: ${filledCount}`);
  console.log(`위탁제조업체 없음: ${emptyCount}`);

  // Show first 5 rows with their contractManufacturer value
  console.log(`\n--- 처음 5행 샘플 ---`);
  for (let i = 0; i < Math.min(5, dataRows.length); i++) {
    const cols = dataRows[i].match(/"[^"]*"/g) || [];
    const name = (cols[2] || "").replace(/^"|"$/g, "");
    const cm = (cols[cmIndex] || "").replace(/^"|"$/g, "");
    console.log(`  ${i + 1}. ${name} → 위탁: "${cm}"`);
  }
}
test();
