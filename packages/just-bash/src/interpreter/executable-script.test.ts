import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { defineCommand } from "../custom-commands.js";

const showArgv = defineCommand("show-argv", async (args, ctx) => ({
  stdout: `${JSON.stringify(args)} stdin=${JSON.stringify(ctx.stdin)}\n`,
  stderr: "",
  exitCode: 3,
}));

function withScripts(files: Record<string, string>): Bash {
  return new Bash({
    files: Object.fromEntries(
      Object.entries(files).map(([path, content]) => [
        path,
        { content, mode: 0o755 },
      ]),
    ),
    cwd: "/w",
    customCommands: [showArgv],
  });
}

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

  it("runs a script through a #!/usr/bin/env interpreter that is a registered command", async () => {
    const env = withScripts({
      "/w/s": "#!/usr/bin/env show-argv\nnot bash (\n",
    });

    const result = await env.exec("echo hi | ./s 'a b' c; echo $?");

    expect(result).toMatchObject({
      stdout: '["/w/s","a b","c"] stdin="hi\\n"\n3\n',
      stderr: "",
      exitCode: 0,
    });
  });

  it("passes a #! line's argument before the script path, as a kernel does", async () => {
    const env = withScripts({ "/w/s": "#!/usr/bin/show-argv --flag\n" });

    const result = await env.exec("/w/s x | tr a-z A-Z");

    expect(result.stdout).toBe('["--FLAG","/W/S","X"] STDIN=""\n');
  });

  it("runs the body as bash for bash, sh, unregistered interpreters and other paths", async () => {
    const env = withScripts({
      "/w/bash": "#!/bin/bash\necho bash $1\n",
      "/w/sh": "#!/bin/sh\necho sh $1\n",
      "/w/env": "#!/usr/bin/env perl\necho perl $1\n",
      "/w/elsewhere": "#!/opt/bin/show-argv\necho elsewhere $1\n",
      "/w/plain": "echo plain $1\n",
    });

    const result = await env.exec(
      "./bash 1; ./sh 2; ./env 3; ./elsewhere 4; ./plain 5",
    );

    expect(result.stdout).toBe("bash 1\nsh 2\nperl 3\nelsewhere 4\nplain 5\n");
  });
});
