import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

const files = {
  "/home/user/a/tool": "echo a",
  "/home/user/e/tool": "echo e",
  "/home/user/e/script": "echo script",
};

async function shell() {
  const env = new Bash({ files, cwd: "/home/user" });
  await env.fs.chmod("/home/user/e/tool", 0o755);
  await env.fs.chmod("/home/user/e/script", 0o755);
  return env;
}

describe("PATH search", () => {
  it("names a file without execute permission as formed from PATH", async () => {
    const env = await shell();

    const result = await env.exec(
      'PATH=/home/user/a tool; echo "status=$?"; PATH=a tool; echo "status=$?"',
    );

    expect(result).toMatchObject({
      stdout: "status=126\nstatus=126\n",
      stderr:
        "bash: /home/user/a/tool: Permission denied\nbash: a/tool: Permission denied\n",
      exitCode: 0,
    });
  });

  it("prefers a later executable over an earlier file without execute permission", async () => {
    const env = await shell();

    const result = await env.exec(
      "PATH=/home/user/a:/home/user/e:/usr/bin; tool; command -v tool; type -P tool",
    );

    expect(result).toMatchObject({
      stdout: "e\n/home/user/e/tool\n/home/user/e/tool\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("finds executable scripts with command -v and command -V", async () => {
    const env = await shell();

    const result = await env.exec(
      "PATH=/home/user/e:/usr/bin; command -v script; command -V script",
    );

    expect(result).toMatchObject({
      stdout: "/home/user/e/script\nscript is /home/user/e/script\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
