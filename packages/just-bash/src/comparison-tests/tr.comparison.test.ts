import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("tr command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("character translation", () => {
    it("should translate lowercase to uppercase", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | tr 'a-z' 'A-Z'");
    });

    it("should translate uppercase to lowercase", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "HELLO WORLD\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | tr 'A-Z' 'a-z'");
    });

    it("should translate specific characters", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | tr 'elo' 'xyz'");
    });

    it("should translate digits", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "12345\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | tr '0-9' 'a-j'");
    });
  });

  describe("-d flag (delete)", () => {
    it("should delete specified characters", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | tr -d 'aeiou'");
    });

    it("should delete digits", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "abc123def456\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | tr -d '0-9'");
    });

    it("should delete spaces", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world foo bar\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | tr -d ' '");
    });

    it("should delete newlines", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line1\nline2\nline3\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | tr -d '\\n'");
    });
  });

  describe("-s flag (squeeze)", () => {
    it("should squeeze repeated characters", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "helllo   wooorld\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | tr -s 'lo '");
    });

    it("should squeeze spaces", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello    world   foo\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | tr -s ' '");
    });

    it("should squeeze newlines", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line1\n\n\nline2\n\nline3\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | tr -s '\\n'");
    });
  });

  describe("special character sets", () => {
    it("should handle escaped characters", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello\tworld\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | tr '\\t' ' '");
    });

    it("should translate newlines to spaces", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line1\nline2\nline3\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | tr '\\n' ' '");
    });
  });

  describe("stdin from echo", () => {
    it("should translate from echo", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "echo 'hello' | tr 'a-z' 'A-Z'");
    });

    it("should delete from echo", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "echo 'hello world' | tr -d 'lo'");
    });
  });

  describe("combined operations", () => {
    it("should translate and squeeze", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "HELLO   WORLD\n",
      });
      await compareOutputs(
        env,
        testDir,
        "cat test.txt | tr 'A-Z' 'a-z' | tr -s ' '",
      );
    });
  });
});
