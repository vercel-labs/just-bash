import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("prefix bindings - Real Bash Comparison", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it.each([
    "TEMP=0; TEMP=one TEMP=two :; echo $TEMP",
    "TEMP=0; TEMP=one TEMP=$((TEMP=5)) :; echo $TEMP",
    "TEMP=0; TEMP=5 TEMP=$((TEMP=5)) :; echo $TEMP",
    'TEMP=original; TEMP=prefix echo "$TEMP"; echo "$TEMP"',
    'TEMP=out; TEMP=prefix echo "$TEMP" >"$TEMP"; cat out; echo "$TEMP"',
    'TEMP=$((OTHER=1)) echo ok >&"$OTHER"',
    'f() { echo "$TEMP"; }; TEMP=old; TEMP=prefix f >&"$((TEMP=1))"; echo "$TEMP"',
    'TEMP=old; TEMP=prefix cat /dev/null >&"$((TEMP=1))"; echo "$TEMP"',
    'TEMP=old; TEMP=prefix printenv TEMP >&"$((TEMP=1))"; echo "$TEMP"',
    'f() { echo "$TEMP"; }; TEMP=out; TEMP=prefix f >"$TEMP"; cat out; echo "$TEMP"',
    'echo() { printf "%s\\n" "$TEMP"; }; TEMP=old; TEMP=prefix echo >&"$((TEMP=1))"; printf "%s\\n" "$TEMP"',
    'TEMP=old; TEMP=prefix command cat /dev/null >&"$((TEMP=1))"; echo "$TEMP"',
    'cat /dev/null >&"$((OTHER=1))"; printf "<%s>\\n" "${OTHER-unset}"',
    'TEMP=0; TEMP=1 echo ok >&"$((TEMP=1))"; echo "$TEMP"',
    'a=(0 keep); a=(1) echo ok >&"$((a[0]=1))"; printf "<%s>\\n" "${a[@]}"',
    'a=(old); a=("$((a[0]=5))") :; printf "array=<%s>\\n" "${a[0]}"',
    'a=(old keep); a=(temp) a=("$((a[1]=5))") :; printf "<%s>\\n" "${a[@]}"',
    'TEMP=(original); TEMP=(one) :; printf "[%s]\\n" "${TEMP[@]}"',
    'v=outer; TMP=$(v=inner) :; echo "$v"',
    'a=(outer); TMP=$(a[0]=inner) :; echo "${a[0]}"',
    'V=$(echo a)$((Y=1)) :; echo "$Y"',
    'Y=0; Y=temporary V=$(echo a)$((Y=1)) :; echo "$Y"',
    'Y=0; Y=1 V=$(echo a)$((Y=1)) :; echo "$Y"',
    'a=(outer keep); a=(temp) V=$(echo a)$((a[1]=5)) :; printf "<%s>\\n" "${a[@]}"',
    'v=outer; TMP=<(v=inner) :; echo "$v"',
    'v=outer; TMP=$(v=inner; exit) :; echo "$v"',
    'v=outer; TMP=$(v=inner; echo "$(v=nested)") :; echo "$v"',
    'shopt -s extglob\nv=outer; a=(@($(v=inner; echo x))) :; printf "v=<%s>\\n" "$v"',
    // Locked fixture observed with Bash 5.3.20; macOS Bash 3.2 lacks -A.
    'declare -A a=([key]=value); a=(temp) unset a; printf "lookup=<%s>\\n" "${a[key]}"',
  ])("preserves underlying state for %s", async (script) => {
    const bash = await setupFiles(testDir, {});
    await compareOutputs(bash, testDir, script);
  });
});
