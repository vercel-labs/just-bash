import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTestDir,
  createTestDir,
  path,
  runRealBash,
  setupFiles,
} from "./fixture-runner.js";

describe("mkdir command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should create a single directory", async () => {
    const env = await setupFiles(testDir, {});

    await env.exec("mkdir newdir");
    await runRealBash("mkdir newdir2", testDir);

    // Check both directories exist
    const envResult = await env.exec("ls -1");
    const realResult = await runRealBash("ls -1", testDir);
    expect(envResult.stdout).toContain("newdir");
    expect(realResult.stdout).toContain("newdir2");
  });

  it("should create nested directories with -p", async () => {
    const env = await setupFiles(testDir, {});

    await env.exec("mkdir -p a/b/c");
    await runRealBash("mkdir -p a2/b2/c2", testDir);

    const envResult = await env.exec("ls a/b");
    const realResult = await runRealBash("ls a2/b2", testDir);
    expect(envResult.stdout.trim()).toBe("c");
    expect(realResult.stdout.trim()).toBe("c2");
  });

  it("should not fail with -p on existing directory", async () => {
    const env = await setupFiles(testDir, {
      "existing/.gitkeep": "",
    });

    const result = await env.exec("mkdir -p existing");
    expect(result.exitCode).toBe(0);
  });
});

describe("rm command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should remove a file", async () => {
    const env = await setupFiles(testDir, {
      "file.txt": "content",
    });

    await env.exec("rm file.txt");

    const result = await env.exec("ls");
    expect(result.stdout).not.toContain("file.txt");
  });

  it("should remove multiple files", async () => {
    const env = await setupFiles(testDir, {
      "a.txt": "",
      "b.txt": "",
      "c.txt": "",
    });

    await env.exec("rm a.txt b.txt");

    const result = await env.exec("ls");
    expect(result.stdout).not.toContain("a.txt");
    expect(result.stdout).not.toContain("b.txt");
    expect(result.stdout).toContain("c.txt");
  });

  it("should remove directory with -r", async () => {
    const env = await setupFiles(testDir, {
      "dir/file.txt": "content",
    });

    await env.exec("rm -r dir");

    const result = await env.exec("ls");
    expect(result.stdout).not.toContain("dir");
  });

  it("should handle -f for non-existent file", async () => {
    const env = await setupFiles(testDir, {});

    const result = await env.exec("rm -f nonexistent.txt");
    expect(result.exitCode).toBe(0);
  });
});

describe("cp command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should copy a file", async () => {
    const env = await setupFiles(testDir, {
      "source.txt": "hello world\n",
    });

    await env.exec("cp source.txt dest.txt");

    const sourceContent = await env.readFile(path.join(testDir, "source.txt"));
    const destContent = await env.readFile(path.join(testDir, "dest.txt"));
    expect(destContent).toBe(sourceContent);
  });

  it("should copy file to directory", async () => {
    const env = await setupFiles(testDir, {
      "file.txt": "content\n",
      "dir/.gitkeep": "",
    });

    await env.exec("cp file.txt dir/");

    const content = await env.readFile(path.join(testDir, "dir/file.txt"));
    expect(content).toBe("content\n");
  });

  it("should copy directory with -r", async () => {
    const env = await setupFiles(testDir, {
      "src/a.txt": "a content\n",
      "src/b.txt": "b content\n",
    });

    await env.exec("cp -r src dest");

    const result = await env.exec("ls dest");
    expect(result.stdout).toContain("a.txt");
    expect(result.stdout).toContain("b.txt");
  });

  it("should copy multiple files to directory", async () => {
    const env = await setupFiles(testDir, {
      "a.txt": "a\n",
      "b.txt": "b\n",
      "dir/.gitkeep": "",
    });

    await env.exec("cp a.txt b.txt dir/");

    const result = await env.exec("ls dir");
    expect(result.stdout).toContain("a.txt");
    expect(result.stdout).toContain("b.txt");
  });
});

describe("mv command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should rename a file", async () => {
    const env = await setupFiles(testDir, {
      "old.txt": "content\n",
    });

    await env.exec("mv old.txt new.txt");

    const result = await env.exec("ls");
    expect(result.stdout).not.toContain("old.txt");
    expect(result.stdout).toContain("new.txt");
  });

  it("should move file to directory", async () => {
    const env = await setupFiles(testDir, {
      "file.txt": "content\n",
      "dir/.gitkeep": "",
    });

    await env.exec("mv file.txt dir/");

    const rootLs = await env.exec("ls");
    const dirLs = await env.exec("ls dir");
    expect(rootLs.stdout).not.toContain("file.txt");
    expect(dirLs.stdout).toContain("file.txt");
  });

  it("should rename a directory", async () => {
    const env = await setupFiles(testDir, {
      "olddir/file.txt": "content\n",
    });

    await env.exec("mv olddir newdir");

    const result = await env.exec("ls");
    expect(result.stdout).not.toContain("olddir");
    expect(result.stdout).toContain("newdir");
  });

  it("should move multiple files to directory", async () => {
    const env = await setupFiles(testDir, {
      "a.txt": "a\n",
      "b.txt": "b\n",
      "dir/.gitkeep": "",
    });

    await env.exec("mv a.txt b.txt dir/");

    const rootLs = await env.exec("ls");
    const dirLs = await env.exec("ls dir");
    expect(rootLs.stdout).not.toContain("a.txt");
    expect(rootLs.stdout).not.toContain("b.txt");
    expect(dirLs.stdout).toContain("a.txt");
    expect(dirLs.stdout).toContain("b.txt");
  });
});

describe("touch command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should create an empty file", async () => {
    const env = await setupFiles(testDir, {});

    await env.exec("touch newfile.txt");

    const result = await env.exec("ls");
    expect(result.stdout).toContain("newfile.txt");

    const content = await env.readFile(path.join(testDir, "newfile.txt"));
    expect(content).toBe("");
  });

  it("should create multiple files", async () => {
    const env = await setupFiles(testDir, {});

    await env.exec("touch a.txt b.txt c.txt");

    const result = await env.exec("ls");
    expect(result.stdout).toContain("a.txt");
    expect(result.stdout).toContain("b.txt");
    expect(result.stdout).toContain("c.txt");
  });

  it("should not modify existing file content", async () => {
    const env = await setupFiles(testDir, {
      "existing.txt": "original content\n",
    });

    await env.exec("touch existing.txt");

    const content = await env.readFile(path.join(testDir, "existing.txt"));
    expect(content).toBe("original content\n");
  });
});

describe("pwd command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should output current working directory", async () => {
    const env = await setupFiles(testDir, {});

    const result = await env.exec("pwd");

    // On macOS, /var is a symlink to /private/var, so just check basename
    const baseName = path.basename(testDir);
    expect(result.stdout.trim()).toContain(baseName);
    expect(result.exitCode).toBe(0);
  });
});
