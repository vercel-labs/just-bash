/**
 * Tests for xan reshape commands: explode, implode, pivot
 * These operations change the structure of the data (rows/columns)
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xan explode", () => {
  it("splits delimited values into rows", async () => {
    const bash = new Bash({
      files: { "/data.csv": "id,tags\n1,a|b|c\n2,x|y\n" },
    });
    const result = await bash.exec("xan explode tags /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,tags\n1,a\n1,b\n1,c\n2,x\n2,y\n");
  });

  it("uses custom separator with -s", async () => {
    const bash = new Bash({
      files: { "/data.csv": "id,items\n1,a;b;c\n" },
    });
    const result = await bash.exec("xan explode items -s ';' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,items\n1,a\n1,b\n1,c\n");
  });

  it("renames column with -r", async () => {
    const bash = new Bash({
      files: { "/data.csv": "id,tags\n1,a|b\n" },
    });
    const result = await bash.exec("xan explode tags -r tag /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,tag\n1,a\n1,b\n");
  });

  it("handles empty values", async () => {
    const bash = new Bash({
      files: { "/data.csv": "id,tags\n1,a|b\n2,\n3,c\n" },
    });
    const result = await bash.exec("xan explode tags /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,tags\n1,a\n1,b\n2,\n3,c\n");
  });

  it("drops empty rows with --drop-empty", async () => {
    const bash = new Bash({
      files: { "/data.csv": "id,tags\n1,a|b\n2,\n3,c\n" },
    });
    const result = await bash.exec("xan explode tags --drop-empty /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,tags\n1,a\n1,b\n3,c\n");
  });

  it("errors on missing column", async () => {
    const bash = new Bash({
      files: { "/data.csv": "id,tags\n1,a\n" },
    });
    const result = await bash.exec("xan explode nonexistent /data.csv");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not found");
  });
});

describe("xan implode", () => {
  it("combines consecutive rows with same key", async () => {
    const bash = new Bash({
      files: { "/data.csv": "id,tag\n1,a\n1,b\n1,c\n2,x\n2,y\n" },
    });
    const result = await bash.exec("xan implode tag /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,tag\n1,a|b|c\n2,x|y\n");
  });

  it("uses custom separator with -s", async () => {
    const bash = new Bash({
      files: { "/data.csv": "id,val\n1,a\n1,b\n" },
    });
    const result = await bash.exec("xan implode val -s ';' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,val\n1,a;b\n");
  });

  it("renames column with -r", async () => {
    const bash = new Bash({
      files: { "/data.csv": "id,tag\n1,a\n1,b\n" },
    });
    const result = await bash.exec("xan implode tag -r tags /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,tags\n1,a|b\n");
  });

  it("only groups consecutive rows with same key", async () => {
    const bash = new Bash({
      files: { "/data.csv": "id,tag\n1,a\n2,x\n1,b\n" },
    });
    const result = await bash.exec("xan implode tag /data.csv");
    expect(result.exitCode).toBe(0);
    // Non-consecutive rows with same key are NOT merged
    expect(result.stdout).toBe("id,tag\n1,a\n2,x\n1,b\n");
  });
});

describe("xan pivot", () => {
  it("pivots data with count aggregation", async () => {
    const bash = new Bash({
      files: {
        "/data.csv":
          "region,product,amount\nnorth,A,10\nnorth,B,20\nsouth,A,15\nsouth,B,25\n",
      },
    });
    const result = await bash.exec(
      "xan pivot product 'count(amount)' -g region /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("region,A,B\nnorth,1,1\nsouth,1,1\n");
  });

  it("pivots data with sum aggregation", async () => {
    const bash = new Bash({
      files: {
        "/data.csv":
          "region,product,amount\nnorth,A,10\nnorth,B,20\nsouth,A,15\nsouth,A,5\n",
      },
    });
    const result = await bash.exec(
      "xan pivot product 'sum(amount)' -g region /data.csv",
    );
    expect(result.exitCode).toBe(0);
    // south has no B product, so sum is 0
    expect(result.stdout).toBe("region,A,B\nnorth,10,20\nsouth,20,0\n");
  });

  it("uses mean aggregation", async () => {
    const bash = new Bash({
      files: {
        "/data.csv": "cat,type,val\nX,a,10\nX,a,20\nX,b,30\n",
      },
    });
    const result = await bash.exec(
      "xan pivot type 'mean(val)' -g cat /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("cat,a,b\nX,15,30\n");
  });

  it("auto-determines group columns when not specified", async () => {
    const bash = new Bash({
      files: {
        "/data.csv":
          "year,quarter,sales\n2023,Q1,100\n2023,Q2,150\n2024,Q1,120\n",
      },
    });
    const result = await bash.exec("xan pivot quarter 'sum(sales)' /data.csv");
    expect(result.exitCode).toBe(0);
    // 2024 has no Q2 data, so sum is 0
    expect(result.stdout).toBe("year,Q1,Q2\n2023,100,150\n2024,120,0\n");
  });

  it("errors on invalid aggregation expression", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b,c\n1,2,3\n" },
    });
    const result = await bash.exec("xan pivot b 'invalid syntax' /data.csv");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid aggregation");
  });
});

describe("xan flatmap", () => {
  it("expands array results into multiple rows", async () => {
    const bash = new Bash({
      files: { "/data.csv": "text\nhello world\nfoo bar baz\n" },
    });
    const result = await bash.exec(
      "xan flatmap \"split(text, ' ') as word\" /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "text,word\nhello world,hello\nhello world,world\nfoo bar baz,foo\nfoo bar baz,bar\nfoo bar baz,baz\n",
    );
  });

  it("handles non-array results", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n" },
    });
    const result = await bash.exec("xan flatmap 'n * 2 as doubled' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("n,doubled\n1,2\n2,4\n");
  });
});
