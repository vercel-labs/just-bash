import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

function destructiveFixture(): Bash {
  return new Bash({
    files: {
      "/dir/keep": "keep",
      "/dir/remove": "remove",
    },
  });
}

describe("find fail-closed parsing", () => {
  const invalidCases = [
    {
      command: "find /dir -size invalid -delete",
      stderr: "find: invalid argument `invalid' to `-size'\n",
    },
    {
      command: "find /dir -size 9007199254740991G -delete",
      stderr: "find: invalid argument `9007199254740991G' to `-size'\n",
    },
    {
      command: "find /dir -mtime 1x -delete",
      stderr: "find: invalid argument `1x' to `-mtime'\n",
    },
    {
      command: "find /dir -perm 755x -delete",
      stderr: "find: invalid argument `755x' to `-perm'\n",
    },
    {
      command: "find /dir -maxdepth nope -delete",
      stderr: "find: invalid argument `nope' to `-maxdepth'\n",
    },
    {
      command: "find /dir -name",
      stderr: "find: missing argument to `-name'\n",
    },
    {
      command: "find /dir -name keep -o",
      stderr: "find: expected an expression after `-o'\n",
    },
    {
      command: "find /dir -name keep -a",
      stderr: "find: expected an expression after `-a'\n",
    },
    {
      command: "find /dir !",
      stderr: "find: expected an expression after `!'\n",
    },
    {
      command: "find /dir \\( -name keep",
      stderr: "find: missing closing `)'\n",
    },
    {
      command: "find /dir -name keep \\)",
      stderr: "find: unexpected `)'\n",
    },
    {
      command: "find /dir -exec \\;",
      stderr: "find: missing argument to `-exec'\n",
    },
    {
      command: "find /dir -exec echo {}",
      stderr: "find: missing argument to `-exec'\n",
    },
    {
      command: "find /dir -exec echo +",
      stderr: "find: invalid argument `+' to `-exec'\n",
    },
    {
      command: "find /dir ! -delete",
      stderr: "find: refusing to evaluate `-delete' under negation\n",
    },
  ];

  for (const { command, stderr } of invalidCases) {
    it(`rejects ${command} before side effects`, async () => {
      const env = destructiveFixture();
      const result = await env.exec(command);

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(stderr);
      expect(result.exitCode).toBe(1);

      const after = await env.exec("printf '%s|' /dir/*");
      expect(after.stdout).toBe("/dir/keep|/dir/remove|");
      expect(after.stderr).toBe("");
      expect(after.exitCode).toBe(0);
    });
  }
});

describe("find action expression semantics", () => {
  it("applies print0 and delete only in their reached OR branches", async () => {
    const env = destructiveFixture();
    const result = await env.exec(
      "find /dir -type f \\( -name keep -print0 -o -name remove -delete \\)",
    );

    expect(result.stdout).toBe("/dir/keep\0");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const after = await env.exec("printf '%s|' /dir/*");
    expect(after.stdout).toBe("/dir/keep|");
  });

  it("short-circuits delete on the true side of OR", async () => {
    const env = destructiveFixture();
    const result = await env.exec(
      "find /dir -type f -a \\( -name keep -o -delete \\)",
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const after = await env.exec("printf '%s|' /dir/*");
    expect(after.stdout).toBe("/dir/keep|");
  });

  it("runs exec only in its nested matching branch", async () => {
    const env = destructiveFixture();
    const result = await env.exec(
      "find /dir -type f \\( \\( -name keep -exec echo EXEC {} \\; \\) -o -name remove -print \\)",
    );

    expect(result.stdout).toBe("EXEC /dir/keep\n/dir/remove\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("preserves action effects reached beneath logical NOT", async () => {
    const env = new Bash({ files: { "/dir/file": "x" } });
    const result = await env.exec("find /dir -type f ! -print");

    expect(result.stdout).toBe("/dir/file\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("find conservative traversal", () => {
  it("does not prune nested descendants for path expressions", async () => {
    const env = new Bash({
      files: {
        "/repo/pulls/direct.json": "",
        "/repo/pulls/nested/deep.json": "",
        "/repo/pulls/nested/deep.txt": "",
      },
    });

    const result = await env.exec(
      "find /repo -type f -path '*/pulls/*.json' -print",
    );
    expect(result.stdout).toBe(
      "/repo/pulls/direct.json\n/repo/pulls/nested/deep.json\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("does not prune OR, NOT, or case-insensitive path expressions", async () => {
    const env = new Bash({
      files: {
        "/repo/PULLS/nested/UPPER.JSON": "",
        "/repo/other/nested/value.txt": "",
      },
    });

    const result = await env.exec(
      "find /repo -type f \\( -ipath '*/pulls/*.json' -o ! -path '*/PULLS/*' \\)",
    );
    expect(result.stdout).toBe(
      "/repo/PULLS/nested/UPPER.JSON\n/repo/other/nested/value.txt\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
