// Automa modifications: N00b regressions from checksum-streams and options suites.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("Automa checksum operands", () => {
  it.each([
    ["md5sum", "md5"],
    ["sha1sum", "sha1"],
    ["sha256sum", "sha256"],
  ])("preserves streams and -- operands for %s", async (command, algorithm) => {
    const shell = new Bash({
      cwd: "/",
      files: { "/f": "hello\n", "/--help": "helpfile", "/-c": "dashfile" },
    });
    const hash = (text: string) =>
      createHash(algorithm).update(text).digest("hex");
    expect(await shell.exec(`${command} f missing`)).toMatchObject({
      stdout: `${hash("hello\n")}  f\n`,
      stderr: `${command}: missing: No such file or directory\n`,
      exitCode: 1,
    });
    expect(
      await shell.exec(`${command} missing 2>/dev/null || printf fallback`),
    ).toMatchObject({ stdout: "fallback", stderr: "", exitCode: 0 });
    expect(await shell.exec(`${command} -- --help -c`)).toMatchObject({
      stdout: `${hash("helpfile")}  --help\n${hash("dashfile")}  -c\n`,
      stderr: "",
      exitCode: 0,
    });
  });
});
