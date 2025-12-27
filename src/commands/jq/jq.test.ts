import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq", () => {
  describe("identity filter", () => {
    it("should pass through JSON with .", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"a\":1}' | jq '.'");
      expect(result.stdout).toBe('{\n  "a": 1\n}\n');
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should pretty print arrays", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[1,2,3]' | jq '.'");
      expect(result.stdout).toBe("[\n  1,\n  2,\n  3\n]\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("object access", () => {
    it("should access object key with .key", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"name\":\"test\"}' | jq '.name'");
      expect(result.stdout).toBe('"test"\n');
      expect(result.exitCode).toBe(0);
    });

    it("should access nested key with .a.b", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'{"a":{"b":"nested"}}\' | jq \'.a.b\'',
      );
      expect(result.stdout).toBe('"nested"\n');
      expect(result.exitCode).toBe(0);
    });

    it("should return null for missing key", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"a\":1}' | jq '.missing'");
      expect(result.stdout).toBe("null\n");
      expect(result.exitCode).toBe(0);
    });

    it("should access numeric values", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"count\":42}' | jq '.count'");
      expect(result.stdout).toBe("42\n");
      expect(result.exitCode).toBe(0);
    });

    it("should access boolean values", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"active\":true}' | jq '.active'");
      expect(result.stdout).toBe("true\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("array access", () => {
    it("should access array element with .[0]", async () => {
      const env = new Bash();
      const result = await env.exec('echo \'["a","b","c"]\' | jq \'.[0]\'');
      expect(result.stdout).toBe('"a"\n');
      expect(result.exitCode).toBe(0);
    });

    it("should access last element with .[-1]", async () => {
      const env = new Bash();
      const result = await env.exec('echo \'["a","b","c"]\' | jq \'.[-1]\'');
      expect(result.stdout).toBe('"c"\n');
      expect(result.exitCode).toBe(0);
    });

    it("should return null for out of bounds index", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[1,2]' | jq '.[99]'");
      expect(result.stdout).toBe("null\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("array iteration", () => {
    it("should iterate array with .[]", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[1,2,3]' | jq '.[]'");
      expect(result.stdout).toBe("1\n2\n3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should iterate object values with .[]", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"a\":1,\"b\":2}' | jq '.[]'");
      expect(result.stdout).toBe("1\n2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should iterate nested array with .items[]", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"items\":[1,2,3]}' | jq '.items[]'",
      );
      expect(result.stdout).toBe("1\n2\n3\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("pipes", () => {
    it("should pipe filters with |", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"data\":{\"value\":42}}' | jq '.data | .value'",
      );
      expect(result.stdout).toBe("42\n");
      expect(result.exitCode).toBe(0);
    });

    it("should chain multiple pipes", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'{"a":{"b":{"c":"deep"}}}\' | jq \'.a | .b | .c\'',
      );
      expect(result.stdout).toBe('"deep"\n');
      expect(result.exitCode).toBe(0);
    });
  });

  describe("builtin functions", () => {
    it("should get keys with keys", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"b\":1,\"a\":2}' | jq 'keys'");
      expect(result.stdout).toContain('"a"');
      expect(result.stdout).toContain('"b"');
      expect(result.exitCode).toBe(0);
    });

    it("should get values with values", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"a\":1,\"b\":2}' | jq 'values'");
      expect(result.stdout).toContain("1");
      expect(result.stdout).toContain("2");
      expect(result.exitCode).toBe(0);
    });

    it("should get length of array", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[1,2,3,4,5]' | jq 'length'");
      expect(result.stdout).toBe("5\n");
      expect(result.exitCode).toBe(0);
    });

    it("should get length of string", async () => {
      const env = new Bash();
      const result = await env.exec("echo '\"hello\"' | jq 'length'");
      expect(result.stdout).toBe("5\n");
      expect(result.exitCode).toBe(0);
    });

    it("should get length of object", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"a\":1,\"b\":2}' | jq 'length'");
      expect(result.stdout).toBe("2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should get type of value", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"a\":1}' | jq 'type'");
      expect(result.stdout).toBe('"object"\n');
      expect(result.exitCode).toBe(0);
    });

    it("should get type of array", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[1,2]' | jq 'type'");
      expect(result.stdout).toBe('"array"\n');
      expect(result.exitCode).toBe(0);
    });

    it("should get first element", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[5,10,15]' | jq 'first'");
      expect(result.stdout).toBe("5\n");
      expect(result.exitCode).toBe(0);
    });

    it("should get last element", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[5,10,15]' | jq 'last'");
      expect(result.stdout).toBe("15\n");
      expect(result.exitCode).toBe(0);
    });

    it("should reverse array", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[1,2,3]' | jq 'reverse'");
      expect(result.stdout).toBe("[\n  3,\n  2,\n  1\n]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should sort array", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[3,1,2]' | jq 'sort'");
      expect(result.stdout).toBe("[\n  1,\n  2,\n  3\n]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should get unique values", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[1,2,1,3,2]' | jq 'unique'");
      expect(result.stdout).toContain("1");
      expect(result.stdout).toContain("2");
      expect(result.stdout).toContain("3");
      expect(result.exitCode).toBe(0);
    });

    it("should add numbers", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[1,2,3,4]' | jq 'add'");
      expect(result.stdout).toBe("10\n");
      expect(result.exitCode).toBe(0);
    });

    it("should concatenate strings", async () => {
      const env = new Bash();
      const result = await env.exec('echo \'["a","b","c"]\' | jq \'add\'');
      expect(result.stdout).toBe('"abc"\n');
      expect(result.exitCode).toBe(0);
    });

    it("should get min value", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[5,2,8,1]' | jq 'min'");
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should get max value", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[5,2,8,1]' | jq 'max'");
      expect(result.stdout).toBe("8\n");
      expect(result.exitCode).toBe(0);
    });

    it("should flatten arrays", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[[1,2],[3,4]]' | jq 'flatten'");
      expect(result.stdout).toBe("[\n  1,\n  2,\n  3,\n  4\n]\n");
      expect(result.exitCode).toBe(0);
    });
  });

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
      expect(result.stderr).toContain("parse error");
      expect(result.exitCode).toBe(5);
    });

    it("should error on missing file", async () => {
      const env = new Bash();
      const result = await env.exec("jq . /missing.json");
      expect(result.stderr).toContain("No such file or directory");
      expect(result.exitCode).toBe(2);
    });

    it("should error on unknown option", async () => {
      const env = new Bash();
      const result = await env.exec("jq --unknown '.'");
      expect(result.stderr).toContain("unrecognized option");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("help", () => {
    it("should show help with --help", async () => {
      const env = new Bash();
      const result = await env.exec("jq --help");
      expect(result.stdout).toContain("jq");
      expect(result.stdout).toContain("JSON");
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
});
