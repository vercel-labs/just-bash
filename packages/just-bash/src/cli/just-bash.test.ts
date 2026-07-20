import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI_PATH = path.resolve(__dirname, "../../dist/cli/just-bash.js");

/**
 * Helper to run just-bash CLI and capture output
 */
function runCli(
  args: string[],
  options?: { cwd?: string; input?: string },
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = execSync(`node ${CLI_PATH} ${args.join(" ")}`, {
      cwd: options?.cwd,
      input: options?.input,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: result, stderr: "", exitCode: 0 };
  } catch (e) {
    const error = e as {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode: error.status ?? 1,
    };
  }
}

describe("just-bash CLI", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "just-bash-cli-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("help and version", () => {
    it("should show help with -h", () => {
      const result = runCli(["-h"]);
      expect(result.stdout).toContain("just-bash");
      expect(result.stdout).toContain("Usage:");
      expect(result.exitCode).toBe(0);
    });

    it("should show help with --help", () => {
      const result = runCli(["--help"]);
      expect(result.stdout).toContain("just-bash");
      expect(result.exitCode).toBe(0);
    });

    it("should show version with -v", () => {
      const result = runCli(["-v"]);
      expect(result.stdout).toContain("just-bash");
      expect(result.exitCode).toBe(0);
    }, 10000);

    it("should show version with --version", () => {
      const result = runCli(["--version"]);
      expect(result.stdout).toContain("just-bash");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("script execution with -c", () => {
    it("should execute inline script", () => {
      fs.writeFileSync(path.join(tempDir, "test.txt"), "hello world");
      const result = runCli(["-c", "'cat test.txt'", "--root", tempDir]);
      expect(result.stdout).toBe("hello world");
      expect(result.exitCode).toBe(0);
    });

    it("should execute echo command", () => {
      const result = runCli(["-c", "'echo hello'", "--root", tempDir]);
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle commands with pipes", () => {
      fs.writeFileSync(path.join(tempDir, "data.txt"), "apple\nbanana\ncherry");
      const result = runCli([
        "-c",
        "'cat data.txt | grep banana'",
        "--root",
        tempDir,
      ]);
      expect(result.stdout).toBe("banana\n");
      expect(result.exitCode).toBe(0);
    });

    it("should list files with ls", () => {
      fs.writeFileSync(path.join(tempDir, "file1.txt"), "a");
      fs.writeFileSync(path.join(tempDir, "file2.txt"), "b");
      const result = runCli(["-c", "'ls'", "--root", tempDir]);
      expect(result.stdout).toContain("file1.txt");
      expect(result.stdout).toContain("file2.txt");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("readOnly mode (default)", () => {
    it("should block writes by default", () => {
      const result = runCli([
        "-c",
        "'echo test > newfile.txt'",
        "--root",
        tempDir,
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("EROFS");
    });

    it("should block mkdir by default", () => {
      const result = runCli(["-c", "'mkdir newdir'", "--root", tempDir]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("EROFS");
    });

    it("should block rm by default", () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      const result = runCli(["-c", "'rm file.txt'", "--root", tempDir]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("EROFS");
    });

    it("should allow reads in readOnly mode", () => {
      fs.writeFileSync(path.join(tempDir, "readable.txt"), "can read this");
      const result = runCli(["-c", "'cat readable.txt'", "--root", tempDir]);
      expect(result.stdout).toBe("can read this");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("--allow-write flag", () => {
    it("should allow writes when --allow-write is specified", () => {
      const result = runCli([
        "-c",
        "'echo test > newfile.txt && cat newfile.txt'",
        "--root",
        tempDir,
        "--allow-write",
      ]);
      expect(result.stdout).toBe("test\n");
      expect(result.exitCode).toBe(0);
    });

    it("should allow mkdir when --allow-write is specified", () => {
      const result = runCli([
        "-c",
        "'mkdir newdir && ls'",
        "--root",
        tempDir,
        "--allow-write",
      ]);
      expect(result.stdout).toContain("newdir");
      expect(result.exitCode).toBe(0);
    });

    it("should not persist writes to real filesystem", () => {
      runCli([
        "-c",
        "'echo test > newfile.txt'",
        "--root",
        tempDir,
        "--allow-write",
      ]);
      // File should not exist on real filesystem
      expect(fs.existsSync(path.join(tempDir, "newfile.txt"))).toBe(false);
    });
  });

  describe("--root option", () => {
    it("should use specified root directory", () => {
      const subdir = path.join(tempDir, "subdir");
      fs.mkdirSync(subdir);
      fs.writeFileSync(path.join(subdir, "nested.txt"), "nested content");

      const result = runCli(["-c", "'cat nested.txt'", "--root", subdir]);
      expect(result.stdout).toBe("nested content");
      expect(result.exitCode).toBe(0);
    });

    it("should default to current directory", () => {
      fs.writeFileSync(path.join(tempDir, "cwd.txt"), "in cwd");
      const result = runCli(["-c", "'cat cwd.txt'"], { cwd: tempDir });
      expect(result.stdout).toBe("in cwd");
      expect(result.exitCode).toBe(0);
    });

    it("binds an explicit symlink root to its canonical target", () => {
      const target = path.join(tempDir, "root-target");
      const link = path.join(tempDir, "root-link");
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, "inside.txt"), "inside");
      try {
        fs.symlinkSync(target, link);
      } catch {
        return;
      }

      const result = runCli(["-c", "'cat inside.txt'", "--root", link]);

      expect(result.stdout).toBe("inside");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("does not reinterpret an inline-script positional from filesystem state", () => {
      const narrowRoot = path.join(tempDir, "narrow");
      fs.mkdirSync(narrowRoot);
      const result = runCli(["-c", "'echo unsafe'", narrowRoot]);

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "Error: script file cannot be combined with -c\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("treats a positional as a script file even when it names a directory", () => {
      fs.mkdirSync(path.join(tempDir, "script-name"));

      const result = runCli(["script-name"], {
        cwd: tempDir,
        input: "echo ignored",
      });

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "Error: Cannot read script file: script-name\nEIO: open '<path>'\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("preserves the legacy script-file positional root", () => {
      fs.writeFileSync(path.join(tempDir, "legacy.sh"), "printf compatible");
      const result = runCli(["legacy.sh", tempDir]);

      expect(result.stdout).toBe("compatible");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("accepts matching positional and explicit roots", () => {
      fs.writeFileSync(path.join(tempDir, "legacy.sh"), "printf compatible");
      const result = runCli(["legacy.sh", tempDir, "--root", tempDir]);

      expect(result.stdout).toBe("compatible");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("rejects conflicting positional and explicit roots", () => {
      const otherRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "just-bash-root-"),
      );
      fs.writeFileSync(path.join(tempDir, "legacy.sh"), "printf compatible");
      const result = runCli(["legacy.sh", tempDir, "--root", otherRoot]);
      fs.rmSync(otherRoot, { recursive: true, force: true });

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "Error: conflicting positional root and --root\n",
      );
      expect(result.exitCode).toBe(1);
    });
  });

  describe("--json output", () => {
    it("should output JSON with --json flag", () => {
      fs.writeFileSync(path.join(tempDir, "test.txt"), "content");
      const result = runCli([
        "-c",
        "'cat test.txt'",
        "--root",
        tempDir,
        "--json",
      ]);
      const json = JSON.parse(result.stdout);
      expect(json.stdout).toBe("content");
      expect(json.stderr).toBe("");
      expect(json.exitCode).toBe(0);
    });

    it("should include stderr in JSON output", () => {
      const result = runCli([
        "-c",
        "'cat nonexistent.txt'",
        "--root",
        tempDir,
        "--json",
      ]);
      const json = JSON.parse(result.stdout);
      expect(json.exitCode).not.toBe(0);
      expect(json.stderr).toContain("No such file");
    });
  });

  describe("errexit mode", () => {
    it("should exit on first error with -e", () => {
      const result = runCli([
        "-e",
        "-c",
        "'false; echo should-not-print'",
        "--root",
        tempDir,
      ]);
      expect(result.stdout).not.toContain("should-not-print");
      expect(result.exitCode).not.toBe(0);
    });

    it("should exit on first error with --errexit", () => {
      const result = runCli([
        "--errexit",
        "-c",
        "'false; echo should-not-print'",
        "--root",
        tempDir,
      ]);
      expect(result.stdout).not.toContain("should-not-print");
      expect(result.exitCode).not.toBe(0);
    });

    it("should continue without errexit", () => {
      const result = runCli([
        "-c",
        "'false; echo should-print'",
        "--root",
        tempDir,
      ]);
      expect(result.stdout).toContain("should-print");
    });
  });

  describe("combined flags", () => {
    it("should handle -ec combined flags", () => {
      const result = runCli(["-ec", "'false; echo no'", "--root", tempDir]);
      expect(result.stdout).not.toContain("no");
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("stdin input", () => {
    it("should execute script from stdin", () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "stdin works");
      const result = runCli(["--root", tempDir], { input: "cat file.txt" });
      expect(result.stdout).toBe("stdin works");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("script file execution", () => {
    it("should execute script from file", () => {
      fs.writeFileSync(path.join(tempDir, "script.sh"), "echo from-script");
      const result = runCli(["script.sh", "--root", tempDir]);
      expect(result.stdout).toBe("from-script\n");
      expect(result.exitCode).toBe(0);
    });

    it("uses -- to execute a script file whose name starts with a dash", () => {
      fs.writeFileSync(path.join(tempDir, "-script.sh"), "echo dash-script");
      const result = runCli(["--root", tempDir, "--", "-script.sh"]);
      expect(result.stdout).toBe("dash-script\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("mount point behavior", () => {
    it("should mount files at /home/user/project", () => {
      fs.writeFileSync(path.join(tempDir, "test.txt"), "mounted");
      const result = runCli([
        "-c",
        "'cat /home/user/project/test.txt'",
        "--root",
        tempDir,
      ]);
      expect(result.stdout).toBe("mounted");
      expect(result.exitCode).toBe(0);
    });

    it("should set cwd to mount point by default", () => {
      const result = runCli(["-c", "'pwd'", "--root", tempDir]);
      expect(result.stdout.trim()).toBe("/home/user/project");
    });

    it("should allow --cwd to override working directory", () => {
      const result = runCli([
        "-c",
        "'pwd'",
        "--root",
        tempDir,
        "--cwd",
        "/tmp",
      ]);
      expect(result.stdout.trim()).toBe("/tmp");
    });

    it("should normalize --cwd to prevent path traversal", () => {
      // --cwd with .. should be normalized so it can't escape
      const result = runCli([
        "-c",
        "'pwd'",
        "--root",
        tempDir,
        "--cwd",
        "/home/user/project/../../..",
      ]);
      // .. components should be resolved, landing at /
      expect(result.stdout.trim()).toBe("/");
    });

    it("should normalize --cwd with relative-style path", () => {
      const result = runCli([
        "-c",
        "'pwd'",
        "--root",
        tempDir,
        "--cwd",
        "/home/./user/../user/project",
      ]);
      expect(result.stdout.trim()).toBe("/home/user/project");
    });
  });

  describe("error handling", () => {
    it("should error for unknown options", () => {
      const result = runCli(["--unknown-option"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown option");
    });

    it("should error when -c is missing argument", () => {
      const result = runCli(["-c"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("-c requires");
    });

    it("should error for non-existent root", () => {
      const result = runCli([
        "-c",
        "'echo test'",
        "--root",
        "/nonexistent/path/12345",
      ]);
      expect(result.exitCode).toBe(1);
    });
  });
});
