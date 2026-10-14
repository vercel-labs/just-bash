import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

// Locked stream-device fixtures use Linux reopen semantics, not macOS fd duplication.
// Linux open(2) creates an independent offset and honors O_TRUNC:
// https://man7.org/linux/man-pages/man2/open.2.html
describe("file output offsets - Real Bash Comparison", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(directory);
  });
  it.each([
    '{ x=$(echo hi); echo "[$x]"; } >f; cat f',
    '{ x=`echo hi`; echo "[$x]"; } >f; cat f',
    "{ cat <(echo hi) >g; echo outer; } >f; cat f; cat g",
    'fun() { x=$(echo hi; echo side >&2); echo "[$x]"; }; fun >f 2>&1; cat f',
    '{ for i in $(seq 1 2); do echo "[$i]"; done; } >f; cat f',
    '{ x=$(echo hi; echo side >&3); echo "[$x]"; } >f 3>&1; cat f',
    '{ x=$(echo hi; exit 2); echo "[$x]"; } >f; cat f',
    "printf éé >f; exec 3<>f; printf X >&3; printf Y >&3; cat f",
    "printf 'é\nZZ' >f; exec 3<>f; read -r -u3 x; printf XY >&3; echo \"[$x]\"; cat f",
    "printf 'é\nZZ' >f; exec 3<>f; read -r x <&3; printf XY >&3; echo \"[$x]\"; cat f",
    "exec 4>&1; exec >f; exec 2>/dev/stdout; echo e >&2; exec >&4; cat f; cat f",
    "{ echo a; echo b >&3; } >f 2>/dev/stdout 3>&2; cat f",
    "exec 4>&1; exec >f; exec 3>/dev/stdout; exec >&4; echo b >&3; cat f; cat f",
    "{ echo a; echo b >&3; } >f 3>/dev/stdout; cat f",
    "{ echo a >&2; echo b >&3; } 2>f 3>/dev/stderr; cat f",
    "exec 2>f; exec 3>/dev/stderr; exec 2>/dev/null; echo b >&3; cat f; cat f",
    "echo hi >/dev/stderr 2>/dev/null",
    "{ echo a; echo b >&3; } >f 3>&1; cat f",
    "exec 9>&1; exec 1>f; exec 3>&1; { exec 3>g; echo x; } >h; echo y; cat f >&9",
    "{ echo a; echo b >&3; } >f 2>&1 3>&2; cat f",
    "{ echo oooo; echo e >&2; } >f 2>f; cat f",
    "exec 3>f; echo one >&3; echo two >&3; exec 3>&-; cat f",
    "printf abcdef >f; { echo X; echo Y >&2; } 1<>f 2>&1; cat f",
    "echo a >>f; { echo b; echo c >&3; } >>f 3>&1; cat f",
    "{ echo abc | tr a-z A-Z; } >f; cat f",
  ])("%s", async (script) => {
    const bash = await setupFiles(directory, {});
    await compareOutputs(bash, directory, script);
  });
});
