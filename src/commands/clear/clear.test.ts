import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("clear command", () => {
  it("should output ANSI clear sequence", async () => {
    const env = new Bash();
    const result = await env.exec("clear");
    expect(result.stdout).toContain("\x1B[2J");
    expect(result.stdout).toContain("\x1B[H");
    expect(result.exitCode).toBe(0);
  });

  it("should show help with --help", async () => {
    const env = new Bash();
    const result = await env.exec("clear --help");
    expect(result.stdout).toContain("clear");
    expect(result.stdout).toContain("terminal");
    expect(result.exitCode).toBe(0);
  });
});
