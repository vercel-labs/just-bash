// Native GNU coreutils 9.7 and diffutils 3.10, exact bytes and statuses.
import { execFileSync } from "node:child_process";
import { afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import { Bash } from "../Bash.js";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("N2d diff du uniq od", () => {
  let testDir: string;
  beforeAll(() => {
    if (process.env.RECORD_FIXTURES === "force")
      for (const [name, version] of [
        ["od", "9.7"],
        ["du", "9.7"],
        ["uniq", "9.7"],
        ["diff", "3.10"],
      ]) {
        if (
          !execFileSync(name, ["--version"], { encoding: "utf8" })
            .split("\n")[0]
            .endsWith(version)
        )
          throw new Error(`Record with ${name} ${version}`);
      }
  });
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });
  const files = {
    f: "a\nb\nc\nd\ne\n",
    s: "a\nb\nC\nd\ne\n",
    empty: "",
    "a/same": "same\n",
    "b/same": "same\n",
    "a/sub/f": "old\n",
    "b/sub/f": "new\n",
    "a/only": "only\n",
    "b/other": "other\n",
    words: "a\na\nb\nc\nc\n",
  };
  const commands = [
    "diff -qr a a",
    "diff -rq a b",
    "diff --brief --recursive a b",
    "diff -r a b",
    "diff a b",
    "diff -rN a b",
    "diff -qrN a b",
    "diff --new-file missing f",
    "diff --label a --label b -u f s",
    "diff --label='old file' --label='new file' -U0 f s",
    "diff --label a --label b --unified=1 f s",
    "diff -U 2 --label a --label b f s",
    "diff -r -s a a",
    "diff --brief f s",
    "diff -q missing f; echo $?",
    "diff -z f s; echo $?",
    "diff --unknown f s; echo $?",
    "diff f s extra; echo $?",
    "diff -U-1 f s; echo $?",
    "ln -s a alias; diff -qr alias a",
    "diff -N empty missing",
    "diff f - < f",
    "diff -i f s",
    "du -h --max-depth=1 a | sort",
    "du -d 0 a",
    "du -d1 -k a | sort",
    "du -s a",
    "du -sh a",
    "du -s empty f",
    "du -c a b | sort",
    "du -hc a b | sort",
    "du -ah --max-depth=1 a | sort",
    "du -hk a | sort",
    "du -kh a | sort",
    "du -s -d1 a; echo $?",
    "du -d0 .",
    "du -d1 ./a | sort",
    "ln -s f link; du link",
    "uniq -c words",
    "uniq -cd words",
    "uniq -cu words",
    "printf AB | od",
    "printf hi | od -c",
    "printf 'hello\\n' | od -c",
    "printf A | od -An",
    "printf test | od",
    "printf abc | od -tx1",
    "printf abc | od -Ax -tx2",
    "printf abc | od -Ad -tu1",
    "printf abc | od -An -to1",
    "printf abc | od -An -tu2",
    "printf abc | od -An -tx2 -tc",
    "printf abc | od -An -tx1 -tu1",
    "printf abc | od -An -tx1c",
    "printf 'a\\000b\\t\\177' | od -An -tc",
    "od -j2 -N4 -tx1 f",
    "od --skip-bytes=2 --read-bytes=4 --format=x1 --address-radix=n f",
    "od -j012 -N3 -tx1 f s",
    "od -j0x2 -N0x3 -tx1 f",
    "od -N0 f",
    "od -tx1 empty",
    "od -j999 f; echo $?",
    "printf '%s' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | od -tx1",
    "printf '%s' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | od -v -tx1",
    "printf A > x; printf B > y; od x y",
    "printf A > x; printf B > y; printf X | od x - y",
  ];
  for (const command of commands)
    it(command, async () => {
      const base = await setupFiles(testDir, files);
      const env = new Bash({
        fs: base.fs,
        cwd: testDir,
        virtualFileMetadata: { directorySize: 4096, allocationBlockSize: 4096 },
      });
      await compareOutputs(env, testDir, command, { compareStderr: true });
    });
});
