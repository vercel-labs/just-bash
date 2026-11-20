// Automa N2a: GNU xargs 4.10.0, head/coreutils 9.7 and Bash 5.2.37.
import { execFileSync } from "node:child_process";
import { afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("xargs argument-file child stdin compatibility", () => {
  let testDir: string;
  beforeAll(() => {
    if (process.env.RECORD_FIXTURES === "force") {
      for (const [tool, version] of [
        ["xargs", "4.10.0"],
        ["head", "9.7"],
      ]) {
        if (
          !execFileSync(tool, ["--version"], { encoding: "utf8" })
            .split("\n")[0]
            .endsWith(version)
        )
          throw new Error(`Record with ${tool} ${version}`);
      }
    }
  });
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });
  const files = {
    args: "one two\n",
    cats: "-\n-\n",
    heads: "-c2\n-c2\n",
    other: "OTHER",
  };
  const cases = [
    ["printf payload | xargs -a cats -n1 cat", "payload"],
    ["printf abcdef | xargs -a heads -n1 head", "abcd"],
    [
      "printf abcdef | xargs -a args -n1 bash -c 'read -r -n 2 x; echo \"$x\"'",
      "ab\ncd\n",
    ],
    [
      "printf payload | xargs -a args -n1 bash -c 'if [ \"$0\" = one ]; then echo skip; else cat; fi'",
      "skip\npayload",
    ],
    [
      "printf payload | xargs -a args -n1 bash -c 'if [ \"$0\" = one ]; then cat <other; else cat; fi'",
      "OTHERpayload",
    ],
    [
      "printf abcdef | xargs -a args -n1 bash -c 'exec 3<&0; read -r -n 2 x <&3; echo \"$x\"'",
      "ab\ncd\n",
    ],
    ["printf '__file__:/secret' | xargs -a cats -n1 cat", "__file__:/secret"],
    [
      'printf abcdef | xargs -a args -n1 bash -c \'exec {fd}<&0; read -r -u "$fd" -n2 x; echo "$x"\'',
      "ab\ncd\n",
    ],
    [
      "printf abcdef | xargs -a args -n1 bash -c 'exec 0<&0; read -r -n2 x; echo \"$x\"'",
      "ab\ncd\n",
    ],
    [
      "printf abcdef | xargs -a args -n1 bash -c 'exec 3<&0; exec 0<&-; read -r -u3 -n2 x; echo \"$x\"'",
      "ab\ncd\n",
    ],
    [
      "printf abcdef | xargs -a args -n1 bash -c 'read -r -n2 x; echo \"$x\"; exit 0'",
      "ab\ncd\n",
    ],
    [
      "printf payload | xargs -a args -n1 bash -c 'printf x | cat; cat'",
      "xpayloadx",
    ],
    [
      "printf payload | xargs -a args -n1 bash -c 'printf x | { cat; }; cat'",
      "xpayloadx",
    ],
    [
      "printf payload | xargs -a args -n1 bash -c '{ cat; } <other; cat'",
      "OTHERpayloadOTHER",
    ],
    ["printf abcdef | xargs -a args -n1 bash -c '(head -c2)'", "abcd"],
    ["printf abcdef | xargs -a args -n1 bash -c 'head -c2; cat'", "abcdef"],
  ];
  for (const [command] of cases) {
    it(command, async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(env, testDir, command);
    });
  }
});
