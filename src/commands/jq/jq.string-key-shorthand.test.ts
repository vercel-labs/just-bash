import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { parse } from "../query-engine/parser.js";

describe("jq string key shorthand in object construction", () => {
  describe("parser: quoted string keys without colon", () => {
    it('should parse {"name"} as shorthand', () => {
      const ast = parse('{"name"}');
      expect(ast.type).toBe("Object");
    });

    it('should parse {"name", "label"} as shorthand', () => {
      const ast = parse('{"name", "label"}');
      expect(ast.type).toBe("Object");
    });

    it('should parse {"if"} as shorthand (keyword as string key)', () => {
      const ast = parse('{"if"}');
      expect(ast.type).toBe("Object");
    });

    it('should parse {"as"} as shorthand (keyword as string key)', () => {
      const ast = parse('{"as"}');
      expect(ast.type).toBe("Object");
    });

    it('should parse {"try"} as shorthand (keyword as string key)', () => {
      const ast = parse('{"try"}');
      expect(ast.type).toBe("Object");
    });

    it('should parse {"true"} as shorthand (keyword as string key)', () => {
      const ast = parse('{"true"}');
      expect(ast.type).toBe("Object");
    });

    it('should parse {"null"} as shorthand (keyword as string key)', () => {
      const ast = parse('{"null"}');
      expect(ast.type).toBe("Object");
    });

    it('should parse mixed: {"name", "label": .x}', () => {
      const ast = parse('{"name", "label": .x}');
      expect(ast.type).toBe("Object");
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
  });
});
