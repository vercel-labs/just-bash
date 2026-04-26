// Fetch data from multiple JSON APIs and merge the results
const fs = require("node:fs");

const urls = [
  "https://jsonplaceholder.typicode.com/users/1",
  "https://jsonplaceholder.typicode.com/users/2",
  "https://jsonplaceholder.typicode.com/users/3",
];

const users = [];
for (const url of urls) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error("Failed to fetch", url, ":", res.status);
    continue;
  }
  const user = await res.json();
  users.push({
    id: user.id,
    name: user.name,
    email: user.email,
    company: user.company.name,
  });
}

const report = {
  fetchedAt: new Date().toISOString(),
  count: users.length,
  users,
};

fs.writeFileSync("/tmp/users-report.json", JSON.stringify(report, null, 2));
console.log("Merged", users.length, "users into /tmp/users-report.json");
