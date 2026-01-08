/**
 * Tests for xan agg command - based on xan's test_agg.rs
 * Uses real xan CLI syntax with moonblade expressions
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xan agg", () => {
  it("count() counts all rows", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n" },
    });
    const result = await bash.exec("xan agg 'count() as count' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("count\n4\n");
  });

  it("count(expr) counts matching rows", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n" },
    });
    const result = await bash.exec("xan agg 'count(n > 2) as count' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("count\n2\n");
  });

  it("sum(col) sums values", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n" },
    });
    const result = await bash.exec("xan agg 'sum(n) as sum' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("sum\n10\n");
  });

  it("mean(col) computes average", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n" },
    });
    const result = await bash.exec("xan agg 'mean(n) as mean' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("mean\n2.5\n");
  });

  it("avg is alias for mean", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n" },
    });
    const result = await bash.exec("xan agg 'avg(n) as mean' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("mean\n2.5\n");
  });

  it("min(col) gets minimum", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n" },
    });
    const result = await bash.exec("xan agg 'min(n) as min' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("min\n1\n");
  });

  it("max(col) gets maximum", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n" },
    });
    const result = await bash.exec("xan agg 'max(n) as max' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("max\n4\n");
  });

  it("first(col) gets first value", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n" },
    });
    const result = await bash.exec("xan agg 'first(n) as first' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("first\n1\n");
  });

  it("last(col) gets last value", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n" },
    });
    const result = await bash.exec("xan agg 'last(n) as last' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("last\n4\n");
  });

  it("median(col) computes median", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n" },
    });
    const result = await bash.exec("xan agg 'median(n) as median' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("median\n2.5\n");
  });

  it("multiple aggregations", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n" },
    });
    const result = await bash.exec(
      "xan agg 'count() as count, sum(n) as sum' /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("count,sum\n4,10\n");
  });

  it("all(expr) checks if all rows match", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n" },
    });
    let result = await bash.exec("xan agg 'all(n >= 1) as all' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("all\ntrue\n");

    result = await bash.exec("xan agg 'all(n >= 2) as all' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("all\nfalse\n");
  });

  it("any(expr) checks if any row matches", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n1\n2\n3\n4\n" },
    });
    let result = await bash.exec("xan agg 'any(n >= 1) as any' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("any\ntrue\n");

    result = await bash.exec("xan agg 'any(n >= 5) as any' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("any\nfalse\n");
  });

  it("mode finds most common value", async () => {
    const bash = new Bash({
      files: { "/data.csv": "color\nred\nblue\nyellow\nred\n" },
    });
    const result = await bash.exec("xan agg 'mode(color) as mode' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("mode\nred\n");
  });

  it("cardinality counts unique values", async () => {
    const bash = new Bash({
      files: { "/data.csv": "color\nred\nblue\nyellow\nred\n" },
    });
    const result = await bash.exec(
      "xan agg 'cardinality(color) as cardinality' /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("cardinality\n3\n");
  });

  it("values concatenates all values", async () => {
    const bash = new Bash({
      files: { "/data.csv": "name\nJohn\nMary\nLucas\n" },
    });
    const result = await bash.exec("xan agg 'values(name) as V' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("V\nJohn|Mary|Lucas\n");
  });

  it("distinct_values gets unique values", async () => {
    const bash = new Bash({
      files: { "/data.csv": "name\nJohn\nMary\nLucas\nMary\nLucas\n" },
    });
    const result = await bash.exec(
      "xan agg 'distinct_values(name) as V' /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("V\nJohn|Lucas|Mary\n");
  });
});

describe("xan agg with expressions", () => {
  it("aggregates computed expressions", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b\n1,2\n2,0\n3,6\n4,2\n" },
    });
    const result = await bash.exec(
      "xan agg 'sum(add(a, b + 1)) as sum' /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("sum\n24\n");
  });
});
