import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./test-helpers.js";

describe("column command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should format whitespace-delimited input as table with -t", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a b c\\nd e f\\n' | column -t");
  });

  it("should align columns based on maximum width", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf 'short long\\nlonger x\\n' | column -t",
    );
  });

  it("should handle varying number of columns per row", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf 'a b c\\nd e\\nf\\n' | column -t",
    );
  });

  it("should use custom input delimiter with -s", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf 'a,b,c\\nd,e,f\\n' | column -t -s ','",
    );
  });

  it("should handle empty input", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf '' | column");
  });

  it("should handle file input", async () => {
    const env = await setupFiles(testDir, {
      "data.txt": "name age\nalice 30\nbob 25\n",
    });
    await compareOutputs(env, testDir, "column -t data.txt");
  });
});

describe("join command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should join two files on first field", async () => {
    const env = await setupFiles(testDir, {
      "a.txt": "1 apple\n2 banana\n3 cherry\n",
      "b.txt": "1 red\n2 yellow\n3 red\n",
    });
    await compareOutputs(env, testDir, "join a.txt b.txt");
  });

  it("should only output lines with matching keys", async () => {
    const env = await setupFiles(testDir, {
      "a.txt": "1 apple\n2 banana\n",
      "b.txt": "2 yellow\n3 red\n",
    });
    await compareOutputs(env, testDir, "join a.txt b.txt");
  });

  it("should join on specified fields with -1 and -2", async () => {
    const env = await setupFiles(testDir, {
      "a.txt": "apple 1\nbanana 2\n",
      "b.txt": "1 red\n2 yellow\n",
    });
    await compareOutputs(env, testDir, "join -1 2 -2 1 a.txt b.txt");
  });

  it("should use custom field separator with -t", async () => {
    const env = await setupFiles(testDir, {
      "a.csv": "1,apple,fruit\n2,banana,fruit\n",
      "b.csv": "1,red\n2,yellow\n",
    });
    await compareOutputs(env, testDir, "join -t ',' a.csv b.csv");
  });

  it("should print unpairable lines with -a 1", async () => {
    const env = await setupFiles(testDir, {
      "a.txt": "1 apple\n2 banana\n3 cherry\n",
      "b.txt": "1 red\n3 red\n",
    });
    await compareOutputs(env, testDir, "join -a 1 a.txt b.txt");
  });

  it("should print unpairable lines with -a 2", async () => {
    const env = await setupFiles(testDir, {
      "a.txt": "1 apple\n",
      "b.txt": "1 red\n2 yellow\n",
    });
    await compareOutputs(env, testDir, "join -a 2 a.txt b.txt");
  });

  it("should output only unpairable lines with -v", async () => {
    const env = await setupFiles(testDir, {
      "a.txt": "1 apple\n2 banana\n3 cherry\n",
      "b.txt": "1 red\n3 red\n",
    });
    await compareOutputs(env, testDir, "join -v 1 a.txt b.txt");
  });

  it("should handle empty files", async () => {
    const env = await setupFiles(testDir, {
      "a.txt": "",
      "b.txt": "1 x\n",
    });
    await compareOutputs(env, testDir, "join a.txt b.txt");
  });
});
