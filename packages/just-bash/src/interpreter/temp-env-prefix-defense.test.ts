import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { DefenseInDepthBox } from "../security/defense-in-depth-box.js";

describe("temp env prefix under defense-in-depth", () => {
  afterEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  it("runs a command with a leading env assignment", async () => {
    const bash = new Bash({ defenseInDepth: true });
    const result = await bash.exec("FOO=bar true");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("passes the temp binding through to the command", async () => {
    const bash = new Bash({ defenseInDepth: true });
    const result = await bash.exec("FOO=bar echo hi");

    expect(result.stdout).toBe("hi\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  // Regression guard for the bundled-dist failure where a leading env
  // assignment (`FOO=bar cmd`) threw "security violation: dynamic import of
  // Node.js builtin 'node:module' is blocked during script execution". The
  // assignment path used `await import("./expansion.js")`, which in the dist
  // bundle links a lazy chunk whose static graph pulls in `node:module`; the
  // defense-in-depth ESM resolve hook then blocked it. expansion.js is already
  // statically imported here, so the lazy import must not be reintroduced.
  it("does not lazily import sibling interpreter modules", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL("./simple-command-assignments.ts", import.meta.url),
      ),
      "utf8",
    );
    expect(source).not.toMatch(/await\s+import\(/);
  });
});
