import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { ReadWriteFs } from "../fs/read-write-fs/read-write-fs.js";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
  "du unreadable directory - Real Bash Comparison",
  () => {
    let testDir: string;
    beforeEach(async () => {
      testDir = await createTestDir();
    });
    afterEach(async () => {
      await chmod(join(testDir, "data/locked"), 0o755);
      await chmod(join(testDir, "data/no-search"), 0o755).catch(
        () => undefined,
      );
      await cleanupTestDir(testDir);
    });

    it("summarizes accessible contents and reports failure", async () => {
      await setupFiles(testDir, {
        "data/docs/notes.txt": "notes\n",
        "data/locked/secret.txt": "secret\n",
      });
      await chmod(join(testDir, "data/locked"), 0o000);
      const env = new Bash({
        fs: new ReadWriteFs({ root: testDir }),
        cwd: "/",
      });
      expect(await env.exec("du -s data")).toMatchObject({
        stdout: "1\tdata\n",
        stderr: "du: cannot read directory 'data/locked': Permission denied\n",
        exitCode: 1,
      });
      expect(await env.exec("du data/locked/secret.txt")).toMatchObject({
        stdout: "",
        stderr:
          "du: cannot access 'data/locked/secret.txt': Permission denied\n",
        exitCode: 1,
      });
      // Native block allocation varies by filesystem; compare paths/diagnostics,
      // and assert just-bash's byte-derived sizes separately above.
      await compareOutputs(
        env,
        testDir,
        'out=$(du -s data 2>errors); status=$?; echo "$out" | cut -f2; cat errors; echo "status:$status"',
      );
    });

    it("retains diagnostics and sizes across a failed child stat", async () => {
      await setupFiles(testDir, {
        "data/a/file": "before",
        "data/locked/file": "locked",
        "data/no-search/file": "inaccessible",
        "data/z/file": "after",
        "other/file": "other",
      });
      await chmod(join(testDir, "data/locked"), 0o000);
      await chmod(join(testDir, "data/no-search"), 0o444);
      const env = new Bash({
        fs: new ReadWriteFs({ root: testDir }),
        cwd: "/",
      });
      expect(await env.exec("du data other")).toMatchObject({
        stdout:
          "1\tdata/a\n1\tdata/locked\n1\tdata/no-search\n1\tdata/z\n1\tdata\n1\tother\n",
        stderr:
          "du: cannot read directory 'data/locked': Permission denied\ndu: cannot access 'data/no-search/file': Permission denied\n",
        exitCode: 1,
      });
      // Human-readable mode exposes these small byte totals without block rounding:
      // six bytes before the failures, five after, and eleven in the parent.
      expect(await env.exec("du -h data other")).toMatchObject({
        stdout:
          "6\tdata/a\n0\tdata/locked\n0\tdata/no-search\n5\tdata/z\n11\tdata\n5\tother\n",
        stderr:
          "du: cannot read directory 'data/locked': Permission denied\ndu: cannot access 'data/no-search/file': Permission denied\n",
        exitCode: 1,
      });
      await compareOutputs(
        env,
        testDir,
        'out=$(du data other 2>errors); status=$?; echo "$out" | cut -f2 | sort; sort errors; echo "status:$status"',
      );
    });

    it.each([
      "data/",
      "data///",
      "./data//",
      ".",
    ])("formats paths for operand %s", async (operand) => {
      await setupFiles(testDir, { "data/locked/file": "locked" });
      await chmod(join(testDir, "data/locked"), 0o000);
      const env = new Bash({
        fs: new ReadWriteFs({ root: testDir }),
        cwd: "/",
      });
      await compareOutputs(
        env,
        testDir,
        `out=$(du ${operand} 2>errors); status=$?; echo "$out" | cut -f2; cat errors; echo "status:$status"`,
      );
    });
  },
);
