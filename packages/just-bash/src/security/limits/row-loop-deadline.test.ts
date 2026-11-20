import { afterEach, describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionScope } from "../../execution-scope.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../../interpreter/errors.js";

const slowQuery = "reduce range(0; 1100) as $i (0; . + 1)";
const rows = "needle\n".repeat(3072);

/**
 * Inject an abort at a specific checkpoint without poisoning the scope.
 * This makes a recovery catch that swallows the abort observable.
 */
function abortOnCheckpoint(
  site: string,
  checkpoint: number,
  ready?: () => boolean,
): () => number {
  const original = ExecutionScope.prototype.throwIfAborted;
  let checks = 0;
  vi.spyOn(ExecutionScope.prototype, "throwIfAborted").mockImplementation(
    function (this: ExecutionScope, currentSite?: string) {
      if (
        currentSite === site &&
        (ready?.() ?? true) &&
        ++checks === checkpoint
      ) {
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

describe("execution deadlines inside data commands", () => {
  it.each([
    ["grep", "grep -c needle /rows", "search", 1],
    ["rg", "rg -c needle /rows", "search", 1],
    ["jq", `jq -n '${slowQuery}'`, "query evaluation", 2],
    ["yq", `yq -n '${slowQuery}'`, "query evaluation", 2],
    ["sed", "sed 's/needle/x/' /rows", "sed", 2],
  ])("stops %s at an in-loop checkpoint", async (_name, command, site, checkpoint) => {
    const checks = abortOnCheckpoint(site, checkpoint);
    const bash = new Bash({ files: { "/rows": rows } });

    const result = await bash.exec(`${command}; printf after`);

    expect(checks()).toBe(checkpoint);
    expect(result.exitCode).toBe(124);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`bash: ${site} aborted\n`);
  });

  it("preserves AWK output and stops the script after an abort", async () => {
    const checks = abortOnCheckpoint("awk", 2);
    const bash = new Bash({ files: { "/rows": rows } });

    const result = await bash.exec(
      `awk 'NR == 1 { print "first" }' /rows; printf after`,
    );

    expect(checks()).toBe(2);
    expect(result.exitCode).toBe(124);
    expect(result.stdout).toBe("first\n");
    expect(result.stderr).toBe("bash: awk aborted\n");
  });

  it("preserves AWK output and output carried by a limit", async () => {
    vi.spyOn(InMemoryFs.prototype, "readFile").mockRejectedValueOnce(
      new ExecutionLimitError("injected limit", "iterations", "nested\n"),
    );
    const bash = new Bash({ files: { "/input": "one\n" } });

    const result = await bash.exec(
      "awk 'BEGIN { print \"first\" } { print }' /input; printf after",
    );

    expect(result.exitCode).toBe(126);
    expect(result.stdout).toBe("first\nnested\n");
    expect(result.stderr).toBe("awk: injected limit\n");
  });

  it("checks sed cycles even when N skips line-index boundaries", async () => {
    const checks = abortOnCheckpoint("sed", 2);
    const bash = new Bash({ files: { "/rows": rows } });

    const result = await bash.exec("sed -n '1024~1024N' /rows; printf after");

    expect(checks()).toBe(2);
    expect(result.exitCode).toBe(124);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: sed aborted\n");
  });

  it("leaves a sed in-place input unchanged after an abort", async () => {
    const checks = abortOnCheckpoint("sed", 2);
    const fs = new InMemoryFs({ "/rows": rows });
    const bash = new Bash({ fs });

    const result = await bash.exec("sed -i 's/needle/x/' /rows; printf after");

    expect(checks()).toBe(2);
    expect(result.exitCode).toBe(124);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: sed aborted\n");
    expect(await fs.readFile("/rows")).toBe(rows);
  });

  it.each([
    ["grep", "grep -F needle /a /b", "grep", "needle\n"],
    ["rg", "rg -F needle /a /b", "rg", "needle\n"],
    ["rg binary", "rg -F needle /a /b", "rg", "\0needle\n"],
  ])("checks the deadline between small %s files", async (_name, command, site, content) => {
    let reads = 0;
    class ReadingFs extends InMemoryFs {
      override async readFileBuffer(path: string) {
        const result = await super.readFileBuffer(path);
        if (path === "/a" || path === "/b") reads++;
        return result;
      }
    }
    const checks = abortOnCheckpoint(site, 2, () => reads > 0);
    const bash = new Bash({
      fs: new ReadingFs({ "/a": content, "/b": content }),
    });

    const result = await bash.exec(`${command}; printf after`);

    expect(reads).toBe(2);
    expect(checks()).toBe(2);
    expect(result.exitCode).toBe(124);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`bash: ${site} aborted\n`);
  });

  it.each([
    ["first", `first((${slowQuery}))`],
    ["nth", `nth(0; (${slowQuery}))`],
    ["limit", `limit(1; (${slowQuery}))`],
    ["isempty", `isempty((${slowQuery}))`],
    ["isvalid", `isvalid((${slowQuery}))`],
    ["any", `any((${slowQuery}); .)`],
    ["all", `all((${slowQuery}); .)`],
    ["try/catch", `try (${slowQuery}) catch "swallowed"`],
    ["optional", `(${slowQuery})?`],
    ["splits flags", `"needle" | splits("e"; (${slowQuery}))`],
    ["scan flags", `"needle" | scan("e"; (${slowQuery}))`],
    ["test flags", `"needle" | test("e"; (${slowQuery}))`],
    ["match flags", `"needle" | match("e"; (${slowQuery}))`],
    ["capture flags", `"needle" | capture("e"; (${slowQuery}))`],
    ["sub flags", `"needle" | sub("e"; "x"; (${slowQuery}))`],
    ["gsub flags", `"needle" | gsub("e"; "x"; (${slowQuery}))`],
  ])("does not let jq %s recover from an abort", async (_name, query) => {
    const checks = abortOnCheckpoint("query evaluation", 2);
    const bash = new Bash();

    const result = await bash.exec(`jq -n '${query}'; printf after`);

    expect(checks()).toBe(2);
    expect(result.exitCode).toBe(124);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: query evaluation aborted\n");
  });

  it.each([
    "jq",
    "yq",
  ])("stops the script after a %s resource limit", async (command) => {
    const bash = new Bash({ executionLimits: { maxStringLength: 64 } });

    const result = await bash.exec(
      `${command} -n '"12345678" * 9'; printf after`,
    );

    expect(result.exitCode).toBe(126);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `${command}: string size limit exceeded (64 bytes)\n`,
    );
  });

  it.each([
    ["stdin", "sed ':loop; b loop'"],
    ["file", "sed ':loop; b loop' /input"],
    ["in-place", "sed -i ':loop; b loop' /input"],
  ])("preserves sed's limit diagnostic for %s", async (_name, command) => {
    const bash = new Bash({
      files: { "/input": "one\n" },
      executionLimits: { maxSedIterations: 2 },
    });

    const result = await bash.exec(`${command} | wc -l; printf after`, {
      stdin: "one\n",
    });

    expect(result.exitCode).toBe(126);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "sed: sed: command execution exceeded maximum iterations (2)\n",
    );
  });

  it("leaves a yq in-place input unchanged when evaluation passes its deadline", async () => {
    const deadline = 60_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    const original = ExecutionScope.prototype.throwIfAborted;
    let checks = 0;
    vi.spyOn(ExecutionScope.prototype, "throwIfAborted").mockImplementation(
      function (this: ExecutionScope, site?: string) {
        if (site === "query evaluation" && ++checks === 2) {
          clock.mockReturnValue(deadline + 1);
        }
        original.call(this, site);
      },
    );
    const content = "original: 1\n";
    const fs = new InMemoryFs({ "/input.yaml": content });
    const bash = new Bash({
      fs,
      executionLimits: { maxExecutionTimeMs: deadline },
    });

    const result = await bash.exec(`yq -i 'first((${slowQuery}))' /input.yaml`);

    expect(checks).toBe(2);
    expect(result.exitCode).toBe(124);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: query evaluation exceeded execution deadline (60000ms)\n",
    );
    expect(await fs.readFile("/input.yaml")).toBe(content);
  });

  it.each([
    ["grep", "grep -c needle /rows", "2\n"],
    ["rg", "rg -c needle /rows", "2\n"],
    ["awk", "awk 'END { print NR }' /rows", "2\n"],
    ["sed", "sed 's/needle/x/' /rows", "x\nx\n"],
    ["jq", "jq -n '1 + 1'", "2\n"],
    ["yq", "yq -n '1 + 1'", "2\n"],
  ])("keeps %s output unchanged before the deadline", async (_name, command, expected) => {
    const bash = new Bash({
      files: { "/rows": "needle\nneedle\n" },
      executionLimits: { maxExecutionTimeMs: 60_000 },
    });

    const result = await bash.exec(command);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe("");
  });
});
