// Fetch multiple URLs with retry logic and aggregate results
const fs = require("node:fs");

async function fetchWithRetry(url, maxRetries) {
  if (maxRetries === undefined) maxRetries = 3;
  var lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const body = await res.text();
      return { url: url, status: res.status, body: body, attempts: attempt };
    }
    lastError = `HTTP ${res.status}`;
    console.error("Attempt", attempt, "failed for", url, ":", lastError);
  }

  return { url: url, status: -1, error: lastError, attempts: maxRetries };
}

var endpoints = [
  "https://jsonplaceholder.typicode.com/posts/1",
  "https://jsonplaceholder.typicode.com/posts/2",
  "https://jsonplaceholder.typicode.com/comments/1",
  "https://jsonplaceholder.typicode.com/albums/1",
  "https://jsonplaceholder.typicode.com/photos/1",
];

var results = [];
var succeeded = 0;
var failed = 0;

for (let i = 0; i < endpoints.length; i++) {
  const result = await fetchWithRetry(endpoints[i]);
  if (result.error) {
    failed++;
    results.push({ url: result.url, error: result.error });
  } else {
    succeeded++;
    results.push({ url: result.url, data: JSON.parse(result.body) });
  }
}

var report = {
  total: endpoints.length,
  succeeded: succeeded,
  failed: failed,
  results: results,
};

fs.writeFileSync("/tmp/fetch-results.json", JSON.stringify(report, null, 2));
console.log(
  "Fetched",
  `${succeeded}/${endpoints.length}`,
  "endpoints successfully",
);
