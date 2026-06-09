const dns = require("node:dns");
if (dns && dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}

async function test() {
  const url = "https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=200105441";
  try {
    console.log("Fetching url:", url);
    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "cache-control": "no-cache"
      }
    });
    console.log("Response status:", res.status, res.statusText);
    const text = await res.text();
    console.log("Length of response text:", text.length);
  } catch (err) {
    console.error("Fetch failed with error:");
    console.error(err);
    if (err.cause) {
      console.error("Cause:", err.cause);
    }
  }
}

test();
