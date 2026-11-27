import { describe, expect, it } from "vitest";
import { hasModuleSyntax } from "./module-syntax.js";

describe("hasModuleSyntax", () => {
  it.each([
    ["a default import", "import fs from 'fs';"],
    ["a named import", "import { join } from 'path';"],
    ["a namespace import", "import * as path from 'path';"],
    ["a side-effect import", 'import "./setup.js";'],
    ["an import after another statement", "const a = 1; import fs from 'fs';"],
    ["an export after another statement", "const n = 1; export { n };"],
    ["an export declaration", "export const n = 2;"],
    ["an export star", "export * from './a.js';"],
    ["a default export", "export default 1;"],
    ["a comment inside an import", "import /* c */ fs from 'fs';"],
    ["a comment inside an export", "const n = 1; export /* c */ { n };"],
    ["import.meta", "console.log(import.meta.url);"],
    ["import.meta with a comment", "import /* c */ . meta;"],
    ["an import after a hashbang", "#!/usr/bin/env node\nimport fs from 'fs';"],
    ["an import after a template", "const t = `a${b}c`; import fs from 'fs';"],
    ["an import after a regex", "const r = /'/; import fs from 'fs';"],
    ["an import after a division", "const x = a / b; import fs from 'fs';"],
    [
      "an import after a string divided",
      "function f() { return 'a' / 2; } import fs from 'fs';",
    ],
  ])("finds %s", (_name, source) => {
    expect(hasModuleSyntax(source)).toBe(true);
  });

  it.each([
    ["plain code", "console.log(1); return;"],
    ["a dynamic import", "import('fs').then(() => {}); return;"],
    ["import.meta in a string", "console.log('import.meta'); return;"],
    [
      "import.meta in a double-quoted string",
      'const s = "import.meta"; return;',
    ],
    ["import.meta in a line comment", "// import.meta\nreturn;"],
    ["an import in a block comment", "/*\nimport fs from 'fs'\n*/\nreturn;"],
    ["an export in a template", "const t = `\nexport { n }\n`; return;"],
    [
      "an import in a template's nested template",
      "const t = `${`\nimport x from 'y'\n`}`; return;",
    ],
    ["an import in a regex", "const r = /import fs from 'fs'/; return;"],
    ["an import in a regex class", "const r = /[/]import x from 'y'/; return;"],
    ["a property named export", "a.export = 1; obj?.import; return;"],
    ["a method named import", "const o = { import() {}, export: 1 }; return;"],
    ["a word containing import", "const important = 1; exported = 2;"],
  ])("ignores %s", (_name, source) => {
    expect(hasModuleSyntax(source)).toBe(false);
  });

  it("stays linear on a long source", () => {
    const source = `${"`${'/*'}`".repeat(100_000)}import x from 'y'`;
    const started = Date.now();
    expect(hasModuleSyntax(source)).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
