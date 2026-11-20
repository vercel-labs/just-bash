import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("executable scripts", () => {
  it.each([
    2, 1,
  ])("continues a semicolon list after a script exits %i", async (exitCode) => {
    const env = new Bash({
      files: {
        "/scripts/fail.sh": `exit ${exitCode}\n`,
      },
    });
    await env.exec("chmod +x /scripts/fail.sh");

    const result = await env.exec("/scripts/fail.sh ; echo $?");

    expect(result).toMatchObject({
      stdout: `${exitCode}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  it("does not continue an AND list after a script fails", async () => {
    const env = new Bash({
      files: {
        "/scripts/fail.sh": "exit 2\n",
      },
    });
    await env.exec("chmod +x /scripts/fail.sh");

    const result = await env.exec("/scripts/fail.sh && echo $?");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 2,
    });
  });

  it("continues a semicolon list after a script with a lexer error", async () => {
    const env = new Bash({
      files: {
        "/scripts/bad.sh": "x=$(echo a # )\n",
      },
    });
    await env.exec("chmod +x /scripts/bad.sh");

    const result = await env.exec("echo start; /scripts/bad.sh; echo end");

    expect(result).toMatchObject({
      stdout: "start\nend\n",
      stderr:
        "bash: /scripts/bad.sh: line 2: unexpected EOF while looking for matching `)'\n",
      exitCode: 0,
    });
  });
});
