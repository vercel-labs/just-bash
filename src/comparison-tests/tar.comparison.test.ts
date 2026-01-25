import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("tar command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("create and list (-c -t)", () => {
    it("should create and list single file archive", async () => {
      const env = await setupFiles(testDir, {
        "hello.txt": "Hello, World!\n",
      });
      await compareOutputs(
        env,
        testDir,
        "tar -cf archive.tar hello.txt && tar -tf archive.tar",
      );
    });

    it("should create and list multiple files", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "Content 1\n",
        "file2.txt": "Content 2\n",
      });
      await compareOutputs(
        env,
        testDir,
        "tar -cf archive.tar file1.txt file2.txt && tar -tf archive.tar | sort",
      );
    });

    it("should create and list directory archive", async () => {
      const env = await setupFiles(testDir, {
        "mydir/file1.txt": "Content 1\n",
        "mydir/file2.txt": "Content 2\n",
      });
      await compareOutputs(
        env,
        testDir,
        "tar -cf archive.tar mydir && tar -tf archive.tar | sort",
      );
    });
  });

  describe("extract (-x)", () => {
    it("should create and extract single file", async () => {
      const env = await setupFiles(testDir, {
        "original.txt": "Original content\n",
      });
      await compareOutputs(
        env,
        testDir,
        "tar -cf archive.tar original.txt && rm original.txt && tar -xf archive.tar && cat original.txt",
      );
    });

    it("should create and extract directory", async () => {
      const env = await setupFiles(testDir, {
        "mydir/nested.txt": "Nested content\n",
      });
      await compareOutputs(
        env,
        testDir,
        "tar -cf archive.tar mydir && rm -rf mydir && tar -xf archive.tar && cat mydir/nested.txt",
      );
    });

    it("should extract to different directory with -C", async () => {
      const env = await setupFiles(testDir, {
        "source.txt": "Source content\n",
      });
      await compareOutputs(
        env,
        testDir,
        "tar -cf archive.tar source.txt && mkdir dest && tar -xf archive.tar -C dest && cat dest/source.txt",
      );
    });
  });

  describe("gzip compression (-z)", () => {
    it("should create and list gzip compressed archive", async () => {
      const env = await setupFiles(testDir, {
        "compress.txt": "Content to compress\n",
      });
      await compareOutputs(
        env,
        testDir,
        "tar -czf archive.tar.gz compress.txt && tar -tzf archive.tar.gz",
      );
    });

    it("should create and extract gzip compressed archive", async () => {
      const env = await setupFiles(testDir, {
        "compress.txt": "Compressed content\n",
      });
      await compareOutputs(
        env,
        testDir,
        "tar -czf archive.tar.gz compress.txt && rm compress.txt && tar -xzf archive.tar.gz && cat compress.txt",
      );
    });
  });

  describe("strip components (--strip)", () => {
    it("should strip leading path components on extract", async () => {
      const env = await setupFiles(testDir, {
        "deep/path/file.txt": "Deep content\n",
      });
      await compareOutputs(
        env,
        testDir,
        "tar -cf archive.tar deep/path/file.txt && mkdir out && tar -xf archive.tar -C out --strip-components=2 && cat out/file.txt",
      );
    });
  });
});
