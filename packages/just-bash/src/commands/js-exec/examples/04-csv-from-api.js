// Fetch JSON data from an API and convert it to CSV
const fs = require("node:fs");

const res = await fetch("https://jsonplaceholder.typicode.com/todos");
if (!res.ok) {
  console.error("API error:", res.status);
  process.exit(1);
}

const todos = await res.json();

// Build CSV
const header = "id,userId,title,completed";
const rows = todos.map((t) => {
  // Escape title for CSV (wrap in quotes, escape inner quotes)
  const title = `"${t.title.replace(/"/g, '""')}"`;
  return [t.id, t.userId, title, t.completed].join(",");
});

const csv = `${header}\n${rows.join("\n")}\n`;
fs.writeFileSync("/tmp/todos.csv", csv);
console.log("Wrote", todos.length, "rows to /tmp/todos.csv");
