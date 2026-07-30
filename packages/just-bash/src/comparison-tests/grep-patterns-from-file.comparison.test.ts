import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * `grep -f FILE` comparison tests.
 *
 * Fixtures are recorded against GNU grep 3.12, not the BSD grep that ships with
 * macOS, and are therefore locked. To re-record:
 *
 *   PATH=/opt/homebrew/opt/grep/libexec/gnubin:$PATH \
 *     RECORD_FIXTURES=force pnpm test:run \
 *     src/comparison-tests/grep-patterns-from-file.comparison.test.ts
 */
describe("grep -f - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  const patternFiles = {
    "pat.txt": "apple\nbanana\n",
    "hay.txt": "apple pie\ncherry\nbanana split\n",
  };

  const setFiles = {
    "list.txt": "apple\nbanana\ncherry\n",
    "keep.txt": "banana\ndate\napple\n",
  };

  describe("reading patterns", () => {
    it("should read patterns from a file", async () => {
      const env = await setupFiles(testDir, patternFiles);
      await compareOutputs(env, testDir, "grep -f pat.txt hay.txt");
    });

    it("should accept --file=FILE", async () => {
      const env = await setupFiles(testDir, patternFiles);
      await compareOutputs(env, testDir, "grep --file=pat.txt hay.txt");
    });

    it("should union -f patterns with -e patterns", async () => {
      const env = await setupFiles(testDir, patternFiles);
      await compareOutputs(env, testDir, "grep -f pat.txt -e cherry hay.txt");
    });

    it("should union patterns across repeated -f", async () => {
      const env = await setupFiles(testDir, {
        ...patternFiles,
        "p1.txt": "apple\n",
        "p2.txt": "banana\n",
      });
      await compareOutputs(env, testDir, "grep -f p1.txt -f p2.txt hay.txt");
    });

    it("should handle a pattern file without a trailing newline", async () => {
      const env = await setupFiles(testDir, {
        ...patternFiles,
        "notrail.txt": "apple\nbanana",
      });
      await compareOutputs(env, testDir, "grep -f notrail.txt hay.txt");
    });

    it("should read patterns from stdin with -f -", async () => {
      const env = await setupFiles(testDir, patternFiles);
      await compareOutputs(
        env,
        testDir,
        "printf 'app\\nban\\n' | grep -f - hay.txt",
      );
    });
  });

  describe("empty patterns", () => {
    it("should match every line for a blank pattern line", async () => {
      const env = await setupFiles(testDir, {
        ...patternFiles,
        "blank.txt": "\n",
      });
      await compareOutputs(env, testDir, "grep -f blank.txt hay.txt");
    });

    it("should match every line when a blank line is mixed in", async () => {
      const env = await setupFiles(testDir, {
        ...patternFiles,
        "mixed.txt": "foo\n\nbar\n",
      });
      await compareOutputs(env, testDir, "grep -f mixed.txt hay.txt");
    });

    it("should match nothing for an empty pattern file", async () => {
      const env = await setupFiles(testDir, {
        ...patternFiles,
        "empty.txt": "",
      });
      await compareOutputs(env, testDir, "grep -f empty.txt hay.txt");
    });

    it("should match nothing for grep -f /dev/null", async () => {
      const env = await setupFiles(testDir, patternFiles);
      await compareOutputs(env, testDir, "grep -f /dev/null hay.txt");
    });

    it("should print no count for an empty pattern file", async () => {
      const env = await setupFiles(testDir, {
        ...patternFiles,
        "empty.txt": "",
      });
      await compareOutputs(env, testDir, "grep -c -f empty.txt hay.txt");
    });

    it("should select every line with -v and an empty pattern file", async () => {
      const env = await setupFiles(testDir, {
        ...patternFiles,
        "empty.txt": "",
      });
      await compareOutputs(env, testDir, "grep -v -f empty.txt hay.txt");
    });
  });

  describe("set operations", () => {
    it("should intersect line sets with -F -x -f", async () => {
      const env = await setupFiles(testDir, setFiles);
      await compareOutputs(env, testDir, "grep -F -x -f keep.txt list.txt");
    });

    it("should subtract line sets with -F -x -v -f", async () => {
      const env = await setupFiles(testDir, setFiles);
      await compareOutputs(env, testDir, "grep -F -x -v -f keep.txt list.txt");
    });

    it("should count the intersection with -F -x -c -f", async () => {
      const env = await setupFiles(testDir, setFiles);
      await compareOutputs(env, testDir, "grep -F -x -c -f keep.txt list.txt");
    });

    it("should invert the union with -v -f", async () => {
      const env = await setupFiles(testDir, patternFiles);
      await compareOutputs(env, testDir, "grep -v -f pat.txt hay.txt");
    });
  });

  describe("modifiers", () => {
    it("should apply -i to file patterns", async () => {
      const env = await setupFiles(testDir, {
        "p1.txt": "apple\n",
        "caps.txt": "APPLE PIE\nApple\nnope\n",
      });
      await compareOutputs(env, testDir, "grep -i -f p1.txt caps.txt");
    });

    it("should apply -w to file patterns", async () => {
      const env = await setupFiles(testDir, {
        "p1.txt": "apple\n",
        "words.txt": "apple\npineapple\napple pie\n",
      });
      await compareOutputs(env, testDir, "grep -w -f p1.txt words.txt");
    });

    it("should keep -F patterns literal", async () => {
      const env = await setupFiles(testDir, {
        "meta.txt": "a.b\nx*y\n",
        "metahay.txt": "a.b\naxb\nx*y\nxy\n",
      });
      await compareOutputs(env, testDir, "grep -F -f meta.txt metahay.txt");
    });

    it("should treat file patterns as BREs by default", async () => {
      const env = await setupFiles(testDir, {
        "meta.txt": "a.b\nx*y\n",
        "metahay.txt": "a.b\naxb\nx*y\nxy\n",
      });
      await compareOutputs(env, testDir, "grep -f meta.txt metahay.txt");
    });

    it("should treat file patterns as EREs with -E", async () => {
      const env = await setupFiles(testDir, {
        ...setFiles,
        "ere.txt": "^a.+e$\nch.rry\n",
      });
      await compareOutputs(env, testDir, "grep -E -f ere.txt list.txt");
    });

    it("should print line numbers with -n", async () => {
      const env = await setupFiles(testDir, patternFiles);
      await compareOutputs(env, testDir, "grep -n -f pat.txt hay.txt");
    });

    it("should print only matches with -o", async () => {
      const env = await setupFiles(testDir, patternFiles);
      await compareOutputs(env, testDir, "grep -o -f pat.txt hay.txt");
    });

    it("should search recursively with -r", async () => {
      const env = await setupFiles(testDir, {
        "p1.txt": "apple\n",
        "sub/f1.txt": "apple tree\nnope\n",
      });
      await compareOutputs(env, testDir, "grep -r -f p1.txt sub");
    });
  });

  describe("errors", () => {
    it("should report a missing pattern file", async () => {
      const env = await setupFiles(testDir, patternFiles);
      await compareOutputs(env, testDir, "grep -f missing.txt hay.txt");
    });

    it("should report a directory pattern file", async () => {
      const env = await setupFiles(testDir, {
        ...patternFiles,
        "sub/f1.txt": "x\n",
      });
      await compareOutputs(env, testDir, "grep -f sub hay.txt");
    });
  });
});
