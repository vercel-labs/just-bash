import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq", () => {
  describe("raw output (-r)", () => {
    it("should output strings without quotes with -r", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"name\":\"test\"}' | jq -r '.name'",
      );
      expect(result.stdout).toBe("test\n");
      expect(result.exitCode).toBe(0);
    });

    it("should work with --raw-output", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"msg\":\"hello\"}' | jq --raw-output '.msg'",
      );
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("compact output (-c)", () => {
    it("should output compact JSON with -c", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"a\":1,\"b\":2}' | jq -c '.'");
      expect(result.stdout).toBe('{"a":1,"b":2}\n');
      expect(result.exitCode).toBe(0);
    });

    it("should output compact arrays", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[1,2,3]' | jq -c '.'");
      expect(result.stdout).toBe("[1,2,3]\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("null input (-n)", () => {
    it("should work with null input", async () => {
      const env = new Bash();
      const result = await env.exec("jq -n 'empty'");
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("slurp (-s)", () => {
    it("should slurp multiple JSON values into array", async () => {
      const env = new Bash();
      const result = await env.exec("echo '1\n2\n3' | jq -s '.'");
      expect(result.stdout).toBe("[\n  1,\n  2,\n  3\n]\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("sort keys (-S)", () => {
    it("should sort object keys with -S", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"z\":1,\"a\":2}' | jq -S '.'");
      expect(result.stdout).toBe('{\n  "a": 2,\n  "z": 1\n}\n');
      expect(result.exitCode).toBe(0);
    });
  });

  describe("file input", () => {
    it("should read from file", async () => {
      const env = new Bash({
        files: { "/data.json": '{"value":123}' },
      });
      const result = await env.exec("jq '.value' /data.json");
      expect(result.stdout).toBe("123\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should error on invalid JSON", async () => {
      const env = new Bash();
      const result = await env.exec("echo 'not json' | jq '.'");
      expect(result.stderr).toBe(
        "jq: parse error: Unexpected token 'o', \"not json\" is not valid JSON\n",
      );
      expect(result.exitCode).toBe(5);
    });

    it("should error on missing file", async () => {
      const env = new Bash();
      const result = await env.exec("jq . /missing.json");
      expect(result.stderr).toBe(
        "jq: /missing.json: No such file or directory\n",
      );
      expect(result.exitCode).toBe(2);
    });

    it("should error on unknown option", async () => {
      const env = new Bash();
      const result = await env.exec("jq --unknown '.'");
      expect(result.stderr).toBe("jq: unrecognized option '--unknown'\n");
      expect(result.exitCode).toBe(1);
    });

    it("should error on unknown short option", async () => {
      const env = new Bash();
      const result = await env.exec("jq -x '.'");
      expect(result.stderr).toBe("jq: invalid option -- 'x'\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("help", () => {
    it("should show help with --help", async () => {
      const env = new Bash();
      const result = await env.exec("jq --help");
      expect(result.stdout).toMatch(/jq.*JSON/);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("exit status (-e)", () => {
    it("should exit 1 for null with -e", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"a\":1}' | jq -e '.missing'");
      expect(result.stdout).toBe("null\n");
      expect(result.exitCode).toBe(1);
    });

    it("should exit 1 for false with -e", async () => {
      const env = new Bash();
      const result = await env.exec("echo 'false' | jq -e '.'");
      expect(result.stdout).toBe("false\n");
      expect(result.exitCode).toBe(1);
    });

    it("should exit 0 for truthy value with -e", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"a\":1}' | jq -e '.a'");
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("join output (-j)", () => {
    it("should not print newlines with -j", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[1,2,3]' | jq -j '.[]'");
      expect(result.stdout).toBe("123");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("tab indentation (--tab)", () => {
    it("should use tabs for indentation with --tab", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"a\":1}' | jq --tab '.'");
      expect(result.stdout).toBe('{\n\t"a": 1\n}\n');
      expect(result.exitCode).toBe(0);
    });
  });

  describe("combined flags", () => {
    it("should combine -rc flags", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"name\":\"test\"}' | jq -rc '.name'",
      );
      expect(result.stdout).toBe("test\n");
    });
  });
});
