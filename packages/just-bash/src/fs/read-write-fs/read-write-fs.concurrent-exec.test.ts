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
import type { SecurityViolation } from "../../security/types.js";
import { ReadWriteFs } from "./read-write-fs.js";

/** Hold replacement writes at their staging file until released. */
function holdStagingWrites(): { reached: Promise<void>; release: () => void } {
  const originalOpen = fs.promises.open.bind(fs.promises);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markReached!: () => void;
  const reached = new Promise<void>((resolve) => {
    markReached = resolve;
  });
  vi.spyOn(fs.promises, "open").mockImplementation(
    async (filePath, flags, mode) => {
      if (String(filePath).includes(".just-bash-write-")) {
        markReached();
        await gate;
      }
      return await originalOpen(filePath, flags, mode);
    },
  );
  return { reached, release };
}

type WriteObservation = { executionId: string | undefined; trusted: boolean };

/**
 * Record the execution and trust each file is written under. Every write
 * lstats its target, so this runs inside the queued operation itself.
 */
function observeWrites(): Map<string, WriteObservation[]> {
  const observed = new Map<string, WriteObservation[]>();
  const originalLstat = fs.promises.lstat.bind(fs.promises);
  vi.spyOn(fs.promises, "lstat").mockImplementation((target, options) => {
    let trusted = true;
    try {
      new Function("return 1");
    } catch (error) {
      if (!(error instanceof SecurityViolationError)) throw error;
      trusted = false;
    }
    const name = path.basename(String(target));
    const entries = observed.get(name) ?? [];
    entries.push({
      executionId: DefenseInDepthBox.getCurrentExecutionId(),
      trusted,
    });
    observed.set(name, entries);
    return originalLstat(target, options);
  });
  return observed;
}

const executionIdCommand = defineCommand("execution-id", async () => ({
  stdout: `${DefenseInDepthBox.getCurrentExecutionId()}\n`,
  stderr: "",
  exitCode: 0,
}));

describe("ReadWriteFs mutation queue across concurrent exec calls (#442)", () => {
  let root: string;
  let violations: string[];
  let defenseInDepth: {
    onViolation: (violation: SecurityViolation) => void;
  };

  beforeEach(() => {
    DefenseInDepthBox.resetInstance();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-concurrent-exec-"));
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

  it.each([
    ["one Bash instance", false],
    ["two Bash instances sharing one directory", true],
  ])("completes concurrent writes into one root from %s", async (_, separate) => {
    const first = new Bash({ fs: new ReadWriteFs({ root }), defenseInDepth });
    const second = separate
      ? new Bash({ fs: new ReadWriteFs({ root }), defenseInDepth })
      : first;

    const results = await Promise.all([
      first.exec("echo a > /a"),
      second.exec("echo b > /b"),
    ]);

    expect(results.map((result) => result.exitCode)).toEqual([0, 0]);
    expect(readRoot("a")).toBe("a\n");
    expect(readRoot("b")).toBe("b\n");
    expect(violations).toEqual([]);
  });

  it("runs a queued mutation under the execution that requested it", async () => {
    const rwfs = new ReadWriteFs({ root });
    const bash = new Bash({
      fs: rwfs,
      defenseInDepth,
      customCommands: [executionIdCommand],
    });
    const observed = observeWrites();
    const writeFile = vi.spyOn(rwfs, "writeFile");
    const staging = holdStagingWrites();

    const first = bash.exec("execution-id; echo a > /a");
    await staging.reached;
    const second = bash.exec("execution-id; echo b > /b");
    // The second write queues behind the first and is started when it ends.
    await vi.waitFor(() =>
      expect(writeFile).toHaveBeenCalledWith("/b", "", "binary"),
    );
    staging.release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.exitCode).toBe(0);
    expect(secondResult.exitCode).toBe(0);
    expect(firstResult.stdout).not.toBe(secondResult.stdout);
    const ids = (name: string) =>
      new Set(observed.get(name)?.map((entry) => entry.executionId));
    expect(ids("a")).toEqual(new Set([firstResult.stdout.trim()]));
    expect(ids("b")).toEqual(new Set([secondResult.stdout.trim()]));
  });

  it("runs a queued host mutation outside every execution", async () => {
    const rwfs = new ReadWriteFs({ root });
    const bash = new Bash({ fs: rwfs, defenseInDepth });
    const observed = observeWrites();
    const staging = holdStagingWrites();

    const execution = bash.exec("echo a > /a");
    await staging.reached;
    const hostWrite = rwfs.writeFile("/host", "host\n");
    staging.release();
    const [result] = await Promise.all([execution, hostWrite]);

    expect(result.exitCode).toBe(0);
    expect(
      new Set(observed.get("host")?.map((entry) => entry.executionId)),
    ).toEqual(new Set([undefined]));
    expect(readRoot("host")).toBe("host\n");
  });

  it.each([
    [true, false],
    [true, true],
    [false, false],
    [false, true],
  ])("keeps the caller's trust (trusted: %s, queued: %s)", async (trusted, queued) => {
    const writeProbe = defineCommand(
      "write-probe",
      async (_args, ctx) => {
        await ctx.fs.writeFile("/probe", "probe\n");
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      { trusted },
    );
    const rwfs = new ReadWriteFs({ root });
    const bash = new Bash({
      fs: rwfs,
      defenseInDepth,
      customCommands: [writeProbe],
    });
    const observed = observeWrites();
    const writeFile = vi.spyOn(rwfs, "writeFile");
    const staging = holdStagingWrites();

    const held = queued ? bash.exec("echo a > /a") : undefined;
    if (held) await staging.reached;
    const probe = bash.exec("write-probe");
    if (held) {
      // The probe's write queues behind the held one and starts when it ends.
      await vi.waitFor(() =>
        expect(writeFile.mock.calls.some(([file]) => file === "/probe")).toBe(
          true,
        ),
      );
    }
    staging.release();
    const [result] = await Promise.all([probe, held]);

    expect(result.exitCode).toBe(0);
    expect(readRoot("probe")).toBe("probe\n");
    expect(
      new Set(observed.get("probe")?.map((entry) => entry.trusted)),
    ).toEqual(new Set([trusted]));
  });
});
