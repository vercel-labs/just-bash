/**
 * Tests for xan column operations: select, drop, rename
 * Uses real xan CLI syntax
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const fixturesDir = path.join(import.meta.dirname, "fixtures");

function loadFixtures(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const file of fs.readdirSync(fixturesDir)) {
    if (file.endsWith(".csv")) {
      const content = fs.readFileSync(path.join(fixturesDir, file), "utf-8");
      files[`/${file}`] = content;
    }
  }
  return files;
}

const fixtures = loadFixtures();

describe("xan select", () => {
  it("selects columns by name", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan select name,email /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,email\nalice,alice@example.com\nbob,bob@example.com\ncharlie,charlie@example.com\ndiana,diana@example.com\n",
    );
  });

  it("selects columns by index", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan select 0,2 /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,email\nalice,alice@example.com\nbob,bob@example.com\ncharlie,charlie@example.com\ndiana,diana@example.com\n",
    );
  });

  it("reorders columns", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan select email,name /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "email,name\nalice@example.com,alice\nbob@example.com,bob\ncharlie@example.com,charlie\ndiana@example.com,diana\n",
    );
  });

  it("selects with range notation", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan select 0-1 /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age\nalice,30\nbob,25\ncharlie,35\ndiana,28\n",
    );
  });

  it("works with file paths without slashes", async () => {
    const bash = new Bash({
      files: { "/home/user/data.csv": "a,b,c\n1,2,3\n" },
      cwd: "/home/user",
    });
    const result = await bash.exec("xan select a,b data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b\n1,2\n");
  });
});

describe("xan drop", () => {
  it("drops columns by name", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan drop email,active /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age\nalice,30\nbob,25\ncharlie,35\ndiana,28\n",
    );
  });

  it("drops columns by index", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan drop 2,3 /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age\nalice,30\nbob,25\ncharlie,35\ndiana,28\n",
    );
  });

  it("works with file paths without slashes", async () => {
    const bash = new Bash({
      files: { "/home/user/data.csv": "a,b,c\n1,2,3\n" },
      cwd: "/home/user",
    });
    const result = await bash.exec("xan drop c data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b\n1,2\n");
  });
});

describe("xan rename", () => {
  it("renames all columns", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan rename VALUE /numbers.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("VALUE\n1\n2\n3\n4\n5\n");
  });

  it("renames selected columns with -s", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec(
      "xan rename username -s name /users.csv | xan select username",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("username\nalice\nbob\ncharlie\ndiana\n");
  });
});
