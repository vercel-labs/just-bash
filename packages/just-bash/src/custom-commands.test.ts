import { describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";
import {
  type CustomCommand,
  createCommandContext,
  createLazyCustomCommand,
  defineCommand,
  isLazyCommand,
  type LazyCommand,
} from "./custom-commands.js";
import { decodeBytesToUtf8, EMPTY_BYTES } from "./encoding.js";
import { resolveLimits } from "./limits.js";
import type { Command } from "./types.js";

describe("custom-commands", () => {
  it("creates a fully resolved standalone command context", () => {
    const context = createCommandContext({
      fs: {} as never,
      executionLimits: { maxCommandCount: 7 },
    });

    expect(context.cwd).toBe("/");
    expect(context.stdin).toBe(EMPTY_BYTES);
    expect(context.limits.maxCommandCount).toBe(7);
    expect(context.limits.maxExecutionTimeMs).toBeGreaterThan(0);
  });

  describe("defineCommand", () => {
    it("creates a Command object with name and execute", () => {
      const cmd = defineCommand("test", async () => ({
        stdout: "hello\n",
        stderr: "",
        exitCode: 0,
      }));

      expect(cmd.name).toBe("test");
      expect(cmd.trusted).toBe(false);
      expect(typeof cmd.execute).toBe("function");
    });

    it("requires an explicit trusted opt-in", () => {
      const execute = async () => ({ stdout: "", stderr: "", exitCode: 0 });
      expect(defineCommand("safe", execute).trusted).toBe(false);
      expect(defineCommand("trusted", execute, { trusted: true }).trusted).toBe(
        true,
      );
    });

    it("execute function receives args and ctx", async () => {
      const cmd = defineCommand("greet", async (args, ctx) => ({
        stdout: `Hello, ${args[0] || "world"}! CWD: ${ctx.cwd}\n`,
        stderr: "",
        exitCode: 0,
      }));

      const bash = new Bash({ customCommands: [cmd] });
      const result = await bash.exec("greet Alice");

      expect(result.stdout).toBe("Hello, Alice! CWD: /home/user\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("isLazyCommand", () => {
    it("returns true for LazyCommand objects", () => {
      const lazy: LazyCommand = {
        name: "lazy",
        load: async () => ({
          name: "lazy",
          execute: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        }),
      };
      expect(isLazyCommand(lazy)).toBe(true);
    });

    it("returns false for Command objects", () => {
      const cmd: Command = {
        name: "cmd",
        execute: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      };
      expect(isLazyCommand(cmd)).toBe(false);
    });
  });

  describe("createLazyCustomCommand", () => {
    it("creates a command that loads on first execution", async () => {
      let loadCount = 0;
      const lazy: LazyCommand = {
        name: "lazy-test",
        load: async () => {
          loadCount++;
          return defineCommand("lazy-test", async () => ({
            stdout: "lazy loaded\n",
            stderr: "",
            exitCode: 0,
          }));
        },
      };

      const cmd = createLazyCustomCommand(lazy);
      expect(loadCount).toBe(0);

      // First execution loads the command
      const result1 = await cmd.execute([], {
        fs: {} as never,
        cwd: "/",
        env: new Map(),
        stdin: EMPTY_BYTES,
        limits: resolveLimits(),
      });
      expect(loadCount).toBe(1);
      expect(result1.stdout).toBe("lazy loaded\n");

      // Second execution uses cached command
      const result2 = await cmd.execute([], {
        fs: {} as never,
        cwd: "/",
        env: new Map(),
        stdin: EMPTY_BYTES,
        limits: resolveLimits(),
      });
      expect(loadCount).toBe(1);
      expect(result2.stdout).toBe("lazy loaded\n");
    });

    it("single-flights concurrent first execution", async () => {
      let loadCount = 0;
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const cmd = createLazyCustomCommand({
        name: "concurrent",
        load: async () => {
          loadCount++;
          await gate;
          return defineCommand("concurrent", async () => ({
            stdout: "loaded\n",
            stderr: "",
            exitCode: 0,
          }));
        },
      });
      const context = {
        fs: {} as never,
        cwd: "/",
        env: new Map<string, string>(),
        stdin: EMPTY_BYTES,
        limits: resolveLimits(),
      };

      const executions = [
        cmd.execute([], context),
        cmd.execute([], context),
        cmd.execute([], context),
      ];
      expect(loadCount).toBe(1);
      release?.();

      const results = await Promise.all(executions);
      expect(results.map((result) => result.stdout)).toEqual([
        "loaded\n",
        "loaded\n",
        "loaded\n",
      ]);
      expect(loadCount).toBe(1);
    });

    it("allows a retry after a rejected load", async () => {
      let loadCount = 0;
      const cmd = createLazyCustomCommand({
        name: "retry",
        load: async () => {
          loadCount++;
          if (loadCount === 1) throw new Error("temporary load failure");
          return defineCommand("retry", async () => ({
            stdout: "retried\n",
            stderr: "",
            exitCode: 0,
          }));
        },
      });
      const context = {
        fs: {} as never,
        cwd: "/",
        env: new Map<string, string>(),
        stdin: EMPTY_BYTES,
        limits: resolveLimits(),
      };

      await expect(cmd.execute([], context)).rejects.toThrow(
        "temporary load failure",
      );
      const result = await cmd.execute([], context);

      expect(result.stdout).toBe("retried\n");
      expect(loadCount).toBe(2);
    });
  });

  describe("Bash with customCommands", () => {
    it.each([
      "direct",
      "helper",
      "lazy",
    ] as const)("uses the same untrusted default for %s commands", async (kind) => {
      const execute = async () => {
        setTimeout(() => {}, 1);
        return { stdout: "unexpected\n", stderr: "", exitCode: 0 };
      };
      const command: CustomCommand =
        kind === "direct"
          ? { name: kind, execute }
          : kind === "helper"
            ? defineCommand(kind, execute)
            : { name: kind, load: async () => ({ name: kind, execute }) };
      const bash = new Bash({ customCommands: [command] });

      const result = await bash.exec(kind);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("setTimeout is blocked");
    });

    it("lets a lazy command explicitly opt in to trusted execution", async () => {
      const bash = new Bash({
        customCommands: [
          {
            name: "trusted-lazy",
            trusted: true,
            load: async () => ({
              name: "trusted-lazy",
              execute: async () => {
                await new Promise((resolve) => setTimeout(resolve, 1));
                return { stdout: "ok\n", stderr: "", exitCode: 0 };
              },
            }),
          },
        ],
      });

      expect((await bash.exec("trusted-lazy")).stdout).toBe("ok\n");
    });
    it("registers and executes a simple custom command", async () => {
      const hello = defineCommand("hello", async (args) => ({
        stdout: `Hello, ${args[0] || "world"}!\n`,
        stderr: "",
        exitCode: 0,
      }));

      const bash = new Bash({ customCommands: [hello] });
      const result = await bash.exec("hello");

      expect(result.stdout).toBe("Hello, world!\n");
      expect(result.exitCode).toBe(0);
    });

    it("custom command receives stdin from pipe", async () => {
      const wordcount = defineCommand("wordcount", async (_args, ctx) => {
        const text = decodeBytesToUtf8(ctx.stdin);
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        return { stdout: `${words}\n`, stderr: "", exitCode: 0 };
      });

      const bash = new Bash({ customCommands: [wordcount] });
      const result = await bash.exec("echo 'one two three' | wordcount");

      expect(result.stdout).toBe("3\n");
      expect(result.exitCode).toBe(0);
    });

    it("custom command can read files via ctx.fs", async () => {
      const reader = defineCommand("reader", async (args, ctx) => {
        const content = await ctx.fs.readFile(args[0]);
        return { stdout: content, stderr: "", exitCode: 0 };
      });

      const bash = new Bash({
        customCommands: [reader],
        files: { "/test.txt": "file content" },
      });
      const result = await bash.exec("reader /test.txt");

      expect(result.stdout).toBe("file content");
      expect(result.exitCode).toBe(0);
    });

    it("custom command can access environment variables", async () => {
      const showenv = defineCommand("showenv", async (args, ctx) => ({
        stdout: `${args[0]}=${ctx.env.get(args[0]) || ""}\n`,
        stderr: "",
        exitCode: 0,
      }));

      const bash = new Bash({
        customCommands: [showenv],
        env: { MY_VAR: "my_value" },
      });
      const result = await bash.exec("showenv MY_VAR");

      expect(result.stdout).toBe("MY_VAR=my_value\n");
      expect(result.exitCode).toBe(0);
    });

    it("custom command overrides built-in command", async () => {
      const customEcho = defineCommand("echo", async (args) => ({
        stdout: `Custom: ${args.join(" ")}\n`,
        stderr: "",
        exitCode: 0,
      }));

      const bash = new Bash({ customCommands: [customEcho] });
      const result = await bash.exec("echo hello world");

      expect(result.stdout).toBe("Custom: hello world\n");
      expect(result.exitCode).toBe(0);
    });

    it("registers lazy-loaded custom command", async () => {
      let loaded = false;
      const lazyCmd: LazyCommand = {
        name: "lazy-hello",
        load: async () => {
          loaded = true;
          return defineCommand("lazy-hello", async () => ({
            stdout: "lazy hello!\n",
            stderr: "",
            exitCode: 0,
          }));
        },
      };

      const bash = new Bash({ customCommands: [lazyCmd] });
      expect(loaded).toBe(false);

      const result = await bash.exec("lazy-hello");
      expect(loaded).toBe(true);
      expect(result.stdout).toBe("lazy hello!\n");
      expect(result.exitCode).toBe(0);
    });

    it("multiple custom commands can be registered", async () => {
      const cmd1 = defineCommand("cmd1", async () => ({
        stdout: "one\n",
        stderr: "",
        exitCode: 0,
      }));
      const cmd2 = defineCommand("cmd2", async () => ({
        stdout: "two\n",
        stderr: "",
        exitCode: 0,
      }));

      const bash = new Bash({ customCommands: [cmd1, cmd2] });

      const result1 = await bash.exec("cmd1");
      expect(result1.stdout).toBe("one\n");

      const result2 = await bash.exec("cmd2");
      expect(result2.stdout).toBe("two\n");
    });

    it("custom command can return non-zero exit code", async () => {
      const failing = defineCommand("failing", async () => ({
        stdout: "",
        stderr: "error occurred\n",
        exitCode: 42,
      }));

      const bash = new Bash({ customCommands: [failing] });
      const result = await bash.exec("failing");

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("error occurred\n");
      expect(result.exitCode).toBe(42);
    });

    it("custom command works in pipeline with built-in commands", async () => {
      const upper = defineCommand("upper", async (_args, ctx) => ({
        stdout: decodeBytesToUtf8(ctx.stdin).toUpperCase(),
        stderr: "",
        exitCode: 0,
      }));

      const bash = new Bash({ customCommands: [upper] });
      const result = await bash.exec("echo 'hello world' | upper | cat");

      expect(result.stdout).toBe("HELLO WORLD\n");
      expect(result.exitCode).toBe(0);
    });

    it("custom command can use exec to run subcommands", async () => {
      const wrapper = defineCommand("wrapper", async (args, ctx) => {
        if (!ctx.exec) {
          return { stdout: "", stderr: "exec not available\n", exitCode: 1 };
        }
        const subResult = await ctx.exec(args.join(" "), { cwd: ctx.cwd });
        return {
          stdout: `[wrapped] ${subResult.stdout}`,
          stderr: subResult.stderr,
          exitCode: subResult.exitCode,
        };
      });

      const bash = new Bash({ customCommands: [wrapper] });
      const result = await bash.exec("wrapper echo hello");

      expect(result.stdout).toBe("[wrapped] hello\n");
      expect(result.exitCode).toBe(0);
    });

    it("works with mixed Command and LazyCommand types", async () => {
      const regular = defineCommand("regular", async () => ({
        stdout: "regular\n",
        stderr: "",
        exitCode: 0,
      }));

      const lazy: CustomCommand = {
        name: "lazy",
        load: async () =>
          defineCommand("lazy", async () => ({
            stdout: "lazy\n",
            stderr: "",
            exitCode: 0,
          })),
      };

      const bash = new Bash({ customCommands: [regular, lazy] });

      expect((await bash.exec("regular")).stdout).toBe("regular\n");
      expect((await bash.exec("lazy")).stdout).toBe("lazy\n");
    });
  });
});
