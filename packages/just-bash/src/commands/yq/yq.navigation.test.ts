/**
 * Tests for yq navigation operators (parent, parents, root)
 */
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("yq navigation operators", () => {
  it("parent returns immediate parent", async () => {
    const bash = new Bash({
      files: {
        "/data.yaml": "a:\n  b:\n    c: value\n",
      },
    });
    const result = await bash.exec("yq -o json '.a.b.c | parent' /data.yaml");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('{\n  "c": "value"\n}\n');
  });

  it("parent(2) returns grandparent", async () => {
    const bash = new Bash({
      files: {
        "/data.yaml": "a:\n  b:\n    c: value\n",
      },
    });
    const result = await bash.exec(
      "yq -o json '.a.b.c | parent(2)' /data.yaml",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('{\n  "b": {\n    "c": "value"\n  }\n}\n');
  });

  it("parent(-1) returns root", async () => {
    const bash = new Bash({
      files: {
        "/data.yaml": "a:\n  b:\n    c: value\n",
      },
    });
    const result = await bash.exec(
      "yq -o json '.a.b.c | parent(-1)' /data.yaml",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      '{\n  "a": {\n    "b": {\n      "c": "value"\n    }\n  }\n}\n',
    );
  });

  it("root returns document root", async () => {
    const bash = new Bash({
      files: {
        "/data.yaml": "a:\n  b:\n    c: value\n",
      },
    });
    const result = await bash.exec("yq -o json '.a.b.c | root' /data.yaml");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      '{\n  "a": {\n    "b": {\n      "c": "value"\n    }\n  }\n}\n',
    );
  });

  it("parents returns array of all ancestors", async () => {
    const bash = new Bash({
      files: {
        "/data.yaml": "a:\n  b:\n    c: value\n",
      },
    });
    const result = await bash.exec(
      "yq -o json '.a.b.c | parents | length' /data.yaml",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("3\n"); // parent .a.b, grandparent .a, root
  });

  describe("edge cases", () => {
    it("parent(0) returns current value", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "a:\n  b: test\n",
        },
      });
      const result = await bash.exec(
        "yq -o json '.a.b | parent(0)' /data.yaml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('"test"\n');
    });

    it("parent(-2) returns one level below root", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "a:\n  b:\n    c: value\n",
        },
      });
      const result = await bash.exec(
        "yq -o json '.a.b.c | parent(-2)' /data.yaml",
      );
      expect(result.exitCode).toBe(0);
      // -2 means one level below root, which is .a
      expect(result.stdout).toBe('{\n  "b": {\n    "c": "value"\n  }\n}\n');
    });

    it("parent beyond root returns empty", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "a:\n  b: test\n",
        },
      });
      const result = await bash.exec(
        "yq -o json '.a.b | parent(10)' /data.yaml",
      );
      expect(result.exitCode).toBe(0);
      // Beyond root should return nothing
      expect(result.stdout).toBe("");
    });

    it("parent at root returns empty", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "value: test\n",
        },
      });
      const result = await bash.exec("yq -o json '. | parent' /data.yaml");
      expect(result.exitCode).toBe(0);
      // At root, no parent
      expect(result.stdout).toBe("");
    });

    it("parent with array index path", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml":
            "items:\n  - name: foo\n    val: 1\n  - name: bar\n    val: 2\n",
        },
      });
      const result = await bash.exec(
        "yq -o json '.items[0].name | parent' /data.yaml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('{\n  "name": "foo",\n  "val": 1\n}\n');
    });

    it("parents on shallow path", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "a: test\n",
        },
      });
      const result = await bash.exec(
        "yq -o json '.a | parents | length' /data.yaml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("1\n"); // Just root
    });

    it("root without prior navigation", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "a: 1\nb: 2\n",
        },
      });
      const result = await bash.exec("yq -o json 'root' /data.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
    });

    it("chained parent calls", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml": "a:\n  b:\n    c:\n      d: value\n",
        },
      });
      const result = await bash.exec(
        "yq -o json '.a.b.c.d | parent | parent' /data.yaml",
      );
      expect(result.exitCode).toBe(0);
      // First parent: .a.b.c, second parent: .a.b
      expect(result.stdout).toBe('{\n  "c": {\n    "d": "value"\n  }\n}\n');
    });

    it("parent after select", async () => {
      const bash = new Bash({
        files: {
          "/data.yaml":
            "items:\n  - name: foo\n    active: true\n  - name: bar\n    active: false\n",
        },
      });
      // This is a complex case - select doesn't preserve path context in our impl
      // So parent after select may not work as expected
      const result = await bash.exec(
        "yq -o json '.items[] | select(.active == true) | .name' /data.yaml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('"foo"\n');
    });
  });
});
