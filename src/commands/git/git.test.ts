import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("git", () => {
  describe("help and version", () => {
    it("should show help with --help", async () => {
      const env = new Bash();
      const result = await env.exec("git --help");
      expect(result.stdout).toContain("git");
      expect(result.stdout).toContain("stupid content tracker");
      expect(result.exitCode).toBe(0);
    });

    it("should show version with --version", async () => {
      const env = new Bash();
      const result = await env.exec("git --version");
      expect(result.stdout).toContain("git version");
      expect(result.exitCode).toBe(0);
    });

    it("should show help when called without arguments", async () => {
      const env = new Bash();
      const result = await env.exec("git");
      expect(result.stdout).toContain("Usage:");
      expect(result.exitCode).toBe(0);
    });

    it("should error on unknown subcommand", async () => {
      const env = new Bash();
      const result = await env.exec("git foobar");
      expect(result.stderr).toContain("'foobar' is not a git command");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("git init", () => {
    it("should initialize a new repository", async () => {
      const env = new Bash();
      const result = await env.exec("git init");
      expect(result.stdout).toContain("Initialized empty Git repository");
      expect(result.exitCode).toBe(0);
    });

    it("should reinitialize existing repository", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git init");
      expect(result.stdout).toContain("Reinitialized existing Git repository");
      expect(result.exitCode).toBe(0);
    });

    it("should support quiet mode with -q", async () => {
      const env = new Bash();
      const result = await env.exec("git init -q");
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should show help with --help", async () => {
      const env = new Bash();
      const result = await env.exec("git init --help");
      expect(result.stdout).toContain("Create an empty Git repository");
      expect(result.exitCode).toBe(0);
    });

    it("should error on unknown option", async () => {
      const env = new Bash();
      const result = await env.exec("git init --unknown");
      expect(result.stderr).toContain("unknown option");
      expect(result.exitCode).toBe(129);
    });
  });

  describe("git status", () => {
    it("should error when not in a repository", async () => {
      const env = new Bash();
      const result = await env.exec("git status");
      expect(result.stderr).toContain("not a git repository");
      expect(result.exitCode).toBe(128);
    });

    it("should show status on empty repository", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git status");
      expect(result.stdout).toContain("On branch main");
      expect(result.stdout).toContain("No commits yet");
      expect(result.exitCode).toBe(0);
    });

    it("should show untracked files", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      const result = await env.exec("git status");
      expect(result.stdout).toContain("Untracked files:");
      expect(result.stdout).toContain("test.txt");
      expect(result.exitCode).toBe(0);
    });

    it("should show staged files", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      const result = await env.exec("git status");
      expect(result.stdout).toContain("Changes to be committed:");
      expect(result.stdout).toContain("new file:");
      expect(result.stdout).toContain("test.txt");
      expect(result.exitCode).toBe(0);
    });

    it("should support short format with -s", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      const result = await env.exec("git status -s");
      expect(result.stdout).toBe("?? test.txt\n");
      expect(result.exitCode).toBe(0);
    });

    it("should show staged files in short format", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      const result = await env.exec("git status -s");
      expect(result.stdout).toBe("A  test.txt\n");
      expect(result.exitCode).toBe(0);
    });

    it("should show branch with -sb", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git status -sb");
      expect(result.stdout).toContain("## main");
      expect(result.exitCode).toBe(0);
    });

    it("should error on unknown option", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git status --unknown");
      expect(result.stderr).toContain("unknown option");
      expect(result.exitCode).toBe(129);
    });
  });

  describe("git add", () => {
    it("should error when not in a repository", async () => {
      const env = new Bash();
      const result = await env.exec("git add file.txt");
      expect(result.stderr).toContain("not a git repository");
      expect(result.exitCode).toBe(128);
    });

    it("should error when no files specified", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git add");
      expect(result.stderr).toContain("Nothing specified");
      expect(result.exitCode).toBe(0);
    });

    it("should add a file to staging", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      const addResult = await env.exec("git add test.txt");
      expect(addResult.exitCode).toBe(0);

      const statusResult = await env.exec("git status -s");
      expect(statusResult.stdout).toBe("A  test.txt\n");
    });

    it("should add all files with -A", async () => {
      const env = new Bash({
        files: {
          "/file1.txt": "content1\n",
          "/file2.txt": "content2\n",
        },
      });
      await env.exec("git init");
      await env.exec("git add -A");
      const result = await env.exec("git status -s");
      expect(result.stdout).toContain("A  file1.txt");
      expect(result.stdout).toContain("A  file2.txt");
    });

    it("should add all files with .", async () => {
      const env = new Bash({
        files: {
          "/file1.txt": "content1\n",
          "/file2.txt": "content2\n",
        },
      });
      await env.exec("git init");
      await env.exec("git add .");
      const result = await env.exec("git status -s");
      expect(result.stdout).toContain("A  file1.txt");
      expect(result.stdout).toContain("A  file2.txt");
    });

    it("should error on non-existent file", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git add nonexistent.txt");
      expect(result.stderr).toContain("did not match any files");
      expect(result.exitCode).toBe(128);
    });

    it("should error on unknown option", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git add --unknown file.txt");
      expect(result.stderr).toContain("unknown option");
      expect(result.exitCode).toBe(129);
    });
  });

  describe("git commit", () => {
    it("should error when not in a repository", async () => {
      const env = new Bash();
      const result = await env.exec('git commit -m "test"');
      expect(result.stderr).toContain("not a git repository");
      expect(result.exitCode).toBe(128);
    });

    it("should error when no message provided", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git commit");
      expect(result.stderr).toContain("switch `m' requires a value");
      expect(result.exitCode).toBe(129);
    });

    it("should error when nothing to commit", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec('git commit -m "test"');
      // Real git outputs status-like info to stdout
      expect(result.stdout).toContain("nothing to commit");
      expect(result.exitCode).toBe(1);
    });

    it("should create a commit with staged changes", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      const result = await env.exec('git commit -m "Initial commit"');
      expect(result.stdout).toContain("[main");
      expect(result.stdout).toContain("Initial commit");
      expect(result.exitCode).toBe(0);
    });

    it("should show file count in commit output", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      const result = await env.exec('git commit -m "test"');
      expect(result.stdout).toContain("1 file changed");
      expect(result.exitCode).toBe(0);
    });

    it("should support -a flag to stage tracked files", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "first"');

      // Modify the file
      await env.exec('echo "world" > test.txt');
      const result = await env.exec('git commit -a -m "second"');
      expect(result.stdout).toContain("[main");
      expect(result.stdout).toContain("second");
      expect(result.exitCode).toBe(0);
    });

    it("should support --allow-empty", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec(
        'git commit --allow-empty -m "empty commit"',
      );
      expect(result.stdout).toContain("empty commit");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("git log", () => {
    it("should error when not in a repository", async () => {
      const env = new Bash();
      const result = await env.exec("git log");
      expect(result.stderr).toContain("not a git repository");
      expect(result.exitCode).toBe(128);
    });

    it("should error when no commits", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git log");
      expect(result.stderr).toContain("does not have any commits");
      expect(result.exitCode).toBe(128);
    });

    it("should show commit history", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial commit"');
      const result = await env.exec("git log");
      expect(result.stdout).toContain("commit ");
      expect(result.stdout).toContain("Author:");
      expect(result.stdout).toContain("Date:");
      expect(result.stdout).toContain("Initial commit");
      expect(result.exitCode).toBe(0);
    });

    it("should support --oneline format", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial commit"');
      const result = await env.exec("git log --oneline");
      expect(result.stdout).toMatch(/^[a-f0-9]{7} Initial commit\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should support -n to limit commits", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "First"');
      await env.exec('echo "world" > test.txt');
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Second"');

      const result = await env.exec("git log -n1 --oneline");
      expect(result.stdout).toContain("Second");
      expect(result.stdout).not.toContain("First");
      expect(result.exitCode).toBe(0);
    });

    it("should show multiple commits in order", async () => {
      const env = new Bash({
        files: { "/test.txt": "1\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "First"');
      await env.exec('echo "2" > test.txt');
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Second"');

      const result = await env.exec("git log --oneline");
      const lines = result.stdout.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("Second");
      expect(lines[1]).toContain("First");
    });
  });

  describe("git branch", () => {
    it("should error when not in a repository", async () => {
      const env = new Bash();
      const result = await env.exec("git branch");
      expect(result.stderr).toContain("not a git repository");
      expect(result.exitCode).toBe(128);
    });

    it("should list current branch", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      const result = await env.exec("git branch");
      expect(result.stdout).toBe("* main\n");
      expect(result.exitCode).toBe(0);
    });

    it("should create a new branch", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      await env.exec("git branch feature");
      const result = await env.exec("git branch");
      expect(result.stdout).toContain("feature");
      expect(result.stdout).toContain("* main");
      expect(result.exitCode).toBe(0);
    });

    it("should error creating duplicate branch", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      await env.exec("git branch feature");
      const result = await env.exec("git branch feature");
      expect(result.stderr).toContain("already exists");
      expect(result.exitCode).toBe(128);
    });

    it("should delete a branch with -d", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      await env.exec("git branch feature");
      const result = await env.exec("git branch -d feature");
      expect(result.stdout).toContain("Deleted branch feature");
      expect(result.exitCode).toBe(0);
    });

    it("should error deleting current branch", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      const result = await env.exec("git branch -d main");
      expect(result.stderr).toContain("cannot delete branch");
      expect(result.exitCode).toBe(1);
    });

    it("should rename branch with -m", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      await env.exec("git branch feature");
      await env.exec("git branch -m feature renamed");
      const result = await env.exec("git branch");
      expect(result.stdout).toContain("renamed");
      expect(result.stdout).not.toContain("feature");
      expect(result.exitCode).toBe(0);
    });

    it("should error on unknown option", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git branch --unknown");
      expect(result.stderr).toContain("unknown option");
      expect(result.exitCode).toBe(129);
    });
  });

  describe("git checkout", () => {
    it("should error when not in a repository", async () => {
      const env = new Bash();
      const result = await env.exec("git checkout main");
      expect(result.stderr).toContain("not a git repository");
      expect(result.exitCode).toBe(128);
    });

    it("should error without target", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git checkout");
      expect(result.stderr).toContain("you must specify");
      expect(result.exitCode).toBe(1);
    });

    it("should switch to existing branch", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      await env.exec("git branch feature");
      const result = await env.exec("git checkout feature");
      // Real git outputs to stderr, not stdout
      expect(result.stderr).toContain("Switched to branch 'feature'");
      expect(result.exitCode).toBe(0);
    });

    it("should create and checkout with -b", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      const result = await env.exec("git checkout -b feature");
      // Real git outputs to stderr, not stdout
      expect(result.stderr).toContain("Switched to a new branch 'feature'");
      expect(result.exitCode).toBe(0);

      const branchResult = await env.exec("git branch");
      expect(branchResult.stdout).toContain("* feature");
    });

    it("should error on non-existent branch", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      const result = await env.exec("git checkout nonexistent");
      expect(result.stderr).toContain("did not match");
      expect(result.exitCode).toBe(1);
    });

    it("should error creating duplicate branch with -b", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      await env.exec("git branch feature");
      const result = await env.exec("git checkout -b feature");
      expect(result.stderr).toContain("already exists");
      expect(result.exitCode).toBe(128);
    });

    it("should error on unknown option", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git checkout --unknown");
      expect(result.stderr).toContain("unknown option");
      expect(result.exitCode).toBe(129);
    });
  });

  describe("git diff", () => {
    it("should error when not in a repository", async () => {
      const env = new Bash();
      const result = await env.exec("git diff");
      expect(result.stderr).toContain("not a git repository");
      expect(result.exitCode).toBe(128);
    });

    it("should show nothing when no changes", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      const result = await env.exec("git diff");
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should show unstaged changes", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      await env.exec('echo "world" > test.txt');
      const result = await env.exec("git diff");
      expect(result.stdout).toContain("-hello");
      expect(result.stdout).toContain("+world");
      expect(result.exitCode).toBe(0);
    });

    it("should show staged changes with --staged", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      const result = await env.exec("git diff --staged");
      expect(result.stdout).toContain("+hello");
      expect(result.exitCode).toBe(0);
    });

    it("should support --cached as alias for --staged", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      const result = await env.exec("git diff --cached");
      expect(result.stdout).toContain("+hello");
      expect(result.exitCode).toBe(0);
    });

    it("should support --name-only", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      await env.exec('echo "world" > test.txt');
      const result = await env.exec("git diff --name-only");
      expect(result.stdout).toBe("test.txt\n");
      expect(result.exitCode).toBe(0);
    });

    it("should error on unknown option", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git diff --unknown");
      expect(result.stderr).toContain("unknown option");
      expect(result.exitCode).toBe(129);
    });
  });

  describe("git config", () => {
    it("should error when not in a repository", async () => {
      const env = new Bash();
      const result = await env.exec("git config user.name");
      expect(result.stderr).toContain("not a git repository");
      expect(result.exitCode).toBe(128);
    });

    it("should get a config value", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git config user.name");
      expect(result.stdout).not.toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should return exit 1 for missing config", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git config nonexistent.key");
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("should set a config value", async () => {
      const env = new Bash();
      await env.exec("git init");
      await env.exec("git config user.name TestUser");
      const result = await env.exec("git config user.name");
      expect(result.stdout).toBe("TestUser\n");
      expect(result.exitCode).toBe(0);
    });

    it("should list all config with --list", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git config --list");
      expect(result.stdout).toContain("user.name=");
      expect(result.stdout).toContain("user.email=");
      expect(result.exitCode).toBe(0);
    });

    it("should unset config with --unset", async () => {
      const env = new Bash();
      await env.exec("git init");
      await env.exec("git config test.key testvalue");
      await env.exec("git config --unset test.key");
      const result = await env.exec("git config test.key");
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("git rm", () => {
    it("should error when not in a repository", async () => {
      const env = new Bash();
      const result = await env.exec("git rm file.txt");
      expect(result.stderr).toContain("not a git repository");
      expect(result.exitCode).toBe(128);
    });

    it("should error without files", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git rm");
      expect(result.stderr).toContain("No pathspec was given");
      expect(result.exitCode).toBe(128);
    });

    it("should remove a tracked file", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      const result = await env.exec("git rm test.txt");
      expect(result.stdout).toContain("rm 'test.txt'");
      expect(result.exitCode).toBe(0);
    });

    it("should remove from index only with --cached", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      await env.exec("git rm --cached test.txt");

      // File should still exist
      const lsResult = await env.exec("ls test.txt");
      expect(lsResult.stdout).toContain("test.txt");
    });

    it("should error on untracked file", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      const result = await env.exec("git rm test.txt");
      expect(result.stderr).toContain("did not match");
      expect(result.exitCode).toBe(128);
    });

    it("should error on unknown option", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git rm --unknown file.txt");
      expect(result.stderr).toContain("unknown option");
      expect(result.exitCode).toBe(129);
    });
  });

  describe("git reset", () => {
    it("should error when not in a repository", async () => {
      const env = new Bash();
      const result = await env.exec("git reset");
      expect(result.stderr).toContain("not a git repository");
      expect(result.exitCode).toBe(128);
    });

    it("should reset HEAD", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "First"');
      await env.exec('echo "world" > test.txt');
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Second"');

      const result = await env.exec("git reset HEAD~1");
      expect(result.stdout).toContain("HEAD is now at");
      expect(result.exitCode).toBe(0);
    });

    it("should error on unknown option", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git reset --unknown");
      expect(result.stderr).toContain("unknown option");
      expect(result.exitCode).toBe(129);
    });
  });

  describe("git rev-parse", () => {
    it("should error when not in a repository", async () => {
      const env = new Bash();
      const result = await env.exec("git rev-parse HEAD");
      expect(result.stderr).toContain("not a git repository");
      expect(result.exitCode).toBe(128);
    });

    it("should show git directory with --git-dir", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git rev-parse --git-dir");
      expect(result.stdout).toContain(".git");
      expect(result.exitCode).toBe(0);
    });

    it("should show toplevel with --show-toplevel", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git rev-parse --show-toplevel");
      // The cwd could be / or /home/user depending on test environment
      expect(result.stdout).toMatch(/^\/.*\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should show HEAD commit hash", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      const result = await env.exec("git rev-parse HEAD");
      expect(result.stdout).toMatch(/^[a-f0-9]{40}\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should show short hash with --short", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      const result = await env.exec("git rev-parse --short HEAD");
      expect(result.stdout).toMatch(/^[a-f0-9]{7}\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should show branch name with --abbrev-ref", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      const result = await env.exec("git rev-parse --abbrev-ref HEAD");
      expect(result.stdout).toBe("main\n");
      expect(result.exitCode).toBe(0);
    });

    it("should error on unknown option", async () => {
      const env = new Bash();
      await env.exec("git init");
      const result = await env.exec("git rev-parse --unknown");
      expect(result.stderr).toContain("unknown option");
      expect(result.exitCode).toBe(129);
    });
  });

  describe("git show", () => {
    it("should error when not in a repository", async () => {
      const env = new Bash();
      const result = await env.exec("git show");
      expect(result.stderr).toContain("not a git repository");
      expect(result.exitCode).toBe(128);
    });

    it("should show commit details", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial commit"');
      const result = await env.exec("git show");
      expect(result.stdout).toContain("commit ");
      expect(result.stdout).toContain("Author:");
      expect(result.stdout).toContain("Initial commit");
      expect(result.exitCode).toBe(0);
    });

    it("should show commit with diff", async () => {
      const env = new Bash({
        files: { "/test.txt": "hello\n" },
      });
      await env.exec("git init");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "First"');
      await env.exec('echo "world" > test.txt');
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Second"');
      const result = await env.exec("git show");
      expect(result.stdout).toContain("Second");
      expect(result.stdout).toContain("+world");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("workflow integration", () => {
    it("should support basic git workflow", async () => {
      const env = new Bash({
        files: { "/readme.txt": "Hello World\n" },
      });

      // Initialize repository
      const initResult = await env.exec("git init");
      expect(initResult.exitCode).toBe(0);

      // Add and commit
      await env.exec("git add readme.txt");
      const commitResult = await env.exec('git commit -m "Initial commit"');
      expect(commitResult.exitCode).toBe(0);

      // Create and switch to feature branch
      await env.exec("git checkout -b feature");

      // Make changes
      await env.exec('echo "New feature" >> readme.txt');
      await env.exec("git add readme.txt");
      await env.exec('git commit -m "Add feature"');

      // Check log shows both commits
      const logResult = await env.exec("git log --oneline");
      expect(logResult.stdout).toContain("Add feature");
      expect(logResult.stdout).toContain("Initial commit");

      // Switch back to main
      await env.exec("git checkout main");
      const branchResult = await env.exec("git branch");
      expect(branchResult.stdout).toContain("* main");
    });

    it("should track modified files correctly", async () => {
      const env = new Bash({
        files: { "/file.txt": "initial\n" },
      });

      await env.exec("git init");
      await env.exec("git add file.txt");
      await env.exec('git commit -m "First"');

      // Modify file
      await env.exec('echo "modified" > file.txt');

      // Status should show modified
      const statusResult = await env.exec("git status -s");
      expect(statusResult.stdout).toBe(" M file.txt\n");

      // Add and commit
      await env.exec("git add file.txt");
      await env.exec('git commit -m "Second"');

      // Status should be clean
      const cleanStatus = await env.exec("git status -s");
      expect(cleanStatus.stdout).toBe("");
    });
  });
});
