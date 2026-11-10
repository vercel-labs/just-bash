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
import type { IFileSystem } from "../interface.js";
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
    // Genuine bytes with accessors of their own, which a copy must not read.
    const hookedBytes = (label: string) => {
      const bytes = new Uint8Array([98]);
      const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
      for (const key of ["buffer", "byteLength", "byteOffset", "length"]) {
        const read = Object.getOwnPropertyDescriptor(typedArray, key)?.get;
        Object.defineProperty(bytes, key, {
          get() {
            probe(label);
            return read?.call(bytes);
          },
        });
      }
      return bytes;
    };
    // A fresh set of arguments per phase, each hook labelled by its call.
    const argumentsFor = (phase: string) => {
      const label = <T extends object>(call: string, target: T) =>
        hooked(`${phase} ${call}`, target);
      return {
        writePath: label("writeFile path", { toString: () => "/p" }) as never,
        text: label("writeFile content", { toString: () => "text" }) as never,
        encoding: label("writeFile options", { encoding: "utf8" as const }),
        bytes: hookedBytes(`${phase} appendFile bytes`),
        mkdir: label("mkdir options", { recursive: true }),
        exclusive: label("createExclusive options", { mode: 0o600 }),
        cp: label("cp options", { recursive: true }),
        rm: label("rm options", { recursive: true, force: true }),
        mvPath: label("mv path", { toString: () => "/p" }) as never,
        mode: label("chmod mode", { valueOf: () => 0o644 }) as never,
        symlinkPath: label("symlink path", { toString: () => "/p" }) as never,
        linkPath: label("link path", { toString: () => "/p" }) as never,
        time: label("utimes time", new Date(0)),
      };
    };
    const mutations = (
      cmdFs: IFileSystem,
      a: ReturnType<typeof argumentsFor>,
    ) =>
      [
        ["writeFile path", () => cmdFs.writeFile(a.writePath, "x")],
        ["writeFile content", () => cmdFs.writeFile("/w", a.text)],
        ["writeFile options", () => cmdFs.writeFile("/o", "o", a.encoding)],
        ["appendFile bytes", () => cmdFs.appendFile("/w", a.bytes)],
        ["mkdir", () => cmdFs.mkdir("/d/e", a.mkdir)],
        ["createExclusive", () => cmdFs.createExclusive?.("/x", a.exclusive)],
        ["cp", () => cmdFs.cp("/d", "/c", a.cp)],
        ["rm", () => cmdFs.rm("/d", a.rm)],
        ["mv", () => cmdFs.mv(a.mvPath, "/m")],
        ["chmod", () => cmdFs.chmod("/w", a.mode)],
        ["symlink", () => cmdFs.symlink(a.symlinkPath, "/s")],
        ["link", () => cmdFs.link(a.linkPath, "/l")],
        ["utimes", () => cmdFs.utimes("/w", a.time, a.time)],
      ] as const;

    const outcomes = new Map<string, string>();
    const settle = async (label: string, call: Promise<void> | undefined) => {
      try {
        await call;
        outcomes.set(label, "done");
      } catch (error) {
        const { name, message } = error as Error;
        outcomes.set(
          label,
          message.startsWith("ECANCELED") ? "ECANCELED" : name,
        );
      }
    };
    // Live: the root is free, so each call runs as soon as it is made.
    const liveArguments = argumentsFor("live");
    const live = defineCommand(
      "live",
      async (_args, ctx) => {
        for (const [call, run] of mutations(ctx.fs, liveArguments)) {
          await settle(`live ${call}`, run());
        }
        return OK;
      },
      { trusted: false },
    );
    // Queued: every call is made at once, behind a held root.
    const queuedArguments = argumentsFor("queued");
    const issued = createGate();
    const settled = createGate();
    const queued = defineCommand(
      "queued",
      async (_args, ctx) => {
        const calls = mutations(ctx.fs, queuedArguments).map(([call, run]) =>
          settle(`queued ${call}`, run()),
        );
        issued.reached();
        for (const call of calls) await call;
        settled.reached();
        return OK;
      },
      { trusted: false },
    );
    const rwfs = new ReadWriteFs({ root });
    const bash = new Bash({
      fs: rwfs,
      customCommands: [live, queued],
      defenseInDepth: true,
    });

    expect(await settleWithin(bash.exec("live"))).toMatchObject(OK);
    // Read now, assert later, so a hook failure is the first one reported.
    const at = (file: string) => path.join(root, file);
    const read = (file: string) =>
      fs.existsSync(at(file)) ? fs.readFileSync(at(file), "utf8") : null;
    const liveResults = {
      w: read("w"),
      o: read("o"),
      copied: fs.existsSync(at("c/e")),
      removed: !fs.existsSync(at("d")),
      exclusiveMode: fs.existsSync(at("x"))
        ? fs.statSync(at("x")).mode & 0o777
        : null,
    };

    // A host write holds the root, so every call that passes its checks
    // queues; it is released only after the caller's execution has ended.
    const [held] = holdStagedWrites(1);
    const holder = rwfs.writeFile("/held", "h");
    await settleWithin(held.inFlight);
    const controller = new AbortController();
    const stopped = bash.exec("queued", { signal: controller.signal });
    await settleWithin(issued.inFlight);
    controller.abort();
    expect(await settleWithin(stopped)).toMatchObject(ABORTED);
    held.release();
    expect(await settleWithin(holder)).toBeUndefined();
    expect(await settleWithin(settled.inFlight)).toBeUndefined();

    // Every hook ran at its call, where the sandbox blocked it, and none ran
    // later. Paths, content objects, modes and times never reach a hook, and
    // neither do the accessors of the copied bytes.
    const hooksAtCall = [
      "cp options",
      "createExclusive options",
      "mkdir options",
      "rm options",
      "writeFile options",
    ];
    expect([...hookRuns].sort()).toEqual(
      ["live", "queued"].flatMap((phase) =>
        hooksAtCall.map((call) => `${phase} ${call}: blocked`),
      ),
    );
    // Non-string paths, object content, object modes and non-Date times are
    // rejected at the call; everything else ran live, and was dropped once
    // queued.
    const rejectedAtCall = new Set([
      "writeFile path",
      "writeFile content",
      "mv",
      "chmod",
      "symlink",
      "link",
      "utimes",
    ]);
    const calls = mutations(rwfs, liveArguments).map(([call]) => call);
    expect(outcomes).toEqual(
      new Map(
        ["live", "queued"].flatMap((phase) =>
          calls.map((call) => [
            `${phase} ${call}`,
            rejectedAtCall.has(call)
              ? "TypeError"
              : phase === "live"
                ? "done"
                : "ECANCELED",
          ]),
        ),
      ),
    );
    // The owned copies kept the caller's values.
    expect(liveResults).toEqual({
      w: "b",
      o: "o",
      copied: true,
      removed: true,
      exclusiveMode: 0o600,
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
