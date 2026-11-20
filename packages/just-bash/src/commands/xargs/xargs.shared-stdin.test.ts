// Automa N2a: -a children share one stdin cursor, including partial reads.
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xargs argument-file shared stdin", () => {
  const files = {
    "/args": "one two\n",
    "/cats": "-\n-\n",
    "/heads": "-c2\n-c2\n",
    "/other": "OTHER",
  };
  it.each([
    ["printf payload | xargs -a /cats -n1 cat", "payload"],
    ["printf abcdef | xargs -a /heads -n1 head", "abcd"],
    [
      "printf abcdef | xargs -a /args -n1 bash -c 'read -r -n 2 x; echo \"$x\"'",
      "ab\ncd\n",
    ],
    [
      "printf payload | xargs -a /args -n1 bash -c 'if [ \"$0\" = one ]; then echo skip; else cat; fi'",
      "skip\npayload",
    ],
    [
      "printf payload | xargs -a /args -n1 bash -c 'if [ \"$0\" = one ]; then cat </other; else cat; fi'",
      "OTHERpayload",
    ],
    [
      "printf abcdef | xargs -a /args -n1 bash -c 'exec 3<&0; read -r -n 2 x <&3; echo \"$x\"'",
      "ab\ncd\n",
    ],
    ["printf '__file__:/secret' | xargs -a /cats -n1 cat", "__file__:/secret"],
    [
      'printf abcdef | xargs -a /args -n1 bash -c \'exec {fd}<&0; read -r -u "$fd" -n2 x; echo "$x"\'',
      "ab\ncd\n",
    ],
    [
      "printf abcdef | xargs -a /args -n1 bash -c 'exec 0<&0; read -r -n2 x; echo \"$x\"'",
      "ab\ncd\n",
    ],
    [
      "printf abcdef | xargs -a /args -n1 bash -c 'exec 3<&0; exec 0<&-; read -r -u3 -n2 x; echo \"$x\"'",
      "ab\ncd\n",
    ],
    [
      "printf abcdef | xargs -a /args -n1 bash -c 'read -r -n2 x; echo \"$x\"; exit 0'",
      "ab\ncd\n",
    ],
    [
      "printf payload | xargs -a /args -n1 bash -c 'printf x | cat; cat'",
      "xpayloadx",
    ],
    [
      "printf payload | xargs -a /args -n1 bash -c 'printf x | { cat; }; cat'",
      "xpayloadx",
    ],
    [
      "printf payload | xargs -a /args -n1 bash -c '{ cat; } </other; cat'",
      "OTHERpayloadOTHER",
    ],
    ["printf abcdef | xargs -a /args -n1 bash -c '(head -c2)'", "abcd"],
    ["printf abcdef | xargs -a /args -n1 bash -c 'head -c2; cat'", "abcdef"],
    [
      "printf payload | xargs -a /args -n1 bash -c 'printf x | read -u0 -n1 x; cat'",
      "payload",
    ],
    [
      "printf payload | xargs -a /args -n1 bash -c 'printf x | { read -u0 -n1 x; echo \"$x\"; }; cat'",
      "x\npayloadx\n",
    ],
  ])("%s", async (command, stdout) => {
    const result = await new Bash({ files }).exec(command);
    expect(result).toMatchObject({ stdout, stderr: "", exitCode: 0 });
  });
  it("keeps EOF as owned input instead of falling back to rg's cwd", async () => {
    const result = await new Bash({
      files: { ...files, "/needle": "foo\n" },
      cwd: "/",
    }).exec("printf foo | xargs -a /args -n1 bash -c 'rg -n foo'");
    expect(result).toMatchObject({
      stdout: "1:foo\n",
      stderr: "",
      exitCode: 123,
    });
  });
});
