import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const binPath = resolve(__dirname, "../../../dist/bin/just-bash.js");

async function runBin(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.code ?? 1,
    };
  }
}

describe("tar bundled binary", () => {
  it("should show help", async () => {
    const result = await runBin(["-c", "tar --help"]);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("tar");
    expect(result.exitCode).toBe(0);
  });

  it("should create and list a tar archive", async () => {
    const result = await runBin([
      "-c",
      `
mkdir -p /tmp/tartest
echo "hello" > /tmp/tartest/file1.txt
echo "world" > /tmp/tartest/file2.txt
tar -cf /tmp/test.tar -C /tmp/tartest file1.txt file2.txt
tar -tf /tmp/test.tar
`,
      "--allow-write",
    ]);
    expect(result.stdout).toContain("file1.txt");
    expect(result.stdout).toContain("file2.txt");
    expect(result.exitCode).toBe(0);
  });

  it("should create and extract a tar archive", async () => {
    const result = await runBin([
      "-c",
      `
mkdir -p /tmp/src
echo "content123" > /tmp/src/data.txt
tar -cf /tmp/archive.tar -C /tmp/src data.txt
mkdir -p /tmp/dest
tar -xf /tmp/archive.tar -C /tmp/dest
cat /tmp/dest/data.txt
`,
      "--allow-write",
    ]);
    expect(result.stdout).toContain("content123");
    expect(result.exitCode).toBe(0);
  });

  it("should create and extract a gzip-compressed archive", async () => {
    const result = await runBin([
      "-c",
      `
mkdir -p /tmp/gztest
echo "gzip content" > /tmp/gztest/file.txt
tar -czf /tmp/test.tar.gz -C /tmp/gztest file.txt
mkdir -p /tmp/gzout
tar -xzf /tmp/test.tar.gz -C /tmp/gzout
cat /tmp/gzout/file.txt
`,
      "--allow-write",
    ]);
    expect(result.stdout).toContain("gzip content");
    expect(result.exitCode).toBe(0);
  });

  it("should create and extract a bzip2-compressed archive", async () => {
    const result = await runBin([
      "-c",
      `
mkdir -p /tmp/bz2test
echo "bzip2 content" > /tmp/bz2test/file.txt
tar -cjf /tmp/test.tar.bz2 -C /tmp/bz2test file.txt
mkdir -p /tmp/bz2out
tar -xjf /tmp/test.tar.bz2 -C /tmp/bz2out
cat /tmp/bz2out/file.txt
`,
      "--allow-write",
    ]);
    expect(result.stdout).toContain("bzip2 content");
    expect(result.exitCode).toBe(0);
  });

  it("should create and extract an xz-compressed archive", async () => {
    const result = await runBin([
      "-c",
      `
mkdir -p /tmp/xztest
echo "xz content" > /tmp/xztest/file.txt
tar -cJf /tmp/test.tar.xz -C /tmp/xztest file.txt
mkdir -p /tmp/xzout
tar -xJf /tmp/test.tar.xz -C /tmp/xzout
cat /tmp/xzout/file.txt
`,
      "--allow-write",
    ]);
    expect(result.stdout).toContain("xz content");
    expect(result.exitCode).toBe(0);
  });

  it("should create and extract a zstd-compressed archive", async () => {
    const result = await runBin([
      "-c",
      `
mkdir -p /tmp/zsttest
echo "zstd content" > /tmp/zsttest/file.txt
tar --zstd -cf /tmp/test.tar.zst -C /tmp/zsttest file.txt
mkdir -p /tmp/zstout
tar --zstd -xf /tmp/test.tar.zst -C /tmp/zstout
cat /tmp/zstout/file.txt
`,
      "--allow-write",
    ]);
    expect(result.stdout).toContain("zstd content");
    expect(result.exitCode).toBe(0);
  });

  it("should auto-detect compression from filename (-a)", async () => {
    const result = await runBin([
      "-c",
      `
mkdir -p /tmp/autotest
echo "auto content" > /tmp/autotest/file.txt
tar -caf /tmp/auto.tar.gz -C /tmp/autotest file.txt
mkdir -p /tmp/autoout
tar -xf /tmp/auto.tar.gz -C /tmp/autoout
cat /tmp/autoout/file.txt
`,
      "--allow-write",
    ]);
    expect(result.stdout).toContain("auto content");
    expect(result.exitCode).toBe(0);
  });

  it("should use files-from (-T)", async () => {
    const result = await runBin([
      "-c",
      `
mkdir -p /tmp/ttest
echo "file1" > /tmp/ttest/a.txt
echo "file2" > /tmp/ttest/b.txt
echo "file3" > /tmp/ttest/c.txt
echo -e "a.txt\nc.txt" > /tmp/filelist.txt
tar -cf /tmp/ttest.tar -C /tmp/ttest -T /tmp/filelist.txt
tar -tf /tmp/ttest.tar
`,
      "--allow-write",
    ]);
    expect(result.stdout).toContain("a.txt");
    expect(result.stdout).toContain("c.txt");
    expect(result.stdout).not.toContain("b.txt");
    expect(result.exitCode).toBe(0);
  });

  it("should use exclude-from (-X)", async () => {
    const result = await runBin([
      "-c",
      `
mkdir -p /tmp/xtest
echo "file1" > /tmp/xtest/a.txt
echo "file2" > /tmp/xtest/b.txt
echo "file3" > /tmp/xtest/c.txt
echo "b.txt" > /tmp/excludelist.txt
tar -cf /tmp/xtest.tar -C /tmp/xtest -X /tmp/excludelist.txt .
tar -tf /tmp/xtest.tar
`,
      "--allow-write",
    ]);
    expect(result.stdout).toContain("a.txt");
    expect(result.stdout).toContain("c.txt");
    expect(result.stdout).not.toContain("b.txt");
    expect(result.exitCode).toBe(0);
  });

  it("should preserve file permissions", async () => {
    const result = await runBin([
      "-c",
      `
mkdir -p /tmp/permtest
echo "script" > /tmp/permtest/run.sh
chmod 755 /tmp/permtest/run.sh
tar -cf /tmp/perm.tar -C /tmp/permtest run.sh
tar -tvf /tmp/perm.tar
`,
      "--allow-write",
    ]);
    expect(result.stdout).toContain("rwxr-xr-x");
    expect(result.exitCode).toBe(0);
  });

  it("should handle verbose output (-v)", async () => {
    const result = await runBin([
      "-c",
      `
mkdir -p /tmp/vtest
echo "data" > /tmp/vtest/file.txt
tar -cvf /tmp/verbose.tar -C /tmp/vtest file.txt
`,
      "--allow-write",
    ]);
    // Verbose output goes to stderr
    expect(result.stderr).toContain("file.txt");
    expect(result.exitCode).toBe(0);
  });
});
