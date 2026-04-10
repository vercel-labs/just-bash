import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec executor tools", () => {
  function createBashWithTools() {
    return new Bash({
      executor: {
        tools: {
          "math.add": {
            description: "Add two numbers",
            execute: (args: { a: number; b: number }) => ({
              sum: args.a + args.b,
            }),
          },
          "math.multiply": {
            description: "Multiply two numbers",
            execute: (args: { a: number; b: number }) => ({
              product: args.a * args.b,
            }),
          },
          "echo.back": {
            execute: (args: unknown) => args,
          },
        },
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
      executor: {
        tools: {
          "a.b.c.d": { execute: () => ({ deep: true }) },
        },
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
      executor: {
        tools: {
          "async.fetch": {
            execute: async (args: { id: number }) => {
              return { id: args.id, name: `User ${args.id}` };
            },
          },
        },
      },
    });
    const r = await bash.exec(
      `js-exec -c 'const u = tools.async.fetch({id:42}); console.log(u.name)'`,
    );
    expect(r.stdout).toBe("User 42\n");
    expect(r.exitCode).toBe(0);
  });

  it("should implicitly enable javascript", async () => {
    const bash = new Bash({
      executor: { tools: { "noop.test": { execute: () => ({}) } } },
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
      executor: {
        tools: {
          "void.action": { execute: () => undefined },
        },
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
      executor: {
        tools: {
          "fail.hard": {
            execute: () => {
              throw new Error("tool exploded");
            },
          },
        },
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
      executor: {
        tools: {
          "time.now": { execute: () => ({ ts: 1234567890 }) },
        },
      },
    });
    const r = await bash.exec(`js-exec -c 'console.log(tools.time.now().ts)'`);
    expect(r.stdout).toBe("1234567890\n");
    expect(r.exitCode).toBe(0);
  });

  it("should work alongside normal js-exec features", async () => {
    const bash = new Bash({
      files: { "/data/test.txt": "hello from file" },
      executor: {
        tools: {
          "str.upper": {
            execute: (args: { s: string }) => ({
              result: args.s.toUpperCase(),
            }),
          },
        },
      },
    });
    const r = await bash.exec(
      `js-exec -c 'const fs = require("fs"); const content = fs.readFileSync("/data/test.txt", "utf8"); const r = tools.str.upper({s: content}); console.log(r.result)'`,
    );
    expect(r.stdout).toBe("HELLO FROM FILE\n");
    expect(r.exitCode).toBe(0);
  });
});
