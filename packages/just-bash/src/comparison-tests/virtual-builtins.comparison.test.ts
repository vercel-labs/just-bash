import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("Bash 5.2 virtual builtin semantics", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(directory);
  });
  const cases = [
    ["mask output", "umask 077; umask; umask -p; umask -S; umask -pS"],
    [
      "mask symbolic",
      "umask 022; umask u=rwx,g=rx,o=; umask; umask u-w; umask; umask a=rx; umask",
    ],
    [
      "mask new files",
      "umask 077; touch first; echo text >second; mkdir parent; stat -c %a first second parent",
    ],
    [
      "mask existing files",
      "umask 022; touch first; umask 077; echo changed >first; echo more >>first; stat -c %a first",
    ],
    [
      "mask subshell",
      "umask 077; (umask 002; umask); umask; value=$(umask 007; umask); echo $value; umask",
    ],
    [
      "mask child shell",
      "umask 077; bash -c 'umask; umask 000'; umask; env -i bash -c 'umask'",
    ],
    [
      "mask pipeline",
      "umask 077; umask 002 | cat; umask; echo ignored | umask 027; umask; shopt -s lastpipe; echo ignored | umask 027; umask",
    ],
    ["mask process substitution", "umask 077; cat <(umask 007; umask); umask"],
    [
      "mask private temporary entries",
      'umask 777; f=$(mktemp ./file.XXXXXX); d=$(mktemp -d ./dir.XXXXXX); stat -c %a "$f" "$d"; chmod 700 "$d"',
    ],
    ["mask function", "umask 022; f() { umask 027; }; f; umask"],
    ["mask terminator", "umask -- 000; umask; umask 002 ignored; umask"],
    [
      "mask invalid arguments",
      "umask -z 2>/dev/null; echo option:$?; umask 089 2>/dev/null; echo octal:$?; umask bad 2>/dev/null; echo symbolic:$?",
    ],
    [
      "mask copy defaults",
      "umask 022; mkdir src; touch src/file; chmod 750 src; chmod 664 src/file; umask 077; cp -r src copy; cp -a src archive; stat -c %a copy copy/file archive archive/file",
    ],
    [
      "mask explicit modes",
      "umask 077; mkdir -m 755 explicit; mkdir -p -m 750 parent/child; stat -c %a explicit parent parent/child",
    ],
    [
      "mask recursive parents retain owner access",
      "umask 777; mkdir -p p/c; stat -c %a p p/c; chmod 700 p p/c",
    ],
    [
      "mask recursive explicit leaf mode",
      "umask 777; mkdir -p -m 710 p/c; stat -c %a p p/c; chmod 700 p p/c",
    ],
    [
      "mask recursive existing parent mode",
      "mkdir -m 751 p; umask 777; mkdir -p -m 710 p/c; stat -c %a p p/c; chmod 700 p p/c",
    ],
    ["limit query shape", "ulimit -a | sed -E 's/ [0-9]+$/ unlimited/'"],
    ["limit selectors", "ulimit -t; ulimit -St; ulimit -Ht; ulimit -tv"],
    ["limit invalid option", "ulimit -Z 2>/dev/null; echo status:$?"],
    ["signal listing", "kill -l"],
    ["signal zero and lowercase names", "kill -l 0 128 EXIT term sigint"],
    ["signal names", "kill -l TERM SIGINT 9 143 RTMIN RTMAX 64 IOT CLD POLL"],
    [
      "signal zero own",
      "kill -0 $$; echo own:$?; (kill -0 $BASHPID; echo sub:$?)",
    ],
    [
      "signal invalid",
      "kill -l missing 2>/dev/null; echo name:$?; kill -z 12345 2>/dev/null; echo option:$?; kill -0 hello 2>/dev/null; echo pid:$?",
    ],
  ];
  for (const [name, command] of cases)
    it(name, async () => {
      const env = await setupFiles(directory, {});
      await compareOutputs(env, directory, command);
    });
});
