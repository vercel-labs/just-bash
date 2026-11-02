// Automa N2c: native GNU coreutils 9.7 mode and overwrite behavior.
import { execFileSync } from "node:child_process";
import { afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("N2c shared file modes", () => {
  let testDir: string;
  beforeAll(() => {
    if (
      process.env.RECORD_FIXTURES === "force" &&
      !execFileSync("chmod", ["--version"], { encoding: "utf8" })
        .split("\n")[0]
        .endsWith("9.7")
    )
      throw new Error("Record with chmod 9.7");
  });
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });
  const files = { f: "old\n", "d/a": "x" };
  for (const command of [
    "chmod 644 f; chmod a+X f; stat -c %a f",
    "chmod 744 f; chmod a+X f; stat -c %a f",
    "chmod 755 f; chmod a-x,a+X f; stat -c %a f",
    "chmod 644 f; chmod au+x f; stat -c %a f",
    "chmod 644 f; chmod u+t f; stat -c %a f",
    "chmod 644 f; chmod o+t f; stat -c %a f",
    "chmod 644 d; chmod +X d; stat -c %a d",
    "chmod 777 f; chmod u=rw,g=r,o= f; stat -c %a f",
    "chmod 640 f; printf new >f; stat -c %a f",
    "chmod 750 f; sed -i s/old/new/ f; stat -c %a f",
    "chmod 600 f; : >f; stat -c %a f",
  ]) {
    it(command, async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(env, testDir, command);
    });
  }
});
