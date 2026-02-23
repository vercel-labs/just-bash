// Recursively walk a directory and output a tree structure as JSON
const fs = require("node:fs");
const path = require("node:path");

function walkDir(dir, depth) {
  if (depth === undefined) depth = 0;
  if (depth > 5) return []; // safety limit

  var entries = fs.readdirSync(dir);
  var result = [];

  for (let i = 0; i < entries.length; i++) {
    const name = entries[i];
    if (name.startsWith(".")) continue; // skip hidden files

    const fullPath = path.join(dir, name);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory) {
      result.push({
        name: name,
        type: "directory",
        children: walkDir(fullPath, depth + 1),
      });
    } else {
      result.push({
        name: name,
        type: "file",
        size: stat.size,
      });
    }
  }

  return result;
}

var root = process.argv[1] || "/home/user";
var tree = walkDir(root);
var output = JSON.stringify(tree, null, 2);
fs.writeFileSync("/tmp/tree.json", output);
console.log(output);
