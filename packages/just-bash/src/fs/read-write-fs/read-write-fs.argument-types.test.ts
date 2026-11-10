import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { defineCommand } from "../../custom-commands.js";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "../../security/defense-in-depth-box.js";
import { settleWithin } from "../../test-utils/fs-gates.js";
import type { IFileSystem } from "../interface.js";
import { ReadWriteFs } from "./read-write-fs.js";

const OK = { stdout: "", stderr: "", exitCode: 0 };

// A mutation runs outside its caller's execution, so an argument of an
// unexpected type must be rejected at the call: the operation would otherwise
// inspect it again out there, running caller code unsandboxed.
describe("ReadWriteFs mutation argument types", () => {
  let root: string;
  const hookRuns: string[] = [];
  const probe = (label: string) => {
    let outcome = "allowed";
    try {
      // @banned-pattern-ignore: asserts the sandbox still blocks this inside a caller's hook
      new Function("return 1")();
    } catch (error) {
      outcome =
        error instanceof SecurityViolationError ? "blocked" : String(error);
    }
    hookRuns.push(`${label}: ${outcome}`);
  };
  // Runs one mutation from an untrusted command and returns how it settled.
  const mutateFrom = async (mutate: (cmdFs: IFileSystem) => Promise<void>) => {
    let settled = "unsettled";
    const command = defineCommand(
      "mutate",
      async (_args, ctx) => {
        try {
          await mutate(ctx.fs);
          settled = "done";
        } catch (error) {
          settled = String(error);
        }
        return OK;
      },
      { trusted: false },
    );
    const bash = new Bash({
      fs: new ReadWriteFs({ root }),
      customCommands: [command],
      defenseInDepth: true,
    });
    expect(await settleWithin(bash.exec("mutate"))).toMatchObject(OK);
    return settled;
  };

  beforeEach(() => {
    DefenseInDepthBox.resetInstance();
    hookRuns.length = 0;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-argument-types-"));
  });

  afterEach(() => {
    DefenseInDepthBox.resetInstance();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects a non-string encoding before a prototype getter can read it", async () => {
    // The sandbox can define this getter too; it is planted here so the test
    // does not depend on that.
    Object.defineProperty(Number.prototype, "encoding", {
      configurable: true,
      get() {
        probe("Number.prototype.encoding");
        return undefined;
      },
    });
    let settled: string;
    try {
      settled = await mutateFrom((cmdFs) =>
        cmdFs.writeFile("/n", "x", { encoding: 5 as never }),
      );
    } finally {
      delete (Number.prototype as { encoding?: unknown }).encoding;
    }

    expect(hookRuns).toEqual([]);
    expect(settled).toBe("TypeError: write: encoding must be a string");
    expect(fs.existsSync(path.join(root, "n"))).toBe(false);
  });

  it("rejects byte content that is not a genuine Uint8Array", async () => {
    // Not a Uint8Array to the first prototype lookup, a Uint8Array after.
    let lookups = 0;
    const flipping = new Proxy(new Uint8Array([98]), {
      getPrototypeOf() {
        probe("getPrototypeOf");
        return lookups++ === 0 ? Object.prototype : Uint8Array.prototype;
      },
      get(target, key) {
        probe("get");
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const settled = await mutateFrom((cmdFs) =>
      cmdFs.writeFile("/f", flipping),
    );

    expect(hookRuns).toEqual([]);
    expect(settled).toBe(
      "TypeError: write: content must be a string or a Uint8Array",
    );
    expect(fs.existsSync(path.join(root, "f"))).toBe(false);
  });
});
