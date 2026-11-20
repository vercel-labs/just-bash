// Automa N2a: native GNU findutils 4.10.0 and coreutils 9.7 recordings.
import { execFileSync } from "node:child_process";
import { afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("N2a find, xargs and wc compatibility", () => {
  let testDir: string;
  beforeAll(() => {
    if (process.env.RECORD_FIXTURES === "force") {
      for (const [tool, version] of [
        ["find", "4.10.0"],
        ["xargs", "4.10.0"],
        ["wc", "9.7"],
      ]) {
        if (
          !execFileSync(tool, ["--version"], { encoding: "utf8" })
            .split("\n")[0]
            .endsWith(version)
        ) {
          throw new Error(`Record N2a with ${tool} ${version}`);
        }
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
    "d/g.ts": "type\n",
    "d/e": "a\n",
    args: "f.txt s.txt\n",
    "stdin-args": "-\n",
  };
  const commands = [
    "find . -mmin -60 -type f -name f.txt",
    "find . -mtime 0 -type f -name f.txt",
    "find . -mindepth 1 -not -ipath '*.TS' -type f | sort",
    "find . -mindepth 1 ! -ipath '*.TS' -type f | sort",
    "find . -name f.txt -quit -print",
    "find . -print -quit",
    "find . ! -quit -print",
    "find . -quit -o -print",
    "find . missing -quit",
    "find d -depth -name g.ts -print -quit",
    "find f.txt s.txt -exec echo {} + -quit",
    "find f.txt s.txt -printf '%p|%s|%f|%h|%y|%m\\n'",
    "ln -s f.txt link; find link d -maxdepth 0 -printf '%p|%y\\n'",
    "TZ=UTC touch -d '2020-01-01T00:00:00Z' f.txt; TZ=UTC find f.txt -printf '%T@|%TY-%Tm-%Td\\n'",
    "touch -d 2000-01-01 f.txt; find f.txt s.txt -newer f.txt",
    "touch -d 2000-01-01 f.txt; find f.txt s.txt -newermt 2000-01-02",
    "touch -d '2020-01-01T00:00:00Z' f.txt; TZ=Asia/Shanghai find f.txt -newermt '2020-01-01 07:59:59'",
    "touch -d '2020-01-01T00:00:00Z' f.txt; TZ=Asia/Shanghai find f.txt -newermt '2020-01-01 08:00:00'",
    "printf 'a b c' | xargs -n2",
    "xargs -a args echo",
    "xargs -aargs -n1 echo",
    "xargs --arg-file=args echo",
    "xargs --arg-file args echo",
    "printf ignored | xargs -a args echo",
    "printf payload | xargs -a stdin-args -n1 cat",
    "printf 'a b' | xargs -a - echo",
    "printf 'f.txt' | xargs -t wc -l 2>&1",
    "printf '' | xargs",
    "printf '' | xargs -r echo suppressed",
    "printf 'a:b:c\\n' | xargs -d : echo",
    "printf 'a::b\\n' | xargs -d : echo",
    "printf 'a:b:c:d:e\\n' | xargs -d : -n2 echo",
    "printf 'x:y:z\\n' | xargs -d : -I{} echo 'item: {}'",
    "printf 'hello world:foo bar:test\\n' | xargs -d : -n1 echo",
    "printf 'a\\0\\0b\\0' | xargs -0 -n1 printf '<%s>\\n'",
    "printf 'a b' | xargs -n1 false",
    "printf 'a b' | xargs -P2 -n1 false",
    "printf 'a b' | xargs -n1 bash -c 'exit 255'",
    "printf 'a b' | xargs -P0 -n1 echo",
    "wc -l f.txt s.txt",
    "wc -c f.txt s.txt",
    "wc f.txt s.txt",
    "wc -lm f.txt s.txt",
    "printf 'f.txt\\0s.txt\\0' | xargs -0 wc -c | tail -1",
  ];
  for (const command of commands) {
    it(command, async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(env, testDir, command);
    });
  }
});
