import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { camelToKebab, parseToolCliArgs } from "./tool-command.js";

// ── camelToKebab ────────────────────────────────────────────────

describe("camelToKebab", () => {
  it("converts camelCase to kebab-case", () => {
    expect(camelToKebab("listPets")).toBe("list-pets");
    expect(camelToKebab("getPetById")).toBe("get-pet-by-id");
    expect(camelToKebab("createUser")).toBe("create-user");
  });

  it("leaves single words unchanged", () => {
    expect(camelToKebab("add")).toBe("add");
    expect(camelToKebab("list")).toBe("list");
  });

  it("handles consecutive uppercase (acronyms)", () => {
    expect(camelToKebab("parseXMLDocument")).toBe("parse-xml-document");
    expect(camelToKebab("getHTTPResponse")).toBe("get-http-response");
  });

  it("handles already-lowercase", () => {
    expect(camelToKebab("already-kebab")).toBe("already-kebab");
  });
});

// ── parseToolCliArgs ────────────────────────────────────────────

describe("parseToolCliArgs", () => {
  it("parses key=value pairs", () => {
    const result = parseToolCliArgs(["a=1", "b=2"], "");
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("parses --key value flags", () => {
    const result = parseToolCliArgs(["--a", "1", "--b", "2"], "");
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("parses --key=value flags", () => {
    const result = parseToolCliArgs(["--a=1", "--b=2"], "");
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("parses --json flag", () => {
    const result = parseToolCliArgs(["--json", '{"a":1,"b":2}'], "");
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("parses --json=value flag", () => {
    const result = parseToolCliArgs(['--json={"a":1}'], "");
    expect(result).toEqual({ a: 1 });
  });

  it("returns empty object for no args", () => {
    const result = parseToolCliArgs([], "");
    expect(result).toEqual({});
  });

  it("coerces values: numbers", () => {
    const result = parseToolCliArgs(["a=42", "b=3.14", "c=-5"], "");
    expect(result).toEqual({ a: 42, b: 3.14, c: -5 });
  });

  it("coerces values: booleans", () => {
    const result = parseToolCliArgs(["a=true", "b=false"], "");
    expect(result).toEqual({ a: true, b: false });
  });

  it("coerces values: null", () => {
    const result = parseToolCliArgs(["a=null"], "");
    expect(result).toEqual({ a: null });
  });

  it("coerces values: arrays", () => {
    const result = parseToolCliArgs(["a=[1,2,3]"], "");
    expect(result).toEqual({ a: [1, 2, 3] });
  });

  it("keeps strings as strings", () => {
    const result = parseToolCliArgs(["name=hello", "path=/tmp/file"], "");
    expect(result).toEqual({ name: "hello", path: "/tmp/file" });
  });

  it("handles empty value", () => {
    const result = parseToolCliArgs(["a="], "");
    expect(result).toEqual({ a: "" });
  });

  it("parses single JSON positional arg", () => {
    const result = parseToolCliArgs(['{"a":1,"b":2}'], "");
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("parses piped stdin JSON as base", () => {
    const result = parseToolCliArgs([], '{"a":1,"b":2}');
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("explicit args override stdin", () => {
    const result = parseToolCliArgs(["a=99"], '{"a":1,"b":2}');
    expect(result).toEqual({ a: 99, b: 2 });
  });

  it("--json overrides stdin", () => {
    const result = parseToolCliArgs(["--json", '{"a":99}'], '{"a":1,"b":2}');
    expect(result).toEqual({ a: 99, b: 2 });
  });

  it("flags override --json", () => {
    const result = parseToolCliArgs(["--json", '{"a":1,"b":2}', "a=99"], "");
    expect(result).toEqual({ a: 99, b: 2 });
  });

  it("boolean flags (no value)", () => {
    const result = parseToolCliArgs(["--verbose", "--debug"], "");
    expect(result).toEqual({ verbose: true, debug: true });
  });

  it("returns help sentinel for --help", () => {
    const result = parseToolCliArgs(["--help"], "");
    expect(typeof result).toBe("symbol");
  });

  it("ignores non-JSON stdin", () => {
    const result = parseToolCliArgs(["a=1"], "not json at all");
    expect(result).toEqual({ a: 1 });
  });
});

// ── Integration: Bash with tool commands ────────────────────────

function createBashWithInlineTools() {
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
        "util.echo": {
          description: "Echo arguments back",
          execute: (args: unknown) => args,
        },
      },
    },
  });
}

describe("tool namespace commands", () => {
  it("invokes tool via key=value args", async () => {
    const bash = createBashWithInlineTools();
    const r = await bash.exec("math add a=1 b=2");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"sum":3}\n');
  });

  it("invokes tool via --key value flags", async () => {
    const bash = createBashWithInlineTools();
    const r = await bash.exec("math add --a 1 --b 2");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"sum":3}\n');
  });

  it("invokes tool via --key=value flags", async () => {
    const bash = createBashWithInlineTools();
    const r = await bash.exec("math add --a=1 --b=2");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"sum":3}\n');
  });

  it("invokes tool via --json flag", async () => {
    const bash = createBashWithInlineTools();
    const r = await bash.exec(`math add --json '{"a":10,"b":20}'`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"sum":30}\n');
  });

  it("invokes tool via piped stdin JSON", async () => {
    const bash = createBashWithInlineTools();
    const r = await bash.exec(`echo '{"a":5,"b":3}' | math add`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"sum":8}\n');
  });

  it("pipes tool output to jq", async () => {
    const bash = createBashWithInlineTools();
    const r = await bash.exec("math add a=1 b=2 | jq -r .sum");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("3\n");
  });

  it("shows namespace help with --help", async () => {
    const bash = createBashWithInlineTools();
    const r = await bash.exec("math --help");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Executor tools: math");
    expect(r.stdout).toContain("COMMANDS");
    expect(r.stdout).toContain("add");
    expect(r.stdout).toContain("multiply");
    expect(r.stdout).toContain("Add two numbers");
  });

  it("shows namespace help with no args", async () => {
    const bash = createBashWithInlineTools();
    const r = await bash.exec("math");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("COMMANDS");
  });

  it("shows subcommand help", async () => {
    const bash = createBashWithInlineTools();
    const r = await bash.exec("math add --help");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Add two numbers");
    expect(r.stdout).toContain("USAGE");
    expect(r.stdout).toContain("EXAMPLES");
    expect(r.stdout).toContain("--json");
    expect(r.stdout).toContain("math add");
  });

  it("errors on unknown subcommand", async () => {
    const bash = createBashWithInlineTools();
    const r = await bash.exec("math nonexistent");
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('unknown command "nonexistent"');
    expect(r.stderr).toContain("--help");
  });

  it("errors on tool execution failure", async () => {
    const bash = new Bash({
      executor: {
        tools: {
          "fail.now": {
            execute: () => {
              throw new Error("something broke");
            },
          },
        },
      },
    });
    const r = await bash.exec("fail now");
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("something broke");
  });

  it("registers multiple namespaces", async () => {
    const bash = createBashWithInlineTools();
    // math namespace
    const r1 = await bash.exec("math add a=1 b=2");
    expect(r1.exitCode).toBe(0);
    expect(r1.stdout).toBe('{"sum":3}\n');

    // util namespace
    const r2 = await bash.exec(`util echo --json '{"hello":"world"}'`);
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout).toBe('{"hello":"world"}\n');

    // second subcommand in same namespace
    const r3 = await bash.exec("math multiply a=3 b=4");
    expect(r3.exitCode).toBe(0);
    expect(r3.stdout).toBe('{"product":12}\n');
  });

  it("does not register commands when exposeToolsAsCommands is false", async () => {
    const bash = new Bash({
      executor: {
        tools: {
          "calc.add": {
            execute: (args: { a: number; b: number }) => ({
              sum: args.a + args.b,
            }),
          },
        },
        exposeToolsAsCommands: false,
      },
    });
    const r = await bash.exec("calc add a=1 b=2");
    expect(r.exitCode).toBe(127);
    expect(r.stderr).toContain("not found");
  });

  it("handles camelCase subcommand aliases", async () => {
    const bash = new Bash({
      executor: {
        tools: {
          "api.listUsers": {
            description: "List all users",
            execute: () => [{ name: "Alice" }],
          },
        },
      },
    });
    // kebab-case works
    const r1 = await bash.exec("api list-users");
    expect(r1.exitCode).toBe(0);
    expect(r1.stdout).toContain("Alice");

    // original camelCase also works
    const r2 = await bash.exec("api listUsers");
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout).toContain("Alice");
  });

  it("chains tool output through jq in a pipeline", async () => {
    const bash = createBashWithInlineTools();
    const r = await bash.exec("math add a=10 b=20 | jq -r .sum");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("30\n");
  });
});
