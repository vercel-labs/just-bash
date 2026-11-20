import { afterEach, describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionScope } from "../../execution-scope.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { ExecutionAbortedError } from "../../interpreter/errors.js";

function abortOnCheckpoint(site: string, checkpoint: number): () => number {
  const original = ExecutionScope.prototype.throwIfAborted;
  let checks = 0;
  vi.spyOn(ExecutionScope.prototype, "throwIfAborted").mockImplementation(
    function (this: ExecutionScope, currentSite?: string) {
      if (currentSite === site && ++checks === checkpoint) {
        throw new ExecutionAbortedError("", `bash: ${site} aborted\n`);
      }
      original.call(this, currentSite);
    },
  );
  return () => checks;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deadline and output limit regressions", () => {
  it("discards AWK loop output instead of duplicating it", async () => {
    const bash = new Bash({
      executionLimits: { maxAwkIterations: 2, maxOutputSize: 5 },
    });
    const result = await bash.exec(
      `awk 'BEGIN { while(1) print "x" }'; printf after`,
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "awk: awk: while loop exceeded maximum iterations (2)\n",
    );
    expect(result.exitCode).toBe(126);
  });

  it.each([
    ["yq", "yq -i '.value = 2' /input", "yq", 1],
    ["sed", "sed -i 's/1/2/' /input", "sed", 2],
  ])("does not write %s output after the final checkpoint aborts", async (_name, command, site, checkpoint) => {
    const checks = abortOnCheckpoint(site, checkpoint);
    const content = "value: 1\n";
    const fs = new InMemoryFs({ "/input": content });
    const bash = new Bash({ fs });

    const result = await bash.exec(`${command}; printf after`);

    expect(await fs.readFile("/input")).toBe(content);
    expect(checks()).toBe(checkpoint);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`bash: ${site} aborted\n`);
    expect(result.exitCode).toBe(124);
  });

  it("checks the deadline after a bulk query work charge", async () => {
    const checks = abortOnCheckpoint("query evaluation", 2);
    const bash = new Bash();

    const result = await bash.exec(
      `jq -n 'range(40) + range(40)'; printf after`,
    );

    expect(checks()).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: query evaluation aborted\n");
    expect(result.exitCode).toBe(124);
  });

  it.each([
    "range(3000)",
    "range(0; 3000)",
    "range(0; 3000; 2)",
    "range(3000; 0; -1)",
  ])("checks the deadline while producing %s", async (query) => {
    const checks = abortOnCheckpoint("query evaluation", 2);
    const bash = new Bash();

    const result = await bash.exec(`jq -n '${query}'; printf after`);

    expect(checks()).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: query evaluation aborted\n");
    expect(result.exitCode).toBe(124);
  });

  it("charges range values against the query iteration limit", async () => {
    const bash = new Bash({ executionLimits: { maxJqIterations: 100 } });

    const result = await bash.exec(`jq -n 'range(1000)'; printf after`);

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "jq: query evaluation: too many iterations (100)\n",
    );
    expect(result.exitCode).toBe(126);
  });

  it.each([
    "range(range(20;40);range(20))",
    "range(range(20;40);range(20);range(1;21))",
    "range(range(20;40);range(20);empty)",
  ])("charges empty combinations in %s", async (query) => {
    const bash = new Bash({ executionLimits: { maxJqIterations: 100 } });
    const result = await bash.exec(`jq -n '${query}'; printf after`);

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "jq: query evaluation: too many iterations (100)\n",
    );
    expect(result.exitCode).toBe(126);
  });

  it.each([
    "w",
    "W",
  ])("does not flush sed %s writes after the deadline", async (command) => {
    const checks = abortOnCheckpoint("sed", 2);
    const fs = new InMemoryFs({ "/input": "old\n" });
    const bash = new Bash({ fs });

    const result = await bash.exec(
      `sed -i -e 's/old/new/' -e '${command} /input' /input; printf after`,
    );

    expect(await fs.readFile("/input")).toBe("old\n");
    expect(checks()).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: sed aborted\n");
    expect(result.exitCode).toBe(124);
  });

  it("checks the deadline during sed D restarts", async () => {
    const checks = abortOnCheckpoint("sed", 2);
    const bash = new Bash({ files: { "/rows": "line\n".repeat(3072) } });

    const result = await bash.exec("sed -n 'N;D' /rows; printf after");

    expect(checks()).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: sed aborted\n");
    expect(result.exitCode).toBe(124);
  });

  it("checks the deadline during the rg JSON rescan", async () => {
    const original = ExecutionScope.prototype.throwIfAborted;
    let searchChecks = 0;
    let rescanChecks = 0;
    vi.spyOn(ExecutionScope.prototype, "throwIfAborted").mockImplementation(
      function (this: ExecutionScope, site?: string) {
        if (site === "search") searchChecks++;
        if (site === "rg" && searchChecks > 0 && ++rescanChecks === 2) {
          throw new ExecutionAbortedError("", "bash: rg aborted\n");
        }
        original.call(this, site);
      },
    );
    const bash = new Bash({
      files: { "/rows": `needle\n${"other\n".repeat(3072)}` },
    });

    const result = await bash.exec("rg --json needle /rows; printf after");

    expect(searchChecks).toBeGreaterThan(0);
    expect(rescanChecks).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: rg aborted\n");
    expect(result.exitCode).toBe(124);
  });
});
