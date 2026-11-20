// Automa modification: source-owned patch for the separately pinned RE2JS
// dependency. Never search or rewrite the compiled just-bash bundles.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(
  new URL("../packages/just-bash/package.json", import.meta.url),
);
const ts = require("typescript");
const hashes = {
  "index.esm.js":
    "a2ec204fdf50b0a2b06a6a43f76c6a53f61186372c5141310a8b1115667da4d7",
  "index.cjs.cjs":
    "24f6daf0b4490a2f241798dcffc7ace74698c02bb80d9d35527c79871f95fd44",
  "index.umd.js":
    "b37542a4bad86e2f81b705450eb1fbde09dc32854870087b613d8c16ed0947f1",
};

const iterative = `// Automa: preserve RE2 fragment order without recursive JS stack growth.
  compile(root) {
    const frames = [{ node: root, index: 0, fragment: null, opened: null }];
    let result;
    while (frames.length) {
      const frame = frames[frames.length - 1], node = frame.node;
      switch (node.op) {
        case Regexp.Op.CAPTURE:
          if (frame.index === 0) {
            frame.opened = this.cap(node.cap << 1);
            frame.index = 1;
            frames.push({ node: node.subs[0], index: 0, fragment: null, opened: null });
            continue;
          }
          result = this.cat(this.cat(frame.opened, result), this.cap(node.cap << 1 | 1));
          frames.pop();
          break;
        case Regexp.Op.STAR:
        case Regexp.Op.PLUS:
        case Regexp.Op.QUEST:
          if (frame.index === 0) {
            frame.index = 1;
            frames.push({ node: node.subs[0], index: 0, fragment: null, opened: null });
            continue;
          }
          result = node.op === Regexp.Op.STAR
            ? this.star(result, (node.flags & RE2Flags.NON_GREEDY) !== 0)
            : node.op === Regexp.Op.PLUS
              ? this.plus(result, (node.flags & RE2Flags.NON_GREEDY) !== 0)
              : this.quest(result, (node.flags & RE2Flags.NON_GREEDY) !== 0);
          frames.pop();
          break;
        case Regexp.Op.CONCAT:
        case Regexp.Op.ALTERNATE:
          if (frame.index > 0) {
            frame.fragment = frame.fragment === null ? result
              : node.op === Regexp.Op.CONCAT ? this.cat(frame.fragment, result)
              : this.alt(frame.fragment, result);
          }
          if (frame.index < node.subs.length) {
            frames.push({ node: node.subs[frame.index++], index: 0, fragment: null, opened: null });
            continue;
          }
          result = frame.fragment === null ? this.nop() : frame.fragment;
          frames.pop();
          break;
        default:
          result = this.compileLeaf(node);
          frames.pop();
      }
    }
    return result;
  }`;

export function patchCompiler(source, filename) {
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    hashes[filename],
    `RE2JS 1.3.3 pristine mismatch: ${filename}`,
  );
  const ast = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const matches = [];
  function visit(node) {
    if (ts.isClassDeclaration(node) && node.name?.text === "Compiler") {
      for (const member of node.members) {
        if (
          ts.isMethodDeclaration(member) &&
          member.name.getText(ast) === "compile"
        )
          matches.push(member);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(matches.length, 1, "Expected exactly one original RE2 compiler");
  const method = matches[0];
  const original = method.getText(ast).replace(/^compile\(/, "compileLeaf(");
  return (
    source.slice(0, method.getStart(ast)) +
    iterative +
    "\n  " +
    original +
    source.slice(method.end)
  ).replace(/^\/\/# sourceMappingURL=.*$/gm, "");
}

export async function patchPackage(root) {
  const pkg = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(pkg.name, "re2js");
  assert.equal(pkg.version, "1.3.3");
  // Validate every input before writing any output.
  const results = await Promise.all(
    Object.keys(hashes).map(async (name) => {
      const file = path.join(root, "build", name);
      return [file, patchCompiler(await fs.readFile(file, "utf8"), name)];
    }),
  );
  for (const [file, source] of results) await fs.writeFile(file, source);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  assert.equal(
    process.argv.length,
    3,
    "Usage: node scripts/patch-re2js-compiler.mjs <pnpm-patch-directory>",
  );
  await patchPackage(process.argv[2]);
}
