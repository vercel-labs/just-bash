import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { defineCommand } from "../../custom-commands.js";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "../../security/defense-in-depth-box.js";
import {
  createGate,
  holdStagedWrites,
  settleWithin,
} from "../../test-utils/fs-gates.js";
import { ReadWriteFs } from "./read-write-fs.js";

const OK = { stdout: "", stderr: "", exitCode: 0 };
const ABORTED = {
  stdout: "",
  stderr: "bash: execution aborted\n",
  exitCode: 124,
};

describe("ReadWriteFs mutations outside the caller's execution", () => {
  let root: string;

  beforeEach(() => {
    DefenseInDepthBox.resetInstance();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-mutation-context-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    DefenseInDepthBox.resetInstance();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("runs an untrusted caller's argument hooks only while it is sandboxed", async () => {
    const hookRuns = new Set<string>();
    const probe = (label: string) => {
      let outcome = "allowed";
      try {
        // @banned-pattern-ignore: asserts the sandbox still blocks this inside a caller's hook
        new Function("return 1")();
      } catch (error) {
        outcome =
          error instanceof SecurityViolationError ? "blocked" : String(error);
      }
      hookRuns.add(`${label}: ${outcome}`);
    };
    // Every property read, `in` check and prototype lookup calls probe. The
    // sandbox blocks Proxy, so the caller's hook-bearing values are built here.
    const hooked = <T extends object>(label: string, target: T): T =>
      new Proxy(target, {
        get(object, key) {
          probe(label);
          const value = Reflect.get(object, key);
          return typeof value === "function" ? value.bind(object) : value;
        },
        has(object, key) {
          probe(label);
          return Reflect.has(object, key);
        },
        getPrototypeOf(object) {
          probe(label);
          return Reflect.getPrototypeOf(object);
        },
      });
    const pathLike = hooked("path", { toString: () => "/p" }) as never;
    const text = hooked("content", { toString: () => "text" }) as never;
    const bytes = hooked("bytes", new Uint8Array([98]));
    const options = hooked("options", {
      recursive: true,
      force: true,
      mode: 0o600,
      encoding: "utf8" as const,
    });
    const mode = hooked("mode", { valueOf: () => 0o644 }) as never;
    const time = hooked("time", new Date(0));

    const outcomes = new Map<string, string>();
    const issued = createGate();
    const settled = createGate();
    const mutate = defineCommand(
      "mutate",
      async (_args, ctx) => {
        const settle = async (label: string, call?: Promise<void>) => {
          try {
            await call;
            outcomes.set(label, "done");
          } catch (error) {
            outcomes.set(label, (error as Error).name);
          }
          if (outcomes.size === 13) settled.reached();
        };
        const calls = [
          settle("writeFile path", ctx.fs.writeFile(pathLike, "x")),
          settle("writeFile content", ctx.fs.writeFile("/w", text)),
          settle("writeFile options", ctx.fs.writeFile("/w", "x", options)),
          settle("appendFile bytes", ctx.fs.appendFile("/w", bytes)),
          settle("mkdir", ctx.fs.mkdir("/d", options)),
          settle("createExclusive", ctx.fs.createExclusive?.("/e", options)),
          settle("rm", ctx.fs.rm("/d", options)),
          settle("cp", ctx.fs.cp("/w", "/c", options)),
          settle("mv", ctx.fs.mv(pathLike, "/m")),
          settle("chmod", ctx.fs.chmod("/w", mode)),
          settle("symlink", ctx.fs.symlink(pathLike, "/s")),
          settle("link", ctx.fs.link(pathLike, "/l")),
          settle("utimes", ctx.fs.utimes("/w", time, time)),
        ];
        issued.reached();
        for (const call of calls) await call;
        return OK;
      },
      { trusted: false },
    );
    const rwfs = new ReadWriteFs({ root });
    const bash = new Bash({
      fs: rwfs,
      customCommands: [mutate],
      defenseInDepth: true,
    });
    // A host write holds the root, so every call that passes its checks
    // queues; it is released only after the caller's execution has ended.
    const [held] = holdStagedWrites(1);
    const holder = rwfs.writeFile("/held", "h");
    await settleWithin(held.inFlight);
    const controller = new AbortController();

    const stopped = bash.exec("mutate", { signal: controller.signal });
    await settleWithin(issued.inFlight);
    controller.abort();
    expect(await settleWithin(stopped)).toMatchObject(ABORTED);
    held.release();
    expect(await settleWithin(holder)).toBeUndefined();
    expect(await settleWithin(settled.inFlight)).toBeUndefined();

    // Each hook ran once, at the call, where the sandbox blocked it. None
    // ran after the execution ended.
    expect([...hookRuns].sort()).toEqual([
      "bytes: blocked",
      "content: blocked",
      "options: blocked",
    ]);
    expect(Object.fromEntries(outcomes)).toEqual({
      "writeFile path": "TypeError",
      "writeFile content": "ExecutionAbortedError",
      "writeFile options": "ExecutionAbortedError",
      "appendFile bytes": "ExecutionAbortedError",
      mkdir: "ExecutionAbortedError",
      createExclusive: "ExecutionAbortedError",
      rm: "ExecutionAbortedError",
      cp: "ExecutionAbortedError",
      mv: "TypeError",
      chmod: "TypeError",
      symlink: "TypeError",
      link: "TypeError",
      utimes: "TypeError",
    });
    const later = await settleWithin(bash.exec("echo b > /b && cat /b"));
    expect(later).toMatchObject({ ...OK, stdout: "b\n" });
  });

  it("releases the root when rm -rf of a large tree is aborted midway", async () => {
    const tree = path.join(root, "tree");
    for (let d = 0; d < 20; d++) {
      fs.mkdirSync(path.join(tree, `d${d}`), { recursive: true });
      for (let f = 0; f < 100; f++) {
        fs.writeFileSync(path.join(tree, `d${d}`, `f${f}`), "x");
      }
    }
    // A short cleanup grace ends the execution while Node is still deleting.
    const bash = new Bash({
      fs: new ReadWriteFs({ root }),
      defenseInDepth: true,
      executionLimits: { maxExtensionCleanupTimeMs: 1 },
    });
    const deleting = () => {
      try {
        return fs.readdirSync(path.join(tree, "d0")).length < 100;
      } catch {
        return true;
      }
    };
    const controller = new AbortController();

    const stopped = bash.exec("rm -rf /tree", { signal: controller.signal });
    await vi.waitFor(() => expect(deleting()).toBe(true), {
      timeout: 2000,
      interval: 1,
    });
    controller.abort();
    expect(await settleWithin(stopped)).toMatchObject(ABORTED);

    const later = await settleWithin(bash.exec("echo b > /b && cat /b"));
    expect(later).toMatchObject({ ...OK, stdout: "b\n" });
    // The rm was already running, so it finished.
    expect(fs.existsSync(tree)).toBe(false);
  });
});
