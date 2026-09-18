/**
 * The worker used to be resolved from `import.meta.url`, which is empty in the
 * CJS bundle — `python3: Invalid URL` on every call through `require()` (#385).
 * These tests pin the two layouts the worker ships in.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _internals } from "./python3.js";

describe("python3 findWorkerPath()", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "python3-worker-res-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves <currentDir>/worker.js", () => {
    const chunksDir = join(root, "dist/bundle/chunks");
    mkdirSync(chunksDir, { recursive: true });
    const expected = join(chunksDir, "worker.js");
    writeFileSync(expected, "// python3 worker");

    expect(_internals.findWorkerPath(chunksDir)).toBe(expected);
  });

  it("resolves <currentDir>/chunks/worker.js — the CJS bundle layout", () => {
    const bundleDir = join(root, "dist/bundle");
    mkdirSync(join(bundleDir, "chunks"), { recursive: true });
    const expected = join(bundleDir, "chunks/worker.js");
    writeFileSync(expected, "// python3 worker");

    expect(_internals.findWorkerPath(bundleDir)).toBe(expected);
  });

  it("prefers the sibling worker over a nested chunks/ copy", () => {
    const dir = join(root, "dist/commands/python3");
    mkdirSync(join(dir, "chunks"), { recursive: true });
    const expected = join(dir, "worker.js");
    writeFileSync(expected, "// python3 worker");
    writeFileSync(join(dir, "chunks/worker.js"), "// stale copy");

    expect(_internals.findWorkerPath(dir)).toBe(expected);
  });

  it("throws a clear error when no worker can be located", () => {
    const emptyDir = join(root, "dist/bundle");
    mkdirSync(emptyDir, { recursive: true });

    expect(() => _internals.findWorkerPath(emptyDir)).toThrow(
      /python3 worker not found.*pnpm build/,
    );
  });
});
