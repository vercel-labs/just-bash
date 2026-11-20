import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runScanner } from "./check-banned-patterns.js";

describe("shared worker lifecycle lint boundary", () => {
  it.each([
    ["Node import", 'import { Worker } from "node:worker_threads";\n'],
    ["dynamic Node import", 'const worker = import("node:worker_threads");\n'],
    ["Node global", "const pid = process.pid;\n"],
    ["Buffer global", 'const bytes = Buffer.from("x");\n'],
    ["worker construction", "const worker = new Worker(url);\n"],
    [
      "global worker construction",
      "const worker = new globalThis.Worker(url);\n",
    ],
  ])("rejects %s", (_name, source) => {
    const root = mkdtempSync(join(tmpdir(), "just-bash-worker-boundary-"));
    try {
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "src", "worker-lifecycle.ts"), source);

      const result = runScanner(root, { report: false });
      expect(result.violations.map((item) => item.pattern.name)).toEqual([
        "Host-specific code in shared worker lifecycle",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows Node imports in the Node request controller", () => {
    const root = mkdtempSync(join(tmpdir(), "just-bash-worker-boundary-"));
    try {
      mkdirSync(join(root, "src", "commands"), { recursive: true });
      writeFileSync(
        join(root, "src", "commands", "worker-request-controller.ts"),
        'import { randomBytes } from "node:crypto";\n',
      );

      expect(runScanner(root, { report: false }).hasErrors).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
