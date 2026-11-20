// Automa N2b: native GNU coreutils 9.7 recordings; no timestamp/owner normalization.
import { execFileSync } from "node:child_process";
import { afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("N2b date and stat compatibility", () => {
  let testDir: string;
  beforeAll(() => {
    if (process.env.RECORD_FIXTURES === "force") {
      for (const tool of ["date", "stat"]) {
        if (
          !execFileSync(tool, ["--version"], { encoding: "utf8" })
            .split("\n")[0]
            .endsWith("9.7")
        )
          throw new Error(`Record with ${tool} 9.7`);
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
    "f.txt": "one\ntwo\n",
    "s.txt": "x y\n",
    empty: "",
    "d/g.ts": "type\n",
  };
  const commands = [
    "stat --format='%F' d",
    "stat --format '%F|%a|%A|%s|%n|%h' f.txt",
    "stat --printf='%F|%a|%A|%s|%n|%h\\n' f.txt s.txt empty",
    "stat --printf='%n\\t%s\\n' f.txt s.txt",
    "stat --printf='%n\\0' f.txt | od -An -t x1",
    "stat --printf='\\377\\0%n' f.txt | od -An -t x1",
    "stat --format='' f.txt",
    "stat --printf='' f.txt",
    "stat --printf='[%n]' --format='%s' f.txt",
    "stat --format='%s' --printf='[%n]' f.txt",
    "stat --format='%% %n %q' f.txt",
    "chmod 4751 f.txt; stat --format='%a|%A' f.txt",
    "ln -s f.txt link; stat --format='%F|%A|%h' link",
    "ln -s f.txt link; stat -L --format='%F|%s' link",
    "stat --format='%F' missing f.txt",
    "TZ=UTC touch -d '2020-01-01T00:00:00.125Z' f.txt; TZ=UTC stat --format='%Y|%y' f.txt",
    "TZ=UTC touch -d '2020-01-01T00:00:00.125Z' f.txt; TZ=Asia/Shanghai stat --printf='%Y|%y\\n' f.txt",
    "touch -d '2020-01-01T00:00:00Z' f.txt; TZ=UTC date -r f.txt +%Y",
    "touch -d '2020-01-01T00:00:00.125Z' f.txt; TZ=Asia/Shanghai date --reference=f.txt '+%Y-%m-%d %H:%M:%S.%N %z'",
    "date -r missing +%Y",
    ...["UTC", "Asia/Shanghai"].flatMap((tz) => [
      `TZ=${tz} date -d @0 '+%Y-%m-%d %H:%M:%S %z'`,
      `TZ=${tz} date -d @-1 '+%s %F %T'`,
      `TZ=${tz} date -d @-0.5 '+%s %N'`,
      `TZ=${tz} date -d 2020-01-01 '+%s %F %T %z'`,
      `TZ=${tz} date -u -d 2020-01-01 '+%s %F %T %z'`,
      `TZ=${tz} date -d @0 -I`,
      `TZ=${tz} date -d @0 --iso-8601`,
      `TZ=${tz} date -d @0 -Iseconds`,
      `TZ=${tz} date -d @0 --iso-8601=hours`,
      `TZ=${tz} date -d @0 --iso-8601=minutes`,
      `TZ=${tz} date -d @0.125 --iso-8601=ns`,
      `TZ=${tz} date -d @0 -R`,
      `TZ=${tz} date -d 2020-02-30 +%s`,
      `TZ=${tz} date -d @0 +`,
    ]),
  ];
  for (const command of commands) {
    it(command, async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(env, testDir, command);
    });
  }
});
