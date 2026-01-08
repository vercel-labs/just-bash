/**
 * Tests for xan basic commands: count, headers, head, tail, slice, reverse
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

describe("xan count", () => {
  it("counts rows excluding header", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan count /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("4\n");
  });

  it("counts rows in numbers.csv", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan count /numbers.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("5\n");
  });

  it("returns 0 for empty file", async () => {
    const bash = new Bash({ files: { "/empty.csv": "name,age\n" } });
    const result = await bash.exec("xan count /empty.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("0\n");
  });

  it("handles stdin", async () => {
    const bash = new Bash();
    const result = await bash.exec("echo 'a\n1\n2\n3' | xan count");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("3\n");
  });
});

describe("xan headers", () => {
  it("lists column names with indices", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan headers /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("0   name\n1   age\n2   email\n3   active\n");
  });

  it("lists just names with -j", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan headers -j /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("name\nage\nemail\nactive\n");
  });

  it("handles stdin", async () => {
    const bash = new Bash();
    const result = await bash.exec("echo 'a,b,c\n1,2,3' | xan headers -j");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a\nb\nc\n");
  });
});

describe("xan head", () => {
  it("shows first 10 rows by default", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan head /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age,email,active\nalice,30,alice@example.com,true\nbob,25,bob@example.com,false\ncharlie,35,charlie@example.com,true\ndiana,28,diana@example.com,true\n",
    );
  });

  it("shows first N rows with -l", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan head -l 2 /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age,email,active\nalice,30,alice@example.com,true\nbob,25,bob@example.com,false\n",
    );
  });

  it("handles stdin", async () => {
    const bash = new Bash();
    const result = await bash.exec("echo 'a\n1\n2\n3\n4\n5' | xan head -l 2");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a\n1\n2\n");
  });
});

describe("xan tail", () => {
  it("shows last 10 rows by default", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan tail /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age,email,active\nalice,30,alice@example.com,true\nbob,25,bob@example.com,false\ncharlie,35,charlie@example.com,true\ndiana,28,diana@example.com,true\n",
    );
  });

  it("shows last N rows with -l", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan tail -l 2 /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age,email,active\ncharlie,35,charlie@example.com,true\ndiana,28,diana@example.com,true\n",
    );
  });
});

describe("xan slice", () => {
  it("extracts rows with -s and -e", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan slice -s 1 -e 3 /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age,email,active\nbob,25,bob@example.com,false\ncharlie,35,charlie@example.com,true\n",
    );
  });

  it("extracts from start with -l", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan slice -l 2 /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age,email,active\nalice,30,alice@example.com,true\nbob,25,bob@example.com,false\n",
    );
  });
});

describe("xan reverse", () => {
  it("reverses row order", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan reverse /numbers.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("n\n5\n4\n3\n2\n1\n");
  });
});

describe("xan enum", () => {
  it("adds index column", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan enum /numbers.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("index,n\n0,1\n1,2\n2,3\n3,4\n4,5\n");
  });

  it("uses custom column name with -c", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan enum -c row_num /numbers.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("row_num,n\n0,1\n1,2\n2,3\n3,4\n4,5\n");
  });
});

describe("xan error handling", () => {
  it("errors on missing file", async () => {
    const bash = new Bash();
    const result = await bash.exec("xan count /nonexistent.csv");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No such file");
  });

  it("shows help with --help", async () => {
    const bash = new Bash();
    const result = await bash.exec("xan --help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("xan");
  });

  it("errors on unknown subcommand", async () => {
    const bash = new Bash();
    const result = await bash.exec("xan foobar /data.csv");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown command");
  });

  it("returns proper error for unimplemented commands", async () => {
    const bash = new Bash({});
    const result = await bash.exec("xan parallel");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("xan parallel: not yet implemented\n");
  });
});

describe("xan behead", () => {
  it("removes header row completely", async () => {
    const bash = new Bash({
      files: { "/data.csv": "name,age\nalice,30\nbob,25\n" },
    });
    const result = await bash.exec("xan behead /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("alice,30\nbob,25\n");
  });

  it("returns empty output for header-only file", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b,c\n" },
    });
    const result = await bash.exec("xan behead /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});

describe("xan sample", () => {
  it("samples N rows (positional argument)", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n" },
    });
    const result = await bash.exec("xan sample 3 --seed 42 /data.csv");
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines.length).toBe(4); // header + 3 rows
    expect(lines[0]).toBe("n");
  });

  it("returns all rows if sample size exceeds data", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n" },
    });
    const result = await bash.exec("xan sample 10 /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("n\n1\n2\n3\n");
  });

  it("errors without sample size", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n" },
    });
    const result = await bash.exec("xan sample /data.csv");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("usage");
  });
});

describe("xan flatten", () => {
  const sep = "─".repeat(80);

  it("displays records vertically", async () => {
    const bash = new Bash({
      files: { "/data.csv": "name,age\nalice,30\nbob,25\n" },
    });
    const result = await bash.exec("xan flatten /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `Row n°0\n${sep}\nname alice\nage  30\n\nRow n°1\n${sep}\nname bob\nage  25\n`,
    );
  });

  it("limits rows with -l", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n" },
    });
    const result = await bash.exec("xan flatten -l 1 /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`Row n°0\n${sep}\nn 1\n`);
  });

  it("works with alias f", async () => {
    const bash = new Bash({
      files: { "/data.csv": "x\n1\n" },
    });
    const result = await bash.exec("xan f /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`Row n°0\n${sep}\nx 1\n`);
  });
});
