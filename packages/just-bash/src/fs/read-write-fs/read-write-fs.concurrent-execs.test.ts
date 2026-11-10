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

const OK = { stdout: "", stderr: "", exitCode: 0 };

// A hang fails the test instead of stalling it until the suite timeout.
function settleWithin<T>(promise: Promise<T>): Promise<T | "hung"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<"hung">((resolve) => {
    timer = setTimeout(() => resolve("hung"), 2000);
  });
  return Promise.race([promise, hung]).finally(() => clearTimeout(timer));
}

// Holds the first `count` opens that match open until each is released, so a
// test can act while they are in flight.
function holdOpens(matches: (filePath: string) => boolean, count: number) {
  const originalOpen = fs.promises.open.bind(fs.promises);
  const gates = Array.from({ length: count }, () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      reached = resolve;
    });
    return { inFlight, release, released, reached };
  });
  let held = 0;
  vi.spyOn(fs.promises, "open").mockImplementation(
    async (filePath, flags, mode) => {
      const gate = matches(String(filePath)) ? gates[held++] : undefined;
      if (gate) {
        gate.reached();
        await gate.released;
      }
      const handle = await originalOpen(filePath, flags, mode);
      return handle;
    },
  );
  return gates;
}

const holdStagedWrites = (count: number) =>
  holdOpens((filePath) => filePath.includes(".just-bash-write-"), count);

function saveCommand(file: string, trusted: boolean) {
  return defineCommand(
    "save",
    async (_args, ctx) => {
      await ctx.fs.writeFile(file, "s");
      return OK;
    },
    { trusted },
  );
}

