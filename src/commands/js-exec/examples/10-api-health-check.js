// Health-check multiple API endpoints and generate a status page
const fs = require("node:fs");

var endpoints = [
  { name: "Users API", url: "https://jsonplaceholder.typicode.com/users" },
  { name: "Posts API", url: "https://jsonplaceholder.typicode.com/posts" },
  {
    name: "Comments API",
    url: "https://jsonplaceholder.typicode.com/comments",
  },
  { name: "Albums API", url: "https://jsonplaceholder.typicode.com/albums" },
  { name: "Todos API", url: "https://jsonplaceholder.typicode.com/todos" },
  { name: "Photos API", url: "https://jsonplaceholder.typicode.com/photos" },
];

var results = [];
var allHealthy = true;

for (let i = 0; i < endpoints.length; i++) {
  const ep = endpoints[i];
  const startTime = Date.now();
  const res = await fetch(ep.url);
  const elapsed = Date.now() - startTime;

  const healthy = res.status === 200;
  if (!healthy) allHealthy = false;

  const body = await res.text();
  const bodySize = body ? body.length : 0;
  let recordCount = 0;
  if (healthy) {
    try {
      const data = JSON.parse(body);
      if (Array.isArray(data)) recordCount = data.length;
    } catch (_e) {
      // not JSON, that's fine
    }
  }

  results.push({
    name: ep.name,
    url: ep.url,
    status: res.status,
    healthy: healthy,
    responseTimeMs: elapsed,
    bodyBytes: bodySize,
    records: recordCount,
  });
}

// Generate a plain-text status page
var lines = ["# API Health Check", ""];
lines.push(`Checked at: ${new Date().toISOString()}`);
lines.push(`Overall status: ${allHealthy ? "ALL HEALTHY" : "DEGRADED"}`);
lines.push("");

for (let j = 0; j < results.length; j++) {
  const r = results[j];
  const icon = r.healthy ? "[OK]" : "[FAIL]";
  lines.push(`${icon} ${r.name}`);
  lines.push(`    URL: ${r.url}`);
  lines.push(
    "    Status: " +
      r.status +
      " | Time: " +
      r.responseTimeMs +
      "ms | Size: " +
      r.bodyBytes +
      " bytes",
  );
  if (r.records > 0) {
    lines.push(`    Records: ${r.records}`);
  }
  lines.push("");
}

var statusPage = lines.join("\n");
fs.writeFileSync("/tmp/health-check.txt", statusPage);
fs.writeFileSync("/tmp/health-check.json", JSON.stringify(results, null, 2));

console.log(statusPage);
