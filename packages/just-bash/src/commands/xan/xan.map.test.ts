/**
 * Tests for xan map command - based on xan's test_map.rs
 * Uses real xan CLI syntax with moonblade expressions
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xan map", () => {
  it("adds computed column", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b\n1,2\n2,3\n" },
    });
    const result = await bash.exec("xan map 'add(a, b) as c' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b,c\n1,2,3\n2,3,5\n");
  });

  it("adds multiple computed columns", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b\n1,2\n2,3\n" },
    });
    const result = await bash.exec(
      "xan map 'add(a, b) as c, mul(a, b) as d' /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b,c,d\n1,2,3,2\n2,3,5,6\n");
  });

  it("uses index() function", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n10\n15\n" },
    });
    const result = await bash.exec("xan map 'index() as r' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("n,r\n10,0\n15,1\n");
  });

  it("overwrites columns with -O", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b\n1,4\n5,2\n" },
    });
    const result = await bash.exec(
      "xan map -O 'b * 10 as b, a * b as c' /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a,b,c\n1,40,4\n5,20,10\n");
  });

  it("filters rows with --filter", async () => {
    const bash = new Bash({
      files: { "/data.csv": "full_name\njohn landis\nbéatrice babka\n" },
    });
    const result = await bash.exec(
      "xan map \"if(startswith(full_name, 'j'), split(full_name, ' ')[0]) as first_name\" --filter /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("full_name,first_name\njohn landis,john\n");
  });
});

describe("xan map string functions", () => {
  it("uses split function", async () => {
    const bash = new Bash({
      files: { "/data.csv": "full_name\njohn landis\nmary smith\n" },
    });
    const result = await bash.exec(
      "xan map \"split(full_name, ' ')[0] as first\" /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "full_name,first\njohn landis,john\nmary smith,mary\n",
    );
  });

  it("uses upper and lower", async () => {
    const bash = new Bash({
      files: { "/data.csv": "name\nJohn\nmary\n" },
    });
    const result = await bash.exec(
      "xan map 'upper(name) as upper, lower(name) as lower' /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,upper,lower\nJohn,JOHN,john\nmary,MARY,mary\n",
    );
  });

  it("uses trim function", async () => {
    const bash = new Bash({
      // Use quoted input so PapaParse preserves the spaces
      files: { "/data.csv": 'text\n"  hello  "\n"  world  "\n' },
    });
    const result = await bash.exec("xan map 'trim(text) as trimmed' /data.csv");
    expect(result.exitCode).toBe(0);
    // CSV quotes fields with spaces
    expect(result.stdout).toBe(
      'text,trimmed\n"  hello  ",hello\n"  world  ",world\n',
    );
  });

  it("uses len function", async () => {
    const bash = new Bash({
      files: { "/data.csv": "word\ncat\ndog\nelephant\n" },
    });
    const result = await bash.exec("xan map 'len(word) as length' /data.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("word,length\ncat,3\ndog,3\nelephant,8\n");
  });
});

describe("xan map arithmetic", () => {
  it("computes arithmetic expressions", async () => {
    const bash = new Bash({
      files: { "/data.csv": "x,y\n10,3\n20,4\n" },
    });
    const result = await bash.exec(
      "xan map 'x + y as sum, x - y as diff, x * y as prod, x / y as quot' /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "x,y,sum,diff,prod,quot\n10,3,13,7,30,3.3333333333333335\n20,4,24,16,80,5\n",
    );
  });

  it("uses abs and round", async () => {
    const bash = new Bash({
      files: { "/data.csv": "n\n-5.7\n3.2\n" },
    });
    const result = await bash.exec(
      "xan map 'abs(n) as absolute, round(n) as rounded' /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("n,absolute,rounded\n-5.7,5.7,-6\n3.2,3.2,3\n");
  });
});

describe("xan map conditionals", () => {
  it("uses if expression", async () => {
    const bash = new Bash({
      files: { "/data.csv": "score\n85\n55\n70\n" },
    });
    const result = await bash.exec(
      "xan map \"if(score >= 60, 'pass', 'fail') as result\" /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("score,result\n85,pass\n55,fail\n70,pass\n");
  });

  it("uses coalesce for defaults", async () => {
    const bash = new Bash({
      // Multi-column CSV ensures empty value is preserved (not treated as blank line)
      files: { "/data.csv": "name,id\njohn,1\n,2\nmary,3\n" },
    });
    const result = await bash.exec(
      "xan map \"coalesce(name, 'unknown') as name_safe\" /data.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "name,id,name_safe\njohn,1,john\n,2,unknown\nmary,3,mary\n",
    );
  });
});
