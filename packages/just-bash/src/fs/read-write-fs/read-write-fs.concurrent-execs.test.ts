import * as fs from "node:fs";
import * as nodeModule from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { DefenseInDepthBox } from "../../security/defense-in-depth-box.js";
import type { SecurityViolation } from "../../security/types.js";
import { ReadWriteFs } from "./read-write-fs.js";

const describeDefense =
  typeof nodeModule.registerHooks === "function" ? describe : describe.skip;

// A hang fails the test instead of stalling it until the suite timeout.
function settleWithin<T>(promise: Promise<T>): Promise<T | "hung"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<"hung">((resolve) => {
    timer = setTimeout(() => resolve("hung"), 2000);
  });
  return Promise.race([promise, hung]).finally(() => clearTimeout(timer));
}

describeDefense("ReadWriteFs mutations from concurrent executions", () => {
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
    expect(writes).not.toBe("hung");

    const read = await settleWithin(bash.exec("echo c > /c && cat /a /b /c"));
    expect(read).toMatchObject({
      stdout: "a\nb\nc\n",
      stderr: "",
      exitCode: 0,
    });
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
    expect(mkdirs).not.toBe("hung");

    const write = await settleWithin(
      third.exec("echo ok > /shared/dir/f && cat /shared/dir/f"),
    );
    expect(write).toMatchObject({ stdout: "ok\n", stderr: "", exitCode: 0 });
    expect(violations).toEqual([]);
  });
});
