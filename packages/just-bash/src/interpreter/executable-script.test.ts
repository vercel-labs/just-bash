import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("executable scripts", () => {
  it.each([
    false,
    true,
  ])("imports only exported startup options (exported=%s)", async (exported) => {
    const bash = new Bash({
      files: {
        "/script.sh":
          '#!/bin/bash\nfalse | true\necho $?\nprintf "<%s>\\n" missing-*\n',
      },
    });
    const result = await bash.exec(
      `chmod +x /script.sh; set -o pipefail; shopt -s nullglob; ${exported ? "export SHELLOPTS BASHOPTS;" : ""} /script.sh; bash /script.sh; false | true; echo $?`,
    );
    expect(result.stdout).toBe(
      exported ? "1\n<>\n1\n<>\n1\n" : "0\n<missing-*>\n0\n<missing-*>\n1\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
  it("does not inherit aliases into executed scripts or leak script aliases", async () => {
    const bash = new Bash({
      files: {
        "/script.sh": "#!/bin/bash\necho script\nalias echo='printf child'\n",
      },
    });
    const result = await bash.exec(`chmod +x /script.sh
shopt -s expand_aliases
alias echo='printf parent'
/script.sh
echo kept`);
    expect(result.stdout).toBe("script\nparent");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
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
});
