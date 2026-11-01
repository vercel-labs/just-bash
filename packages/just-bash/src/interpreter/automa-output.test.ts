// Automa modifications: migrated patch-output-order/output-sink regression cases.
import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("Automa ordered terminal output", () => {
  it.each([
    ["printf a; printf b >&2; printf c", "abc"],
    ["{ printf a; printf b >&2; printf c; } 2>&1", "abc"],
    ["{ printf a; printf b >&2; printf c; } > /out 2>&1; cat /out", "abc"],
    ["{ printf a; printf b >&2; printf c; } |& cat", "abc"],
    ["for x in a b; do printf $x; printf E >&2; done", "aEbE"],
    ["f() { printf a; printf b >&2; return; }; f; printf c", "abc"],
    ["x=$(printf a; printf b >&2); printf '<%s>' \"$x\"", "b<a>"],
    ["printf a >/file; printf b >&2; cat /file", "ba"],
    ["printf '\\342'; printf '\\202'; printf '\\254'", "€"],
    ["printf '\\357\\273\\277x'", "\uFEFFx"],
  ])("streams %s once", async (script, expected) => {
    const parts: string[] = [];
    const result = await new Bash().exec(script, {
      onOutput: (text) => {
        parts.push(text);
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe(expected);
    expect(parts.join("")).toBe(expected);
  });

  it("publishes a completed command before a later command finishes", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const parts: string[] = [];
    const bash = new Bash({
      customCommands: [
        {
          name: "waiter",
          async execute() {
            expect(parts.join("")).toBe("before");
            release();
            return { stdout: "after", stderr: "", exitCode: 0 };
          },
        },
      ],
    });
    const result = bash.exec("printf before; waiter", {
      onOutput: (text) => {
        parts.push(text);
      },
    });
    await pending;
    expect((await result).output).toBe("beforeafter");
  });

  it("resource exhaustion survives ordinary shell recovery", async () => {
    const result = await new Bash({
      executionLimits: { maxCommandCount: 3 },
    }).exec("bash -c 'while :; do :; done' || true; echo hidden");
    expect(result.executionFailure?.kind).toBe("resource-limit");
    expect(result.exitCode).toBe(126);
    expect(result.stdout).not.toContain("hidden");
  });
});
