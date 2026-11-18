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
  },
);
