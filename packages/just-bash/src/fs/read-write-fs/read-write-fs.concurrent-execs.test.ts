import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { Bash } from "../../Bash.js";
import { type CustomCommand, defineCommand } from "../../custom-commands.js";
import { ExecutionAbortedError } from "../../interpreter/errors.js";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "../../security/defense-in-depth-box.js";
import type { SecurityViolation } from "../../security/types.js";
import {
  createGate,
  holdStagedWrites,
  settleWithin,
} from "../../test-utils/fs-gates.js";
import { withUnhandledRejectionsTracked } from "../../test-utils/unhandled-rejections.js";
import type { IFileSystem } from "../interface.js";
import { ReadWriteFs } from "./read-write-fs.js";

const OK = { stdout: "", stderr: "", exitCode: 0 };
const ABORTED = {
  stdout: "",
  stderr: "bash: execution aborted\n",
  exitCode: 124,
};

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

// Mutations waiting for a root, read from the private queue.
function queuedMutations(root: string): number {
  const canonicalRoot = fs.realpathSync(root);
  const queue = (
    ReadWriteFs as unknown as { pendingMutations: Array<{ root: string }> }
  ).pendingMutations;
  return queue.filter((pending) => pending.root === canonicalRoot).length;
}

describe("ReadWriteFs mutations from concurrent executions", () => {
  let root: string;
  const violations: string[] = [];
  const onViolation = (violation: SecurityViolation) => {
    violations.push(violation.type);
  };
  const sandbox = (customCommands: CustomCommand[] = []) =>
    new Bash({
      fs: new ReadWriteFs({ root }),
      customCommands,
      defenseInDepth: { onViolation },
    });

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
    const bash = sandbox();

    const writes = await settleWithin(
      Promise.all([bash.exec("echo a > /a"), bash.exec("echo b > /b")]),
    );
    expect(writes).toMatchObject([OK, OK]);

    const read = await settleWithin(bash.exec("echo c > /c && cat /c /a /b"));
    expect(read).toMatchObject({ ...OK, stdout: "c\na\nb\n" });
    expect(violations).toEqual([]);
  });

  it("settles sibling sandboxes that create one directory at once", async () => {
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

    expect(await settleWithin(direct)).toBeUndefined();
    expect(fs.readFileSync(path.join(root, "direct.txt"), "utf8")).toBe("d");
  });

  it.each([
    ["a trusted", true],
    ["an untrusted", false],
  ])("releases the root when %s command stops while its write is in flight", async (_kind, trusted) => {
    const bash = sandbox([saveCommand("/saved.txt", trusted)]);
    const [write] = holdStagedWrites(1);
    const controller = new AbortController();

    const stopped = bash.exec("save", { signal: controller.signal });
    await write.inFlight;
    controller.abort();
    expect(await settleWithin(stopped)).toMatchObject(ABORTED);
    write.release();

    const later = await settleWithin(bash.exec("echo b > /b && cat /b"));
    expect(later).toMatchObject({ ...OK, stdout: "b\n" });
  });

  it.each([
    [
      "an rm",
      () => fs.mkdirSync(path.join(root, "victim", "dir"), { recursive: true }),
      (cmdFs: IFileSystem) => cmdFs.rm("/victim", { recursive: true }),
      () => fs.existsSync(path.join(root, "victim", "dir")),
    ],
    [
      "an existing-file overwrite",
      () => fs.writeFileSync(path.join(root, "victim"), "old"),
      (cmdFs: IFileSystem) => cmdFs.writeFile("/victim", "new"),
      () => fs.readFileSync(path.join(root, "victim"), "utf8") === "old",
    ],
  ])("releases the root when %s is aborted while queued behind another execution", async (_kind, setUp, mutate, untouched) => {
    setUp();
    const [held] = holdStagedWrites(1);
    const queued = createGate();
    const outcome: unknown[] = [];
    const queue = defineCommand(
      "queue",
      async (_args, ctx) => {
        const pending = mutate(ctx.fs);
        queued.reached();
        try {
          await pending;
          outcome.push("done");
        } catch (error) {
          outcome.push(error);
        }
        return OK;
      },
      { trusted: false },
    );
    const controller = new AbortController();

    const { result, rejections } = await withUnhandledRejectionsTracked(
      async () => {
        const holder = sandbox().exec("echo a > /a");
        await settleWithin(held.inFlight);
        const b = sandbox([queue]).exec("queue", { signal: controller.signal });
        await settleWithin(queued.inFlight);
        const queuedBehindHolder = queuedMutations(root);
        controller.abort();
        const aborted = await settleWithin(b);
        held.release();
        return {
          queuedBehindHolder,
          aborted,
          holder: await settleWithin(holder),
          later: await settleWithin(sandbox().exec("echo c > /c && cat /c")),
        };
      },
    );

    expect(result.queuedBehindHolder).toBe(1);
    expect(result.aborted).toMatchObject(ABORTED);
    expect(result.holder).toMatchObject(OK);
    expect(result.later).toMatchObject({ ...OK, stdout: "c\n" });
    // The queued mutation was dropped with its execution, not run for it.
    expect(outcome).toEqual([expect.any(ExecutionAbortedError)]);
    expect(untouched()).toBe(true);
    expect(rejections).toEqual([]);
  });

  it("releases the root when a copy is aborted during its EPERM fallback open", async () => {
    // openCopySource tries O_NOATIME only on Linux, and falls back when the
    // kernel answers EPERM for a file the process does not own. Take that
    // branch on every platform; the forced EPERM keeps any stand-in flag
    // value away from the kernel.
    const constants = fs.constants as { O_NOATIME?: number };
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    const hadNoAtime = constants.O_NOATIME !== undefined;
    Object.defineProperty(process, "platform", { value: "linux" });
    constants.O_NOATIME ??= 0o1000000;
    onTestFinished(() => {
      if (platform) Object.defineProperty(process, "platform", platform);
      if (!hadNoAtime) delete constants.O_NOATIME;
    });
    const noAtime = constants.O_NOATIME;
    const originalOpen = fs.promises.open.bind(fs.promises);
    const fallback = createGate();
    vi.spyOn(fs.promises, "open").mockImplementation(
      async (filePath, flags, mode) => {
        if (String(filePath).endsWith("src.txt")) {
          if ((Number(flags) & noAtime) !== 0) {
            throw Object.assign(new Error("EPERM: operation not permitted"), {
              code: "EPERM",
            });
          }
          fallback.reached();
          await fallback.released;
        }
        const handle = await originalOpen(filePath, flags, mode);
        return handle;
      },
    );
    const copy = defineCommand(
      "copy",
      async (_args, ctx) => {
        await ctx.fs.cp("/src.txt", "/dst.txt");
        return OK;
      },
      { trusted: false },
    );
    fs.writeFileSync(path.join(root, "src.txt"), "s");
    const controller = new AbortController();

    const stopped = sandbox([copy]).exec("copy", { signal: controller.signal });
    await settleWithin(fallback.inFlight);
    controller.abort();
    expect(await settleWithin(stopped)).toMatchObject(ABORTED);
    fallback.release();

    const later = await settleWithin(sandbox().exec("echo b > /b && cat /b"));
    expect(later).toMatchObject({ ...OK, stdout: "b\n" });
    // The copy was already running, so it finished.
    expect(fs.readFileSync(path.join(root, "dst.txt"), "utf8")).toBe("s");
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

    expect(await settleWithin(sandbox([probe]).exec("probe"))).toMatchObject(
      OK,
    );
    expect(blocked).toBeInstanceOf(SecurityViolationError);
  });
});
