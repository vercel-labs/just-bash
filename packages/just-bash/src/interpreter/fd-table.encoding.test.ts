import { describe, expect, it } from "vitest";
import {
  closeFd,
  decodeFdEntry,
  dupFd,
  encodeFdEntry,
  type FdEntry,
  getFdEntry,
  isFdOpen,
  readFd,
  setFdEntry,
} from "./fd-table.js";
import type { InterpreterContext } from "./types.js";

/**
 * The descriptor table is stored as `Map<number, string>` because it is part
 * of the public CommandContext surface. These tests pin the encoding and the
 * read/advance semantics every redirection site relies on.
 */
function makeCtx(maxFileDescriptors = 64): InterpreterContext {
  return {
    state: { fileDescriptors: new Map<number, string>() },
    limits: { maxFileDescriptors },
  } as unknown as InterpreterContext;
}

describe("fd-table encoding", () => {
  const cases: Array<[string, FdEntry, string]> = [
    [
      "plain content is an input descriptor",
      { kind: "input", content: "a\nb\n" },
      "a\nb\n",
    ],
    [
      "truncating output descriptor",
      { kind: "output", path: "/tmp/out.txt", append: false },
      "__file__:/tmp/out.txt",
    ],
    [
      "appending output descriptor",
      { kind: "output", path: "/tmp/out.txt", append: true },
      "__file_append__:/tmp/out.txt",
    ],
    [
      "output descriptor keeps its byte offset and colon-containing path",
      { kind: "output", path: "/tmp/a:b", append: false, position: 4 },
      "__out__:8:/tmp/a:b:4:0",
    ],
    [
      "append descriptor keeps its byte offset",
      { kind: "output", path: "/tmp/out", append: true, position: 9 },
      "__out__:8:/tmp/out:9:1",
    ],
    [
      "read-write descriptor keeps its position",
      { kind: "readwrite", path: "/tmp/rw", position: 3, content: "abcdef" },
      "__rw__:7:/tmp/rw:3:abcdef",
    ],
    [
      "output duplication marker",
      { kind: "dup-out", sourceFd: 2 },
      "__dupout__:2",
    ],
    [
      "input duplication marker",
      { kind: "dup-in", sourceFd: 0 },
      "__dupin__:0",
    ],
  ];

  for (const [name, entry, raw] of cases) {
    it(`round-trips: ${name}`, () => {
      expect(encodeFdEntry(entry)).toBe(raw);
      expect(decodeFdEntry(raw)).toEqual(entry);
    });
  }

  it("parses a read-write path that contains colons", () => {
    const entry: FdEntry = {
      kind: "readwrite",
      path: "/tmp/a:b:c",
      position: 2,
      content: "xy:z",
    };
    expect(decodeFdEntry(encodeFdEntry(entry))).toEqual(entry);
  });

  it("treats a malformed __rw__ value as input content", () => {
    expect(decodeFdEntry("__rw__:notanumber")).toEqual({
      kind: "input",
      content: "__rw__:notanumber",
    });
  });

  it("treats a malformed dup marker as input content", () => {
    expect(decodeFdEntry("__dupout__:x")).toEqual({
      kind: "input",
      content: "__dupout__:x",
    });
  });
});

describe("fd-table content vs. marker classification", () => {
  it.each([
    "__file__:/tmp/pwn\n",
    "__out__:8:/tmp/pwn:0:0",
  ])("never re-parses input content: %s", (content) => {
    const ctx = makeCtx();
    setFdEntry(ctx, 3, { kind: "input", content });
    expect(getFdEntry(ctx, 3)).toEqual({
      kind: "input",
      content,
    });
    expect(readFd(ctx, 3)).toEqual({ content });
  });

  it("still decodes a marker written by a non-fd-table code path", () => {
    const ctx = makeCtx();
    // No setFdEntry, so nothing classified this descriptor.
    ctx.state.fileDescriptors?.set(3, "__file__:/tmp/out");
    expect(getFdEntry(ctx, 3)).toEqual({
      kind: "output",
      path: "/tmp/out",
      append: false,
    });
  });

  it("clears the classification when the descriptor is reused for output", () => {
    const ctx = makeCtx();
    setFdEntry(ctx, 3, { kind: "input", content: "__dupout__:1" });
    setFdEntry(ctx, 3, { kind: "output", path: "/tmp/o", append: false });
    expect(getFdEntry(ctx, 3)).toEqual({
      kind: "output",
      path: "/tmp/o",
      append: false,
    });
  });

  it("clears the classification when the descriptor is closed", () => {
    const ctx = makeCtx();
    setFdEntry(ctx, 3, { kind: "input", content: "__file__:/tmp/pwn" });
    closeFd(ctx, 3);
    ctx.state.fileDescriptors?.set(3, "__file__:/tmp/real");
    expect(getFdEntry(ctx, 3)).toEqual({
      kind: "output",
      path: "/tmp/real",
      append: false,
    });
  });

  it("carries the classification through a duplication", () => {
    const ctx = makeCtx();
    setFdEntry(ctx, 3, { kind: "input", content: "__file__:/tmp/pwn" });
    expect(dupFd(ctx, 4, 3)).toBe(true);
    expect(getFdEntry(ctx, 4)).toEqual({
      kind: "input",
      content: "__file__:/tmp/pwn",
    });
  });

  it("reports a failed duplication of an unopened descriptor", () => {
    const ctx = makeCtx();
    expect(dupFd(ctx, 4, 3)).toBe(false);
    expect(isFdOpen(ctx, 4)).toBe(false);
  });
});
