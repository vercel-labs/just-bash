import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { defineCommand } from "../../custom-commands.js";
import { DefenseInDepthBox } from "../../security/defense-in-depth-box.js";
import type { SecurityViolation } from "../../security/types.js";
import { ReadWriteFs } from "./read-write-fs.js";

const noAtime = (fs.constants as typeof fs.constants & { O_NOATIME?: number })
  .O_NOATIME;

/**
 * Hold the first matching open until released or failed. The hold awaits the real open
 * instead of returning its promise: a returned promise resolves through
 * Promise.prototype.then, which defense-in-depth drops once the caller has
 * been aborted, and the test would hang in its own spy.
 */
function holdOpen(matches: (file: string, flags: number) => boolean) {
  const originalOpen = fs.promises.open.bind(fs.promises);
  let release!: () => void;
  let fail!: (error: Error) => void;
  const gate = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  gate.catch(() => {});
  let markReached!: () => void;
  const reached = new Promise<void>((resolve) => {
    markReached = resolve;
  });
  let held = false;
  vi.spyOn(fs.promises, "open").mockImplementation(
    async (filePath, flags, mode) => {
      const numeric = typeof flags === "number" ? flags : 0;
      // Refuse O_NOATIME so Linux also takes the plain open fallback.
      if (noAtime !== undefined && (numeric & noAtime) !== 0) {
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      }
      if (!held && matches(String(filePath), numeric)) {
        held = true;
        markReached();
        await gate;
      }
      return await originalOpen(filePath, flags, mode);
    },
  );
  return { reached, release, fail };
}

const stagingWrite = (file: string) => file.includes(".just-bash-write-");
const copySource = (file: string, flags: number) =>
  path.basename(file) === "src.txt" &&
  (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0;

// A command, unlike a `>>` redirection, returns as soon as it is aborted.
const appendCommand = defineCommand(
  "append-more",
  async (_args, ctx) => {
    await ctx.fs.appendFile("/src.txt", "more\n");
    return { stdout: "", stderr: "", exitCode: 0 };
  },
  { trusted: false },
);

describe("ReadWriteFs mutation queue when a caller is aborted (#442)", () => {
  let root: string;
  let violations: string[];
  let defenseInDepth: {
    onViolation: (violation: SecurityViolation) => void;
  };

  beforeEach(() => {
    DefenseInDepthBox.resetInstance();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-concurrent-abort-"));
    violations = [];
    defenseInDepth = {
      onViolation: (violation) => violations.push(violation.type),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    DefenseInDepthBox.resetInstance();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function readRoot(name: string): string {
    return fs.readFileSync(path.join(root, name), "utf8");
  }

  function abortableBash() {
    return new Bash({
      fs: new ReadWriteFs({ root }),
      defenseInDepth,
      customCommands: [appendCommand],
      executionLimits: { maxExtensionCleanupTimeMs: 5 },
    });
  }

  it("skips a queued mutation whose caller's execution ended before its turn", async () => {
    const resumed: string[] = [];
    const makeDir = defineCommand(
      "make-dir",
      async (_args, ctx) => {
        await ctx.fs.mkdir("/b");
        resumed.push("make-dir");
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      { trusted: false },
    );
    const rwfs = new ReadWriteFs({ root });
    const bash = new Bash({
      fs: rwfs,
      defenseInDepth,
      customCommands: [makeDir],
      executionLimits: { maxExtensionCleanupTimeMs: 5 },
    });
    const mkdir = vi.spyOn(rwfs, "mkdir");
    const staging = holdOpen(stagingWrite);
    const controller = new AbortController();

    const first = bash.exec("echo a > /a");
    await staging.reached;
    const second = bash.exec("make-dir", { signal: controller.signal });
    await vi.waitFor(() => expect(mkdir).toHaveBeenCalled());
    controller.abort();
    const secondResult = await second;
    staging.release();
    const firstResult = await first;
    const thirdResult = await bash.exec("echo c > /c");

    expect(secondResult.stderr).toBe("bash: execution aborted\n");
    expect(secondResult.exitCode).toBe(124);
    expect(firstResult.exitCode).toBe(0);
    expect(thirdResult.exitCode).toBe(0);
    expect(fs.existsSync(path.join(root, "b"))).toBe(false);
    expect(readRoot("c")).toBe("c\n");
    // The skipped mutation never settles, so its caller never resumes.
    expect(resumed).toEqual([]);
    expect(violations).toContain("bound_callback_after_deactivate");
  });

  it("releases the root when the caller is aborted mid-mutation", async () => {
    const bash = abortableBash();
    const staging = holdOpen(stagingWrite);
    const controller = new AbortController();

    const first = bash.exec("touch /a", { signal: controller.signal });
    await staging.reached;
    controller.abort();
    const firstResult = await first;
    staging.release();
    const secondResult = await bash.exec("echo b > /b");

    expect(firstResult.stderr).toBe("bash: execution aborted\n");
    expect(firstResult.exitCode).toBe(124);
    expect(secondResult.exitCode).toBe(0);
    expect(readRoot("b")).toBe("b\n");
  });

  it.each([
    ["cp", "cp /src.txt /dst.txt", false],
    ["copy-on-write chmod", "chmod 600 /src.txt", true],
    ["copy-on-write touch", "touch -d 2020-01-01 /src.txt", true],
    ["copy-on-write append", "append-more", true],
  ])("releases the root when %s is aborted while opening its source", async (_, command, hardLinked) => {
    fs.writeFileSync(path.join(root, "src.txt"), "source\n");
    if (hardLinked) {
      fs.linkSync(path.join(root, "src.txt"), path.join(root, "other.txt"));
    }
    const bash = abortableBash();
    const source = holdOpen(copySource);
    const controller = new AbortController();

    const first = bash.exec(command, { signal: controller.signal });
    await source.reached;
    controller.abort();
    const firstResult = await first;
    source.release();
    const secondResult = await bash.exec("echo b > /b");

    expect(firstResult.stderr).toBe("bash: execution aborted\n");
    expect(firstResult.exitCode).toBe(124);
    expect(secondResult.exitCode).toBe(0);
    expect(readRoot("b")).toBe("b\n");
    if (hardLinked) expect(readRoot("other.txt")).toBe("source\n");
  });

  it("releases the root when a mutation fails", async () => {
    const rwfs = new ReadWriteFs({ root });
    const staging = holdOpen(stagingWrite);

    const first = rwfs.writeFile("/a", "a\n");
    await staging.reached;
    const second = rwfs.writeFile("/b", "b\n");
    staging.fail(Object.assign(new Error("EIO: i/o error"), { code: "EIO" }));

    await expect(first).rejects.toThrow("EIO");
    await second;
    expect(fs.existsSync(path.join(root, "a"))).toBe(false);
    expect(readRoot("b")).toBe("b\n");
  });
});
