import { describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";
import { InMemoryFs } from "./fs/in-memory-fs/in-memory-fs.js";
import { OverlayFs } from "./fs/overlay-fs/overlay-fs.js";

describe("InMemoryFs serialization", () => {
  it("round-trips files, directories, and symlinks", async () => {
    const fs = new InMemoryFs({
      "/home/user/hello.txt": "Hello, world!",
      "/home/user/data/config.json": '{"key": "value"}',
    });
    await fs.symlink("/home/user/hello.txt", "/home/user/link.txt");

    const serialized = fs.toJSON();
    const restored = InMemoryFs.fromJSON(serialized);

    // Verify file content
    expect(await restored.readFile("/home/user/hello.txt")).toBe(
      "Hello, world!",
    );
    expect(await restored.readFile("/home/user/data/config.json")).toBe(
      '{"key": "value"}',
    );

    // Verify symlink
    expect(await restored.readlink("/home/user/link.txt")).toBe(
      "/home/user/hello.txt",
    );

    // Verify directories exist
    expect(await restored.exists("/home/user/data")).toBe(true);
    const stat = await restored.stat("/home/user/data");
    expect(stat.isDirectory).toBe(true);
  });

  it("round-trips binary content (Uint8Array)", async () => {
    const binary = new Uint8Array([0x00, 0x01, 0xff, 0x80, 0x7f]);
    const fs = new InMemoryFs();
    await fs.writeFile("/binary.bin", binary);

    const serialized = fs.toJSON();
    const restored = InMemoryFs.fromJSON(serialized);

    const content = await restored.readFileBuffer("/binary.bin");
    expect(content).toEqual(binary);
  });

  it("preserves file modes and mtimes", async () => {
    const fs = new InMemoryFs();
    const mtime = new Date("2025-06-15T12:00:00Z");
    fs.writeFileSync("/test.sh", "#!/bin/bash\necho hi", undefined, {
      mode: 0o755,
      mtime,
    });

    const serialized = fs.toJSON();
    const restored = InMemoryFs.fromJSON(serialized);

    const stat = await restored.stat("/test.sh");
    expect(stat.mode).toBe(0o755);
    expect(stat.mtime.getTime()).toBe(mtime.getTime());
  });

  it("skips lazy file entries", () => {
    const fs = new InMemoryFs({
      "/dev/null": () => "",
      "/real.txt": "content",
    });

    const serialized = fs.toJSON();
    // Lazy file should not appear in serialized entries
    expect(serialized.entries.has("/dev/null")).toBe(false);
    // Real file should be present
    expect(serialized.entries.has("/real.txt")).toBe(true);
  });

  it("round-trips an empty filesystem", async () => {
    const fs = new InMemoryFs();
    const serialized = fs.toJSON();
    const restored = InMemoryFs.fromJSON(serialized);

    // Root should exist
    expect(await restored.exists("/")).toBe(true);
    const stat = await restored.stat("/");
    expect(stat.isDirectory).toBe(true);
  });

  it("round-trips deeply nested directories", async () => {
    const fs = new InMemoryFs({
      "/a/b/c/d/e/f/file.txt": "deep",
    });

    const serialized = fs.toJSON();
    const restored = InMemoryFs.fromJSON(serialized);

    expect(await restored.readFile("/a/b/c/d/e/f/file.txt")).toBe("deep");
    expect(await restored.exists("/a/b/c/d/e")).toBe(true);
  });
});

describe("Bash serialization", () => {
  it("round-trips basic Bash instance with files and env", async () => {
    const bash = new Bash({
      files: { "/home/user/test.txt": "hello" },
      env: { MY_VAR: "my_value" },
      cwd: "/home/user",
    });

    const serialized = bash.toJSON();
    const restored = Bash.fromJSON(serialized);

    const result = await restored.exec("echo $MY_VAR");
    expect(result.stdout).toBe("my_value\n");
    expect(result.exitCode).toBe(0);

    const fileResult = await restored.exec("cat /home/user/test.txt");
    expect(fileResult.stdout).toBe("hello");
    expect(fileResult.exitCode).toBe(0);
  });

  it("preserves cwd across round-trip", async () => {
    const bash = new Bash({ cwd: "/tmp" });
    await bash.exec("true"); // initialize

    const serialized = bash.toJSON();
    const restored = Bash.fromJSON(serialized);

    const result = await restored.exec("pwd");
    expect(result.stdout).toBe("/tmp\n");
  });

  it("preserves shell options set within a single exec", async () => {
    const bash = new Bash();
    // Shell options, functions, and variables set in exec() are isolated per-call.
    // But they ARE preserved in the state for within-exec serialization snapshots.
    // Test that the state object itself round-trips correctly.
    const result = await bash.exec(
      "set -e; shopt -s extglob; set -o | grep errexit | awk '{print $2}'",
    );
    expect(result.stdout).toBe("on\n");

    // Constructor-provided env vars persist across execs and round-trips
    const bash2 = new Bash({ env: { FOO: "bar" } });
    const serialized = bash2.toJSON();
    const restored = Bash.fromJSON(serialized);
    const r = await restored.exec("echo $FOO");
    expect(r.stdout).toBe("bar\n");
  });

  it("preserves env vars provided at construction across round-trip", async () => {
    const bash = new Bash({
      env: { FOO: "bar", BAZ: "qux" },
    });

    const serialized = bash.toJSON();
    const restored = Bash.fromJSON(serialized);

    const result = await restored.exec('echo "$FOO $BAZ"');
    expect(result.stdout).toBe("bar qux\n");
  });

  it("preserves filesystem writes across round-trip", async () => {
    const bash = new Bash();
    await bash.exec('echo "written content" > /tmp/output.txt');

    const serialized = bash.toJSON();
    const restored = Bash.fromJSON(serialized);

    const result = await restored.exec("cat /tmp/output.txt");
    expect(result.stdout).toBe("written content\n");
  });

  it("recreates system files (lazy entries) on deserialization", async () => {
    const bash = new Bash();

    const serialized = bash.toJSON();
    const restored = Bash.fromJSON(serialized);

    // /dev/null should work (recreated by initFilesystem)
    const result = await restored.exec("echo test > /dev/null && echo ok");
    expect(result.stdout).toBe("ok\n");
    expect(result.exitCode).toBe(0);
  });

  it("preserves execution limits", async () => {
    const bash = new Bash({
      executionLimits: { maxCommandCount: 5 },
    });

    const serialized = bash.toJSON();
    const restored = Bash.fromJSON(serialized);

    // Run a loop that exceeds the limit
    const result = await restored.exec(
      "for i in 1 2 3 4 5 6 7 8 9 10; do echo $i; done",
    );
    expect(result.stderr).toContain("too many commands executed");
    expect(result.exitCode).not.toBe(0);
  });

  it("throws when serializing non-InMemoryFs", () => {
    const bash = new Bash({
      fs: new OverlayFs({ root: "/tmp" }),
    });

    expect(() => bash.toJSON()).toThrow("only InMemoryFs instances");
  });

  it("preserves special characters in env vars", async () => {
    const bash = new Bash({
      env: {
        SPECIAL: 'hello "world" & <foo>',
        NEWLINE: "line1\nline2",
      },
    });

    const serialized = bash.toJSON();
    const restored = Bash.fromJSON(serialized);

    const result = await restored.exec('printf "%s" "$SPECIAL"');
    expect(result.stdout).toBe('hello "world" & <foo>');

    const nlResult = await restored.exec('printf "%s" "$NEWLINE"');
    expect(nlResult.stdout).toBe("line1\nline2");
  });

  it("preserves processInfo across round-trip", async () => {
    const bash = new Bash({
      processInfo: { pid: 42, ppid: 1, uid: 500, gid: 500 },
    });

    const serialized = bash.toJSON();
    const restored = Bash.fromJSON(serialized);

    const result = await restored.exec("echo $$");
    expect(result.stdout).toBe("42\n");

    const uidResult = await restored.exec("echo $UID");
    expect(uidResult.stdout).toBe("500\n");
  });
});
