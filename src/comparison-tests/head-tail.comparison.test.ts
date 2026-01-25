import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("head command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  const createLinesFile = (count: number) => {
    return `${Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
  };

  describe("default behavior", () => {
    it("should output first 10 lines by default", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": createLinesFile(20),
      });
      await compareOutputs(env, testDir, "head test.txt");
    });

    it("should handle file with fewer than 10 lines", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": createLinesFile(5),
      });
      await compareOutputs(env, testDir, "head test.txt");
    });
  });

  describe("-n option", () => {
    it("should output first n lines", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": createLinesFile(20),
      });
      await compareOutputs(env, testDir, "head -n 5 test.txt");
    });

    it("should handle -n larger than file", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": createLinesFile(3),
      });
      await compareOutputs(env, testDir, "head -n 10 test.txt");
    });

    it("should handle -n 1", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": createLinesFile(5),
      });
      await compareOutputs(env, testDir, "head -n 1 test.txt");
    });

    it("should handle -n with no space", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": createLinesFile(10),
      });
      await compareOutputs(env, testDir, "head -n3 test.txt");
    });
  });

  describe("stdin", () => {
    it("should read from stdin", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'echo -e "a\\nb\\nc\\nd\\ne" | head -n 3',
      );
    });
  });

  describe("multiple files", () => {
    it("should show headers for multiple files", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": createLinesFile(3),
        "b.txt": createLinesFile(3),
      });
      await compareOutputs(env, testDir, "head -n 2 a.txt b.txt");
    });
  });

  describe("-c option (bytes)", () => {
    it("should output first n bytes", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "Hello, World!\n",
      });
      await compareOutputs(env, testDir, "head -c 5 test.txt");
    });

    it("should handle -c with multiline content", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line1\nline2\nline3\n",
      });
      await compareOutputs(env, testDir, "head -c 10 test.txt");
    });

    it("should handle -c larger than file", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "short\n",
      });
      await compareOutputs(env, testDir, "head -c 100 test.txt");
    });
  });
});

describe("tail command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  const createLinesFile = (count: number) => {
    return `${Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
  };

  describe("default behavior", () => {
    it("should output last 10 lines by default", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": createLinesFile(20),
      });
      await compareOutputs(env, testDir, "tail test.txt");
    });

    it("should handle file with fewer than 10 lines", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": createLinesFile(5),
      });
      await compareOutputs(env, testDir, "tail test.txt");
    });
  });

  describe("-n option", () => {
    it("should output last n lines", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": createLinesFile(20),
      });
      await compareOutputs(env, testDir, "tail -n 5 test.txt");
    });

    it("should handle -n larger than file", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": createLinesFile(3),
      });
      await compareOutputs(env, testDir, "tail -n 10 test.txt");
    });

    it("should handle -n 1", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": createLinesFile(5),
      });
      await compareOutputs(env, testDir, "tail -n 1 test.txt");
    });

    it("should handle +n (from line n)", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": createLinesFile(10),
      });
      await compareOutputs(env, testDir, "tail -n +3 test.txt");
    });
  });

  describe("stdin", () => {
    it("should read from stdin", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'echo -e "a\\nb\\nc\\nd\\ne" | tail -n 2',
      );
    });
  });

  describe("multiple files", () => {
    it("should show headers for multiple files", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": createLinesFile(3),
        "b.txt": createLinesFile(3),
      });
      await compareOutputs(env, testDir, "tail -n 2 a.txt b.txt");
    });
  });

  describe("-c option (bytes)", () => {
    it("should output last n bytes", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "Hello, World!\n",
      });
      await compareOutputs(env, testDir, "tail -c 5 test.txt");
    });

    it("should handle -c with multiline content", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line1\nline2\nline3\n",
      });
      await compareOutputs(env, testDir, "tail -c 10 test.txt");
    });

    it("should handle -c larger than file", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "short\n",
      });
      await compareOutputs(env, testDir, "tail -c 100 test.txt");
    });
  });
});
