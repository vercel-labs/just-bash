import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("normalized device redirections", () => {
  it.each([
    ["cd /dev; echo hi > stdout", "hi\n", "", 0],
    ["echo hi > //dev/stdout", "hi\n", "", 0],
    ["echo hi > /dev/../dev/stderr", "", "hi\n", 0],
    ["set -C; echo hi >/dev/stdout", "hi\n", "", 0],
    ["cd /dev; set -C; echo hi >./stderr", "", "hi\n", 0],
    ["{ set -C; echo hi >//dev/stdout; } | cat", "hi\n", "", 0],
    ["{ cd /dev; set -C; echo hi >./stderr; } 2>&1 | cat", "hi\n", "", 0],
    ["cd /; echo hi > dev/null; ls -la /dev >/listing", "", "", 0],
  ])("preserves virtual /dev contents: %s", async (script, stdout, stderr, exitCode) => {
    const bash = new Bash();
    const names = await bash.fs.readdir("/dev");
    const files = names.filter((name) => name !== "fd");
    const contents = await Promise.all(
      files.map((name) => bash.fs.readFile(`/dev/${name}`)),
    );

    expect(await bash.exec(script)).toMatchObject({ stdout, stderr, exitCode });
    expect(await bash.fs.readdir("/dev")).toStrictEqual(names);
    expect(
      await Promise.all(files.map((name) => bash.fs.readFile(`/dev/${name}`))),
    ).toStrictEqual(contents);
  });

  it("preserves the relative full-device target in the existing error", async () => {
    const bash = new Bash();
    const names = await bash.fs.readdir("/dev");
    const result = await bash.exec("cd /dev; echo hi > ./full; echo $?");
    // /dev/full currently fails while opening, not while writing as in Bash.
    // Only target spelling and filesystem preservation are asserted here.
    expect(result.stderr).toBe("bash: ./full: No space left on device\n");
    expect(await bash.fs.readdir("/dev")).toStrictEqual(names);
  });

  it("reads normalized null paths without reading the backing file", async () => {
    const bash = new Bash();
    await bash.fs.writeFile("/dev/null", "sentinel");
    expect(
      await bash.exec("cd /dev; wc -c < ./null; wc -c < /dev/../dev/null"),
    ).toMatchObject({ stdout: "0\n0\n", stderr: "", exitCode: 0 });
    expect(await bash.fs.readFile("/dev/null")).toBe("sentinel");
  });
});
