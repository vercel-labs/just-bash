import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("rg --no-messages", () => {
  it("keeps matches available to a pipeline", async () => {
    const bash = new Bash({ files: { "/file.txt": "needle\n" } });
    expect(
      await bash.exec("rg --no-messages needle /file.txt | wc -l"),
    ).toMatchObject({ stdout: "1\n", stderr: "", exitCode: 0 });
  });

  it.each([
    ["rg --no-messages needle /missing", ""],
    ["rg --no-messages -N needle /file.txt /missing", "/file.txt:needle\n"],
    ["rg --no-messages --files /file.txt /missing", "/file.txt\n"],
  ])("suppresses access diagnostics without changing failure status: %s", async (command, stdout) => {
    const bash = new Bash({ files: { "/file.txt": "needle\n" } });
    expect(await bash.exec(command)).toMatchObject({
      stdout,
      stderr: "",
      exitCode: 2,
    });
  });

  it("lets --messages restore diagnostics", async () => {
    const bash = new Bash();
    expect(
      await bash.exec("rg --no-messages --messages needle /missing"),
    ).toMatchObject({
      stdout: "",
      stderr: "rg: /missing: Unable to access path\n",
      exitCode: 2,
    });
  });

  it("keeps invalid-pattern diagnostics", async () => {
    const bash = new Bash({ files: { "/file.txt": "needle\n" } });
    expect(await bash.exec("rg --no-messages '[' /file.txt")).toMatchObject({
      stdout: "",
      stderr: "rg: invalid regex: [\n",
      exitCode: 2,
    });
  });
});
