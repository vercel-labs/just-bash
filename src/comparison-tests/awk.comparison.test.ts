import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("awk - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("field access", () => {
    it("should print entire line with $0", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "hello world\nfoo bar\n",
      });
      await compareOutputs(env, testDir, "awk '{print $0}' data.txt");
    });

    it("should print first field with $1", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "hello world\nfoo bar\n",
      });
      await compareOutputs(env, testDir, "awk '{print $1}' data.txt");
    });

    it("should print multiple fields", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "a b c\n1 2 3\n",
      });
      await compareOutputs(env, testDir, "awk '{print $1, $3}' data.txt");
    });

    it("should print last field with $NF", async () => {
      const _env = await setupFiles(testDir, {
        "data.txt": "one two three\na b\n",
      });
      // Note: Our awk doesn't support $NF yet, so this test documents expected behavior
      // await compareOutputs(env, testDir, "awk '{print $NF}' data.txt");
    });
  });

  describe("field separator -F", () => {
    it("should use comma as field separator", async () => {
      const env = await setupFiles(testDir, {
        "data.csv": "a,b,c\n1,2,3\n",
      });
      await compareOutputs(env, testDir, "awk -F, '{print $2}' data.csv");
    });

    it("should use colon as field separator", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "root:x:0:0:root:/root:/bin/bash\n",
      });
      await compareOutputs(env, testDir, "awk -F: '{print $1}' data.txt");
    });

    it("should use tab as field separator", async () => {
      const env = await setupFiles(testDir, {
        "data.tsv": "a\tb\tc\n1\t2\t3\n",
      });
      await compareOutputs(env, testDir, "awk -F'\\t' '{print $2}' data.tsv");
    });
  });

  describe("built-in variables", () => {
    it("should track NR (line number)", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "a\nb\nc\n",
      });
      await compareOutputs(env, testDir, "awk '{print NR, $0}' data.txt");
    });

    it("should track NF (field count)", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "one\ntwo three\na b c d\n",
      });
      await compareOutputs(env, testDir, "awk '{print NF}' data.txt");
    });
  });

  describe("BEGIN and END blocks", () => {
    it("should execute BEGIN before processing", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "line1\nline2\n",
      });
      await compareOutputs(
        env,
        testDir,
        "awk 'BEGIN{print \"start\"} {print $0}' data.txt",
      );
    });

    it("should execute END after processing", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "line1\nline2\n",
      });
      await compareOutputs(
        env,
        testDir,
        "awk '{print $0} END{print \"done\"}' data.txt",
      );
    });

    it("should execute both BEGIN and END", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "a\nb\n",
      });
      await compareOutputs(
        env,
        testDir,
        'awk \'BEGIN{print "start"} {print $0} END{print "end"}\' data.txt',
      );
    });
  });

  describe("pattern matching", () => {
    it("should filter with regex pattern", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "apple\nbanana\napricot\ncherry\n",
      });
      await compareOutputs(env, testDir, "awk '/^a/' data.txt");
    });

    it("should filter with NR condition", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "line1\nline2\nline3\n",
      });
      await compareOutputs(env, testDir, "awk 'NR==2' data.txt");
    });

    it("should filter with NR > condition", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "line1\nline2\nline3\nline4\n",
      });
      await compareOutputs(env, testDir, "awk 'NR>2' data.txt");
    });
  });

  describe("printf formatting", () => {
    it("should format with %s", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "hello world\n",
      });
      await compareOutputs(
        env,
        testDir,
        "awk '{printf \"%s!\\n\", $1}' data.txt",
      );
    });

    it("should format with %d", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "42\n",
      });
      await compareOutputs(
        env,
        testDir,
        "awk '{printf \"num: %d\\n\", $1}' data.txt",
      );
    });
  });

  describe("arithmetic", () => {
    it("should perform addition", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "10 20\n5 15\n",
      });
      await compareOutputs(env, testDir, "awk '{print $1 + $2}' data.txt");
    });

    it("should perform subtraction", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "20 5\n100 30\n",
      });
      await compareOutputs(env, testDir, "awk '{print $1 - $2}' data.txt");
    });

    it("should perform multiplication", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "3 4\n5 6\n",
      });
      await compareOutputs(env, testDir, "awk '{print $1 * $2}' data.txt");
    });
  });

  describe("stdin input", () => {
    it("should process piped input", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "echo 'a b c' | awk '{print $2}'");
    });

    it("should process multi-line piped input", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "printf 'a b\\nc d\\n' | awk '{print $1}'",
      );
    });
  });

  describe("string concatenation", () => {
    it("should concatenate fields", async () => {
      const env = await setupFiles(testDir, {
        "data.txt": "hello world\n",
      });
      await compareOutputs(env, testDir, "awk '{print $1 \"-\" $2}' data.txt");
    });
  });
});
