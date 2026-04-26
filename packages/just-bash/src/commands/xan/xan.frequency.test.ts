/**
 * Tests for xan frequency command - based on xan's test_frequency.rs
 * Uses real xan CLI syntax
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xan frequency", () => {
  const DATA = "h1,h2\na,z\na,y\na,y\nb,z\n,z\n";

  it("computes frequency of all columns", async () => {
    const bash = new Bash({ files: { "/in.csv": DATA } });
    const result = await bash.exec("xan frequency --no-extra -l 0 /in.csv");
    expect(result.exitCode).toBe(0);
    // Output includes all columns, sorted by field then count
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("field,value,count");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("selects specific column with -s", async () => {
    const bash = new Bash({ files: { "/in.csv": DATA } });
    const result = await bash.exec(
      "xan frequency -s h2 --no-extra -l 0 /in.csv",
    );
    expect(result.exitCode).toBe(0);
    // Should show frequency of h2 values
    expect(result.stdout).toContain("field,value,count\n");
    expect(result.stdout).toContain("h2,z,3");
    expect(result.stdout).toContain("h2,y,2");
  });

  it("limits results with -l", async () => {
    const bash = new Bash({ files: { "/in.csv": DATA } });
    const result = await bash.exec("xan frequency -l 1 --no-extra /in.csv");
    expect(result.exitCode).toBe(0);
    // Should only show top 1 per field
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("field,value,count");
  });

  it("includes empty values", async () => {
    const bash = new Bash({ files: { "/in.csv": DATA } });
    const result = await bash.exec("xan frequency -s h1 -l 0 /in.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("<empty>");
  });

  it("shows stability with equal counts", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a\nx\nx\ny\ny\nz\nz\n" },
    });
    const result = await bash.exec("xan frequency /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("field,value,count\na,x,2\na,y,2\na,z,2\n");
  });
});

describe("xan frequency with groupby", () => {
  it("groups frequency by column with -g", async () => {
    const bash = new Bash({
      files: {
        "/data.csv":
          "name,color\njohn,blue\nmary,red\nmary,red\nmary,red\nmary,purple\njohn,yellow\njohn,blue\n",
      },
    });
    const result = await bash.exec("xan frequency -g name /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("field,name,value,count\n");
  });
});

describe("xan frequency --all", () => {
  it("shows all values with -A", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n" },
    });
    const result = await bash.exec("xan frequency -A /data.csv");
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split("\n");
    // Header + 11 values
    expect(lines.length).toBe(12);
  });
});
