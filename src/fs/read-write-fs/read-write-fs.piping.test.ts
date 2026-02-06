import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ReadWriteFs } from "./read-write-fs.js";

/**
 * Test piping with ReadWriteFs (real filesystem)
 * This test suite validates that just-bash can handle large data through pipes
 * when using ReadWriteFs backed by the real filesystem.
 */
describe("ReadWriteFs - Piping with large data", () => {
  let tempDir: string;
  let fs: ReadWriteFs;
  let bash: Bash;

  beforeAll(async () => {
    // Create a real temp directory
    tempDir = await mkdtemp(join(tmpdir(), "bash-test-"));
    console.log("Created temp dir:", tempDir);

    // Use ReadWriteFs with real filesystem
    fs = new ReadWriteFs({ root: tempDir });
    bash = new Bash({ fs });
  });

  afterAll(async () => {
    // Cleanup
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      console.log("Cleaned up temp dir:", tempDir);
    }
  });

  it("should handle large data with wc -l using ReadWriteFs", async () => {
    // Create large text data with trailing newline (standard for text files)
    const lines = Array.from({ length: 50000 }, (_, i) => `Line ${i + 1}`);
    const largeText = `${lines.join("\n")}\n`;

    console.log(
      `Generated text size: ${(largeText.length / 1024 / 1024).toFixed(2)}MB`,
    );
    console.log(`Line count: ${lines.length}`);

    // Write to file
    await fs.writeFile("/data.txt", largeText);

    // Test piping through cat
    const result = await bash.exec("cat /data.txt | wc -l");

    console.log("Result stdout:", result.stdout.trim());
    console.log("Result stderr:", result.stderr);
    console.log("Result exitCode:", result.exitCode);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("50000");
  }, 30000);

  it("should handle large data with wc -l FILENAME using ReadWriteFs", async () => {
    // Create large text data with trailing newline
    const lines = Array.from({ length: 50000 }, (_, i) => `Line ${i + 1}`);
    const largeText = `${lines.join("\n")}\n`;

    // Write to file
    await fs.writeFile("/data2.txt", largeText);

    // Test direct file access
    const result = await bash.exec("wc -l /data2.txt");

    console.log("Result stdout:", result.stdout.trim());
    console.log("Result exitCode:", result.exitCode);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toContain("50000");
  }, 30000);

  it("should handle small data with wc -l using ReadWriteFs", async () => {
    // Create small text data with trailing newline
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
    const smallText = `${lines.join("\n")}\n`;

    // Write to file
    await fs.writeFile("/small.txt", smallText);

    // Test piping through cat
    const result = await bash.exec("cat /small.txt | wc -l");

    console.log("Result stdout:", result.stdout.trim());
    console.log("Result exitCode:", result.exitCode);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("100");
  }, 30000);

  it("should handle medium data with multiple pipes", async () => {
    // Create medium text data with some repeated lines
    const lines = Array.from({ length: 10000 }, (_, i) => {
      // Create some duplicates
      const lineNum = Math.floor(i / 2);
      return `Line ${lineNum}`;
    });
    const mediumText = lines.join("\n");

    // Write to file
    await fs.writeFile("/medium.txt", mediumText);

    // Test piping through multiple commands
    const result = await bash.exec("cat /medium.txt | sort | uniq | wc -l");

    console.log("Result stdout:", result.stdout.trim());
    console.log("Result exitCode:", result.exitCode);

    expect(result.exitCode).toBe(0);
    // Should have 5000 unique lines (0-4999)
    expect(result.stdout.trim()).toBe("5000");
  }, 30000);

  it("should handle grep with large files", async () => {
    // Create large text data with specific patterns
    const lines = Array.from({ length: 20000 }, (_, i) => {
      if (i % 3 === 0) {
        return `MATCH Line ${i}`;
      }
      return `Other Line ${i}`;
    });
    const largeText = lines.join("\n");

    // Write to file
    await fs.writeFile("/grep-test.txt", largeText);

    // Test grep with wc
    const result = await bash.exec("grep MATCH /grep-test.txt | wc -l");

    console.log("Result stdout:", result.stdout.trim());
    console.log("Result exitCode:", result.exitCode);

    expect(result.exitCode).toBe(0);
    // Should match every 3rd line: 20000/3 = 6667 (rounded up)
    expect(result.stdout.trim()).toBe("6667");
  }, 30000);

  it("should handle binary data correctly", async () => {
    // Create binary data
    const binaryData = new Uint8Array(10000);
    for (let i = 0; i < binaryData.length; i++) {
      binaryData[i] = i % 256;
    }

    // Write binary file
    await fs.writeFile("/binary.bin", binaryData);

    // Test wc -c (byte count)
    const result = await bash.exec("wc -c /binary.bin");

    console.log("Result stdout:", result.stdout.trim());
    console.log("Result exitCode:", result.exitCode);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toContain("10000");
  }, 30000);
});

// Made with Bob
