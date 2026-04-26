/**
 * Tests for xan filter and sort commands
 * Uses real xan CLI syntax with moonblade expressions
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

describe("xan filter", () => {
  it("filters by numeric comparison", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan filter 'age > 28' /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age,email,active\nalice,30,alice@example.com,true\ncharlie,35,charlie@example.com,true\n",
    );
  });

  it("filters by string equality with eq", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec(
      "xan filter 'active eq \"true\"' /users.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age,email,active\nalice,30,alice@example.com,true\ncharlie,35,charlie@example.com,true\ndiana,28,diana@example.com,true\n",
    );
  });

  it("inverts match with -v", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan filter -v 'age > 28' /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age,email,active\nbob,25,bob@example.com,false\ndiana,28,diana@example.com,true\n",
    );
  });

  it("limits output with -l", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan filter -l 1 'age > 20' /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age,email,active\nalice,30,alice@example.com,true\n",
    );
  });

  it("returns header only when no matches", async () => {
    const bash = new Bash({ files: { "/data.csv": "n\n1\n2\n3\n" } });
    const result = await bash.exec("xan filter 'n > 100' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("n\n");
  });
});

describe("xan sort", () => {
  it("sorts by column (string, lexicographic)", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan sort -s name /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age,email,active\nalice,30,alice@example.com,true\nbob,25,bob@example.com,false\ncharlie,35,charlie@example.com,true\ndiana,28,diana@example.com,true\n",
    );
  });

  it("sorts by column (numeric)", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan sort -s age -N /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age,email,active\nbob,25,bob@example.com,false\ndiana,28,diana@example.com,true\nalice,30,alice@example.com,true\ncharlie,35,charlie@example.com,true\n",
    );
  });

  it("sorts in reverse order", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan sort -s age -N -R /users.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,age,email,active\ncharlie,35,charlie@example.com,true\nalice,30,alice@example.com,true\ndiana,28,diana@example.com,true\nbob,25,bob@example.com,false\n",
    );
  });
});

describe("xan dedup", () => {
  it("removes duplicates by column", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan dedup -s category /products.csv");
    expect(result.exitCode).toBe(0);
    // Should keep first occurrence of each category
    expect(result.stdout).toBe(
      "id,name,price,category,in_stock\n1,Widget,19.99,electronics,true\n3,Gizmo,9.99,accessories,false\n",
    );
  });

  it("dedup with all unique values returns all", async () => {
    const bash = new Bash({ files: { "/data.csv": "n\n1\n2\n3\n" } });
    const result = await bash.exec("xan dedup -s n /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("n\n1\n2\n3\n");
  });

  it("dedup with all same values returns one", async () => {
    const bash = new Bash({ files: { "/data.csv": "n\n5\n5\n5\n" } });
    const result = await bash.exec("xan dedup -s n /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("n\n5\n");
  });
});

describe("xan top", () => {
  it("gets top N by numeric column", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan top price -l 2 /products.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "id,name,price,category,in_stock\n4,Doodad,49.99,electronics,true\n2,Gadget,29.99,electronics,true\n",
    );
  });

  it("gets top N in reverse (bottom N)", async () => {
    const bash = new Bash({ files: fixtures });
    const result = await bash.exec("xan top price -l 2 -R /products.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "id,name,price,category,in_stock\n3,Gizmo,9.99,accessories,false\n5,Thingamajig,14.99,accessories,true\n",
    );
  });
});

describe("xan search", () => {
  it("filters by regex", async () => {
    const bash = new Bash({
      files: { "/data.csv": "h1,h2\nfoobar,x\nabc,y\nbarfoo,z\n" },
    });
    const result = await bash.exec("xan search -r '^foo' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("h1,h2\nfoobar,x\n");
  });

  it("inverts match with -v", async () => {
    const bash = new Bash({
      files: { "/data.csv": "h1,h2\nfoobar,x\nabc,y\nbarfoo,z\n" },
    });
    const result = await bash.exec("xan search -v -r '^foo' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("h1,h2\nabc,y\nbarfoo,z\n");
  });

  it("searches specific columns with -s", async () => {
    const bash = new Bash({
      files: { "/data.csv": "h1,h2\nfoo,bar\nbar,foo\n" },
    });
    const result = await bash.exec("xan search -s h1 -r 'foo' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("h1,h2\nfoo,bar\n");
  });

  it("case insensitive with -i", async () => {
    const bash = new Bash({
      files: { "/data.csv": "name\nFOO\nfoo\nbar\n" },
    });
    const result = await bash.exec("xan search -i -r 'foo' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("name\nFOO\nfoo\n");
  });

  it("errors on invalid regex pattern", async () => {
    const bash = new Bash({
      files: { "/data.csv": "name\nalice\n" },
    });
    const result = await bash.exec("xan search '[' /data.csv");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("xan search: invalid regex pattern '['\n");
  });
});
