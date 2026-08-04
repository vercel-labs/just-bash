import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xan derived-result amplification limits", () => {
  it("bounds ragged fixlengths rows and cells during parsing", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b\n1,2\n3,4\n5,6\n" },
      executionLimits: { maxCsvRows: 2, maxCsvCells: 100 },
    });

    const result = await bash.exec("xan fixlengths /data.csv");

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("xan: CSV row limit exceeded (2)");
  });

  it("rejects unsafe fixlengths allocation lengths before constructing rows", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a\n1\n" },
      executionLimits: { maxArrayElements: 4 },
    });

    const result = await bash.exec("xan fixlengths -l 5 /data.csv");

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain(
      "xan fixlengths: column limit exceeded (4)",
    );
  });

  it("preserves CSV quoting when behead omits the header", async () => {
    const bash = new Bash({
      files: { "/data.csv": 'a,b\n"x,y","a""b"\n' },
    });

    const result = await bash.exec("xan behead /data.csv");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toBe('"x,y","a""b"\n');
  });

  it("shares cat row limits across otherwise-valid input files", async () => {
    const bash = new Bash({
      files: {
        "/a.csv": "v\n1\n2\n3\n",
        "/b.csv": "v\n4\n5\n6\n",
      },
      executionLimits: { maxCsvRows: 5 },
    });

    const result = await bash.exec("xan cat /a.csv /b.csv");

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("xan cat: derived CSV result limit");
  });

  it("bounds JSON conversion output while escaping cells", async () => {
    const bash = new Bash({
      files: { "/data.csv": `v\n"${"\\n".repeat(20)}"\n` },
      executionLimits: { maxOutputSize: 40 },
    });

    const result = await bash.exec("xan to json /data.csv");

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("output size limit exceeded");
  });

  it("bounds aggregate JSON nodes before from-json row construction", async () => {
    const bash = new Bash({
      files: { "/data.json": '[{"a":1},{"a":2},{"a":3}]' },
      executionLimits: { maxQueryElements: 4 },
    });

    const result = await bash.exec("xan from -f json /data.json");

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("query input element limit exceeded (4)");
  });

  it("bounds flatmap across input rows rather than per expression", async () => {
    const bash = new Bash({
      files: { "/data.csv": "value\na b c d e f\ng h i j k l\n" },
      executionLimits: { maxArrayElements: 10, maxCsvRows: 10 },
    });

    const result = await bash.exec(
      "xan flatmap \"split(value, ' ') as part\" /data.csv",
    );

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("xan flatmap: derived CSV result limit");
  });

  it("preflights map output cells before constructing result rows", async () => {
    const bash = new Bash({
      files: { "/data.csv": "value\n1\n2\n3\n4\n" },
      executionLimits: { maxCsvCells: 7 },
    });

    const result = await bash.exec("xan map 'value as copy' /data.csv");

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("xan map: derived CSV result limit");
  });

  it("bounds explode products including an empty separator", async () => {
    const bash = new Bash({
      files: { "/data.csv": "value\nabcdef\n" },
      executionLimits: { maxCsvRows: 5 },
    });

    const result = await bash.exec("xan explode value -s '' /data.csv");

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("xan explode: derived CSV result limit");
  });

  it("preserves leading, trailing, and adjacent multi-character separators", async () => {
    const bash = new Bash({
      files: { "/data.csv": "value\n::a::::b::\n" },
    });

    const result = await bash.exec("xan explode value -s '::' /data.csv");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toBe("value\n\na\n\nb\n\n");
  });

  it("preflights duplicate-key join cardinality", async () => {
    const bash = new Bash({
      files: {
        "/left.csv": "id\n1\n1\n1\n",
        "/right.csv": "id\n1\n1\n1\n",
      },
      executionLimits: { maxArrayElements: 5, maxCsvRows: 5 },
    });

    const result = await bash.exec("xan join id /left.csv id /right.csv");

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("xan join: derived CSV result limit");
  });

  it("preflights sparse pivot row-by-column cardinality", async () => {
    const bash = new Bash({
      files: {
        "/data.csv": "group,pivot,value\na,w,1\nb,x,2\nc,y,3\nd,z,4\n",
      },
      executionLimits: { maxCsvCells: 15 },
    });

    const result = await bash.exec(
      "xan pivot pivot 'sum(value)' -g group /data.csv",
    );

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("xan pivot: derived CSV result limit");
  });

  it("bounds implode separator amplification before join allocation", async () => {
    const bash = new Bash({
      files: { "/data.csv": "id,value\n1,a\n1,b\n1,c\n" },
      executionLimits: { maxStringLength: 100 },
    });

    const result = await bash.exec(
      "sep=$(printf '%080d' 0); xan implode value -s \"$sep\" /data.csv",
    );

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("xan implode: output size limit");
  });

  it("bounds CSV formatting while it is produced", async () => {
    const value = "x".repeat(80);
    const bash = new Bash({
      files: { "/data.csv": `value\n${value}\n` },
      executionLimits: { maxOutputSize: 120 },
    });

    const result = await bash.exec("xan map 'value as copy' /data.csv");

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("xan: output size limit exceeded");
  });

  it("accepts large unquoted cells based on exact output size", async () => {
    const value = "x".repeat(60);
    const bash = new Bash({
      files: { "/data.csv": `value\n${value}\n` },
      executionLimits: { maxOutputSize: 100 },
    });

    const result = await bash.exec("xan transform value _ /data.csv");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toBe(`value\n${value}\n`);
  });

  it("bounds multi-column frequency --all derived rows", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b\na1,b1\na2,b2\na3,b3\n" },
      executionLimits: { maxCsvRows: 5 },
    });

    const result = await bash.exec("xan frequency -A /data.csv");

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("xan frequency: derived CSV result limit");
  });

  it("preserves complete multi-column frequency --all output", async () => {
    const bash = new Bash({
      files: { "/data.csv": "a,b\nx,1\ny,1\nx,2\n,z\n" },
    });

    const result = await bash.exec("xan frequency -A --no-extra /data.csv");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toBe(
      "field,value,count\na,x,2\na,y,1\nb,1,2\nb,2,1\nb,z,1\n",
    );
  });

  it("preserves grouped frequency --all across many selected columns", async () => {
    const bash = new Bash({
      files: { "/data.csv": "g,a,b\nu,x,p\nu,y,q\nv,x,p\n" },
    });

    const result = await bash.exec("xan frequency -A -g g -s a,b /data.csv");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toBe(
      "field,g,value,count\na,u,x,1\na,u,y,1\na,v,x,1\nb,u,p,1\nb,u,q,1\nb,v,p,1\n",
    );
  });

  it("charges groupby aggregation specs against shared work", async () => {
    const bash = new Bash({
      files: { "/data.csv": "g,v\na,1\nb,2\nc,3\n" },
      executionLimits: { maxWorkUnits: 25 },
    });

    const result = await bash.exec(
      "xan groupby g 'sum(v) as s, max(v) as m, min(v) as n' /data.csv",
    );

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("xan groupby");
  });

  it("preserves many aggregations under the liberal default budget", async () => {
    const bash = new Bash({
      files: { "/data.csv": "g,v\na,1\na,3\nb,2\n" },
    });

    const result = await bash.exec(
      "xan groupby g 'count() as n, sum(v) as s, mean(v) as avg, min(v) as lo, max(v) as hi, first(v) as fst, last(v) as lst, median(v) as med, mode(v) as mode, cardinality(v) as card, values(v) as vals, distinct_values(v) as uniq' /data.csv",
    );

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toBe(
      "g,n,s,avg,lo,hi,fst,lst,med,mode,card,vals,uniq\na,2,4,2,1,3,1,3,2,1,2,1|3,1|3\nb,1,2,2,2,2,2,2,2,2,1,2,2\n",
    );
  });
});
