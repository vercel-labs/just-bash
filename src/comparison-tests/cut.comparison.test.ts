import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("cut command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("-d and -f (delimiter and field)", () => {
    it("should cut first field with colon delimiter", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a:b:c\nd:e:f\ng:h:i\n",
      });
      await compareOutputs(env, testDir, "cut -d: -f1 test.txt");
    });

    it("should cut second field", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a:b:c\nd:e:f\ng:h:i\n",
      });
      await compareOutputs(env, testDir, "cut -d: -f2 test.txt");
    });

    it("should cut third field", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a:b:c\nd:e:f\ng:h:i\n",
      });
      await compareOutputs(env, testDir, "cut -d: -f3 test.txt");
    });

    it("should cut multiple fields", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a:b:c:d\ne:f:g:h\n",
      });
      await compareOutputs(env, testDir, "cut -d: -f1,3 test.txt");
    });

    it("should cut field range", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a:b:c:d\ne:f:g:h\n",
      });
      await compareOutputs(env, testDir, "cut -d: -f2-4 test.txt");
    });

    it("should handle tab delimiter", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a\tb\tc\nd\te\tf\n",
      });
      await compareOutputs(env, testDir, "cut -f1 test.txt");
    });

    it("should handle comma delimiter", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a,b,c\nd,e,f\n",
      });
      await compareOutputs(env, testDir, "cut -d, -f2 test.txt");
    });

    it("should handle space delimiter", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "one two three\nfour five six\n",
      });
      await compareOutputs(env, testDir, 'cut -d" " -f2 test.txt');
    });
  });

  describe("-c (characters)", () => {
    it("should cut single character", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "abcdefghij\n1234567890\n",
      });
      await compareOutputs(env, testDir, "cut -c1 test.txt");
    });

    it("should cut character range", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "abcdefghij\n1234567890\n",
      });
      await compareOutputs(env, testDir, "cut -c1-5 test.txt");
    });

    it("should cut multiple characters", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "abcdefghij\n1234567890\n",
      });
      await compareOutputs(env, testDir, "cut -c1,3,5 test.txt");
    });

    it("should cut from character to end", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "abcdefghij\n1234567890\n",
      });
      await compareOutputs(env, testDir, "cut -c5- test.txt");
    });

    it("should cut from start to character", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "abcdefghij\n1234567890\n",
      });
      await compareOutputs(env, testDir, "cut -c-5 test.txt");
    });
  });

  describe("stdin", () => {
    it("should read from stdin", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, 'echo "a:b:c" | cut -d: -f2');
    });

    it("should cut characters from stdin", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, 'echo "hello" | cut -c1-3');
    });
  });

  describe("edge cases", () => {
    it("should handle missing field", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a:b\nc:d:e\n",
      });
      await compareOutputs(env, testDir, "cut -d: -f3 test.txt");
    });

    it("should handle empty fields", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a::c\n:b:\n",
      });
      await compareOutputs(env, testDir, "cut -d: -f2 test.txt");
    });
  });
});
