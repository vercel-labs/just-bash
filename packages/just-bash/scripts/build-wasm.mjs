import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
for (const browser of [false, true]) {
  const filename = browser ? "wasm-worker.browser.js" : "wasm-worker.js";
  const outfile = resolve(root, "src/wasm", filename);
  await build({
    entryPoints: [
      resolve(root, `src/wasm/worker.${browser ? "browser" : "node"}.ts`),
    ],
    outfile,
    bundle: true,
    platform: browser ? "browser" : "node",
    format: "esm",
    minify: true,
    legalComments: "eof",
  });
  for (const directory of [
    "dist/wasm",
    "dist/bundle",
    "dist/bundle/chunks",
    "dist/bin/chunks",
    "dist/bin/shell/chunks",
  ]) {
    await mkdir(resolve(root, directory), { recursive: true });
    await copyFile(outfile, resolve(root, directory, filename));
  }
}
