// Automa N2c: native GNU coreutils 9.7 recordings. Random names tested by shape/effects.
import { execFileSync } from "node:child_process";
import { afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("N2c file commands", () => {
  let testDir: string;
  beforeAll(() => {
    if (process.env.RECORD_FIXTURES === "force")
      for (const tool of ["cp", "mkdir", "mktemp", "ln"]) {
        if (
          !execFileSync(tool, ["--version"], { encoding: "utf8" })
            .split("\n")[0]
            .endsWith("9.7")
        )
          throw new Error(`Record with ${tool} 9.7`);
      }
  });
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });
  const files = {
    f: "one\ntwo\n",
    s: "x y\n",
    "d/e": "e\n",
    "d/g.ts": "type\n",
  };
  const commands = [
    "cp -a d d2; ls d2",
    "cp -dR --preserve=all d d2; ls d2",
    "cp -n f s; cat s; echo $?",
    "cp --no-clobber f s; cat s",
    "chmod 640 f; touch -d '2020-01-01T00:00:00Z' f; cp -p f copy; stat -c '%a %Y' copy",
    "chmod 640 f; chmod 600 s; cp f s; stat -c %a s",
    "touch -d '2000-01-01T00:00:00Z' f; cp -u f s; cat s",
    "touch -d '2000-01-01T00:00:00Z' s; cp -u f s; cat s",
    "cp -v f copy",
    "mkdir out; cp -v -t out f s",
    "mkdir out; cp --target-directory=out f s; ls out",
    "cp -aT d d2; ls d2",
    "mkdir out; cp -a d out; ls out/d",
    "mkdir out; cp -aT d out; ls out",
    "mkdir out; cp -rn d out; printf changed > d/e; cp -rn d out; cat out/d/e",
    "ln -s f link; cp link copy; stat -c '%F %s' copy",
    "ln -s missing link; cp -d link copy; readlink copy",
    "ln -s d alias; cp f alias/copy; cat d/copy",
    "ln -s d alias; cp alias/e copy; cat copy",
    "mkdir -m 700 m; stat -c %a m",
    "mkdir --mode=750 m; stat -c %a m",
    "mkdir -m u=rwx,g=rx,o= m; stat -c %a m",
    "mkdir -m +X m; stat -c %a m",
    "mkdir -v m",
    "mkdir -pv new/a new/b",
    "mkdir -pv ./new/a",
    "mkdir -p -m700 d; stat -c %a d",
    "mkdir -p -m700 new/child; stat -c %a new new/child",
    'p=$(mktemp -d); test -d "$p" && stat -c %a "$p"',
    'p=$(mktemp -p . x.XXXX); case "$p" in ./x.????) echo matched;; esac; stat -c %a "$p"',
    'p=$(mktemp --tmpdir=. x.XXXX); case "$p" in ./x.????) echo matched;; esac; test -f "$p" && echo file',
    'p=$(TMPDIR=. mktemp --tmpdir x.XXXX); case "$p" in ./x.????) echo matched;; esac',
    'p=$(TMPDIR=. mktemp -t x.XXXX); case "$p" in ./x.????) echo matched;; esac',
    'p=$(mktemp -u -p . x.XXXX); test ! -e "$p" && echo absent',
    "ln -sf f link; ln -sf s link; readlink link",
    "ln -s missing link; ln -sf f link; readlink link",
    "ln -s d link; ln -s f link; readlink d/f",
    "ln -s d link; ln -sfn f link; readlink link; test -d d && echo kept",
    "ln -sr f d/link; readlink d/link; cat d/link",
    "ln --symbolic --relative missing d/link; readlink d/link",
    "ln -srv f d/link",
    "ln -s d alias; ln -sr f alias/link; readlink d/link",
    "ln -sn f d; readlink d/f",
  ];
  for (const command of commands)
    it(command, async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(env, testDir, command);
    });
});
