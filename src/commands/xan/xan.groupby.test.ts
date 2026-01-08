/**
 * Tests for xan groupby command - based on xan's test_groupby.rs
 * Uses real xan CLI syntax with moonblade expressions
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xan groupby", () => {
  const DATA =
    "id,value_A,value_B,value_C\nx,1,2,3\ny,2,3,4\nz,3,4,5\ny,1,2,3\nz,2,3,5\nz,3,6,7\n";

  it("groups and sums", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec(
      "xan groupby id 'sum(value_A) as sumA' /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,sumA\nx,1\ny,3\nz,8\n");
  });

  it("groups and counts", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan groupby id 'count()' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,count()\nx,1\ny,2\nz,3\n");
  });

  it("groups with complex expression", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec(
      "xan groupby id 'sum(add(value_A,add(value_B,value_C))) as sum' /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,sum\nx,6\ny,15\nz,38\n");
  });

  it("computes mean per group", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec(
      "xan groupby id 'mean(value_A) as meanA' /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,meanA\nx,1\ny,1.5\nz,2.6666666666666665\n");
  });

  it("computes max per group", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec(
      "xan groupby id 'max(value_A) as maxA, max(value_B) as maxB,max(value_C) as maxC' /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "id,maxA,maxB,maxC\nx,1,2,3\ny,2,3,4\nz,3,6,7\n",
    );
  });

  it("groups by multiple columns", async () => {
    const bash = new Bash({
      files: {
        "/data.csv":
          "name,color,count\njohn,blue,1\nmary,orange,3\nmary,orange,2\njohn,yellow,9\njohn,blue,2\n",
      },
    });
    const result = await bash.exec(
      "xan groupby name,color 'sum(count) as sum' /data.csv",
    );
    expect(result.exitCode).toBe(0);
    // Output preserves first-seen order: john,blue -> mary,orange -> john,yellow
    expect(result.stdout).toBe(
      "name,color,sum\njohn,blue,3\nmary,orange,5\njohn,yellow,9\n",
    );
  });
});

describe("xan groupby --sorted", () => {
  it("handles pre-sorted data", async () => {
    const bash = new Bash({
      files: {
        "/data.csv":
          "id,value_A,value_B,value_C\nx,1,2,3\ny,2,3,4\ny,1,2,3\nz,2,3,5\nz,3,6,7\nz,3,4,5\n",
      },
    });
    const result = await bash.exec(
      "xan groupby id 'sum(value_A) as sumA' --sorted /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,sumA\nx,1\ny,3\nz,8\n");
  });

  it("handles empty data", async () => {
    const bash = new Bash({
      files: { "/data.csv": "id,value_A,value_B,value_C\n" },
    });
    const result = await bash.exec(
      "xan groupby id 'sum(value_A) as sumA' --sorted /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,sumA\n");
  });
});
