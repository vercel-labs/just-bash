import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
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
      // Ignore platform-dependent allocated block sizes; retain the operand and status.
      await compareOutputs(
        env,
        testDir,
        'out=$(du -s data 2>/dev/null); status=$?; echo "$out" | cut -f2; echo "status:$status"',
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
      await compareOutputs(
        env,
        testDir,
        'out=$(du data other 2>errors); status=$?; echo "$out" | cut -f2 | sort; cat errors; echo "status:$status"',
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
