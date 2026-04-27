/**
 * Tests for the generic `invokeTool` hook on `JavaScriptConfig`.
 *
 * Exercises the `tools` proxy in js-exec end-to-end by passing a hand-rolled
 * invokeTool callback that maps a tool map → execution. This is what
 * `@just-bash/executor` does internally for inline tools; the tests live in
 * just-bash because they verify the platform hook, not the executor package.
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

interface InlineTool {
  // biome-ignore lint/suspicious/noExplicitAny: tool execute signatures vary
  execute: (...args: any[]) => unknown;
}

/** Build an invokeTool callback that dispatches over an inline tool map. */
function makeInvokeTool(
  tools: Record<string, InlineTool>,
): (path: string, argsJson: string) => Promise<string> {
  const map: Record<string, InlineTool> = Object.assign(
    Object.create(null) as Record<string, InlineTool>,
    tools,
  );
  return async (path, argsJson) => {
    if (!Object.hasOwn(map, path)) throw new Error(`Unknown tool: ${path}`);
    const args = argsJson ? JSON.parse(argsJson) : undefined;
    const result = await map[path].execute(args);
    return result !== undefined ? JSON.stringify(result) : "";
  };
}

describe("js-exec tools proxy via JavaScriptConfig.invokeTool", () => {
  function createBashWithTools() {
    return new Bash({
      javascript: {
        invokeTool: makeInvokeTool({
          "math.add": {
            execute: (args: { a: number; b: number }) => ({
              sum: args.a + args.b,
            }),
          },
          "math.multiply": {
            execute: (args: { a: number; b: number }) => ({
              product: args.a * args.b,
            }),
          },
          "echo.back": {
            execute: (args: unknown) => args,
          },
        }),
      },
    });
  }

  it("should call a tool and print the result", async () => {
    const bash = createBashWithTools();
    const r = await bash.exec(
      `js-exec -c 'const r = tools.math.add({a:3,b:4}); console.log(r.sum)'`,
    );
    expect(r.stdout).toBe("7\n");
    expect(r.exitCode).toBe(0);
  });

  it("should chain multiple tool calls", async () => {
    const bash = createBashWithTools();
    const r = await bash.exec(
      `js-exec -c 'const s = tools.math.add({a:10,b:20}); const p = tools.math.multiply({a:s.sum,b:3}); console.log(p.product)'`,
    );
    expect(r.stdout).toBe("90\n");
    expect(r.exitCode).toBe(0);
  });

  it("should return structured JSON from tool", async () => {
    const bash = createBashWithTools();
    const r = await bash.exec(
      `js-exec -c 'console.log(JSON.stringify(tools.math.add({a:1,b:2})))'`,
    );
    expect(r.stdout).toBe('{"sum":3}\n');
    expect(r.exitCode).toBe(0);
  });

  it("should error on unknown tool", async () => {
    const bash = createBashWithTools();
    const r = await bash.exec(
      `js-exec -c 'try { tools.nope.missing(); } catch(e) { console.error(e.message); }'`,
    );
    expect(r.stderr).toContain("Unknown tool: nope.missing");
    expect(r.exitCode).toBe(0);
  });

  it("should support deeply nested tool paths", async () => {
    const bash = new Bash({
      javascript: {
        invokeTool: makeInvokeTool({
          "a.b.c.d": { execute: () => ({ deep: true }) },
        }),
      },
    });
    const r = await bash.exec(
      `js-exec -c 'console.log(JSON.stringify(tools.a.b.c.d()))'`,
    );
    expect(r.stdout).toBe('{"deep":true}\n');
    expect(r.exitCode).toBe(0);
  });

  it("should pass through complex arguments", async () => {
    const bash = createBashWithTools();
    const r = await bash.exec(
      `js-exec -c 'const r = tools.echo.back({arr:[1,2,3],nested:{x:true}}); console.log(JSON.stringify(r))'`,
    );
    expect(r.stdout).toBe('{"arr":[1,2,3],"nested":{"x":true}}\n');
    expect(r.exitCode).toBe(0);
  });

  it("should work with async tool execute functions", async () => {
    const bash = new Bash({
      javascript: {
        invokeTool: makeInvokeTool({
          "async.fetch": {
            execute: async (args: { id: number }) => {
              return { id: args.id, name: `User ${args.id}` };
            },
          },
        }),
      },
    });
    const r = await bash.exec(
      `js-exec -c 'const u = tools.async.fetch({id:42}); console.log(u.name)'`,
    );
    expect(r.stdout).toBe("User 42\n");
    expect(r.exitCode).toBe(0);
  });

  it("should implicitly enable javascript when invokeTool is set", async () => {
    const bash = new Bash({
      javascript: {
        invokeTool: makeInvokeTool({
          "noop.test": { execute: () => ({}) },
        }),
      },
    });
    // js-exec should be available even without javascript: true
    const r = await bash.exec(`js-exec -c 'console.log("works")'`);
    expect(r.stdout).toBe("works\n");
    expect(r.exitCode).toBe(0);
  });

  it("should keep console.log going to stdout", async () => {
    const bash = createBashWithTools();
    const r = await bash.exec(
      `js-exec -c 'console.log("out"); console.error("err")'`,
    );
    expect(r.stdout).toBe("out\n");
    expect(r.stderr).toBe("err\n");
    expect(r.exitCode).toBe(0);
  });

  it("should handle tool that returns undefined", async () => {
    const bash = new Bash({
      javascript: {
        invokeTool: makeInvokeTool({
          "void.action": { execute: () => undefined },
        }),
      },
    });
    const r = await bash.exec(
      `js-exec -c 'const r = tools.void.action(); console.log(typeof r)'`,
    );
    expect(r.stdout).toBe("undefined\n");
    expect(r.exitCode).toBe(0);
  });

  it("should handle tool that throws", async () => {
    const bash = new Bash({
      javascript: {
        invokeTool: makeInvokeTool({
          "fail.hard": {
            execute: () => {
              throw new Error("tool exploded");
            },
          },
        }),
      },
    });
    const r = await bash.exec(
      `js-exec -c 'try { tools.fail.hard(); } catch(e) { console.error(e.message); }'`,
    );
    expect(r.stderr).toContain("tool exploded");
    expect(r.exitCode).toBe(0);
  });

  it("should call tool with no arguments", async () => {
    const bash = new Bash({
      javascript: {
        invokeTool: makeInvokeTool({
          "time.now": { execute: () => ({ ts: 1234567890 }) },
        }),
      },
    });
    const r = await bash.exec(`js-exec -c 'console.log(tools.time.now().ts)'`);
    expect(r.stdout).toBe("1234567890\n");
    expect(r.exitCode).toBe(0);
  });

  it("should work alongside normal js-exec features", async () => {
    const bash = new Bash({
      files: { "/data/test.txt": "hello from file" },
      javascript: {
        invokeTool: makeInvokeTool({
          "str.upper": {
            execute: (args: { s: string }) => ({
              result: args.s.toUpperCase(),
            }),
          },
        }),
      },
    });
    const r = await bash.exec(
      `js-exec -c 'const fs = require("fs"); const content = fs.readFileSync("/data/test.txt", "utf8"); const r = tools.str.upper({s: content}); console.log(r.result)'`,
    );
    expect(r.stdout).toBe("HELLO FROM FILE\n");
    expect(r.exitCode).toBe(0);
  });
});
