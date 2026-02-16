import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { parse } from "../parser/parser.js";
import { BashTransformPipeline } from "./pipeline.js";
import { CommandCollectorPlugin } from "./plugins/command-collector.js";
import { TeePlugin, type TeePluginMetadata } from "./plugins/tee-plugin.js";

const FIXED_DATE = new Date("2024-01-15T10:30:45.123Z");
const TS = "2024-01-15T10-30-45.123Z";

describe("transform", () => {
  describe("no plugins", () => {
    it("returns original script unchanged", () => {
      const bash = new Bash();
      const result = bash.transform("echo hello | cat");
      expect(result.script).toBe("echo hello | cat");
      expect(result.metadata).toEqual({});
    });
  });

  describe("TeePlugin", () => {
    it("wraps single command with stderr redirect and tee", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(
        new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
      );
      const result = bash.transform("echo hello");
      expect(result.script).toBe(
        `echo hello 2> /tmp/logs/${TS}-000-echo.stderr.txt | tee /tmp/logs/${TS}-000-echo.stdout.txt`,
      );
    });

    it("wraps each command in a pipeline", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(
        new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
      );
      const result = bash.transform("echo hello | grep hello");
      expect(result.script).toBe(
        `echo hello 2> /tmp/logs/${TS}-000-echo.stderr.txt | tee /tmp/logs/${TS}-000-echo.stdout.txt | grep hello 2> /tmp/logs/${TS}-001-grep.stderr.txt | tee /tmp/logs/${TS}-001-grep.stdout.txt`,
      );
    });

    it("only targets commands matching pattern", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(
        new TeePlugin({
          outputDir: "/tmp/logs",
          timestamp: FIXED_DATE,
          targetCommandPattern: /^grep$/,
        }),
      );
      const result = bash.transform("cat file | sort | grep pattern | wc -l");
      expect(result.script).toBe(
        `cat file | sort | grep pattern 2> /tmp/logs/${TS}-000-grep.stderr.txt | tee /tmp/logs/${TS}-000-grep.stdout.txt | wc -l`,
      );
    });

    it("returns teeFiles metadata", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(
        new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
      );
      const result = bash.transform("echo hello | grep hello");
      const meta = result.metadata as unknown as TeePluginMetadata;
      expect(meta.teeFiles).toEqual([
        {
          commandIndex: 0,
          commandName: "echo",
          command: "echo hello",
          stdoutFile: `/tmp/logs/${TS}-000-echo.stdout.txt`,
          stderrFile: `/tmp/logs/${TS}-000-echo.stderr.txt`,
        },
        {
          commandIndex: 1,
          commandName: "grep",
          command: "grep hello",
          stdoutFile: `/tmp/logs/${TS}-001-grep.stdout.txt`,
          stderrFile: `/tmp/logs/${TS}-001-grep.stderr.txt`,
        },
      ]);
    });

    it("handles multiple pipelines with global counter", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(
        new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
      );
      const result = bash.transform("echo a | cat\necho b | cat");
      expect(result.script).toBe(
        `echo a 2> /tmp/logs/${TS}-000-echo.stderr.txt | tee /tmp/logs/${TS}-000-echo.stdout.txt | cat 2> /tmp/logs/${TS}-001-cat.stderr.txt | tee /tmp/logs/${TS}-001-cat.stdout.txt\necho b 2> /tmp/logs/${TS}-002-echo.stderr.txt | tee /tmp/logs/${TS}-002-echo.stdout.txt | cat 2> /tmp/logs/${TS}-003-cat.stderr.txt | tee /tmp/logs/${TS}-003-cat.stdout.txt`,
      );
    });

    it("uses 'unknown' for dynamic command names", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(
        new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
      );
      const result = bash.transform("$cmd hello");
      expect(result.script).toContain("000-unknown.stdout.txt");
      expect(result.script).toContain("000-unknown.stderr.txt");
    });

    it("replaces colons in ISO timestamp", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(
        new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
      );
      const result = bash.transform("echo hello");
      expect(result.script).not.toContain("10:30:45");
      expect(result.script).toContain("10-30-45");
    });
  });

  describe("CommandCollectorPlugin", () => {
    it("collects commands from simple pipeline", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(new CommandCollectorPlugin());
      const result = bash.transform("echo hello | grep hello | wc -l");
      expect(result.metadata.commands).toEqual(["echo", "grep", "wc"]);
    });

    it("collects commands from compound statements", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(new CommandCollectorPlugin());
      const result = bash.transform("if true; then echo yes; else echo no; fi");
      expect(result.metadata.commands).toEqual(["echo", "true"]);
    });

    it("collects commands from for loop", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(new CommandCollectorPlugin());
      const result = bash.transform("for i in 1 2 3; do echo $i; done");
      expect(result.metadata.commands).toEqual(["echo"]);
    });

    it("collects commands from case statement", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(new CommandCollectorPlugin());
      const result = bash.transform("case $x in a) echo a;; b) ls;; esac");
      expect(result.metadata.commands).toEqual(["echo", "ls"]);
    });

    it("collects commands from nested command substitutions", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(new CommandCollectorPlugin());
      const result = bash.transform("echo $(cat $(ls))");
      expect(result.metadata.commands).toEqual(["cat", "echo", "ls"]);
    });

    it("collects commands from function definitions", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(new CommandCollectorPlugin());
      const result = bash.transform("myfunc() { echo hello; }");
      expect(result.metadata.commands).toEqual(["echo"]);
    });

    it("collects commands from while loop", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(new CommandCollectorPlugin());
      const result = bash.transform("while read line; do echo $line; done");
      expect(result.metadata.commands).toEqual(["echo", "read"]);
    });

    it("does not modify the AST", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(new CommandCollectorPlugin());
      const result = bash.transform("echo hello | cat");
      expect(result.script).toBe("echo hello | cat");
    });
  });

  describe("plugin chaining", () => {
    it("tee + collector: collector sees inserted tee", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(
        new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
      );
      bash.registerTransformPlugin(new CommandCollectorPlugin());
      const result = bash.transform("echo hello | grep hello");
      expect(result.metadata.commands).toEqual(["echo", "grep", "tee"]);
    });

    it("metadata from multiple plugins is merged", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(new CommandCollectorPlugin());
      bash.registerTransformPlugin({
        name: "custom",
        transform: (ctx) => ({
          ast: ctx.ast,
          metadata: { custom: true },
        }),
      });
      const result = bash.transform("echo hello");
      expect(result.metadata.commands).toEqual(["echo"]);
      expect(result.metadata.custom).toBe(true);
    });
  });

  describe("BashTransformPipeline", () => {
    it("runs plugins in order", () => {
      const result = new BashTransformPipeline()
        .use(new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }))
        .use(new CommandCollectorPlugin())
        .transform("echo hello | grep hello");

      expect(result.metadata.commands).toEqual(["echo", "grep", "tee"]);
      expect(result.metadata.teeFiles).toHaveLength(2);
      expect(result.metadata.teeFiles[0].commandName).toBe("echo");
      expect(result.metadata.teeFiles[1].commandName).toBe("grep");
    });

    it("works with single plugin", () => {
      const result = new BashTransformPipeline()
        .use(new CommandCollectorPlugin())
        .transform("echo hello | cat");

      expect(result.metadata.commands).toEqual(["cat", "echo"]);
    });

    it("works with no plugins", () => {
      const result = new BashTransformPipeline().transform("echo hello");
      expect(result.script).toBe("echo hello");
      expect(result.metadata).toEqual({});
    });

    it("merges metadata from all plugins", () => {
      const result = new BashTransformPipeline()
        .use(new CommandCollectorPlugin())
        .use({
          name: "custom",
          transform: (ctx) => ({
            ast: ctx.ast,
            metadata: { custom: true },
          }),
        })
        .transform("echo hello");

      expect(result.metadata.commands).toEqual(["echo"]);
      expect(result.metadata.custom).toBe(true);
    });
  });

  describe("error handling", () => {
    it("plugin exceptions propagate", () => {
      const bash = new Bash();
      bash.registerTransformPlugin({
        name: "failing",
        transform: () => {
          throw new Error("plugin failed");
        },
      });
      expect(() => bash.transform("echo hello")).toThrow("plugin failed");
    });
  });

  describe("exec integration", () => {
    it("exec applies transform plugins and returns metadata", async () => {
      const bash = new Bash();
      bash.registerTransformPlugin(new CommandCollectorPlugin());
      const result = await bash.exec("echo hello | cat");
      expect(result.metadata).toEqual({ commands: ["cat", "echo"] });
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });

    it("exec executes the transformed script", async () => {
      const bash = new Bash();
      bash.registerTransformPlugin({
        name: "rewrite",
        transform: () => {
          return {
            ast: parse("echo transformed"),
            metadata: { rewritten: true },
          };
        },
      });
      const result = await bash.exec("echo original");
      expect(result.stdout).toBe("transformed\n");
      expect(result.metadata).toEqual({ rewritten: true });
    });

    it("exec without plugins does not set metadata", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo hello");
      expect(result.metadata).toBeUndefined();
      expect(result.stdout).toBe("hello\n");
    });

    it("exec merges metadata from multiple plugins", async () => {
      const bash = new Bash();
      bash.registerTransformPlugin(new CommandCollectorPlugin());
      bash.registerTransformPlugin({
        name: "custom",
        transform: (ctx) => ({
          ast: ctx.ast,
          metadata: { custom: true },
        }),
      });
      const result = await bash.exec("echo hello");
      expect(result.metadata).toEqual({ commands: ["echo"], custom: true });
    });
  });
});
