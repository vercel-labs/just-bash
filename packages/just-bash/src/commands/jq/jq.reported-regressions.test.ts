import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq reported regressions", () => {
  it("updates getpath targets and rejects unsupported deletion paths", async () => {
    const bash = new Bash();
    const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
    expect(
      await bash.exec(`echo '{"a":1}' | jq -c 'getpath(["a"]) |= 3'`),
    ).toMatchObject({ stdout: '{"a":3}\n', stderr: "", exitCode: 0 });
    expect(
      await bash.exec(
        `echo '{"a":[1,2]}' | jq -c '(getpath(["a"]) | getpath([-1])) += 3'`,
      ),
    ).toMatchObject({ stdout: '{"a":[1,5]}\n', stderr: "", exitCode: 0 });
    expect(await bash.exec("echo '[1,2]' | jq -c 'del(empty)'")).toMatchObject({
      stdout: "[1,2]\n",
      stderr: "",
      exitCode: 0,
    });
    expect(
      await bash.exec(`echo '[1,2,3]' | jq -c 'del(.[] | select(. == 2))'`),
    ).toMatchObject({
      stdout: "",
      stderr: "jq: error: Unsupported path expression in del\n",
      exitCode: 5,
    });
    expect(
      await bash.exec(
        `echo '{}' | jq -c 'getpath(["__proto__", "constructor", "prototype", "hasOwnProperty", "toString", "valueOf"][] | [., "polluted"]) |= true'`,
      ),
    ).toMatchObject({
      stdout:
        '{"hasOwnProperty":{"polluted":true},"toString":{"polluted":true},"valueOf":{"polluted":true}}\n',
      stderr: "",
      exitCode: 0,
    });
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(
      prototype,
    );
  });

  it("shares the remaining input stream with inputs, including under -n", async () => {
    const bash = new Bash({ files: { "/values": "1\n2\n", "/raw": "a\nb\n" } });
    const read = vi.spyOn(bash.fs, "readFileBytes");
    expect(await bash.exec("jq -n '.' /values")).toMatchObject({
      stdout: "null\n",
      stderr: "",
      exitCode: 0,
    });
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    for (const command of [
      "cat /values | jq -nc '[inputs]'",
      "jq -nc '[inputs]' /values",
      "jq -nc 'null as $x | [inputs]' /values",
      "cat /values | jq -c '[., inputs]'",
    ]) {
      expect(await bash.exec(command)).toMatchObject({
        stdout: "[1,2]\n",
        stderr: "",
        exitCode: 0,
      });
    }
    expect(await bash.exec("jq -nRc '[inputs]' /raw")).toMatchObject({
      stdout: '["a","b"]\n',
      stderr: "",
      exitCode: 0,
    });
    expect(await bash.exec("echo invalid | jq -n '.'")).toMatchObject({
      stdout: "null\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await bash.exec("jq -n '.' /missing")).toMatchObject({
      stdout: "null\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await bash.exec("jq -nc '[inputs?]' /missing")).toMatchObject({
      stdout: "",
      stderr: "jq: /missing: No such file or directory\n",
      exitCode: 2,
    });
  });

  it("joins raw output and labels explicit errors as runtime errors", async () => {
    const bash = new Bash();
    for (const option of ["-j", "--join-output"]) {
      expect(
        await bash.exec(`echo '{"a":1}' | jq ${option} '.a, "x"'`),
      ).toMatchObject({ stdout: "1x", stderr: "", exitCode: 0 });
    }
    expect(
      await bash.exec(`echo '{"a":1}' | jq '.a | error("boom")'`),
    ).toMatchObject({ stdout: "", stderr: "jq: error: boom\n", exitCode: 5 });
  });
});
