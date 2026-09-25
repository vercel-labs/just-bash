import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (
  typeof WebAssembly.Suspending === "function" &&
  typeof WebAssembly.promising === "function"
) {
  await import("./main.mjs");
} else {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-wasm-jspi",
      fileURLToPath(new URL("./main.mjs", import.meta.url)),
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
