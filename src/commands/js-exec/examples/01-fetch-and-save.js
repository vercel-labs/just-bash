// Fetch a webpage and save it to a file
const fs = require("node:fs");

const response = await fetch("https://example.com");
if (!response.ok) {
  console.error("Failed to fetch:", response.status, response.statusText);
  process.exit(1);
}

const body = await response.text();
fs.writeFileSync("/tmp/example.html", body);
console.log("Saved", body.length, "bytes to /tmp/example.html");
