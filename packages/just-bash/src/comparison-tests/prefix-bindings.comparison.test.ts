import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("prefix binding cleanup - Real Bash Comparison", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it.each([
    // Assignment-only commands own both their values and RHS effects.
    'TEMP=${OTHER:=5}; printf "<%s>:<%s>\\n" "$TEMP" "$OTHER"',
    // Argument expansion precedes prefix evaluation; repeated prefixes still
    // distinguish literal replacement from an explicit same-value assignment.
    "TEMP=0; TEMP=one TEMP=two :; echo $TEMP",
    "TEMP=0; TEMP=one TEMP=$((TEMP=5)) :; echo $TEMP",
    "TEMP=0; TEMP=5 TEMP=$((TEMP=5)) :; echo $TEMP",
    'TEMP=original; TEMP=prefix echo "$TEMP"; echo "$TEMP"',
    'TEMP=old; TEMP=prefix cat /dev/null >&"$((TEMP=1))"; echo "$TEMP"',
    'a=(old keep); f() { unset a; a=(new more); }; a=(temp) f; printf "after=<%s>\\n" "${a[@]}"',
    'a=(old keep); f() { OUT=$(unset a; a[0]=new); }; a=(temp) f; printf "after=<%s>\\n" "${a[@]}"',
    'TEMP=old; f() { TEMP=$((TEMP=5)) return; }; f; echo "$TEMP"',
    'TEMP=old; for i in 1; do TEMP=$((TEMP=5)) break; done; echo "$TEMP"',
    'TEMP=old; for i in 1; do TEMP=$((TEMP=5)) continue; done; echo "$TEMP"',
    'TEMP=original; TEMP=$((TEMP=5)) :; echo "$TEMP"; TEMP=$((TEMP=6)) echo command; echo "$TEMP"',
    // Array RHS writes preserve only the affected underlying elements.
    'a=(old); a=("$((a[0]=5))") :; printf "array=<%s>\\n" "${a[0]}"',
    'a=(old keep); a=(temp) a=("$((a[1]=5))") :; printf "<%s>\\n" "${a[@]}"',
    'TEMP=(original); TEMP=(one) :; printf "[%s]\\n" "${TEMP[@]}"',
    // Substitutions own their writes; parent expansion resumes afterward.
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
