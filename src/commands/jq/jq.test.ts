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
      expect(result.stdout).toBe("[\n  1,\n  2,\n  3\n]\n");
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

  describe("arithmetic operators", () => {
    it("should add numbers", async () => {
      const env = new Bash();
      const result = await env.exec("echo '5' | jq '. + 3'");
      expect(result.stdout).toBe("8\n");
    });

    it("should subtract numbers", async () => {
      const env = new Bash();
      const result = await env.exec("echo '10' | jq '. - 4'");
      expect(result.stdout).toBe("6\n");
    });

    it("should multiply numbers", async () => {
      const env = new Bash();
      const result = await env.exec("echo '6' | jq '. * 7'");
      expect(result.stdout).toBe("42\n");
    });

    it("should divide numbers", async () => {
      const env = new Bash();
      const result = await env.exec("echo '20' | jq '. / 4'");
      expect(result.stdout).toBe("5\n");
    });

    it("should modulo numbers", async () => {
      const env = new Bash();
      const result = await env.exec("echo '17' | jq '. % 5'");
      expect(result.stdout).toBe("2\n");
    });

    it("should concatenate strings with +", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'{"a":"foo","b":"bar"}\' | jq \'.a + .b\'',
      );
      expect(result.stdout).toBe('"foobar"\n');
    });

    it("should concatenate arrays with +", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[[1,2],[3,4]]' | jq '.[0] + .[1]'");
      expect(result.stdout).toBe("[\n  1,\n  2,\n  3,\n  4\n]\n");
    });

    it("should merge objects with +", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '[{\"a\":1},{\"b\":2}]' | jq -c '.[0] + .[1]'",
      );
      expect(result.stdout).toBe('{"a":1,"b":2}\n');
    });
  });

  describe("comparison operators", () => {
    it("should compare equal", async () => {
      const env = new Bash();
      const result = await env.exec("echo '5' | jq '. == 5'");
      expect(result.stdout).toBe("true\n");
    });

    it("should compare not equal", async () => {
      const env = new Bash();
      const result = await env.exec("echo '5' | jq '. != 3'");
      expect(result.stdout).toBe("true\n");
    });

    it("should compare less than", async () => {
      const env = new Bash();
      const result = await env.exec("echo '3' | jq '. < 5'");
      expect(result.stdout).toBe("true\n");
    });

    it("should compare greater than", async () => {
      const env = new Bash();
      const result = await env.exec("echo '10' | jq '. > 5'");
      expect(result.stdout).toBe("true\n");
    });

    it("should compare less than or equal", async () => {
      const env = new Bash();
      const result = await env.exec("echo '5' | jq '. <= 5'");
      expect(result.stdout).toBe("true\n");
    });

    it("should compare greater than or equal", async () => {
      const env = new Bash();
      const result = await env.exec("echo '5' | jq '. >= 5'");
      expect(result.stdout).toBe("true\n");
    });
  });

  describe("logical operators", () => {
    it("should evaluate and", async () => {
      const env = new Bash();
      const result = await env.exec("echo 'true' | jq '. and true'");
      expect(result.stdout).toBe("true\n");
    });

    it("should evaluate or", async () => {
      const env = new Bash();
      const result = await env.exec("echo 'false' | jq '. or true'");
      expect(result.stdout).toBe("true\n");
    });

    it("should evaluate not", async () => {
      const env = new Bash();
      const result = await env.exec("echo 'true' | jq 'not'");
      expect(result.stdout).toBe("false\n");
    });

    it("should use alternative operator //", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"a\":null}' | jq '.a // \"default\"'",
      );
      expect(result.stdout).toBe('"default"\n');
    });

    it("should return value if not null with //", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"a\":42}' | jq '.a // \"default\"'",
      );
      expect(result.stdout).toBe("42\n");
    });
  });

  describe("conditionals", () => {
    it("should evaluate if-then-else", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '5' | jq 'if . > 3 then \"big\" else \"small\" end'",
      );
      expect(result.stdout).toBe('"big"\n');
    });

    it("should evaluate else branch", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '2' | jq 'if . > 3 then \"big\" else \"small\" end'",
      );
      expect(result.stdout).toBe('"small"\n');
    });

    it("should evaluate elif", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'5\' | jq \'if . > 10 then "big" elif . > 3 then "medium" else "small" end\'',
      );
      expect(result.stdout).toBe('"medium"\n');
    });
  });

  describe("select and map", () => {
    it("should filter with select", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '[1,2,3,4,5]' | jq '[.[] | select(. > 3)]'",
      );
      expect(result.stdout).toBe("[\n  4,\n  5\n]\n");
    });

    it("should transform with map", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[1,2,3]' | jq 'map(. * 2)'");
      expect(result.stdout).toBe("[\n  2,\n  4,\n  6\n]\n");
    });

    it("should chain select and map", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '[1,2,3,4,5]' | jq '[.[] | select(. > 2) | . * 10]'",
      );
      expect(result.stdout).toBe("[\n  30,\n  40,\n  50\n]\n");
    });

    it("should select objects by field", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'[{"n":1},{"n":5},{"n":2}]\' | jq -c \'[.[] | select(.n > 2)]\'',
      );
      expect(result.stdout).toBe('[{"n":5}]\n');
    });
  });

  describe("object construction", () => {
    it("should construct object with static keys", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'{"name":"test","value":42}\' | jq -c \'{n: .name, v: .value}\'',
      );
      expect(result.stdout).toBe('{"n":"test","v":42}\n');
    });

    it("should construct object with shorthand", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'{"name":"test","value":42}\' | jq -c \'{name, value}\'',
      );
      expect(result.stdout).toBe('{"name":"test","value":42}\n');
    });

    it("should construct object with dynamic keys", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'{"key":"foo","val":42}\' | jq -c \'{(.key): .val}\'',
      );
      expect(result.stdout).toBe('{"foo":42}\n');
    });
  });

  describe("array construction", () => {
    it("should construct array from iterator", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"a\":1,\"b\":2}' | jq '[.a, .b]'");
      expect(result.stdout).toBe("[\n  1,\n  2\n]\n");
    });

    it("should construct array from object values", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'{"a":1,"b":2,"c":3}\' | jq \'[.[]]\'',
      );
      expect(result.stdout).toBe("[\n  1,\n  2,\n  3\n]\n");
    });
  });

  describe("comma operator", () => {
    it("should output multiple values", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"a\":1,\"b\":2}' | jq '.a, .b'");
      expect(result.stdout).toBe("1\n2\n");
    });

    it("should work with three values", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'{"x":1,"y":2,"z":3}\' | jq \'.x, .y, .z\'',
      );
      expect(result.stdout).toBe("1\n2\n3\n");
    });
  });

  describe("array slicing", () => {
    it("should slice with start and end", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[0,1,2,3,4,5]' | jq '.[2:4]'");
      expect(result.stdout).toBe("[\n  2,\n  3\n]\n");
    });

    it("should slice from start", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[0,1,2,3,4]' | jq '.[:3]'");
      expect(result.stdout).toBe("[\n  0,\n  1,\n  2\n]\n");
    });

    it("should slice to end", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[0,1,2,3,4]' | jq '.[3:]'");
      expect(result.stdout).toBe("[\n  3,\n  4\n]\n");
    });

    it("should slice strings", async () => {
      const env = new Bash();
      const result = await env.exec("echo '\"hello\"' | jq '.[1:4]'");
      expect(result.stdout).toBe('"ell"\n');
    });
  });

  describe("variables", () => {
    it("should bind and use variable", async () => {
      const env = new Bash();
      const result = await env.exec("echo '5' | jq '. as $x | $x * $x'");
      expect(result.stdout).toBe("25\n");
    });

    it("should use variable in object construction", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '3' | jq -c '. as $n | {value: $n, doubled: ($n * 2)}'",
      );
      expect(result.stdout).toBe('{"value":3,"doubled":6}\n');
    });
  });

  describe("optional operator", () => {
    it("should return null for missing key with ?", async () => {
      const env = new Bash();
      const result = await env.exec("echo 'null' | jq '.foo?'");
      expect(result.stdout).toBe("null\n");
    });

    it("should return value if present with ?", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"foo\":42}' | jq '.foo?'");
      expect(result.stdout).toBe("42\n");
    });
  });

  describe("try-catch", () => {
    it("should catch errors", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '1' | jq 'try error(\"oops\") catch \"caught\"'",
      );
      expect(result.stdout).toBe('"caught"\n');
    });
  });

  describe("string functions", () => {
    it("should split strings", async () => {
      const env = new Bash();
      const result = await env.exec("echo '\"a,b,c\"' | jq 'split(\",\")'");
      expect(result.stdout).toBe('[\n  "a",\n  "b",\n  "c"\n]\n');
    });

    it("should join arrays", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'["a","b","c"]\' | jq \'join("-")\'',
      );
      expect(result.stdout).toBe('"a-b-c"\n');
    });

    it("should test regex", async () => {
      const env = new Bash();
      const result = await env.exec("echo '\"foobar\"' | jq 'test(\"bar\")'");
      expect(result.stdout).toBe("true\n");
    });

    it("should check startswith", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '\"hello world\"' | jq 'startswith(\"hello\")'",
      );
      expect(result.stdout).toBe("true\n");
    });

    it("should check endswith", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '\"hello world\"' | jq 'endswith(\"world\")'",
      );
      expect(result.stdout).toBe("true\n");
    });

    it("should ltrimstr", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '\"hello world\"' | jq 'ltrimstr(\"hello \")'",
      );
      expect(result.stdout).toBe('"world"\n');
    });

    it("should rtrimstr", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '\"hello world\"' | jq 'rtrimstr(\" world\")'",
      );
      expect(result.stdout).toBe('"hello"\n');
    });

    it("should ascii_downcase", async () => {
      const env = new Bash();
      const result = await env.exec("echo '\"HELLO\"' | jq 'ascii_downcase'");
      expect(result.stdout).toBe('"hello"\n');
    });

    it("should ascii_upcase", async () => {
      const env = new Bash();
      const result = await env.exec("echo '\"hello\"' | jq 'ascii_upcase'");
      expect(result.stdout).toBe('"HELLO"\n');
    });
  });

  describe("has and in", () => {
    it("should check has for object", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"foo\":42}' | jq 'has(\"foo\")'");
      expect(result.stdout).toBe("true\n");
    });

    it("should check has for missing key", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"foo\":42}' | jq 'has(\"bar\")'");
      expect(result.stdout).toBe("false\n");
    });

    it("should check has for array", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[1,2,3]' | jq 'has(1)'");
      expect(result.stdout).toBe("true\n");
    });
  });

  describe("contains", () => {
    it("should check array contains", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[1,2,3]' | jq 'contains([2])'");
      expect(result.stdout).toBe("true\n");
    });

    it("should check object contains", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'{"a":1,"b":2}\' | jq \'contains({"a":1})\'',
      );
      expect(result.stdout).toBe("true\n");
    });
  });

  describe("to_entries and from_entries", () => {
    it("should convert to entries", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"a\":1,\"b\":2}' | jq -c 'to_entries'",
      );
      expect(result.stdout).toBe(
        '[{"key":"a","value":1},{"key":"b","value":2}]\n',
      );
    });

    it("should convert from entries", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'[{"key":"a","value":1}]\' | jq -c \'from_entries\'',
      );
      expect(result.stdout).toBe('{"a":1}\n');
    });

    it("should use with_entries", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"a\":1,\"b\":2}' | jq -c 'with_entries({key: .key, value: (.value + 10)})'",
      );
      expect(result.stdout).toBe('{"a":11,"b":12}\n');
    });
  });

  describe("group_by and sort_by", () => {
    it("should sort_by field", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'[{"n":3},{"n":1},{"n":2}]\' | jq -c \'sort_by(.n)\'',
      );
      expect(result.stdout).toBe('[{"n":1},{"n":2},{"n":3}]\n');
    });

    it("should group_by field", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'[{"g":1,"v":"a"},{"g":2,"v":"b"},{"g":1,"v":"c"}]\' | jq -c \'group_by(.g)\'',
      );
      expect(result.stdout).toBe(
        '[[{"g":1,"v":"a"},{"g":1,"v":"c"}],[{"g":2,"v":"b"}]]\n',
      );
    });

    it("should unique_by field", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'[{"n":1},{"n":2},{"n":1}]\' | jq -c \'unique_by(.n)\'',
      );
      expect(result.stdout).toBe('[{"n":1},{"n":2}]\n');
    });
  });

  describe("math functions", () => {
    it("should floor", async () => {
      const env = new Bash();
      const result = await env.exec("echo '3.7' | jq 'floor'");
      expect(result.stdout).toBe("3\n");
    });

    it("should ceil", async () => {
      const env = new Bash();
      const result = await env.exec("echo '3.2' | jq 'ceil'");
      expect(result.stdout).toBe("4\n");
    });

    it("should round", async () => {
      const env = new Bash();
      const result = await env.exec("echo '3.5' | jq 'round'");
      expect(result.stdout).toBe("4\n");
    });

    it("should sqrt", async () => {
      const env = new Bash();
      const result = await env.exec("echo '16' | jq 'sqrt'");
      expect(result.stdout).toBe("4\n");
    });

    it("should abs", async () => {
      const env = new Bash();
      const result = await env.exec("echo '-5' | jq 'abs'");
      expect(result.stdout).toBe("5\n");
    });
  });

  describe("type conversion", () => {
    it("should tostring", async () => {
      const env = new Bash();
      const result = await env.exec("echo '42' | jq 'tostring'");
      expect(result.stdout).toBe('"42"\n');
    });

    it("should tonumber", async () => {
      const env = new Bash();
      const result = await env.exec("echo '\"42\"' | jq 'tonumber'");
      expect(result.stdout).toBe("42\n");
    });
  });

  describe("range", () => {
    it("should generate range", async () => {
      const env = new Bash();
      const result = await env.exec("jq -n '[range(5)]'");
      expect(result.stdout).toBe("[\n  0,\n  1,\n  2,\n  3,\n  4\n]\n");
    });

    it("should generate range with start and end", async () => {
      const env = new Bash();
      const result = await env.exec("jq -n '[range(2;5)]'");
      expect(result.stdout).toBe("[\n  2,\n  3,\n  4\n]\n");
    });
  });

  describe("recurse", () => {
    it("should recurse through structure", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"a\":{\"b\":1}}' | jq '[.. | numbers]'",
      );
      expect(result.stdout).toBe("[\n  1\n]\n");
    });
  });

  describe("getpath and setpath", () => {
    it("should getpath", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'{"a":{"b":42}}\' | jq \'getpath(["a","b"])\'',
      );
      expect(result.stdout).toBe("42\n");
    });

    it("should setpath", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"a\":1}' | jq -c 'setpath([\"b\"]; 2)'",
      );
      expect(result.stdout).toBe('{"a":1,"b":2}\n');
    });
  });

  describe("limit and first/last with expr", () => {
    it("should limit results", async () => {
      const env = new Bash();
      const result = await env.exec("jq -n '[limit(3; range(10))]'");
      expect(result.stdout).toBe("[\n  0,\n  1,\n  2\n]\n");
    });

    it("should get first of expression", async () => {
      const env = new Bash();
      const result = await env.exec("jq -n 'first(range(10))'");
      expect(result.stdout).toBe("0\n");
    });
  });

  describe("any and all with expression", () => {
    it("should check any with expression", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[1,2,3,4,5]' | jq 'any(. > 3)'");
      expect(result.stdout).toBe("true\n");
    });

    it("should check all with expression", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[1,2,3]' | jq 'all(. > 0)'");
      expect(result.stdout).toBe("true\n");
    });
  });

  describe("min_by and max_by", () => {
    it("should find min_by", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'[{"n":3},{"n":1},{"n":2}]\' | jq -c \'min_by(.n)\'',
      );
      expect(result.stdout).toBe('{"n":1}\n');
    });

    it("should find max_by", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'[{"n":3},{"n":1},{"n":2}]\' | jq -c \'max_by(.n)\'',
      );
      expect(result.stdout).toBe('{"n":3}\n');
    });
  });

  describe("sub and gsub", () => {
    it("should substitute first match", async () => {
      const env = new Bash();
      const result = await env.exec('echo \'"foobar"\' | jq \'sub("o"; "0")\'');
      expect(result.stdout).toBe('"f0obar"\n');
    });

    it("should substitute all matches", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo \'"foobar"\' | jq \'gsub("o"; "0")\'',
      );
      expect(result.stdout).toBe('"f00bar"\n');
    });
  });

  describe("index and indices", () => {
    it("should find index in string", async () => {
      const env = new Bash();
      const result = await env.exec("echo '\"foobar\"' | jq 'index(\"bar\")'");
      expect(result.stdout).toBe("3\n");
    });

    it("should find all indices", async () => {
      const env = new Bash();
      const result = await env.exec("echo '\"abcabc\"' | jq 'indices(\"bc\")'");
      expect(result.stdout).toBe("[\n  1,\n  4\n]\n");
    });
  });

  describe("flatten with depth", () => {
    it("should flatten with specific depth", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[[[1]],[[2]]]' | jq 'flatten(1)'");
      expect(result.stdout).toBe("[\n  [\n    1\n  ],\n  [\n    2\n  ]\n]\n");
    });
  });

  describe("transpose", () => {
    it("should transpose matrix", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[[1,2],[3,4]]' | jq 'transpose'");
      expect(result.stdout).toBe(
        "[\n  [\n    1,\n    3\n  ],\n  [\n    2,\n    4\n  ]\n]\n",
      );
    });
  });

  describe("negative indexing", () => {
    it("should access with negative index in slice", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[0,1,2,3,4]' | jq '.[-2:]'");
      expect(result.stdout).toBe("[\n  3,\n  4\n]\n");
    });
  });
});
