async function test() {
  console.log("Testing search API...");
  try {
    const start = Date.now();
    const response = await fetch("http://localhost:4173/api/search?productName=타이레놀");
    console.log("Status:", response.status);
    const data = await response.json();
    console.log("Time taken:", Date.now() - start, "ms");
    console.log("Total count:", data.total);
    console.log("Items count:", data.items?.length);
    if (data.items?.length > 0) {
      console.log("First item:", data.items[0].itemName);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}
test();
