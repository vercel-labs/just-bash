---
"just-bash": minor
---

Add a `just-bash/parser` subpath for parsing Bash without loading the interpreter, commands or network adapters. Publish ESM and CommonJS bundles, parser errors and options, and AST types for browser and Node.js consumers.

Export matching parser error constructors from the Node.js root entry as well. Import `parse` and its error classes from the same entry and module format; the bundles do not share constructors.

Report the parser's existing input-length limit in UTF-16 code units rather than bytes.
