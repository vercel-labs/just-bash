// Fetch a user, then fetch their posts, and generate a markdown summary
const fs = require("node:fs");

const userRes = await fetch("https://jsonplaceholder.typicode.com/users/1");
const user = await userRes.json();

const postsRes = await fetch(
  `https://jsonplaceholder.typicode.com/posts?userId=${user.id}`,
);
const posts = await postsRes.json();

const lines = [`# Posts by ${user.name}\n`];
lines.push(`Email: ${user.email}`);
lines.push(`Company: ${user.company.name}\n`);
lines.push(`## ${posts.length} Posts\n`);

for (const post of posts) {
  lines.push(`### ${post.title}\n`);
  lines.push(`${post.body}\n`);
}

const markdown = lines.join("\n");
fs.writeFileSync("/tmp/user-posts.md", markdown);
console.log("Generated", lines.length, "lines for", user.name);
