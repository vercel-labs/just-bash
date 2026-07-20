import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { createDefaultOptions } from "../commands/rg/rg-options.js";
import {
  decodeBytesToUtf8,
  encodeUtf8ToBytes,
  unsafeBytesFromLatin1,
} from "../encoding.js";
import { InMemoryFs } from "../fs/in-memory-fs/in-memory-fs.js";
import { OverlayFs } from "../fs/overlay-fs/overlay-fs.js";
import { createUserRegex } from "../regex/index.js";

describe("DeepSec general/core resource follow-up", () => {
  it("rejects script source above maxSourceBytes before parsing", async () => {
    const bash = new Bash({ executionLimits: { maxSourceBytes: 8 } });
    await expect(bash.exec("        ")).resolves.toMatchObject({ exitCode: 0 });
    await expect(bash.exec("         ")).resolves.toMatchObject({
      exitCode: 126,
      stderr: "bash: script input size limit exceeded (8 bytes)\n",
    });
  });

  it("does not treat the expanded-value limit as a source limit", async () => {
    const bash = new Bash({ executionLimits: { maxStringLength: 1 } });
    await expect(bash.exec("                 :")).resolves.toMatchObject({
      exitCode: 0,
    });
  });

  it("bounds recursive chmod at the traversal boundary", async () => {
    const files = { "/tree/a": "a", "/tree/b": "b" };
    const equal = new Bash({
      files,
      executionLimits: { maxTraversalEntries: 3 },
    });
    await expect(equal.exec("chmod -R 600 /tree")).resolves.toMatchObject({
      exitCode: 0,
    });

    const above = new Bash({
      files,
      executionLimits: { maxTraversalEntries: 2 },
    });
    await expect(above.exec("chmod -R 600 /tree")).resolves.toMatchObject({
      exitCode: 126,
      stderr: "bash: chmod: filesystem traversal entry limit exceeded (2)\n",
    });
  });

  it("gives rg a finite default file size and shared traversal budget", async () => {
    expect(createDefaultOptions().maxFilesize).toBeGreaterThan(0);
    const files = { "/tree/a": "needle", "/tree/b": "needle" };
    const equal = new Bash({
      files,
      executionLimits: { maxTraversalEntries: 3 },
    });
    await expect(equal.exec("rg needle /tree")).resolves.toMatchObject({
      exitCode: 0,
    });
    const above = new Bash({
      files,
      executionLimits: { maxTraversalEntries: 2 },
    });
    await expect(above.exec("rg needle /tree")).resolves.toMatchObject({
      exitCode: 126,
      stderr: "bash: rg: filesystem traversal entry limit exceeded (2)\n",
    });
  });

  it("rejects an oversized find directory before retaining child work items", async () => {
    const files = { "/tree/a": "a", "/tree/b": "b" };
    const equal = new Bash({
      files,
      executionLimits: { maxTraversalEntries: 3 },
    });
    await expect(equal.exec("find /tree -type f")).resolves.toMatchObject({
      exitCode: 0,
      stdout: "/tree/a\n/tree/b\n",
    });

    const above = new Bash({
      files,
      executionLimits: { maxTraversalEntries: 2 },
    });
    await expect(above.exec("find /tree -type f")).resolves.toMatchObject({
      exitCode: 126,
      stderr: "bash: find: filesystem traversal entry limit exceeded (2)\n",
    });
  });

  it("bounds head multi-file output prospectively", async () => {
    const bash = new Bash({
      files: { "/a": "1234", "/b": "5678" },
      executionLimits: { maxOutputSize: 12, maxStringLength: 100 },
    });
    await expect(bash.exec("head -q -c 4 /a /b")).resolves.toMatchObject({
      stdout: "12345678",
    });
    await expect(bash.exec("head -c 4 /a /b")).resolves.toMatchObject({
      exitCode: 126,
      stderr: "bash: head: output size limit exceeded (12 bytes)\n",
    });
  });

  it("bounds cut range work instead of expanding overlapping ranges", async () => {
    const bash = new Bash({
      executionLimits: { maxLoopIterations: 4, maxWorkUnits: 100 },
    });
    await expect(
      bash.exec("cut -c 1-4", { stdin: "abcd" }),
    ).resolves.toMatchObject({ stdout: "abcd\n" });
    await expect(
      bash.exec("cut -c 1-4,1", { stdin: "abcd" }),
    ).resolves.toMatchObject({
      exitCode: 126,
      stderr: "bash: cut: range expansion limit exceeded (4)\n",
    });
  });

  it("bounds od input and format work before result arrays", async () => {
    const bash = new Bash({
      executionLimits: { maxLoopIterations: 4, maxInputBytes: 100 },
    });
    await expect(
      bash.exec("od -An -t x1", { stdin: "1234" }),
    ).resolves.toMatchObject({
      exitCode: 0,
    });
    await expect(
      bash.exec("od -An -t x1 -c", { stdin: "123" }),
    ).resolves.toMatchObject({
      exitCode: 126,
      stderr: "bash: od: format work limit exceeded (4)\n",
    });
  });

  it("charges file operands and aggregate file input", async () => {
    const bash = new Bash({
      files: { "/a": "a", "/b": "b" },
      executionLimits: { maxArrayElements: 1, maxInputBytes: 100 },
    });
    await expect(bash.exec("file /a")).resolves.toMatchObject({ exitCode: 0 });
    // Keep each argv within the generic per-command cardinality ceiling while
    // proving file's command-local operand budget is cumulative for the exec.
    await expect(bash.exec("file /a; file /b")).resolves.toMatchObject({
      exitCode: 126,
      stderr: "bash: file: file-operands work limit exceeded (1)\n",
    });
  });

  it("rejects unsafe split numeric parameters exactly", async () => {
    const bash = new Bash({ files: { "/in": "abc" } });
    expect((await bash.exec("split -n 2junk /in")).stderr).toBe(
      "split: invalid number of chunks: '2junk'\n",
    );
    expect((await bash.exec("split -a 9007199254740993 /in")).stderr).toBe(
      "split: invalid suffix length: '9007199254740993'\n",
    );
  });

  it("guards recursive AWK statements that do not add delimiter depth", async () => {
    const nested = `${"if(1) ".repeat(9)}print 1`;
    const bash = new Bash({
      executionLimits: {
        maxAwkParserDepth: 8,
        maxAwkParserTokens: 1_000,
        maxAwkParserOperations: 10_000,
      },
    });
    await expect(bash.exec(`awk 'BEGIN { ${nested} }'`)).resolves.toMatchObject(
      {
        exitCode: 126,
        stderr: "bash: awk: parser depth limit exceeded (8)\n",
      },
    );
  });

  it("enforces conversion ceilings before allocating conversion buffers", () => {
    expect(decodeBytesToUtf8(unsafeBytesFromLatin1("1234"), 4)).toBe("1234");
    expect(() => decodeBytesToUtf8(unsafeBytesFromLatin1("12345"), 4)).toThrow(
      "byte conversion limit exceeded (4 bytes)",
    );
    expect(() => encodeUtf8ToBytes("ééé", 5)).toThrow(
      "byte conversion limit exceeded (5 bytes)",
    );
  });

  it("bounds regex match, split, and iterator result production", () => {
    const matchRegex = createUserRegex("a", "g", { maxResults: 2 });
    expect(() => matchRegex.match("aaa")).toThrow(
      "regular expression result limit exceeded (2)",
    );
    const splitRegex = createUserRegex(",", "", { maxResults: 2 });
    expect(splitRegex.split("a,b,c,d")).toEqual(["a", "b"]);
    const iterator = createUserRegex("a", "g", { maxResults: 1 }).matchAll(
      "aa",
    );
    expect(iterator.next().value?.[0]).toBe("a");
    expect(() => iterator.next()).toThrow(
      "regular expression result limit exceeded (1)",
    );
  });

  it("enforces a cumulative in-memory filesystem quota", async () => {
    const memfs = new InMemoryFs(undefined, { maxTotalBytes: 8 });
    await memfs.writeFile("/a", "1234");
    await memfs.writeFile("/b", "5678");
    await expect(memfs.writeFile("/c", "9")).rejects.toThrow(
      "byte limit exceeded (8 bytes)",
    );
    await memfs.rm("/a");
    await expect(memfs.writeFile("/c", "9")).resolves.toBeUndefined();
  });

  it("uses the live-byte ceiling as the gzip codec ceiling", async () => {
    const bash = new Bash({
      files: { "/input": "a".repeat(128) },
      executionLimits: { maxLiveBytes: 64, maxInputBytes: 1_000 },
    });
    const result = await bash.exec("gzip -c /input");
    expect(result).toMatchObject({ exitCode: 126 });
    expect(result.stderr).toMatch(/live byte limit exceeded/);
  });
});

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("OverlayFs append storage", () => {
  it("preserves repeated appends without re-copying on each append", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-append-"));
    temporaryRoots.push(root);
    const overlay = new OverlayFs({ root, mountPoint: "/" });
    await overlay.writeFile("/log", "a");
    for (let index = 0; index < 100; index++) {
      await overlay.appendFile("/log", "b");
    }
    expect(await overlay.readFile("/log")).toBe(`a${"b".repeat(100)}`);
    expect((await overlay.stat("/log")).size).toBe(101);
  });
});
