import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

function modeAndName(stdout: string): string[] {
  return stdout
    .trimEnd()
    .split("\n")
    .map((line) => {
      const fields = line.split(/\s+/);
      return `${fields[0]} ${fields[fields.length - 1]}`;
    });
}

describe("ls -l mode column", () => {
  it("prints a file operand's mode", async () => {
    const env = new Bash({ files: { "/t/run.sh": { content: "x\n" } } });
    const result = await env.exec(
      "ls -l /t/run.sh; chmod 755 /t/run.sh; ls -l /t/run.sh",
    );
    expect(modeAndName(result.stdout)).toEqual([
      "-rw-r--r-- /t/run.sh",
      "-rwxr-xr-x /t/run.sh",
    ]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("prints each entry's mode in a directory listing", async () => {
    const env = new Bash({
      files: {
        "/t/a": { content: "a\n", mode: 0o600 },
        "/t/b": { content: "b\n", mode: 0o755 },
        "/t/c": { content: "c\n" },
      },
    });
    const result = await env.exec("mkdir /t/d && chmod 750 /t/d && ls -l /t");
    expect(modeAndName(result.stdout)).toEqual([
      "total 4",
      "-rw------- a",
      "-rwxr-xr-x b",
      "-rw-r--r-- c",
      "drwxr-x--- d",
    ]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("prints a directory operand's mode with -d", async () => {
    const env = new Bash();
    const result = await env.exec("mkdir /d && chmod 700 /d && ls -ld /d");
    expect(modeAndName(result.stdout)).toEqual(["drwx------ /d"]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("builds the . and .. rows of -a from the directory and its parent", async () => {
    const env = new Bash();
    const result = await env.exec(
      "mkdir -p /p/c && chmod 711 /p && chmod 700 /p/c && ls -la /p/c",
    );
    expect(modeAndName(result.stdout)).toEqual([
      "total 2",
      "drwx------ .",
      "drwx--x--x ..",
    ]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("builds the .. row of a symlinked directory from its target's parent", async () => {
    const env = new Bash();
    const result = await env.exec(
      "mkdir -p /p/c /a && chmod 711 /p && chmod 700 /p/c && ln -s /p/c /link && ln -s /p/c /a/link && ls -la /link; ls -la /a/link; cd /link && ls -la",
    );
    expect(modeAndName(result.stdout)).toEqual([
      "total 2",
      "drwx------ .",
      "drwx--x--x ..",
      "total 2",
      "drwx------ .",
      "drwx--x--x ..",
      "total 2",
      "drwx------ .",
      "drwx--x--x ..",
    ]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("builds both the . and .. rows of / from / itself", async () => {
    const env = new Bash();
    const result = await env.exec("chmod 750 / && ls -la /");
    expect(modeAndName(result.stdout).slice(1, 3)).toEqual([
      "drwxr-x--- .",
      "drwxr-x--- ..",
    ]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("matches stat -c %A", async () => {
    const env = new Bash({
      files: { "/t/f": { content: "f\n", mode: 0o640 } },
    });
    const result = await env.exec("ls -l /t/f; stat -c %A /t/f");
    const [lsLine, statMode] = result.stdout.trimEnd().split("\n");
    expect(statMode).toBe("-rw-r-----");
    expect(lsLine.slice(0, 10)).toBe(statMode);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
