import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";

describe("AWK prospective allocation limits", () => {
  it.each([
    ["width", `awk 'BEGIN { s=sprintf("%*s", 65, "x") }'`],
    ["precision", `awk 'BEGIN { s=sprintf("%.*f", 65, 1) }'`],
  ])("rejects dynamic printf %s before padding", async (_kind, script) => {
    const bash = new Bash({ executionLimits: { maxStringLength: 64 } });
    const result = await bash.exec(script);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `awk: printf ${_kind} limit exceeded (64 bytes)\n`,
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("bounds cumulative sprintf output, not only each directive", async () => {
    const bash = new Bash({ executionLimits: { maxStringLength: 64 } });
    const result = await bash.exec(
      `awk 'BEGIN { s=sprintf("%40s%40s", "x", "y") }'`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "awk: formatted string size limit exceeded (64 bytes)\n",
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("rejects unsupported floating-point precision before the native formatter", async () => {
    const bash = new Bash({ executionLimits: { maxStringLength: 1_000 } });
    const result = await bash.exec(`awk 'BEGIN { s=sprintf("%.101f", 1) }'`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "awk: printf floating-point precision limit exceeded (100 digits)\n",
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("bounds global substitution while producing replacements", async () => {
    const target = "a".repeat(64);
    const bash = new Bash({ executionLimits: { maxStringLength: 128 } });
    const result = await bash.exec(
      `awk 'BEGIN { s="${target}"; gsub(/a/, "xxx", s) }'`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: string size limit exceeded (128 bytes)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("stops split before exceeding maxArrayElements", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 3 } });
    const result = await bash.exec(
      `awk 'BEGIN { split("a,b,c,d", values, ",") }'`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: array element limit exceeded (3)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("charges input records against the AWK work limit", async () => {
    const bash = new Bash({ executionLimits: { maxAwkIterations: 2 } });
    const result = await bash.exec("awk '{ print }'", {
      stdin: "one\ntwo\nthree\n",
    });
    expect(result.stdout).toBe("one\ntwo\n");
    expect(result.stderr).toBe("awk: record limit exceeded (2)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("rejects record arrays before splitting beyond maxArrayElements", async () => {
    const bash = new Bash({
      files: { "/records": "one\ntwo\nthree\n" },
      executionLimits: { maxArrayElements: 2 },
    });
    const result = await bash.exec("awk '{ print }' /records");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: record array limit exceeded (2)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("does not retain all input files before processing", async () => {
    const bash = new Bash({
      files: {
        "/first": "aaaaaaaaaaaaaaaaaaaa",
        "/second": "bbbbbbbbbbbbbbbbbbbb",
      },
      executionLimits: { maxStringLength: 32 },
    });
    const result = await bash.exec("awk '{ print }' /first /second");
    expect(result.stdout).toBe("aaaaaaaaaaaaaaaaaaaa\n");
    expect(result.stderr).toBe(
      "awk: aggregate input size limit exceeded (32 bytes)\n",
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it.each([
    ["NF assignment", `awk 'BEGIN { NF = 100000000 }'`],
    ["field assignment", `awk 'BEGIN { $100000000 = "x" }'`],
    ["field increment", `awk 'BEGIN { $100000000++ }'`],
    ["sub field target", `awk 'BEGIN { sub(/^/, "x", $100000000) }'`],
    ["gsub field target", `awk 'BEGIN { gsub(/^/, "x", $100000000) }'`],
    ["infinite NF", `awk 'BEGIN { NF = 1e400 }'`],
    ["negative infinite NF", `awk 'BEGIN { NF = -1e400 }'`],
  ])("rejects %s beyond maxArrayElements before growing fields", async (_kind, script) => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 10 } });
    const result = await bash.exec(script);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: field count limit exceeded (10)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("allows growing fields up to maxArrayElements", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 10 } });
    const result = await bash.exec(
      `awk 'BEGIN { OFS = "-"; NF = 3; $5 = "x"; print NF, $0 }'`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("5-----x\n");
    expect(result.exitCode).toBe(0);
  });

  it("bounds the rebuilt record size", async () => {
    const bash = new Bash({ executionLimits: { maxStringLength: 64 } });
    const result = await bash.exec(
      `awk 'BEGIN { OFS = "xxxxxxxxxx"; NF = 10 }'`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: record size limit exceeded (64 bytes)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("rejects NaN NF instead of desynchronizing fields", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 10 } });
    const result = await bash.exec(`awk 'BEGIN { NF = sqrt(-1) }'`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: field count limit exceeded (10)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("allows assigning existing fields of a record at the limit", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 5 } });
    const result = await bash.exec(`awk '{ $4 = "x"; print }'`, {
      stdin: "a b c d e\n",
    });
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("a b c x e\n");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ["an input record", `awk '{ print }'`, "a b c d e\n"],
    ["an input record with FS", `awk -F, '{ print }'`, "a,b,c,d,e\n"],
    ["$0 assignment", `awk 'BEGIN { FS = ""; $0 = "abcde" }'`, undefined],
    ["sub on $0", `awk '{ sub(/x/, "a b c d e") }'`, "x\n"],
  ])("rejects splitting %s beyond maxArrayElements", async (_kind, script, stdin) => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 3 } });
    const result = await bash.exec(script, stdin ? { stdin } : {});
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: field count limit exceeded (3)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("measures the rebuilt record in UTF-8 bytes", async () => {
    const bash = new Bash({ executionLimits: { maxStringLength: 64 } });
    const result = await bash.exec(`awk 'BEGIN { OFS = "€"; NF = 30 }'`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: record size limit exceeded (64 bytes)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("rejects an infinite NF even when arrays are unlimited", async () => {
    const bash = new Bash({
      executionLimits: { maxArrayElements: Number.POSITIVE_INFINITY },
    });
    const result = await bash.exec(`awk 'BEGIN { NF = 1e400 }'`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: field count limit exceeded (Infinity)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("does not wrap huge sub/gsub field targets onto $1", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 10 } });
    const result = await bash.exec(
      `echo a b | awk '{ sub(/a/, "x", $(1e21)) }'`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: field count limit exceeded (10)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("rejects padding that could never fit the record size limit", async () => {
    const bash = new Bash({
      executionLimits: {
        maxArrayElements: Number.POSITIVE_INFINITY,
        maxStringLength: 64,
      },
    });
    const result = await bash.exec(`awk 'BEGIN { NF = 100000000 }'`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: record size limit exceeded (64 bytes)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("rejects a negative NF", async () => {
    const bash = new Bash();
    const result = await bash.exec(`echo a b | awk '{ NF = -1 }'`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: NF set to negative value\n");
    expect(result.exitCode).toBe(2);
  });
});
