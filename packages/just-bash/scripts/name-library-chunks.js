// esbuild's [name] alone names every shared chunk "chunk.js". Use its module
// graph to publish stable paths while keeping the original split points.
import assert from "node:assert/strict";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const { outputs } = JSON.parse(await readFile("dist/lib-layout.json", "utf8"));
const names = new Map();
for (const [file, info] of Object.entries(outputs)) {
  if (file === "dist/bundle/index.js") continue;
  const source =
    info.entryPoint || Object.keys(info.inputs).sort()[0] || "runtime";
  // Remove pnpm's installation prefix; the package name and module path are
  // enough to identify a bundled dependency independently of the checkout.
  const module = source
    .split("/node_modules/")
    .at(-1)
    .replace(/^dist\//, "");
  const stem = module.replace(/\.[cm]?js$/, "").replace(/[^\w.-]+/g, "-");
  const name = `${info.entryPoint ? "" : "shared-"}${stem}.js`;
  names.set(file, path.posix.join("dist/bundle/chunks", name));
}
assert.equal(new Set(names.values()).size, names.size, "Ambiguous chunk name");

for (const [file, info] of Object.entries(outputs)) {
  const final = names.get(file) ?? file;
  let code = await readFile(file, "utf8");
  const references = new Map();
  for (const link of info.imports) {
    const target = names.get(link.path);
    if (!target) continue;
    const prefix = (p) =>
      `./${path.posix.relative(path.posix.dirname(file), p)}`;
    references.set(prefix(link.path), prefix(target));
  }
  // Change only module specifiers, including lazy imports. Literal strings in
  // commands, third-party sources and their notices are left untouched.
  const found = new Set();
  for (const ref of ts
    .preProcessFile(code, true, true)
    .importedFiles.reverse()) {
    const replacement = references.get(ref.fileName);
    if (!replacement) continue;
    const start = ref.pos + 1,
      end = ref.end + 1;
    assert.equal(code.slice(start, end), ref.fileName);
    code = code.slice(0, start) + replacement + code.slice(end);
    found.add(ref.fileName);
  }
  assert.equal(
    found.size,
    references.size,
    `Unresolved chunk import in ${file}`,
  );
  await writeFile(file, code);
  if (file !== final) await rename(file, final);
}
