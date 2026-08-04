import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";

describe("xan stats resource safety", () => {
  it("reduces columns larger than the engine argument limit without spreading", async () => {
    const rowCount = 150_000;
    const fs = new InMemoryFs({
      "/data.csv": `value\n${"1\n".repeat(rowCount)}`,
    });
    const bash = new Bash({ fs });

    const result = await bash.exec("xan stats /data.csv");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toBe(
      `field,type,count,min,max,mean\nvalue,Number,${rowCount},1,1,1\n`,
    );
  });

  it("charges synchronous row work before processing the next value", async () => {
    const fs = new InMemoryFs({
      "/data.csv": `value\n${"1\n".repeat(20)}`,
    });
    const bash = new Bash({
      fs,
      executionLimits: { maxWorkUnits: 10 },
    });

    const result = await bash.exec("xan stats /data.csv");

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("xan stats rows: work work limit exceeded");
  });

  it("preserves mixed and empty-column semantics", async () => {
    const fs = new InMemoryFs({
      "/mixed.csv": "value,empty\n1,\nword,\n2,\n",
    });
    const bash = new Bash({ fs });

    const result = await bash.exec("xan stats /mixed.csv");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "field,type,count,min,max,mean\nvalue,String,3,,,\nempty,String,0,,,\n",
    );
  });
});
