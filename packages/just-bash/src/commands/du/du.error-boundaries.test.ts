import { afterEach, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import * as encoding from "../../encoding.js";
import { EMPTY_BYTES } from "../../encoding.js";
import { ExecutionScope } from "../../execution-scope.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { FileSystemPolicyError, traverseFileTree } from "../../fs/traversal.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../../interpreter/errors.js";
import { resolveLimits } from "../../limits.js";
import { duCommand } from "./du.js";

const context = (fs: InMemoryFs, maxOutputSize = 512) => ({
  fs,
  cwd: "/",
  env: new Map<string, string>(),
  stdin: EMPTY_BYTES,
  limits: resolveLimits({ maxOutputSize }),
});
afterEach(() => vi.restoreAllMocks());

it.each([
  ["EACCES", "Permission denied"],
  ["ELOOP", "Too many levels of symbolic links"],
  ["ENOTDIR", "Not a directory"],
  ["ENOENT", "No such file or directory"],
  ["EIO", "Input/output error"],
])("preserves operand %s", async (code, reason) => {
  class FailingStatFs extends InMemoryFs {
    override async stat(path: string) {
      if (path === "/data/file")
        throw Object.assign(new Error("backend diagnostic"), { code });
      return super.stat(path);
    }
  }
  expect(
    await duCommand.execute(
      ["data/file", "other"],
      context(new FailingStatFs({ "/other/file": "x" })),
    ),
  ).toMatchObject({
    stdout: "1\tother\n",
    stderr: `du: cannot access 'data/file': ${reason}\n`,
    exitCode: 1,
  });
});

it.each([
  new FileSystemPolicyError("readdir", "/data", "refused"),
  new ExecutionAbortedError(),
  new ExecutionLimitError("upstream limit", "iterations"),
])("preserves fatal error with handler and exhausted budget: %s", async (failure) => {
  class FailingReadFs extends InMemoryFs {
    override async readdir(): Promise<string[]> {
      throw failure;
    }
  }
  await expect(
    traverseFileTree(
      {
        fs: new FailingReadFs({ "/data/file": "x" }),
        root: "/data",
        site: "test",
        limits: resolveLimits({ maxTraversalWork: 1 }),
        onError(error) {
          throw error;
        },
      },
      () => undefined,
    ),
  ).rejects.toBe(failure);
});

it("preserves double-slash root spelling", async () => {
  expect(
    await duCommand.execute(
      ["-s", "//"],
      context(new InMemoryFs({ "/data/file": "x" })),
    ),
  ).toMatchObject({
    stdout: "1\t//\n",
    stderr: "",
    exitCode: 0,
  });
});

it.each([
  10000, 150,
])("bounds escape work for %i control characters", async (length) => {
  const encode = vi.spyOn(encoding, "encodeUtf8ToBytes");
  await expect(
    duCommand.execute(["\u007f".repeat(length)], context(new InMemoryFs())),
  ).rejects.toBeInstanceOf(ExecutionLimitError);
  expect(encode.mock.calls.length).toBeLessThan(128);
});

it("propagates unknown filesystem failures instead of inventing ENOENT", async () => {
  const failure = new Error("unclassified backend failure");
  class FailingStatFs extends InMemoryFs {
    override async stat(): Promise<never> {
      throw failure;
    }
  }
  await expect(
    duCommand.execute(["data"], context(new FailingStatFs())),
  ).rejects.toBe(failure);
});

it.each([
  "stat",
  "readdir",
])("does not relabel unknown %s failures", async (operation) => {
  const failure = new Error("unknown backend failure");
  class UnknownFs extends InMemoryFs {
    override async lstat(path: string) {
      if (operation === "stat" && path === "/data/locked/file") throw failure;
      return super.lstat(path);
    }
    override async readdir(path: string) {
      if (operation === "readdir" && path === "/data/locked") throw failure;
      return super.readdir(path);
    }
  }
  await expect(
    duCommand.execute(
      ["data"],
      context(new UnknownFs({ "/data/locked/file": "x" })),
    ),
  ).rejects.toBe(failure);
});

it.each([
  "a\n'b",
  "🙂",
])("enforces the exact UTF-8 diagnostic boundary for %j", async (name) => {
  const expected =
    name === "🙂"
      ? "du: cannot access '🙂': No such file or directory\n"
      : "du: cannot access 'a'$'\\n'\\''b': No such file or directory\n";
  const bytes = new TextEncoder().encode(expected).length;
  const fs = new InMemoryFs();
  expect(await duCommand.execute([name], context(fs, bytes))).toMatchObject({
    stdout: "",
    stderr: expected,
    exitCode: 1,
  });
  await expect(
    duCommand.execute([name], context(fs, bytes - 1)),
  ).rejects.toBeInstanceOf(ExecutionLimitError);
});

it.each([
  "maxLiveBytes",
  "maxStringLength",
] as const)("bounds intermediate diagnostics with %s", async (limit) => {
  const ctx = context(new InMemoryFs());
  ctx.limits[limit] = 64;
  await expect(
    duCommand.execute(["\u007f".repeat(150)], ctx),
  ).rejects.toBeInstanceOf(ExecutionLimitError);
});

it("honors cancellation before expanding a missing-operand diagnostic", async () => {
  const controller = new AbortController();
  class CancelledFs extends InMemoryFs {
    override async stat(): Promise<never> {
      controller.abort();
      throw new Error("ENOENT: missing");
    }
  }
  await expect(
    duCommand.execute(["\u007f".repeat(10000)], {
      ...context(new CancelledFs()),
      signal: controller.signal,
    }),
  ).rejects.toBeInstanceOf(ExecutionAbortedError);
});

it("checks the deadline during quote expansion", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now++);
  const limits = resolveLimits({ maxExecutionTimeMs: 3, maxOutputSize: 20000 });
  const scope = new ExecutionScope(limits);
  await expect(
    duCommand.execute(["\u007f".repeat(3000)], {
      ...context(new InMemoryFs()),
      limits,
      executionScope: scope,
    }),
  ).rejects.toBeInstanceOf(ExecutionAbortedError);
});

it("does not charge a diagnostic again when its command result is relayed", async () => {
  const expected = "du: cannot access 'missing': No such file or directory\n";
  const result = await new Bash({
    executionLimits: { maxOutputSize: expected.length },
  }).exec("du missing; true");
  expect(result).toMatchObject({ stdout: "", stderr: expected, exitCode: 0 });
});

it("keeps mixed quoting correct across compacted fragments", async () => {
  const prefix = "a".repeat(300);
  const expected = `du: cannot access '${prefix}'$'\\n'\\''b': No such file or directory\n`;
  expect(
    await duCommand.execute([`${prefix}\n'b`], context(new InMemoryFs())),
  ).toMatchObject({
    stdout: "",
    stderr: expected,
    exitCode: 1,
  });
});
