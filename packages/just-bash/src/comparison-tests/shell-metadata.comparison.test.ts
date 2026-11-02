import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("Bash 5.2 shell metadata and small builtins", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(directory);
  });

  const cases = [
    ["version declarations", "declare -p BASH_VERSION BASH_VERSINFO"],
    [
      "version indexed expansion",
      'printf "%s\\n" "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}" "${BASH_VERSINFO[@]}"',
    ],
    [
      "version scalar is writable",
      'BASH_VERSION=custom; declare -p BASH_VERSION; unset BASH_VERSION; echo "${BASH_VERSION-unset}"',
    ],
    [
      "version array is readonly",
      '(BASH_VERSINFO[0]=9) 2>/dev/null; echo $?; unset BASH_VERSINFO 2>/dev/null; echo $?; echo "${BASH_VERSINFO[0]}"',
    ],
    [
      "readonly array declarations",
      "declare -ar a=(x y); declare -p a; declare -a empty=(); readonly empty; declare -p empty",
    ],
    [
      "version child shell startup",
      "BASH_VERSION=custom; export BASH_VERSION; bash -c 'declare -p BASH_VERSION BASH_VERSINFO'; env -i bash -c 'echo \"$BASH_VERSION:${BASH_VERSINFO[0]}\"'",
    ],
    [
      "nounset exit",
      'set -u; echo before; echo "$AUTOMA_UNSET_N8"; echo after',
    ],
    [
      "nounset function",
      'set -u; f() { echo "$AUTOMA_UNSET_N8"; }; f; echo after',
    ],
    ["nounset eval", "set -u; eval 'echo \"$AUTOMA_UNSET_N8\"'; echo after"],
    [
      "nounset subshell",
      'set -u; (echo "$AUTOMA_UNSET_N8"); echo "subshell:$?"',
    ],
    [
      "nounset substitution",
      'set -u; v=$(echo "$AUTOMA_UNSET_N8"); echo "substitution:$?"',
    ],
    [
      "nounset grouped loop",
      'set -u; for x in one two; do { echo before; echo "$AUTOMA_UNSET_N8"; }; done; echo after',
    ],
    [
      "nounset grouped subshell",
      'set -u; ({ echo before; echo "$AUTOMA_UNSET_N8"; }; echo after); echo "subshell:$?"',
    ],
    [
      "nounset child shell",
      'bash -c \'set -u; echo "$AUTOMA_UNSET_N8"; echo after\'; echo "child:$?"',
    ],
    [
      "nounset exit trap",
      'trap \'echo "exit:$?"\' EXIT; set -u; echo "$AUTOMA_UNSET_N8"; echo after',
    ],
    [
      "caller outside stack",
      'caller; echo "empty:$?"; caller 0; echo "zero:$?"; caller 99; echo "range:$?"',
    ],
    [
      "caller function stack",
      'inner() { caller; caller 0; caller 1; caller 2; echo "end:$?"; }\nouter() { inner; }\nouter',
    ],
    [
      "caller arguments",
      'f() { caller nope; echo "invalid:$?"; caller -1; echo "negative:$?"; caller 0 extra; echo "extra:$?"; caller --; echo "dash:$?"; }\nf',
    ],
    [
      "caller numeric arguments",
      'inner() { caller +0; caller 00; caller -- -1; echo "negative:$?"; caller 0x0; echo "hex:$?"; caller 999999999999999999999; echo "overflow:$?"; }\nouter() { inner; }\nouter',
    ],
    [
      "hash reset",
      'hash -p /synthetic/tool example; hash -t example; hash -r; hash -t example 2>/dev/null; echo "status:$?"',
    ],
    ["printf year", "TZ=UTC printf '%(%Y)T\\n' 0"],
    ["times shape", "times | sed -E 's/[0-9]+m[0-9]+\\.[0-9]+s/TIME/g'"],
    [
      "times arguments",
      "times -- extra | sed -E 's/[0-9]+m[0-9]+\\.[0-9]+s/TIME/g'; times -z 2>/dev/null; echo status:$?",
    ],
  ];
  for (const [name, command] of cases)
    it(name, async () => {
      const env = await setupFiles(directory, {});
      await compareOutputs(env, directory, command);
    });

  it("caller through sourced files", async () => {
    const env = await setupFiles(directory, {
      "outer.sh": "f() { caller; caller 0; caller 1; }\n. ./inner.sh\n",
      "inner.sh": "caller; caller 0; f\n",
    });
    await compareOutputs(env, directory, ". ./outer.sh");
  });

  it("nounset in a source aborts the shell", async () => {
    const env = await setupFiles(directory, {
      "unset.sh": 'echo "$AUTOMA_UNSET_N8"; echo after-file\n',
    });
    await compareOutputs(
      env,
      directory,
      "set -u; . ./unset.sh; echo after-source",
    );
  });
});
