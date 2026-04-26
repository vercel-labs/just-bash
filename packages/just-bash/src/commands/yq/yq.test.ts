import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("yq", () => {
  describe("YAML processing", () => {
    it("should read YAML and output YAML by default", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "name: test\nversion: 1.0\n",
        },
      });
      const result = await bash.exec("yq '.name' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
    });

    it("should filter nested YAML", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": `
config:
  database:
    host: localhost
    port: 5432
`,
        },
      });
      const result = await bash.exec("yq '.config.database.host' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("localhost\n");
    });

    it("should handle arrays in YAML", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": `
items:
  - name: foo
    value: 1
  - name: bar
    value: 2
`,
        },
      });
      const result = await bash.exec("yq '.items[0].name' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("foo\n");
    });

    it("should iterate over arrays", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": `
fruits:
  - apple
  - banana
  - cherry
`,
        },
      });
      const result = await bash.exec("yq '.fruits[]' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("apple\nbanana\ncherry\n");
    });

    it("should use select filter", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": `
users:
  - name: alice
    active: true
  - name: bob
    active: false
  - name: charlie
    active: true
`,
        },
      });
      const result = await bash.exec(
        "yq '.users[] | select(.active) | .name' /data.yaml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("alice\ncharlie\n");
    });
  });

  describe("output formats", () => {
    it("should output as JSON with -o json", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "name: test\nvalue: 42\n",
        },
      });
      const result = await bash.exec("yq -o json '.' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ name: "test", value: 42 });
    });

    it("should output compact JSON with -c -o json", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "name: test\nvalue: 42\n",
        },
      });
      const result = await bash.exec("yq -c -o json '.' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('{"name":"test","value":42}\n');
    });

    it("should output raw strings with -r -o json", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "message: hello world\n",
        },
      });
      const result = await bash.exec("yq -r -o json '.message' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello world\n");
    });
  });

  describe("JSON input", () => {
    it("should read JSON with -p json", async () => {
      const bash = new Bash({
        files: {
          "/data.json": '{"name": "test", "value": 42}',
        },
      });
      const result = await bash.exec("yq -p json '.name' /data.json");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
    });

    it("should convert JSON to YAML", async () => {
      const bash = new Bash({
        files: {
          "/data.json": '{"name": "test", "value": 42}',
        },
      });
      const result = await bash.exec("yq -p json '.' /data.json");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("name: test");
      expect(result.stdout).toContain("value: 42");
    });
  });

  describe("XML input/output", () => {
    it("should read XML with -p xml", async () => {
      const bash = new Bash({
        files: {
          "/data.xml": "<root><name>test</name><value>42</value></root>",
        },
      });
      const result = await bash.exec("yq -p xml '.root.name' /data.xml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
    });

    it("should handle XML attributes", async () => {
      const bash = new Bash({
        files: {
          "/data.xml": '<item id="123" name="test"/>',
        },
      });
      // Attributes are strings in XML; use -o json to verify string value
      const result = await bash.exec(
        "yq -p xml '.item[\"+@id\"]' /data.xml -o json",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('"123"\n');
    });

    it("should output as XML", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": `
root:
  name: test
  value: 42
`,
        },
      });
      const result = await bash.exec("yq -o xml '.' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("<root>");
      expect(result.stdout).toContain("<name>test</name>");
      expect(result.stdout).toContain("<value>42</value>");
      expect(result.stdout).toContain("</root>");
    });
  });

  describe("stdin support", () => {
    it("should read from stdin", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo 'name: test' | yq '.name'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
    });

    it("should accept - for stdin", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo 'value: 42' | yq '.value' -");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("42\n");
    });
  });

  describe("null input", () => {
    it("should support -n for null input", async () => {
      const bash = new Bash();
      const result = await bash.exec("yq -n '{name: \"created\"}' -o json");
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ name: "created" });
    });
  });

  describe("slurp mode", () => {
    it("should slurp multiple YAML documents", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "---\nname: first\n---\nname: second\n",
        },
      });
      const result = await bash.exec("yq -s '.[0].name' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("first\n");
    });
  });

  describe("jq-style filters", () => {
    it("should support map filter", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": `
numbers:
  - 1
  - 2
  - 3
`,
        },
      });
      const result = await bash.exec("yq '.numbers | map(. * 2)' /data.yaml");
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trim().split("\n");
      expect(lines).toContain("- 2");
      expect(lines).toContain("- 4");
      expect(lines).toContain("- 6");
    });

    it("should support keys filter", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": `
config:
  host: localhost
  port: 8080
  debug: true
`,
        },
      });
      const result = await bash.exec("yq '.config | keys' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("debug");
      expect(result.stdout).toContain("host");
      expect(result.stdout).toContain("port");
    });

    it("should support length filter", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": `
items:
  - a
  - b
  - c
`,
        },
      });
      const result = await bash.exec("yq '.items | length' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("3\n");
    });
  });

  describe("error handling", () => {
    it("should handle file not found", async () => {
      const bash = new Bash();
      const result = await bash.exec("yq '.' /nonexistent.yaml");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("No such file or directory");
    });

    it("should handle invalid YAML", async () => {
      const bash = new Bash({
        files: {
          "/bad.yaml": "invalid: yaml: syntax: error:",
        },
      });
      const result = await bash.exec("yq '.' /bad.yaml");
      expect(result.exitCode).toBe(5);
      expect(result.stderr).toContain("parse error");
    });

    it("should handle unknown options", async () => {
      const bash = new Bash();
      const result = await bash.exec("yq --unknown '.' /data.yaml");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unrecognized option");
    });
  });

  describe("help", () => {
    it("should display help with --help", async () => {
      const bash = new Bash();
      const result = await bash.exec("yq --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("yq");
      expect(result.stdout).toContain("YAML/XML");
    });
  });

  describe("format validation", () => {
    it("should reject invalid input format with --input-format=", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo '{}' | yq --input-format=badformat");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unrecognized option");
    });

    it("should reject invalid output format with --output-format=", async () => {
      const bash = new Bash();
      const result = await bash.exec(
        "echo '{}' | yq --output-format=badformat",
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unrecognized option");
    });

    it("should reject invalid input format with -p", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo '{}' | yq -p badformat");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("invalid option");
    });

    it("should reject invalid output format with -o", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo '{}' | yq -o badformat");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("invalid option");
    });

    it("should accept valid input formats", async () => {
      const bash = new Bash();
      // Test yaml and json which can parse {}
      for (const format of ["yaml", "json"]) {
        const result = await bash.exec(
          `echo '{}' | yq --input-format=${format} --output-format=json`,
        );
        expect(result.exitCode).toBe(0);
      }
    });

    it("should accept valid output formats", async () => {
      const bash = new Bash();
      for (const format of ["yaml", "json", "xml", "ini", "csv", "toml"]) {
        const result = await bash.exec(
          `echo '{}' | yq --output-format=${format}`,
        );
        expect(result.exitCode).toBe(0);
      }
    });
  });

  describe("INI format", () => {
    it("should read INI and extract values", async () => {
      const bash = new Bash({
        files: {
          "/config.ini": `
[database]
host=localhost
port=5432

[server]
debug=true
`,
        },
      });
      const result = await bash.exec("yq -p ini '.database.host' /config.ini");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("localhost\n");
    });

    it("should read INI with numeric values", async () => {
      const bash = new Bash({
        files: {
          "/config.ini": "[database]\nport=5432\n",
        },
      });
      const result = await bash.exec("yq -p ini '.database.port' /config.ini");
      expect(result.exitCode).toBe(0);
      // INI values are strings, use -r for raw output or -o json
      expect(result.stdout.trim()).toMatch(/5432/);
    });

    it("should output as INI", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": `
database:
  host: localhost
  port: 5432
`,
        },
      });
      const result = await bash.exec("yq -o ini '.' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("[database]");
      expect(result.stdout).toContain("host=localhost");
      expect(result.stdout).toContain("port=5432");
    });

    it("should convert YAML to INI", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "name: test\nversion: 1\n",
        },
      });
      const result = await bash.exec("yq -o ini '.' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("name=test");
      expect(result.stdout).toContain("version=1");
    });
  });

  describe("CSV format", () => {
    it("should read CSV with headers", async () => {
      const bash = new Bash({
        files: {
          "/data.csv": "name,age,city\nalice,30,NYC\nbob,25,LA\n",
        },
      });
      const result = await bash.exec("yq -p csv '.[0].name' /data.csv");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("alice\n");
    });

    it("should read CSV and get all names", async () => {
      const bash = new Bash({
        files: {
          "/data.csv": "name,age\nalice,30\nbob,25\n",
        },
      });
      const result = await bash.exec("yq -p csv '.[].name' /data.csv");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("alice\nbob\n");
    });

    it("should filter CSV rows", async () => {
      const bash = new Bash({
        files: {
          "/data.csv":
            "name,age,city\nalice,30,NYC\nbob,25,LA\ncharlie,35,NYC\n",
        },
      });
      const result = await bash.exec(
        "yq -p csv '[.[] | select(.city == \"NYC\") | .name]' /data.csv -o json",
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(["alice", "charlie"]);
    });

    it("should output as CSV", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": `
- name: alice
  age: 30
- name: bob
  age: 25
`,
        },
      });
      const result = await bash.exec("yq -o csv '.' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("name,age");
      expect(result.stdout).toContain("alice,30");
      expect(result.stdout).toContain("bob,25");
    });

    it("should convert JSON to CSV", async () => {
      const bash = new Bash({
        files: {
          "/data.json":
            '[{"name":"alice","score":95},{"name":"bob","score":87}]',
        },
      });
      const result = await bash.exec("yq -p json -o csv '.' /data.json");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("name,score");
      expect(result.stdout).toContain("alice,95");
      expect(result.stdout).toContain("bob,87");
    });

    it("should handle custom delimiter", async () => {
      const bash = new Bash({
        files: {
          "/data.tsv": "name\tage\nalice\t30\nbob\t25\n",
        },
      });
      const result = await bash.exec(
        "yq -p csv --csv-delimiter='\t' '.[0].name' /data.tsv",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("alice\n");
    });
  });

  describe("join-output mode", () => {
    it("should not print newlines with -j", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "items:\n  - a\n  - b\n  - c\n",
        },
      });
      const result = await bash.exec("yq -j '.items[]' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("abc");
    });
  });

  describe("exit-status mode", () => {
    it("should exit 0 for truthy output with -e", async () => {
      const bash = new Bash({
        files: { "/data.yaml": "value: true\n" },
      });
      const result = await bash.exec("yq -e '.value' /data.yaml");
      expect(result.exitCode).toBe(0);
    });

    it("should exit 1 for null output with -e", async () => {
      const bash = new Bash({
        files: { "/data.yaml": "value: 42\n" },
      });
      const result = await bash.exec("yq -e '.missing' /data.yaml");
      expect(result.exitCode).toBe(1);
    });

    it("should exit 1 for false output with -e", async () => {
      const bash = new Bash({
        files: { "/data.yaml": "value: false\n" },
      });
      const result = await bash.exec("yq -e '.value' /data.yaml");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("indent option", () => {
    it("should use custom indent with -I", async () => {
      const bash = new Bash({
        files: { "/data.yaml": "items:\n  - a\n  - b\n" },
      });
      const result = await bash.exec("yq -o json -I 4 '.' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('    "a"');
    });
  });

  describe("combined short options", () => {
    it("should handle -rc for raw compact json", async () => {
      const bash = new Bash({
        files: { "/data.yaml": "msg: hello\n" },
      });
      const result = await bash.exec("yq -rc -o json '.msg' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello\n");
    });

    it("should handle -cej for compact exit-status join", async () => {
      const bash = new Bash({
        files: { "/data.yaml": "items:\n  - 1\n  - 2\n" },
      });
      const result = await bash.exec("yq -cej -o json '.items[]' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("12");
    });
  });

  describe("jq builtin functions", () => {
    it("should support first", async () => {
      const bash = new Bash({
        files: { "/data.yaml": "items:\n  - a\n  - b\n  - c\n" },
      });
      const result = await bash.exec("yq '.items | first' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("a\n");
    });

    it("should support last", async () => {
      const bash = new Bash({
        files: { "/data.yaml": "items:\n  - a\n  - b\n  - c\n" },
      });
      const result = await bash.exec("yq '.items | last' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("c\n");
    });

    it("should support add for numbers", async () => {
      const bash = new Bash({
        files: { "/data.yaml": "nums:\n  - 1\n  - 2\n  - 3\n" },
      });
      const result = await bash.exec("yq '.nums | add' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("6\n");
    });

    it("should support min", async () => {
      const bash = new Bash({
        files: { "/data.yaml": "nums:\n  - 5\n  - 2\n  - 8\n" },
      });
      const result = await bash.exec("yq '.nums | min' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("2\n");
    });

    it("should support max", async () => {
      const bash = new Bash({
        files: { "/data.yaml": "nums:\n  - 5\n  - 2\n  - 8\n" },
      });
      const result = await bash.exec("yq '.nums | max' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("8\n");
    });

    it("should support unique", async () => {
      const bash = new Bash({
        files: { "/data.yaml": "items:\n  - a\n  - b\n  - a\n  - c\n  - b\n" },
      });
      const result = await bash.exec("yq '.items | unique' /data.yaml -o json");
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(["a", "b", "c"]);
    });

    it("should support sort_by", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml":
            "items:\n  - name: b\n    val: 2\n  - name: a\n    val: 1\n",
        },
      });
      const result = await bash.exec(
        "yq '.items | sort_by(.name) | .[0].name' /data.yaml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("a\n");
    });

    it("should support reverse", async () => {
      const bash = new Bash({
        files: { "/data.yaml": "items:\n  - 1\n  - 2\n  - 3\n" },
      });
      const result = await bash.exec(
        "yq '.items | reverse' /data.yaml -o json",
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([3, 2, 1]);
    });

    it("should support group_by", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml":
            "items:\n  - type: a\n    v: 1\n  - type: b\n    v: 2\n  - type: a\n    v: 3\n",
        },
      });
      const result = await bash.exec(
        "yq '.items | group_by(.type) | length' /data.yaml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("2\n");
    });
  });

  describe("CSV options", () => {
    it("should handle --no-csv-header", async () => {
      const bash = new Bash({
        files: { "/data.csv": "alice,30\nbob,25\n" },
      });
      const result = await bash.exec(
        "yq -p csv --no-csv-header '.[0][0]' /data.csv",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("alice\n");
    });
  });

  describe("XML options", () => {
    it("should use custom attribute prefix", async () => {
      const bash = new Bash({
        files: { "/data.xml": '<item id="123"/>' },
      });
      const result = await bash.exec(
        "yq -p xml --xml-attribute-prefix='@' '.item[\"@id\"]' /data.xml -o json -r",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("123\n");
    });
  });

  describe("TOML format", () => {
    it("should read TOML and extract values", async () => {
      const bash = new Bash({
        files: {
          "/Cargo.toml": `[package]
name = "my-app"
version = "1.0.0"

[dependencies]
serde = "1.0"
`,
        },
      });
      const result = await bash.exec("yq '.package.name' /Cargo.toml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("my-app\n");
    });

    it("should auto-detect TOML from .toml extension", async () => {
      const bash = new Bash({
        files: {
          "/config.toml": `[server]
host = "localhost"
port = 8080
`,
        },
      });
      const result = await bash.exec("yq '.server.port' /config.toml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("8080\n");
    });

    it("should output as TOML", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "server:\n  host: localhost\n  port: 8080\n",
        },
      });
      const result = await bash.exec("yq -o toml '.' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("[server]");
      expect(result.stdout).toContain('host = "localhost"');
      expect(result.stdout).toContain("port = 8080");
    });

    it("should convert JSON to TOML", async () => {
      const bash = new Bash({
        files: {
          "/data.json": '{"app": {"name": "test", "version": "2.0"}}',
        },
      });
      const result = await bash.exec("yq -p json -o toml '.' /data.json");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("[app]");
      expect(result.stdout).toContain('name = "test"');
    });
  });

  describe("TSV format", () => {
    it("should auto-detect TSV from .tsv extension", async () => {
      const bash = new Bash({
        files: {
          "/data.tsv": "name\tage\tcity\nalice\t30\tNYC\nbob\t25\tLA\n",
        },
      });
      const result = await bash.exec("yq '.[0].name' /data.tsv");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("alice\n");
    });

    it("should read all TSV rows", async () => {
      const bash = new Bash({
        files: {
          "/data.tsv": "name\tvalue\na\t1\nb\t2\n",
        },
      });
      const result = await bash.exec("yq '.[].name' /data.tsv");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("a\nb\n");
    });
  });

  describe("inplace mode", () => {
    it("should modify file in-place with -i", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "version: 1.0\nname: test\n",
        },
      });
      const result = await bash.exec("yq -i '.version = \"2.0\"' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");

      const readResult = await bash.exec("cat /data.yaml");
      expect(readResult.stdout).toContain('version: "2.0"');
    });

    it("should error when -i used without file", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo 'x: 1' | yq -i '.x'");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("requires a file");
    });
  });

  describe("front-matter", () => {
    it("should extract YAML front-matter from markdown", async () => {
      const bash = new Bash({
        files: {
          "/post.md": `---
title: My Post
date: 2024-01-01
tags:
  - tech
  - web
---

# Content here

This is the post body.
`,
        },
      });
      const result = await bash.exec("yq --front-matter '.title' /post.md");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("My Post\n");
    });

    it("should extract front-matter tags array", async () => {
      const bash = new Bash({
        files: {
          "/post.md": `---
title: Test
tags:
  - a
  - b
---
Content`,
        },
      });
      const result = await bash.exec("yq --front-matter '.tags[]' /post.md");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("a\nb\n");
    });

    it("should extract TOML front-matter with +++", async () => {
      const bash = new Bash({
        files: {
          "/post.md": `+++
title = "Hugo Post"
date = "2024-01-01"
+++

Content here.
`,
        },
      });
      const result = await bash.exec("yq -f '.title' /post.md");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Hugo Post\n");
    });

    it("should error when no front-matter found", async () => {
      const bash = new Bash({
        files: {
          "/plain.md": "# Just a heading\n\nNo front-matter here.",
        },
      });
      const result = await bash.exec("yq --front-matter '.title' /plain.md");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no front-matter found");
    });
  });

  describe("format auto-detection", () => {
    it("should auto-detect JSON from .json extension", async () => {
      const bash = new Bash({
        files: {
          "/data.json": '{"name": "test", "value": 42}',
        },
      });
      // No -p flag, should auto-detect from extension
      const result = await bash.exec("yq '.name' /data.json");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
    });

    it("should auto-detect XML from .xml extension", async () => {
      const bash = new Bash({
        files: {
          "/data.xml": "<root><name>test</name></root>",
        },
      });
      const result = await bash.exec("yq '.root.name' /data.xml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
    });

    it("should auto-detect CSV from .csv extension", async () => {
      const bash = new Bash({
        files: {
          "/data.csv": "name,age\nalice,30\nbob,25\n",
        },
      });
      const result = await bash.exec("yq '.[0].name' /data.csv");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("alice\n");
    });

    it("should auto-detect INI from .ini extension", async () => {
      const bash = new Bash({
        files: {
          "/config.ini": "[database]\nhost=localhost\n",
        },
      });
      const result = await bash.exec("yq '.database.host' /config.ini");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("localhost\n");
    });

    it("should prefer explicit -p over auto-detection", async () => {
      const bash = new Bash({
        files: {
          // File named .json but contains YAML
          "/data.json": "name: yaml-content\n",
        },
      });
      // Explicit -p yaml should override .json extension
      const result = await bash.exec("yq -p yaml '.name' /data.json");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("yaml-content\n");
    });
  });
});
