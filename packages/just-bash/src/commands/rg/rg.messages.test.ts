/**
 * Tests for rg --no-messages / --messages: file traversal and read
 * diagnostics are suppressed, while matches, exit status, and argument
 * errors are unchanged.
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../index.js";

function bashWithFile() {
  return new Bash({
    cwd: "/home/user",
    files: {
      "/home/user/file.txt": "needle\n",
    },
  });
}

describe("rg --no-messages", () => {
  it("finds matches, so a downstream count sees them", async () => {
    const bash = new Bash({ files: { "/file.txt": "needle\n" } });
    const result = await bash.exec("rg --no-messages needle /file.txt | wc -l");
    expect(result.stdout).toBe("1\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("reports a missing path by default", async () => {
    const result = await bashWithFile().exec("rg needle missing.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("rg: missing.txt: Unable to access path\n");
    expect(result.exitCode).toBe(2);
  });

  it("suppresses the missing-path diagnostic but keeps exit code 2", async () => {
    const result = await bashWithFile().exec(
      "rg --no-messages needle missing.txt",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(2);
  });

  it("keeps matches and exit code 2 when one of several paths is missing", async () => {
    const bash = bashWithFile();
    const noisy = await bash.exec("rg needle file.txt missing.txt");
    expect(noisy.stdout).toBe("file.txt:1:needle\n");
    expect(noisy.stderr).toBe("rg: missing.txt: Unable to access path\n");
    expect(noisy.exitCode).toBe(2);

    const quiet = await bash.exec(
      "rg --no-messages needle file.txt missing.txt",
    );
    expect(quiet.stdout).toBe("file.txt:1:needle\n");
    expect(quiet.stderr).toBe("");
    expect(quiet.exitCode).toBe(2);
  });

  it("--messages after --no-messages turns diagnostics back on", async () => {
    const result = await bashWithFile().exec(
      "rg --no-messages --messages needle missing.txt",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("rg: missing.txt: Unable to access path\n");
    expect(result.exitCode).toBe(2);
  });

  it("still reports an invalid regex", async () => {
    const result = await bashWithFile().exec("rg --no-messages '([' file.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("rg: invalid regex: ([\n");
    expect(result.exitCode).toBe(2);
  });

  it("suppresses diagnostics in --files mode too", async () => {
    const bash = bashWithFile();
    const noisy = await bash.exec("rg --files missing-dir");
    expect(noisy.stderr).toBe("rg: missing-dir: Unable to access path\n");
    expect(noisy.exitCode).toBe(2);

    const quiet = await bash.exec("rg --files --no-messages missing-dir");
    expect(quiet.stdout).toBe("");
    expect(quiet.stderr).toBe("");
    expect(quiet.exitCode).toBe(2);
  });
});
