async function testCategory(category, query) {
  console.log(`\n--- Testing category: ${category} with query: ${JSON.stringify(query)} ---`);
  try {
    const response = await fetch("http://localhost:4173/api/csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        category,
        cache: {}
      })
    });
    console.log("Status:", response.status);
    if (!response.ok) {
      const errText = await response.text();
      console.error("Error payload:", errText);
      return false;
    }
    const text = await response.text();
    console.log("Length of CSV:", text.length);
    console.log("First 250 chars:\n", text.slice(0, 250));
    return true;
  } catch (error) {
    console.error("Test failed for", category, ":", error);
    return false;
  }
}

async function runAll() {
  // Test Human
  await testCategory("human", { productName: "타이레놀" });
  
  // Test Vet
  await testCategory("vet", { productName: "아목시" });
  
  // Test Aquatic
  await testCategory("aquatic", { productName: "포르" });
}

runAll();
