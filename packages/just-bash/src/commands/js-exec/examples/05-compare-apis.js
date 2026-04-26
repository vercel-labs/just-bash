// Fetch from two API endpoints and compare/diff the results
const fs = require("node:fs");

// Fetch todos for two users
const res1 = await fetch("https://jsonplaceholder.typicode.com/todos?userId=1");
const res2 = await fetch("https://jsonplaceholder.typicode.com/todos?userId=2");

const todos1 = await res1.json();
const todos2 = await res2.json();

function summarize(todos) {
  const completed = todos.filter((t) => t.completed).length;
  return {
    total: todos.length,
    completed: completed,
    pending: todos.length - completed,
    completionRate: `${Math.round((completed / todos.length) * 100)}%`,
  };
}

const comparison = {
  user1: summarize(todos1),
  user2: summarize(todos2),
};

// Determine who is more productive
if (comparison.user1.completed > comparison.user2.completed) {
  comparison.moreProductive = "user1";
} else if (comparison.user2.completed > comparison.user1.completed) {
  comparison.moreProductive = "user2";
} else {
  comparison.moreProductive = "tie";
}

fs.writeFileSync("/tmp/comparison.json", JSON.stringify(comparison, null, 2));
console.log(JSON.stringify(comparison, null, 2));