describe("ReadWriteFs mutations from concurrent executions", () => {
  let root: string;
  const violations: string[] = [];
  const onViolation = (violation: SecurityViolation) => {
    violations.push(violation.type);
  };

  beforeEach(() => {
    DefenseInDepthBox.resetInstance();
    violations.length = 0;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-concurrent-execs-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    DefenseInDepthBox.resetInstance();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("settles parallel execs that write into one root", async () => {
    const bash = new Bash({
      fs: new ReadWriteFs({ root }),
      defenseInDepth: { onViolation },
    });

    const writes = await settleWithin(
      Promise.all([bash.exec("echo a > /a"), bash.exec("echo b > /b")]),
    );
    expect(writes).toMatchObject([OK, OK]);

    const read = await settleWithin(bash.exec("echo c > /c && cat /c /a /b"));
    expect(read).toMatchObject({ ...OK, stdout: "c\na\nb\n" });
    expect(violations).toEqual([]);
  });

  it("settles sibling sandboxes that create one directory at once", async () => {
    const sandbox = () =>
      new Bash({
        fs: new ReadWriteFs({ root }),
        defenseInDepth: { onViolation },
      });
    const [first, second, third] = [sandbox(), sandbox(), sandbox()];

    const mkdirs = await settleWithin(
      Promise.all([
        first.exec("mkdir -p /shared/dir"),
        second.exec("mkdir -p /shared/dir"),
      ]),
    );
    expect(mkdirs).toMatchObject([OK, OK]);

    const write = await settleWithin(
      third.exec("echo ok > /shared/dir/f && cat /shared/dir/f"),
    );
    expect(write).toMatchObject({ ...OK, stdout: "ok\n" });
    expect(violations).toEqual([]);
  });

  it("settles a direct write queued behind an exec's write", async () => {
    const rwfs = new ReadWriteFs({ root });
    const bash = new Bash({
      fs: rwfs,
      customCommands: [saveCommand("/a", false)],
      defenseInDepth: { onViolation },
    });
    const [execWrite, directWrite] = holdStagedWrites(2);

    const exec = bash.exec("save");
    await execWrite.inFlight;
    const direct = rwfs.writeFile("/direct.txt", "d");
    execWrite.release();
    await directWrite.inFlight;
    expect(await settleWithin(exec)).toMatchObject(OK);
    directWrite.release();

    expect(await settleWithin(direct)).not.toBe("hung");
    expect(fs.readFileSync(path.join(root, "direct.txt"), "utf8")).toBe("d");
  });

  it.each([
    ["a trusted", true],
    ["an untrusted", false],
  ])("releases the root when %s command stops while its write is in flight", async (_kind, trusted) => {
    const bash = new Bash({
      fs: new ReadWriteFs({ root }),
      customCommands: [saveCommand("/saved.txt", trusted)],
      defenseInDepth: { onViolation },
    });
    const [write] = holdStagedWrites(1);
    const controller = new AbortController();

    const stopped = bash.exec("save", { signal: controller.signal });
    await write.inFlight;
    controller.abort();
    expect(await settleWithin(stopped)).toMatchObject({ exitCode: 124 });
    write.release();

    const later = await settleWithin(bash.exec("echo b > /b && cat /b"));
    expect(later).toMatchObject({ ...OK, stdout: "b\n" });
  });

  it("releases the root when an exec is aborted while its queued mkdir runs", async () => {
    const sandbox = () =>
      new Bash({
        fs: new ReadWriteFs({ root }),
        defenseInDepth: { onViolation },
      });
    const originalMkdir = fs.promises.mkdir.bind(fs.promises);
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      reached = resolve;
    });
    vi.spyOn(fs.promises, "mkdir").mockImplementation(async (dir, options) => {
      if (String(dir).endsWith(`${path.sep}b`)) {
        reached();
        await released;
      }
      const made = await originalMkdir(dir, options);
      return made;
    });
    const holder = new AbortController();
    const queued = new AbortController();

    const a = sandbox().exec("mkdir /a; sleep 5", { signal: holder.signal });
    const b = sandbox().exec("mkdir /b", { signal: queued.signal });
    await inFlight;
    queued.abort();
    expect(await settleWithin(b)).toMatchObject({ exitCode: 124 });
    release();

    const c = await settleWithin(sandbox().exec("mkdir /c && echo made"));
    holder.abort();
    await settleWithin(a);
    expect(c).toMatchObject({ ...OK, stdout: "made\n" });
  });

  it("releases the root when a command stops while it copies a file", async () => {
    const copy = defineCommand(
      "copy",
      async (_args, ctx) => {
        await ctx.fs.cp("/src.txt", "/dst.txt");
        return OK;
      },
      { trusted: false },
    );
    const sandbox = () =>
      new Bash({
        fs: new ReadWriteFs({ root }),
        customCommands: [copy],
        defenseInDepth: { onViolation },
      });
    fs.writeFileSync(path.join(root, "src.txt"), "s");
    const [source] = holdOpens((filePath) => filePath.endsWith("src.txt"), 1);
    const holder = new AbortController();
    const copier = new AbortController();

    const a = sandbox().exec("sleep 5", { signal: holder.signal });
    const stopped = sandbox().exec("copy", { signal: copier.signal });
    await source.inFlight;
    copier.abort();
    expect(await settleWithin(stopped)).toMatchObject({ exitCode: 124 });
    source.release();

    const later = await settleWithin(sandbox().exec("echo b > /b && cat /b"));
    holder.abort();
    await settleWithin(a);
    expect(later).toMatchObject({ ...OK, stdout: "b\n" });
  });

  it("keeps an untrusted command restricted while its write is pending", async () => {
    const [write] = holdStagedWrites(1);
    let blocked: unknown;
    const probe = defineCommand(
      "probe",
      async (_args, ctx) => {
        const pending = ctx.fs.writeFile("/p.txt", "p");
        await write.inFlight;
        try {
          // @banned-pattern-ignore: asserts the sandbox still blocks this
          new Function("return 1")();
        } catch (error) {
          blocked = error;
        }
        write.release();
        await pending;
        return OK;
      },
      { trusted: false },
    );
    const bash = new Bash({
      fs: new ReadWriteFs({ root }),
      customCommands: [probe],
      defenseInDepth: { onViolation },
    });

    expect(await settleWithin(bash.exec("probe"))).toMatchObject(OK);
    expect(blocked).toBeInstanceOf(SecurityViolationError);
  });
});
