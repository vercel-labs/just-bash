/**
 * Tests for xan data utility commands:
 * transpose, shuffle, fixlengths, split, partition, to, from
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xan to json", () => {
  it("converts CSV to JSON (array of objects)", async () => {
    const bash = new Bash({
      files: { "/data.csv": "name,age\nalice,30\nbob,25\n" },
    });
    const result = await bash.exec("xan to json /data.csv");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      { name: "alice", age: 30 },
      { name: "bob", age: 25 },
    ]);
  });

  it("pretty prints by default", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n" },
    });
    const result = await bash.exec("xan to json /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('[\n  {\n    "n": 1\n  }\n]\n');
  });

  it("errors without format", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a\n1\n" },
    });
    const result = await bash.exec("xan to");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("xan to: usage: xan to <format> [FILE]\n");
  });
});

describe("xan from json", () => {
  it("converts JSON to CSV", async () => {
    const bash = new Bash({
      files: {
        "/data.json": '[{"name":"alice","age":30},{"name":"bob","age":25}]',
      },
    });
    const result = await bash.exec("xan from -f json /data.json");
    expect(result.exitCode).toBe(0);
    // Real xan outputs columns in alphabetical order
    expect(result.stdout).toBe("age,name\n30,alice\n25,bob\n");
  });

  it("converts JSON array of arrays to CSV", async () => {
    const bash = new Bash({
      files: { "/data.json": '[["name","age"],["alice",30],["bob",25]]' },
    });
    const result = await bash.exec("xan from -f json /data.json");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("name,age\nalice,30\nbob,25\n");
  });

  it("errors on invalid JSON", async () => {
    const bash = new Bash({
      files: { "/data.json": "not valid json" },
    });
    const result = await bash.exec("xan from -f json /data.json");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("xan from: invalid JSON input\n");
  });

  it("errors without format flag", async () => {
    const bash = new Bash({
      files: { "/data.json": "[]" },
    });
    const result = await bash.exec("xan from /data.json");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "xan from: usage: xan from -f <format> [FILE]\n",
    );
  });
});

describe("xan transpose", () => {
  it("transposes rows and columns", async () => {
    const bash = new Bash({
      files: {
        "/data.csv": "metric,jan,feb,mar\nsales,100,150,200\ncosts,80,90,100\n",
      },
    });
    const result = await bash.exec("xan transpose /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "metric,sales,costs\njan,100,80\nfeb,150,90\nmar,200,100\n",
    );
  });

  it("handles single column", async () => {
    const bash = new Bash({
      files: { "/data.csv": "name\nalice\nbob\n" },
    });
    const result = await bash.exec("xan transpose /data.csv");
    expect(result.exitCode).toBe(0);
    // After transpose: first col value becomes header, no data rows (only header column)
    expect(result.stdout).toBe("name,alice,bob\n");
  });

  it("handles empty data (header only)", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b,c\n" },
    });
    const result = await bash.exec("xan transpose /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("column\na\nb\nc\n");
  });
});

describe("xan shuffle", () => {
  it("shuffles rows with seed for reproducibility", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n5\n" },
    });
    const result = await bash.exec("xan shuffle --seed 42 /data.csv");
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("n"); // Header preserved
    expect(lines.length).toBe(6); // Header + 5 data rows
    // With seed, result should be deterministic
    const values = lines.slice(1).map((l) => Number.parseInt(l, 10));
    expect(values.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]); // All values present
  });

  it("produces different order with different seeds", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n" },
    });
    const result1 = await bash.exec("xan shuffle --seed 1 /data.csv");
    const result2 = await bash.exec("xan shuffle --seed 2 /data.csv");
    expect(result1.exitCode).toBe(0);
    expect(result2.exitCode).toBe(0);
    // Different seeds should produce different orders
    expect(result1.stdout).not.toBe(result2.stdout);
  });
});

describe("xan fixlengths", () => {
  it("pads short rows", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b,c\n1,2,3\n4,5\n6\n" },
    });
    const result = await bash.exec("xan fixlengths /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b,c\n1,2,3\n4,5,\n6,,\n");
  });

  it("truncates long rows with -l", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b,c,d\n1,2,3,4\n5,6,7,8\n" },
    });
    const result = await bash.exec("xan fixlengths -l 2 /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b\n1,2\n5,6\n");
  });

  it("uses custom default value with -d", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b,c\n1,2\n3\n" },
    });
    const result = await bash.exec("xan fixlengths -d 'N/A' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b,c\n1,2,N/A\n3,N/A,N/A\n");
  });
});

describe("xan split", () => {
  it("splits into N chunks with -c", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n5\n6\n" },
    });
    const result = await bash.exec("xan split -c 3 /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Split into 3 parts\n");
  });

  it("splits by size with -S", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n5\n" },
    });
    const result = await bash.exec("xan split -S 2 /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Split into 3 parts\n");
  });

  it("errors without -c or -S", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n" },
    });
    const result = await bash.exec("xan split /data.csv");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("xan split: must specify -c or -S\n");
  });
});

describe("xan partition", () => {
  it("partitions by column value", async () => {
    const bash = new Bash({
      files: { "/data.csv": "region,value\nnorth,10\nsouth,20\nnorth,30\n" },
    });
    const result = await bash.exec("xan partition region /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Partitioned into 2 files by 'region'\n");
  });

  it("errors on missing column", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b\n1,2\n" },
    });
    const result = await bash.exec("xan partition nonexistent /data.csv");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "xan partition: column 'nonexistent' not found\n",
    );
  });
});
