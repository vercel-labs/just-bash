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
