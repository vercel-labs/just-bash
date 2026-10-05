import { describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";
import { defineCommand } from "./custom-commands.js";
import { InMemoryFs } from "./fs/in-memory-fs/in-memory-fs.js";

function forward(calls: string[] = []) {
  return defineCommand("forward", async ([name = "", ...args]) => {
    calls.push(name);
    return { stdout: `${name} [${args.join(",")}]\n`, stderr: "", exitCode: 7 };
  });
}

describe("commandNotFound option and command resolution", () => {
  it("is not reached by registered commands that PATH or deleted stubs hide", async () => {
    const calls: string[] = [];
    const env = new Bash({ commandNotFound: forward(calls) });

    const result = await env.exec(
      'PATH=/nonexistent ls f; echo "status=$?"; rm /bin/cat /usr/bin/cat; cat f; echo "status=$?"',
    );

    expect(result).toMatchObject({
      stdout: "status=127\nstatus=127\n",
      stderr: "bash: ls: command not found\nbash: cat: command not found\n",
      exitCode: 0,
    });
    expect(calls).toEqual([]);
  });

  it("is reached by commands the commands option leaves out", async () => {
    const env = new Bash({ commands: ["echo"], commandNotFound: forward() });

    const result = await env.exec("ls f");

    expect(result).toMatchObject({
      stdout: "ls [f]\n",
      stderr: "",
      exitCode: 7,
    });
  });

  it("is reached by commands whose stubs another shell wrote on a shared filesystem", async () => {
    const fs = new InMemoryFs();
    new Bash({ fs });
    const env = new Bash({
      fs,
      commands: ["echo", "chmod"],
      commandNotFound: forward(),
    });

    const result = await env.exec(
      "ls f; chmod +x /usr/bin/cat /bin/cat; cat g",
    );

    expect(result).toMatchObject({
      stdout: "ls [f]\ncat [g]\n",
      stderr: "",
      exitCode: 7,
    });
  });

  it("runs stubs of commands it does not register as missing commands", async () => {
    const fs = new InMemoryFs();
    new Bash({ fs });
    const env = new Bash({ fs, commands: ["echo", "chmod"] });

    const result = await env.exec(
      'ls; echo "status=$?"; /usr/bin/ls; echo "status=$?"; chmod +x /bin/ls /usr/bin/ls; ls; echo "status=$?"',
    );

    expect(result).toMatchObject({
      stdout: "status=127\nstatus=127\nstatus=127\n",
      stderr:
        "bash: ls: command not found\n" +
        "bash: /usr/bin/ls: No such file or directory\n" +
        "bash: ls: command not found\n",
      exitCode: 0,
    });
  });

  it("does not find stubs of commands it does not register", async () => {
    const fs = new InMemoryFs();
    new Bash({ fs });
    const env = new Bash({ fs, commands: ["echo"] });

    const result = await env.exec(
      'command -v ls; echo "status=$?"; type -t ls; echo "status=$?"; hash ls; echo "status=$?"',
    );

    expect(result).toMatchObject({
      stdout: "status=1\nstatus=1\nstatus=1\n",
      stderr: "bash: hash: ls: not found\n",
      exitCode: 0,
    });
  });

  it("still denies a file in /usr/bin that is not a stub", async () => {
    const calls: string[] = [];
    const env = new Bash({
      commandNotFound: forward(calls),
      files: { "/usr/bin/tool": "echo tool" },
    });

    const result = await env.exec('tool; echo "status=$?"');

    expect(result).toMatchObject({
      stdout: "status=126\n",
      stderr: "bash: /usr/bin/tool: Permission denied\n",
      exitCode: 0,
    });
    expect(calls).toEqual([]);
  });
});
