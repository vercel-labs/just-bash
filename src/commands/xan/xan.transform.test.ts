/**
 * Tests for xan transform command - based on xan's test_transform.rs
 * Transform modifies existing columns in-place
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xan transform", () => {
  const DATA = "a,b,c\n1,2,3\n4,5,6\n";

  it("transforms a column with expression", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan transform b 'add(a, b)' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b,c\n1,3,3\n4,9,6\n");
  });

  it("transforms with rename", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec(
      "xan transform b 'add(a, b)' -r sum /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,sum,c\n1,3,3\n4,9,6\n");
  });

  it("transforms with underscore reference", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan transform b 'mul(_, 2)' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b,c\n1,4,3\n4,10,6\n");
  });

  it("transforms multiple columns", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan transform a,b 'mul(_, 10)' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b,c\n10,20,3\n40,50,6\n");
  });

  it("transforms multiple columns with rename", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec(
      "xan transform a,b 'mul(_, 10)' -r x,y /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("x,y,c\n10,20,3\n40,50,6\n");
  });

  it("errors on missing column", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan transform z 'add(a, b)' /data.csv");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("column 'z' not found");
  });

  it("errors on missing arguments", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan transform");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("usage");
  });

  it("errors on missing expression", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    // Piping empty data to simulate no expression
    const result = await bash.exec("echo '' | xan transform a");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("usage");
  });

  it("transforms with string functions", async () => {
    const bash = new Bash({
      files: { "/data.csv": "name,value\nhello,1\nworld,2\n" },
    });
    const result = await bash.exec("xan transform name 'upper(_)' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("name,value\nHELLO,1\nWORLD,2\n");
  });
});
