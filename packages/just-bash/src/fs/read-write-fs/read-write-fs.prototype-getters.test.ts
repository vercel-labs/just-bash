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
import { createGate, settleWithin } from "../../test-utils/fs-gates.js";
import type { IFileSystem } from "../interface.js";
import { ReadWriteFs } from "./read-write-fs.js";

const OK = { stdout: "", stderr: "", exitCode: 0 };
const ABORTED = {
  stdout: "",
  stderr: "bash: execution aborted\n",
  exitCode: 124,
};

// Sandboxed code can add a getter to a built-in prototype the box does not
// protect. Node and the library then read it on their own values, such as an
// option Node looks for, or a byte copy's length. Those reads happen inside a
// queued mutation, which must stay as restricted as its caller.
describe("ReadWriteFs mutations reading a planted prototype getter", () => {
  let root: string;
  const hookRuns = new Set<string>();
  const probe = (label: string) => {
    let outcome = "allowed";
    try {
      // @banned-pattern-ignore: asserts the sandbox still blocks this inside a planted getter
      new Function("return 1")();
    } catch (error) {
      outcome =
        error instanceof SecurityViolationError ? "blocked" : String(error);
    }
    hookRuns.add(`${label}: ${outcome}`);
  };
  const planted: Array<[object, string]> = [];
  // Called from the sandbox, which is allowed to plant on these prototypes.
  const plant = (target: object, key: string, label: string) => {
    const parent = Object.getPrototypeOf(target);
    const inherited = parent
      ? Object.getOwnPropertyDescriptor(parent, key)?.get
      : undefined;
    planted.push([target, key]);
    Object.defineProperty(target, key, {
      configurable: true,
      get(this: unknown) {
        probe(label);
        return inherited?.call(this);
      },
      // Assignments still create an own property, as without the getter.
      set(this: object, value: unknown) {
        Object.defineProperty(this, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      },
    });
  };
  const unplant = () => {
    for (const [target, key] of planted.splice(0)) {
      Reflect.deleteProperty(target, key);
    }
  };
  const untrusted = (
    name: string,
    run: (cmdFs: IFileSystem) => Promise<void>,
  ) =>
    defineCommand(
      name,
      async (_args, ctx) => {
        await run(ctx.fs);
        return OK;
      },
      { trusted: false },
    );

  beforeEach(() => {
    DefenseInDepthBox.resetInstance();
    hookRuns.clear();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-prototype-getters-"));
  });

  afterEach(() => {
    unplant();
    vi.restoreAllMocks();
    DefenseInDepthBox.resetInstance();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([
    [
      "Object.prototype.mode, which Node's mkdir reads",
      (cmdFs: IFileSystem) => {
        plant(Object.prototype, "mode", "mode");
        return cmdFs.mkdir("/made");
      },
      "mode",
      () => fs.statSync(path.join(root, "made")).isDirectory(),
    ],
    [
      "Object.prototype.signal, which Node's FileHandle.writeFile reads",
      (cmdFs: IFileSystem) => {
        plant(Object.prototype, "signal", "signal");
        return cmdFs.writeFile("/existing", "new");
      },
      "signal",
      () => fs.readFileSync(path.join(root, "existing"), "utf8") === "new",
    ],
    [
      "Uint8Array.prototype.byteLength, which replaceFile reads",
      (cmdFs: IFileSystem) => {
        plant(Uint8Array.prototype, "byteLength", "byteLength");
        return cmdFs.writeFile("/bytes", new Uint8Array([98]));
      },
      "byteLength",
      () => fs.readFileSync(path.join(root, "bytes"), "utf8") === "b",
    ],
  ])("keeps a getter on %s blocked", async (_name, mutate, label, applied) => {
    fs.writeFileSync(path.join(root, "existing"), "old");
    const bash = new Bash({
      fs: new ReadWriteFs({ root }),
      customCommands: [untrusted("mutate", mutate)],
      defenseInDepth: true,
    });

    expect(await settleWithin(bash.exec("mutate"))).toMatchObject(OK);
    unplant();
    expect([...hookRuns]).toEqual([`${label}: blocked`]);
    expect(applied()).toBe(true);
  });

  it("keeps a planted getter blocked after the caller's execution ends", async () => {
    // Hold Node's mkdir until the caller is gone and no other execution is
    // active, then let it read the getter.
    const originalMkdir = fs.promises.mkdir.bind(fs.promises);
    const held = createGate();
    const finished = createGate();
    vi.spyOn(fs.promises, "mkdir").mockImplementation(async (dir, options) => {
      const orphan = String(dir).endsWith(`${path.sep}orphan`);
      if (orphan) {
        held.reached();
        await held.released;
      }
      const made = await originalMkdir(dir, options);
      if (orphan) finished.reached();
      return made;
    });
    const bash = new Bash({
      fs: new ReadWriteFs({ root }),
      customCommands: [
        untrusted("orphan", (cmdFs) => {
          plant(Object.prototype, "mode", "mode");
          return cmdFs.mkdir("/orphan");
        }),
      ],
      defenseInDepth: true,
    });
    const controller = new AbortController();

    const stopped = bash.exec("orphan", { signal: controller.signal });
    await settleWithin(held.inFlight);
    controller.abort();
    expect(await settleWithin(stopped)).toMatchObject(ABORTED);
    held.release();
    expect(await settleWithin(finished.inFlight)).toBeUndefined();
    // Host code is not sandboxed, so take the getter away before it writes.
    unplant();

    const later = await settleWithin(
      // Defense off, so this write does not start an execution of its own.
      new Bash({ fs: new ReadWriteFs({ root }), defenseInDepth: false }).exec(
        "echo b > /b && cat /b",
      ),
    );
    expect(later).toMatchObject({ ...OK, stdout: "b\n" });
    expect([...hookRuns]).toEqual(["mode: blocked"]);
    expect(fs.statSync(path.join(root, "orphan")).isDirectory()).toBe(true);
  });
});
