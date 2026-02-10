import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { parse } from "../query-engine/parser.js";
import type { ObjectNode } from "../query-engine/parser-types.js";

function expectShorthandEntry(
  entry: ObjectNode["entries"][number],
  keyName: string,
) {
  expect(entry.key).toBe(keyName);
  expect(entry.value).toEqual({ type: "Field", name: keyName });
}

describe("jq string key shorthand in object construction", () => {
  describe("parser: quoted string keys without colon", () => {
    it('should parse {"name"} as shorthand with correct AST', () => {
      const ast = parse('{"name"}') as ObjectNode;
      expect(ast.type).toBe("Object");
      expect(ast.entries).toHaveLength(1);
      expectShorthandEntry(ast.entries[0], "name");
    });

    it('should parse {"name", "label"} as shorthand with correct AST', () => {
      const ast = parse('{"name", "label"}') as ObjectNode;
      expect(ast.type).toBe("Object");
      expect(ast.entries).toHaveLength(2);
      expectShorthandEntry(ast.entries[0], "name");
      expectShorthandEntry(ast.entries[1], "label");
    });

    it('should parse {"if"} as shorthand (keyword as string key)', () => {
      const ast = parse('{"if"}') as ObjectNode;
      expect(ast.type).toBe("Object");
      expect(ast.entries).toHaveLength(1);
      expectShorthandEntry(ast.entries[0], "if");
    });

    it('should parse {"as"} as shorthand (keyword as string key)', () => {
      const ast = parse('{"as"}') as ObjectNode;
      expect(ast.type).toBe("Object");
      expect(ast.entries).toHaveLength(1);
      expectShorthandEntry(ast.entries[0], "as");
    });

    it('should parse {"try"} as shorthand (keyword as string key)', () => {
      const ast = parse('{"try"}') as ObjectNode;
      expect(ast.type).toBe("Object");
      expect(ast.entries).toHaveLength(1);
      expectShorthandEntry(ast.entries[0], "try");
    });

    it('should parse {"true"} as shorthand (keyword as string key)', () => {
      const ast = parse('{"true"}') as ObjectNode;
      expect(ast.type).toBe("Object");
      expect(ast.entries).toHaveLength(1);
      expectShorthandEntry(ast.entries[0], "true");
    });

    it('should parse {"null"} as shorthand (keyword as string key)', () => {
      const ast = parse('{"null"}') as ObjectNode;
      expect(ast.type).toBe("Object");
      expect(ast.entries).toHaveLength(1);
      expectShorthandEntry(ast.entries[0], "null");
    });

    it('should parse mixed: {"name", "label": .x}', () => {
      const ast = parse('{"name", "label": .x}') as ObjectNode;
      expect(ast.type).toBe("Object");
      expect(ast.entries).toHaveLength(2);
      expectShorthandEntry(ast.entries[0], "name");
      expect(ast.entries[1].key).toBe("label");
      expect(ast.entries[1].value).toEqual({ type: "Field", name: "x" });
    });

    it('should parse non-identifier key {"a-b"} as shorthand', () => {
      const ast = parse('{"a-b"}') as ObjectNode;
      expect(ast.type).toBe("Object");
      expect(ast.entries).toHaveLength(1);
      expectShorthandEntry(ast.entries[0], "a-b");
    });

    it('should parse numeric string key {"1"} as shorthand', () => {
      const ast = parse('{"1"}') as ObjectNode;
      expect(ast.type).toBe("Object");
      expect(ast.entries).toHaveLength(1);
      expectShorthandEntry(ast.entries[0], "1");
    });

    it('should parse empty string key {""} as shorthand', () => {
      const ast = parse('{""}') as ObjectNode;
      expect(ast.type).toBe("Object");
      expect(ast.entries).toHaveLength(1);
      expectShorthandEntry(ast.entries[0], "");
    });

    it("should still parse explicit key-value with string key", () => {
      const ast = parse('{"name": .x}') as ObjectNode;
      expect(ast.type).toBe("Object");
      expect(ast.entries).toHaveLength(1);
      expect(ast.entries[0].key).toBe("name");
      expect(ast.entries[0].value).toEqual({ type: "Field", name: "x" });
    });
  });

  describe("evaluation: quoted string key shorthand", () => {
    it('should evaluate {"name"} shorthand', async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo '{"name":"foo","extra":"bar"}' | jq -c '{"name"}'`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('{"name":"foo"}\n');
    });

    it('should evaluate {"name", "label"} shorthand', async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo '{"name":"foo","label":"bar","extra":"baz"}' | jq -c '{"name", "label"}'`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('{"name":"foo","label":"bar"}\n');
    });

    it('should evaluate {"if"} keyword string shorthand', async () => {
      const env = new Bash();
      const result = await env.exec(`echo '{"if":"val"}' | jq -c '{"if"}'`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('{"if":"val"}\n');
    });

    it('should evaluate {"true"} keyword string shorthand', async () => {
      const env = new Bash();
      const result = await env.exec(`echo '{"true":"val"}' | jq -c '{"true"}'`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('{"true":"val"}\n');
    });

    it("should evaluate mixed shorthand and explicit keys", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo '{"name":"foo","value":42}' | jq -c '{"name", "v": .value}'`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('{"name":"foo","v":42}\n');
    });

    it("should evaluate string shorthand in fromjson pipeline", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo '{"content":[{"text":"{\\"id\\":\\"abcde\\",\\"name\\":\\"foo\\",\\"label\\":\\"bar\\"}"}]}' | jq -c '.content[0].text | fromjson | select(.id == "abcde") | {"name", "label"}'`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('{"name":"foo","label":"bar"}\n');
    });

    it("should evaluate string shorthand in fromjson + array iteration pipeline", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo '{"content":[{"text":"[{\\"id\\":\\"abcde\\",\\"name\\":\\"foo\\",\\"label\\":\\"bar\\"},{\\"id\\":\\"xyz\\",\\"name\\":\\"baz\\",\\"label\\":\\"qux\\"}]"}]}' | jq -c '.content[0].text | fromjson | .[] | select(.id == "abcde") | {"name", "label"}'`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('{"name":"foo","label":"bar"}\n');
    });

    it('should evaluate non-identifier key {"a-b"} shorthand', async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo '{"a-b":"val","extra":"x"}' | jq -c '{"a-b"}'`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('{"a-b":"val"}\n');
    });

    it('should evaluate numeric string key {"1"} shorthand', async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo '{"1":"val","extra":"x"}' | jq -c '{"1"}'`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('{"1":"val"}\n');
    });

    it('should evaluate empty string key {""} shorthand', async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo '{"":"val","extra":"x"}' | jq -c '{""}'`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('{"":"val"}\n');
    });
  });
});
