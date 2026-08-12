import { describe, expect, it } from "vitest";
import type { WordNode } from "../ast/types.js";
import { Bash } from "../Bash.js";
import { parse } from "../parser/parser.js";
import { BashTransformPipeline } from "./pipeline.js";
import { CommandCollectorPlugin } from "./plugins/command-collector.js";
import { TeePlugin, type TeePluginMetadata } from "./plugins/tee-plugin.js";

const FIXED_DATE = new Date("2024-01-15T10:30:45.123Z");
const TS = "2024-01-15T10-30-45.123Z";

describe("transform", () => {
  it("rejects source above maxSourceBytes before parsing", () => {
    const bash = new Bash({ executionLimits: { maxSourceBytes: 8 } });

    expect(() => bash.transform("echo 1234")).toThrow(
      /script input size limit exceeded \(8 bytes\)/,
    );
    expect(() => bash.transform("echo ok")).not.toThrow();
  });

  it("executes EOF-terminated heredocs but rejects them from transform APIs", async () => {
    const script = "cat <<EOF\nbody";
    const bash = new Bash();
    const result = await bash.exec(script);

    expect(result.stdout).toBe("body\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(() => bash.transform(script)).toThrow(
      "Cannot serialize an unterminated here-document",
    );
    expect(() => new BashTransformPipeline().transform(script)).toThrow(
      "Cannot serialize an unterminated here-document",
    );
  });

  describe("no plugins", () => {
    it("returns original script unchanged", () => {
      const bash = new Bash();
      const result = bash.transform("echo hello | cat");
      expect(result.script).toBe("echo hello | cat");
      expect(result.metadata).toEqual({});
    });
  });

  describe("TeePlugin", () => {
    it("does not wrap single commands (no existing pipe)", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(
        new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
      );
      const result = bash.transform("echo hello");
      expect(result.script).toBe("echo hello");
    });

    it("wraps each command in a pipeline", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(
        new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
      );
      const result = bash.transform("echo hello | grep hello");
      expect(result.script).toBe(
        `echo hello | tee /tmp/logs/${TS}-000-echo.stdout.txt | grep hello | tee /tmp/logs/${TS}-001-grep.stdout.txt ; builtin __just_bash_tee_restore \${PIPESTATUS[0]} \${PIPESTATUS[2]}`,
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
        `cat file | sort | grep pattern | tee /tmp/logs/${TS}-000-grep.stdout.txt | wc -l ; builtin __just_bash_tee_restore \${PIPESTATUS[0]} \${PIPESTATUS[1]} \${PIPESTATUS[2]} \${PIPESTATUS[4]}`,
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
        },
        {
          commandIndex: 1,
          commandName: "grep",
          command: "grep hello",
          stdoutFile: `/tmp/logs/${TS}-001-grep.stdout.txt`,
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
        `echo a | tee /tmp/logs/${TS}-000-echo.stdout.txt | cat | tee /tmp/logs/${TS}-001-cat.stdout.txt ; builtin __just_bash_tee_restore \${PIPESTATUS[0]} \${PIPESTATUS[2]}\necho b | tee /tmp/logs/${TS}-002-echo.stdout.txt | cat | tee /tmp/logs/${TS}-003-cat.stdout.txt ; builtin __just_bash_tee_restore \${PIPESTATUS[0]} \${PIPESTATUS[2]}`,
      );
    });

    it("uses 'unknown' for dynamic command names in pipeline", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(
        new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
      );
      const result = bash.transform("$cmd hello | cat");
      expect(result.script).toContain("000-unknown.stdout.txt");
    });

    it("replaces colons in ISO timestamp", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(
        new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
      );
      const result = bash.transform("echo hello | cat");
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

    it("ignores commands removed by a direct extglob pattern rewrite", () => {
      const bash = new Bash();
      bash.registerTransformPlugin({
        name: "rewrite-public-extglob-pattern",
        transform: ({ ast }) => {
          const command = ast.statements[0].pipelines[0].commands[0];
          if (command.type !== "SimpleCommand") {
            throw new Error("Expected a simple command");
          }
          const glob = command.args[0].parts[0];
          if (glob.type !== "Glob") {
            throw new Error("Expected a structured extglob");
          }
          glob.pattern = "@(bar)";
          return { ast };
        },
      });
      bash.registerTransformPlugin(new CommandCollectorPlugin());

      const result = bash.transform("echo @($(printf stale)|foo)");

      expect(result.script).toBe("echo @(bar)");
      expect(result.metadata.commands).toEqual(["echo"]);
    });

    it("collects commands from case patterns and conditional operands", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(new CommandCollectorPlugin());

      const result = bash.transform(
        "[[ x == @($(printf conditional)) ]] && :; case x in @($(printf case))) :;; esac",
      );

      expect(result.metadata.commands).toEqual([":", "printf"]);
    });
  });

  it("executes transformed extglobs in patterns and assignments", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin({
      name: "rewrite-extglob",
      transform: ({ ast }) => {
        const updateExtglob = (word: WordNode): void => {
          const glob = word.parts.find((part) => part.type === "Glob");
          if (!glob?.extglob) {
            throw new Error("Expected a structured extglob");
          }
          const alternative = glob.extglob.alternatives[0].parts[0];
          if (alternative.type !== "Literal") {
            throw new Error("Expected a literal alternative");
          }
          alternative.value = "bar";
        };

        const conditional = ast.statements[1].pipelines[0].commands[0];
        if (
          conditional.type !== "ConditionalCommand" ||
          conditional.expression.type !== "CondBinary"
        ) {
          throw new Error("Expected a binary conditional");
        }
        updateExtglob(conditional.expression.right);

        const caseCommand = ast.statements[2].pipelines[0].commands[0];
        if (caseCommand.type !== "Case") {
          throw new Error("Expected a case command");
        }
        updateExtglob(caseCommand.items[0].patterns[0]);

        const assignment = ast.statements[3].pipelines[0].commands[0];
        if (
          assignment.type !== "SimpleCommand" ||
          !assignment.assignments[0].value
        ) {
          throw new Error("Expected an assignment value");
        }
        updateExtglob(assignment.assignments[0].value);

        return { ast };
      },
    });

    const result = await bash.exec(
      'shopt -s extglob; [[ bar == @(foo) ]] && echo conditional; case bar in @(foo) ) echo case;; esac; value=@(foo); printf "%s\\n" "$value"',
    );

    expect(result.stdout).toBe("conditional\ncase\n@(bar)\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("executes direct extglob pattern rewrites consistently", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin({
      name: "rewrite-public-extglob-pattern",
      transform: ({ ast }) => {
        const updatePattern = (word: WordNode): void => {
          const glob = word.parts.find((part) => part.type === "Glob");
          if (glob?.type !== "Glob") {
            throw new Error("Expected a structured extglob");
          }
          glob.pattern = "@(bar)";
        };

        const conditional = ast.statements[1].pipelines[0].commands[0];
        if (
          conditional.type !== "ConditionalCommand" ||
          conditional.expression.type !== "CondBinary"
        ) {
          throw new Error("Expected a binary conditional");
        }
        updatePattern(conditional.expression.right);

        const caseCommand = ast.statements[2].pipelines[0].commands[0];
        if (caseCommand.type !== "Case") {
          throw new Error("Expected a case command");
        }
        updatePattern(caseCommand.items[0].patterns[0]);

        const assignment = ast.statements[3].pipelines[0].commands[0];
        if (
          assignment.type !== "SimpleCommand" ||
          !assignment.assignments[0].value
        ) {
          throw new Error("Expected an assignment value");
        }
        updatePattern(assignment.assignments[0].value);

        return { ast };
      },
    });

    const script =
      'shopt -s extglob; [[ bar == @(foo) ]] && echo conditional; case bar in @(foo) ) echo case;; esac; value=@(foo); printf "%s\\n" "$value"';
    expect(bash.transform(script).script).toContain("@(bar)");

    const result = await bash.exec(script);

    expect(result.stdout).toBe("conditional\ncase\n@(bar)\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("executes transformed extglobs in parameter patterns", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin({
      name: "rewrite-pattern-extglob",
      transform: ({ ast }) => {
        const command = ast.statements[2].pipelines[0].commands[0];
        if (
          command.type !== "SimpleCommand" ||
          command.args[1].parts[0].type !== "DoubleQuoted"
        ) {
          throw new Error("Expected a double-quoted parameter expansion");
        }
        const expansion = command.args[1].parts[0].parts[0];
        if (
          expansion.type !== "ParameterExpansion" ||
          expansion.operation?.type !== "PatternRemoval"
        ) {
          throw new Error("Expected a pattern removal");
        }
        const glob = expansion.operation.pattern.parts[0];
        if (!glob || glob.type !== "Glob" || !glob.extglob) {
          throw new Error("Expected a structured extglob");
        }
        const alternative = glob.extglob.alternatives[0].parts[0];
        if (alternative.type !== "Literal") {
          throw new Error("Expected a literal alternative");
        }
        alternative.value = "bar";

        return { ast };
      },
    });

    const result = await bash.exec(
      'shopt -s extglob; value=bar; printf "%s\\n" "${value##@(foo)}"',
    );

    expect(result.stdout).toBe("\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  describe("plugin chaining", () => {
    it("tee + collector: collector sees inserted tee and restore builtin", () => {
      const bash = new Bash();
      bash.registerTransformPlugin(
        new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
      );
      bash.registerTransformPlugin(new CommandCollectorPlugin());
      const result = bash.transform("echo hello | grep hello");
      expect(result.metadata.commands).toEqual([
        "builtin",
        "echo",
        "grep",
        "tee",
      ]);
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

      expect(result.metadata.commands).toEqual([
        "builtin",
        "echo",
        "grep",
        "tee",
      ]);
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

    it("rejects oversized source before standalone parsing", () => {
      const pipeline = new BashTransformPipeline(2);
      expect(() => pipeline.transform("é")).not.toThrow();
      expect(() => pipeline.transform("éx")).toThrow(
        "script input size limit exceeded (2 bytes)",
      );
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
