import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xan CSV cell identity", () => {
  const files = {
    "/codes.csv": "id,amount,flag\n00123,02.50,TRUE\n123,10,false\n",
    "/lookup.csv": "id,label\n00123,match\n",
  };
  it.each([
    ["xan select id,amount,flag /codes.csv", files["/codes.csv"]],
    [
      "xan join id /codes.csv id /lookup.csv",
      "id,amount,flag,label\n00123,02.50,TRUE,match\n",
    ],
    [
      "xan filter 'amount < 5' /codes.csv",
      "id,amount,flag\n00123,02.50,TRUE\n",
    ],
    [
      `xan filter 'id eq "00123"' /codes.csv`,
      "id,amount,flag\n00123,02.50,TRUE\n",
    ],
    [
      "xan map 'amount + 1 as total' /codes.csv",
      "id,amount,flag,total\n00123,02.50,TRUE,3.5\n123,10,false,11\n",
    ],
    ["xan agg 'sum(amount) as total' /codes.csv", "total\n12.5\n"],
    ["xan dedup -s id /codes.csv", files["/codes.csv"]],
  ])("preserves source cells with %s", async (command, stdout) => {
    const result = await new Bash({ files }).exec(command);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
  it("preserves explicitly selected JSON string columns", async () => {
    const result = await new Bash({ files }).exec(
      "xan to json --strings id,flag /codes.csv",
    );
    expect(result.stdout).toBe(
      `${JSON.stringify(
        [
          { id: "00123", amount: 2.5, flag: "TRUE" },
          { id: "123", amount: 10, flag: "false" },
        ],
        null,
        2,
      )}\n`,
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("excludes empty cells from aggregations while retaining zero", async () => {
    const bash = new Bash({
      files: { "/sparse.csv": "id,n\na,1\nb,\nc,3\nd,0\n" },
    });
    const result = await bash.exec(
      "xan agg 'count() as rows, count(n) as present, sum(n) as total, mean(n) as average, min(n) as low, max(n) as high, median(n) as middle' /sparse.csv",
    );
    expect(result.stdout).toBe(
      "rows,present,total,average,low,high,middle\n4,3,4,1.3333333333333333,0,3,1\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ["substr(text, start, size)", "bc"],
    ["substr(text, start)", "bcdef"],
  ])("uses numeric column arguments for %s", async (expression, part) => {
    const bash = new Bash({
      files: { "/text.csv": "text,start,size\nabcdef,1,2\n" },
    });
    const result = await bash.exec(`xan map '${expression} as part' /text.csv`);
    expect(result.stdout).toBe(`text,start,size,part\nabcdef,1,2,${part}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
