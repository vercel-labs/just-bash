import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("permission regressions", () => {
  it("denies reads after a write-only redirection", async () => {
    const bash = new Bash({ files: { "/data.txt": "original\n" } });
    const result = await bash.exec(
      "chmod 200 /data.txt; echo x > /data.txt; cat /data.txt",
    );

    expect(result).toMatchObject({
      stdout: "",
      stderr: "cat: /data.txt: Permission denied\n",
      exitCode: 1,
    });
  });

  it("replaces a symlink rather than its target with sed -i", async () => {
    const bash = new Bash({ files: { "/target": "a\n" } });
    const result = await bash.exec(
      "ln -s /target /link; sed -i 's/a/b/' /link; if test -L /link; then echo link; else echo file; fi; cat /link; cat /target",
    );

    expect(result).toMatchObject({
      stdout: "file\nb\na\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("reports denied reads from sed", async () => {
    const bash = new Bash({
      files: { "/data.txt": { content: "a\n", mode: 0o000 } },
    });
    const result = await bash.exec("sed 's/a/b/' /data.txt");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "sed: can't read /data.txt: Permission denied\n",
      exitCode: 2,
    });
  });

  it("reports denied reads from sed -i", async () => {
    const bash = new Bash({
      files: { "/data.txt": { content: "a\n", mode: 0o000 } },
    });
    const result = await bash.exec("sed -i 's/a/b/' /data.txt");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "sed: can't read /data.txt: Permission denied\n",
      exitCode: 2,
    });
  });

  it("requires write permission for read-write redirection", async () => {
    const bash = new Bash({
      files: { "/data.txt": { content: "original\n", mode: 0o400 } },
    });
    const result = await bash.exec('exec 3<> /data.txt; echo "rc=$?"');

    expect(result).toMatchObject({
      stdout: "rc=1\n",
      stderr: "bash: /data.txt: Permission denied\n",
      exitCode: 0,
    });
  });
});
