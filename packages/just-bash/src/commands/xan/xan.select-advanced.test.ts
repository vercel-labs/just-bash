/**
 * Tests for xan select advanced features
 * Based on xan's test_select.rs
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xan select glob patterns", () => {
  const DATA = "name,vec_1,vec_2,count_1,count_2\njohn,1,2,3,4\nmary,5,6,7,8\n";

  it("selects columns by prefix glob", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan select 'vec_*' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("vec_1,vec_2\n1,2\n5,6\n");
  });

  it("selects columns by suffix glob", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan select '*_1' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("vec_1,count_1\n1,3\n5,7\n");
  });

  it("combines glob with regular column", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan select 'name,vec_*' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("name,vec_1,vec_2\njohn,1,2\nmary,5,6\n");
  });

  it("selects all with *", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b,c\n1,2,3\n" },
    });
    const result = await bash.exec("xan select '*' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b,c\n1,2,3\n");
  });

  it("combines * with additional column", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b\n1,2\n" },
    });
    const result = await bash.exec("xan select '*,a' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b,a\n1,2,1\n");
  });
});

describe("xan select column ranges", () => {
  const DATA = "a,b,c,d,e\n1,2,3,4,5\n";

  it("selects column range a:c", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan select 'a:c' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b,c\n1,2,3\n");
  });

  it("selects reverse range c:a", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan select 'c:a' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("c,b,a\n3,2,1\n");
  });

  it("selects range to end d:", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan select 'd:' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("d,e\n4,5\n");
  });

  it("selects range from start :b", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan select ':b' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b\n1,2\n");
  });

  it("combines ranges", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan select 'a:b,d:e' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b,d,e\n1,2,4,5\n");
  });
});

describe("xan select negation", () => {
  const DATA = "a,b,c,d\n1,2,3,4\n";

  it("excludes single column", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan select '*,!b' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,c,d\n1,3,4\n");
  });

  it("excludes multiple columns", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan select '*,!b,!d' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,c\n1,3\n");
  });

  it("excludes range", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan select '*,!b:c' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,d\n1,4\n");
  });
});

describe("xan select numeric indices and ranges", () => {
  const DATA = "a,b,c,d\n1,2,3,4\n";

  it("selects by numeric index", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan select '0,2' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,c\n1,3\n");
  });

  it("selects by numeric range", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan select '1-3' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("b,c,d\n2,3,4\n");
  });

  it("handles duplicate selections", async () => {
    const bash = new Bash({ files: { "/data.csv": DATA } });
    const result = await bash.exec("xan select 'a,a' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,a\n1,1\n");
  });
});
