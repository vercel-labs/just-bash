import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("bash/sh command", () => {
  describe("bash -c", () => {
    it("should execute command string with -c", async () => {
      const env = new Bash();
      const result = await env.exec('bash -c "echo hello"');
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });

    it("should execute multiple commands with -c", async () => {
      const env = new Bash();
      const result = await env.exec('bash -c "echo one; echo two"');
      expect(result.stdout).toBe("one\ntwo\n");
      expect(result.exitCode).toBe(0);
    });

    it("should pass positional arguments to -c", async () => {
      const env = new Bash();
      // Use single quotes to prevent outer shell expansion of $1 and $2
      const result = await env.exec("bash -c 'echo $1 $2' _ foo bar");
      expect(result.stdout).toBe("foo bar\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("sh -c", () => {
    it("should execute command string with -c", async () => {
      const env = new Bash();
      const result = await env.exec('sh -c "echo hello"');
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });

    it("should pass positional arguments to -c", async () => {
      const env = new Bash();
      // Use single quotes to prevent outer shell expansion of $1
      const result = await env.exec("sh -c 'echo $1' _ world");
      expect(result.stdout).toBe("world\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("script file execution", () => {
    it("should execute a simple script file", async () => {
      const env = new Bash({
        files: {
          "/scripts/hello.sh": 'echo "Hello, World!"',
        },
      });
      const result = await env.exec("bash /scripts/hello.sh");
      expect(result.stdout).toBe("Hello, World!\n");
      expect(result.exitCode).toBe(0);
    });

    it("should execute script with shebang", async () => {
      const env = new Bash({
        files: {
          "/scripts/script.sh": '#!/bin/bash\necho "from shebang script"',
        },
      });
      const result = await env.exec("bash /scripts/script.sh");
      expect(result.stdout).toBe("from shebang script\n");
      expect(result.exitCode).toBe(0);
    });

    it("should pass arguments to script", async () => {
      const env = new Bash({
        files: {
          "/scripts/greet.sh": 'echo "Hello, $1!"',
        },
      });
      const result = await env.exec("bash /scripts/greet.sh Alice");
      expect(result.stdout).toBe("Hello, Alice!\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support $# for argument count", async () => {
      const env = new Bash({
        files: {
          "/scripts/count.sh": 'echo "Got $# arguments"',
        },
      });
      const result = await env.exec("bash /scripts/count.sh a b c");
      expect(result.stdout).toBe("Got 3 arguments\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support $@ for all arguments", async () => {
      const env = new Bash({
        files: {
          "/scripts/all.sh": 'echo "Args: $@"',
        },
      });
      const result = await env.exec("bash /scripts/all.sh one two three");
      expect(result.stdout).toBe("Args: one two three\n");
      expect(result.exitCode).toBe(0);
    });

    it("should return error for non-existent script", async () => {
      const env = new Bash();
      const result = await env.exec("bash /nonexistent.sh");
      expect(result.stderr).toBe(
        "bash: /nonexistent.sh: No such file or directory\n",
      );
      expect(result.exitCode).toBe(127);
    });

    it("should execute script with multiple commands", async () => {
      const env = new Bash({
        files: {
          "/scripts/multi.sh": `echo "Line 1"
echo "Line 2"
echo "Line 3"`,
        },
      });
      const result = await env.exec("bash /scripts/multi.sh");
      expect(result.stdout).toBe("Line 1\nLine 2\nLine 3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should execute sh scripts", async () => {
      const env = new Bash({
        files: {
          "/scripts/test.sh": 'echo "from sh"',
        },
      });
      const result = await env.exec("sh /scripts/test.sh");
      expect(result.stdout).toBe("from sh\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("script with complex operations", () => {
    it("should handle script with environment variable", async () => {
      const env = new Bash({
        files: {
          "/scripts/vars.sh": 'echo "Hello $NAME"',
        },
        env: { NAME: "Test" },
      });
      const result = await env.exec("bash /scripts/vars.sh");
      expect(result.stdout).toBe("Hello Test\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle script with file operations", async () => {
      const env = new Bash({
        files: {
          "/scripts/fileop.sh": `echo "content" > /tmp/test.txt
cat /tmp/test.txt`,
        },
      });
      const result = await env.exec("bash /scripts/fileop.sh");
      expect(result.stdout).toBe("content\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle script with pipes", async () => {
      const env = new Bash({
        files: {
          "/scripts/pipes.sh": 'echo -e "foo\\nbar\\nbaz" | grep bar',
        },
      });
      const result = await env.exec("bash /scripts/pipes.sh");
      expect(result.stdout).toBe("bar\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("no arguments", () => {
    it("bash without arguments should succeed", async () => {
      const env = new Bash();
      const result = await env.exec("bash");
      expect(result.exitCode).toBe(0);
    });

    it("sh without arguments should succeed", async () => {
      const env = new Bash();
      const result = await env.exec("sh");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("--help", () => {
    it("bash --help should show usage", async () => {
      const env = new Bash();
      const result = await env.exec("bash --help");
      expect(result.stdout).toContain("bash");
      expect(result.stdout).toContain("-c");
      expect(result.exitCode).toBe(0);
    });

    it("sh --help should show usage", async () => {
      const env = new Bash();
      const result = await env.exec("sh --help");
      expect(result.stdout).toContain("sh");
      expect(result.exitCode).toBe(0);
    });
  });
});
