---
"just-bash": minor
---

`js-exec` runs a `.js` file, `-c` code, or stdin as an ES module when it uses `import` or `export` declarations or `import.meta`, as Node does since 22.7. Strings, comments, template literals, and regular expressions are skipped, so text that only mentions that syntax keeps a script in function-body mode. `.cjs` files always run in function-body mode, and `-m` and the extension rules are unchanged.
