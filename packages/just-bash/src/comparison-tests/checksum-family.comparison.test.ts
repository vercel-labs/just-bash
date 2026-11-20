// Automa modifications: N5b frozen GNU coreutils checksum fixtures.
import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("N5b checksum family GNU coreutils", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });
  for (const [command, width] of [
    ["sha224sum", 56],
    ["sha384sum", 96],
    ["sha512sum", 128],
    ["b2sum", 128],
  ] as const) {
    const files = {
      data: "hello\n",
      empty: "",
      中文: "中文 é\n",
      "back\\slash": "back",
      "line\nname": "line",
      "--help": "operand",
    };
    const cases = [
      `${command} data empty 中文; ${command} -b data; ${command} -- --help`,
      `printf '\\000\\377abc' | ${command} - -`,
      `${command} data 'back\\slash' 'line\nname' > sums; ${command} -c sums`,
      `${command} data | ${command} -c`,
      `${command} empty | sed 's/empty$/-/' | ${command} -c`,
      `${command} missing data 2>&1 | cat`,
      `${command} -c empty; ${command} -c malformed`,
      `${command} -c bad; ${command} -c missing good`,
    ];
    for (const [index, script] of cases.entries())
      it(`${command} native case ${index}`, async () => {
        const env = await setupFiles(testDir, {
          ...files,
          malformed: "bad input\n",
          bad: `${"0".repeat(width)}  data\n${"0".repeat(width)}  missing\nbad input\n`,
          good: "# comment\n",
        });
        await compareOutputs(env, testDir, script);
      });
  }
});
