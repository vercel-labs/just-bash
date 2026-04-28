/**
 * Regression tests for sqlite3 `findWorkerPath()` resolution.
 *
 * Background: just-bash@2.14.0/2.14.1 silently fell back to the python3
 * worker when consumed via the published npm tarball — the bare
 * `<currentDir>/worker.js` lookup matched `dist/bundle/chunks/worker.js`
 * (python3's worker), causing protocol mismatch on every sqlite3 invocation.
 *
 * These tests pin the resolution order so that footgun cannot return.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _internals } from "./sqlite3.js";

describe("sqlite3 findWorkerPath()", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sqlite3-worker-res-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeFile(rel: string): string {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "// fixture");
    return full;
  }

  it("prefers <chunks>/sqlite3-worker.js when present alongside a stray worker.js", () => {
    // Simulates dist/bundle/chunks/ where python3's `worker.js` also lives.
    const chunksDir = join(root, "dist/bundle/chunks");
    mkdirSync(chunksDir, { recursive: true });
    writeFileSync(join(chunksDir, "worker.js"), "// python3 worker - WRONG");
    const expected = makeFile("dist/bundle/chunks/sqlite3-worker.js");

    const resolved = _internals.findWorkerPath(chunksDir);

    expect(resolved).toBe(expected);
  });

  it("does NOT fall back to a stray <chunks>/worker.js when sqlite3-worker.js is missing", () => {
    // The only file present is the python3-style worker. Resolver must reject.
    const chunksDir = join(root, "dist/bundle/chunks");
    mkdirSync(chunksDir, { recursive: true });
    writeFileSync(join(chunksDir, "worker.js"), "// python3 worker - WRONG");

    expect(() => _internals.findWorkerPath(chunksDir)).toThrow(
      /sqlite3 worker not found/,
    );
  });

  it("falls back to <chunks>/../../commands/sqlite3/worker.js for the tarball commands tree", () => {
    const chunksDir = join(root, "dist/bundle/chunks");
    mkdirSync(chunksDir, { recursive: true });
    const expected = makeFile("dist/commands/sqlite3/worker.js");

    const resolved = _internals.findWorkerPath(chunksDir);

    expect(resolved).toBe(expected);
  });

  it("resolves <currentDir>/worker.js when currentDir is the commands/sqlite3 directory", () => {
    // Non-bundled dist layout: dist/commands/sqlite3/sqlite3.js next to its worker.js.
    const cmdDir = join(root, "dist/commands/sqlite3");
    mkdirSync(cmdDir, { recursive: true });
    const expected = join(cmdDir, "worker.js");
    writeFileSync(expected, "// real sqlite3 worker");

    const resolved = _internals.findWorkerPath(cmdDir);

    expect(resolved).toBe(expected);
  });

  it("throws a clear error when no worker can be located", () => {
    const emptyDir = join(root, "dist/bundle/chunks");
    mkdirSync(emptyDir, { recursive: true });

    expect(() => _internals.findWorkerPath(emptyDir)).toThrow(
      /sqlite3 worker not found.*pnpm build/,
    );
  });
});
