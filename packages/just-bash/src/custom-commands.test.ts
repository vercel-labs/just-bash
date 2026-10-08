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
import type { Command, ResolvedCommandContext } from "./types.js";

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
      expect(cmd.trusted).toBe(true);
      expect(typeof cmd.execute).toBe("function");
    });

    it("preserves trusted defaults and supports explicit untrusted commands", () => {
      const execute = async () => ({ stdout: "", stderr: "", exitCode: 0 });
      expect(defineCommand("compatible", execute).trusted).toBe(true);
      expect(defineCommand("safe", execute, { trusted: false }).trusted).toBe(
        false,
      );
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
    it("preserves prototype methods on class-based commands", async () => {
      class ClassCommand implements Command {
        readonly name = "class-command";

        async execute(
          _args: string[],
          ctx: ResolvedCommandContext,
        ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { stdout: `${ctx.cwd}\n`, stderr: "", exitCode: 0 };
        }
      }

      const command = new ClassCommand();
      expect(Object.hasOwn(command, "execute")).toBe(false);
      expect(
        (await new Bash({ customCommands: [command] }).exec(command.name))
          .stdout,
      ).toBe("/home/user\n");
    });

    it.each([
      "direct",
      "helper",
      "lazy",
    ] as const)("preserves trusted execution by default for %s commands", async (kind) => {
      const execute = async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { stdout: "ok\n", stderr: "", exitCode: 0 };
      };
      const command: CustomCommand =
        kind === "direct"
          ? { name: kind, execute }
          : kind === "helper"
            ? defineCommand(kind, execute)
            : {
                name: kind,
                load: async () => ({ name: kind, execute }),
              };

      expect(
        (await new Bash({ customCommands: [command] }).exec(kind)).stdout,
      ).toBe("ok\n");
    });

    it.each([
      "direct",
      "helper",
      "lazy",
    ] as const)("supports explicit untrusted execution for %s commands", async (kind) => {
      const execute = async () => {
        setTimeout(() => {}, 1);
        return { stdout: "unexpected\n", stderr: "", exitCode: 0 };
      };
      const command: CustomCommand =
        kind === "direct"
          ? { name: kind, trusted: false, execute }
          : kind === "helper"
            ? defineCommand(kind, execute, { trusted: false })
            : {
                name: kind,
                trusted: false,
                load: async () => ({ name: kind, execute }),
              };
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

    it("preserves trusted execution for commands registered later", async () => {
      const bash = new Bash();
      bash.registerCommand({
        name: "late-trusted-default",
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { stdout: "ok\n", stderr: "", exitCode: 0 };
        },
      });

      const result = await bash.exec("late-trusted-default");

      expect(result).toMatchObject({
        stdout: "ok\n",
        stderr: "",
        exitCode: 0,
      });
    });

    it("allows commands registered later to opt into restriction", async () => {
      const bash = new Bash();
      bash.registerCommand({
        name: "late-restricted",
        trusted: false,
        execute: async () => {
          setTimeout(() => {}, 1);
          return { stdout: "unexpected\n", stderr: "", exitCode: 0 };
        },
      });

      const result = await bash.exec("late-restricted");

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("setTimeout is blocked");
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

    describe("ctx.stdinConnected", () => {
      // Prints one word per invocation: "pipe" when fd 0 is connected,
      // "none" when it is not, so a script's stdout is the sequence of
      // answers the command saw.
      const probe = defineCommand("probe", async (_args, ctx) => ({
        stdout: `${ctx.stdinConnected ? "pipe" : "none"}\n`,
        stderr: "",
        exitCode: 0,
      }));
      const run = (script: string) =>
        new Bash({
          customCommands: [probe],
          files: {
            "/empty": "",
            "/full": "x\n",
            "/script": "#!/bin/bash\nprobe\n",
          },
        }).exec(`chmod +x /script; ${script}`);

      it("is false for a bare command", async () => {
        expect((await run("probe")).stdout).toBe("none\n");
      });

      it("is true for a pipe that carried bytes", async () => {
        expect((await run("echo hi | probe")).stdout).toBe("pipe\n");
      });

      it.each([
        ["a producer that printed nothing", "printf '' | probe"],
        ["a producer that failed", "false | probe"],
        ["a middle stage of a pipeline", "printf '' | probe | cat"],
        ["a redirection from an empty file", "probe < /empty"],
        ["a pipe into a group", "printf '' | { probe; }"],
        ["a pipe into a subshell", "printf '' | (probe)"],
        ["a pipe into a function", "f() { probe; }; printf '' | f"],
        ["a pipe into an if", "printf '' | if true; then probe; fi"],
        ["a pipe into a for", "printf '' | for i in 1; do probe; done"],
        [
          "a pipe into a C-style for",
          "printf '' | for ((i = 0; i < 1; i++)); do probe; done",
        ],
        ["a pipe into a while", "printf '' | while probe; do break; done"],
        [
          "a pipe into an until",
          "printf '' | until false; do probe; break; done",
        ],
        ["a pipe into a case", "printf '' | case x in x) probe ;; esac"],
        ["a pipe into an executable script", "printf '' | /script"],
        ["a pipe into a nested shell", "printf '' | bash -c probe"],
        ["a pipe into `command`", "printf '' | command probe"],
        ["a pipe into `exec`", "printf '' | exec probe"],
        ["a pipe into `eval`", "printf '' | eval probe"],
        ["a pipe into `source`", "printf '' | source /script"],
        ["an empty here-string", "probe <<< ''"],
        ["a self-duplication inside a pipe", "printf '' | probe <&0"],
        [
          "a closed fd 0 reopened by an inner redirection",
          "{ probe < /empty; } 0<&-",
        ],
        [
          "a closed fd 0 reopened by a function's own redirection",
          "f() { probe; } < /empty; f 0<&-",
        ],
      ])("is true for %s, even with no bytes", async (_, script) => {
        expect((await run(script)).stdout).toBe("pipe\n");
      });

      it.each([
        ["a nested shell with nothing to hand on", "bash -c probe"],
        ["a closed fd 0", "probe 0<&-"],
        ["a self-duplication of an unconnected fd 0", "probe <&0"],
        ["a script run with nothing to hand on", "/script"],
        ["an if with nothing to hand on", "if true; then probe; fi"],
        ["a closed fd 0 on a group", "{ probe; } 0<&-"],
        ["a closed fd 0 on a subshell", "(probe) 0<&-"],
        ["a closed fd 0 on a function call", "f() { probe; }; f 0<&-"],
        ["a closed fd 0 on a function definition", "f() { probe; } 0<&-; f"],
        ["a closed fd 0 on `eval`", "eval probe 0<&-"],
        ["a closed fd 0 on `source`", "source /script 0<&-"],
        ["a closed fd 0 on an executable script", "/script 0<&-"],
        ["a closed fd 0 on an if", "if true; then probe; fi 0<&-"],
        ["a closed fd 0 on a while", "while probe; do break; done 0<&-"],
        ["a closed fd 0 two scopes up", "f() { probe; }; { { f; }; } 0<&-"],
        ["a closed fd 0 inside a pipe", "printf '' | { probe; } 0<&-"],
      ])("is false for %s", async (_, script) => {
        expect((await run(script)).stdout).toBe("none\n");
      });

      it("is false inside a closed scope and true again outside it", async () => {
        expect(
          (await run("printf '' | { { probe; } 0<&-; probe; }")).stdout,
        ).toBe("none\npipe\n");
      });

      it("is false again once the pipeline is over", async () => {
        expect((await run("printf '' | probe; probe")).stdout).toBe(
          "pipe\nnone\n",
        );
      });

      it("is false for the first stage, which inherits the shell's stdin", async () => {
        expect((await run("probe | cat")).stdout).toBe("none\n");
      });

      it("stays false for the commands after a closed fd 0, which reads as EOF", async () => {
        expect((await run("exec 0<&-; probe")).stdout).toBe("none\n");
      });

      it("follows the standalone context's stdin", () => {
        const withStdin = createCommandContext({
          fs: {} as never,
          stdin: EMPTY_BYTES,
        });
        const without = createCommandContext({ fs: {} as never });
        expect(withStdin.stdinConnected).toBe(true);
        expect(without.stdinConnected).toBe(false);
      });
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
