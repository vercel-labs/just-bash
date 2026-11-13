import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("export command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("direct script inheritance", () => {
    it.each([
      [
        "arithmetic assignment respects allexport",
        "set -a; (( JB_EXPORTED=7 )); set +a; ./probe.sh",
      ],
      [
        "arithmetic expansion respects allexport",
        "set -a; : $(( JB_EXPORTED=7 )); set +a; ./probe.sh",
      ],
      [
        "arithmetic increment respects allexport",
        "JB_EXPORTED=1; set -a; (( ++JB_EXPORTED )); set +a; ./probe.sh",
      ],
      [
        "arithmetic post-increment respects allexport",
        "JB_EXPORTED=1; set -a; (( JB_EXPORTED++ )); set +a; ./probe.sh",
      ],
      [
        "let respects allexport",
        "set -a; let JB_EXPORTED=7; set +a; ./probe.sh",
      ],
      [
        "printf -v respects allexport",
        "set -a; printf -v JB_EXPORTED %s value; set +a; ./probe.sh",
      ],
      [
        "readonly assignment respects allexport",
        "set -a; readonly JB_EXPORTED=value; set +a; ./probe.sh",
      ],
      [
        "readonly append respects allexport",
        "JB_EXPORTED=first; set -a; readonly JB_EXPORTED+=second; set +a; ./probe.sh",
      ],
      [
        "default parameter assignment respects allexport",
        'set -a; : "${JB_EXPORTED:=value}"; set +a; ./probe.sh',
      ],
      [
        "arithmetic keeps older locals hidden",
        "JB_LOCAL=secret; set -a; (( JB_EXPORTED=7 )); set +a; ./probe.sh",
      ],
      ["env assignments reach the script", "env JB_EXPORTED=value ./probe.sh"],
      [
        "env -i assignments reach the script",
        "env -i JB_EXPORTED=value ./probe.sh",
      ],
      [
        "env keeps parent locals hidden",
        "JB_LOCAL=secret; env JB_EXPORTED=value ./probe.sh",
      ],
      [
        "read respects allexport",
        "set -a; read JB_EXPORTED <<<'value'; set +a; ./probe.sh",
      ],
      [
        "read -N respects allexport",
        "set -a; read -N 5 JB_EXPORTED <<<'value'; set +a; ./probe.sh",
      ],
      [
        "read -n respects allexport",
        "set -a; read -n 5 JB_EXPORTED <<<'value'; set +a; ./probe.sh",
      ],
      [
        "for respects allexport",
        "set -a; for JB_EXPORTED in value; do :; done; set +a; ./probe.sh",
      ],
      [
        "allexport leaves older locals hidden",
        "JB_LOCAL=secret; set -a; read JB_EXPORTED <<<'value'; set +a; ./probe.sh",
      ],
      [
        "only exported variables reach the script",
        "JB_LOCAL=local; export JB_EXPORTED=exported; ./probe.sh",
      ],
      [
        "prefix assignments reach the script",
        'JB_LOCAL=parent; JB_EXPORTED=temporary ./probe.sh; echo "[$JB_LOCAL] [$JB_EXPORTED]"',
      ],
      [
        "export -n hides a variable",
        "export JB_LOCAL=local; export -n JB_LOCAL; ./probe.sh",
      ],
      [
        "PATH lookup also isolates variables",
        "JB_LOCAL=local; export JB_EXPORTED=exported; PATH=.:$PATH probe.sh",
      ],
      [
        "sourced scripts still see local variables",
        "JB_LOCAL=local; source ./probe.sh",
      ],
    ])("%s", async (_name, command) => {
      const env = await setupFiles(testDir, {
        "probe.sh":
          '#!/bin/bash\nprintf "[%s] [%s]\\n" "$JB_LOCAL" "$JB_EXPORTED"\n',
      });
      await compareOutputs(
        env,
        testDir,
        `chmod +x probe.sh; ${command}`,
        undefined,
        undefined,
        import.meta.url,
      );
    });
  });

  it("imports prefix assignments as ordinary exports", async () => {
    const env = await setupFiles(testDir, {
      "probe.sh":
        "#!/bin/bash\nexport -p | grep -c ' JB_VALUE='\nexport -n JB_VALUE\nbash -c 'echo \"[$JB_VALUE]\"'\n",
    });
    await compareOutputs(
      env,
      testDir,
      "chmod +x probe.sh; JB_VALUE=value ./probe.sh",
      undefined,
      undefined,
      import.meta.url,
    );
  });

  it("corrects an inherited PWD that does not match the working directory", async () => {
    const env = await setupFiles(testDir, {
      "probe.sh":
        '#!/bin/bash\nif [ "$PWD" = "$(pwd)" ]; then echo same; else echo different; fi\n',
    });
    await compareOutputs(
      env,
      testDir,
      "chmod +x probe.sh; PWD=/fake ./probe.sh",
      undefined,
      undefined,
      import.meta.url,
    );
  });

  it("preserves an inherited logical PWD that matches the working directory", async () => {
    const env = await setupFiles(testDir, {
      "dir/probe.sh":
        '#!/bin/bash\nprintf "%s %s %s\\n" "${PWD##*/}" "$(basename "$(pwd)")" "$(basename "$(pwd -P)")"\n',
    });
    await compareOutputs(
      env,
      testDir,
      'ln -s dir alias; logical="$PWD/alias"; cd dir; chmod +x probe.sh; PWD="$logical" ./probe.sh',
      undefined,
      undefined,
      import.meta.url,
    );
  });

  it.each([
    "unset PWD; ./probe.sh",
    "env -i ./probe.sh",
  ])("exports an initialized PWD: %s", async (command) => {
    const env = await setupFiles(testDir, {
      "probe.sh":
        '#!/bin/bash\nprintf "%s\\n" "${PWD##*/}"\nexport -p | grep -c " PWD="\n',
    });
    await compareOutputs(
      env,
      testDir,
      `mkdir dir; cp probe.sh dir/; cd dir; chmod +x probe.sh; ${command}`,
      undefined,
      undefined,
      import.meta.url,
    );
  });

  it("exports getopts variables and resets OPTIND in a new script", async () => {
    const env = await setupFiles(testDir, {
      "probe.sh":
        '#!/bin/bash\nprintf "[%s] [%s] [%s]\\n" "$JB_FLAG" "$OPTARG" "$OPTIND"\n',
    });
    await compareOutputs(
      env,
      testDir,
      "chmod +x probe.sh; set -a; getopts v: JB_FLAG -v argument; set +a; export -p | grep -c ' OPTIND='; ./probe.sh",
      undefined,
      undefined,
      import.meta.url,
    );
  });

  describe("function-local auto-exports", () => {
    it.each([
      ["nested read", "JB_VALUE=outer", "g() { read JB_VALUE <<<'inner'; }; g"],
      [
        "nested printf -v",
        "JB_VALUE=outer",
        "g() { printf -v JB_VALUE %s inner; }; g",
      ],
      [
        "nested read after unexporting the local",
        "export JB_VALUE=outer",
        "export -n JB_VALUE; g() { read JB_VALUE <<<'inner'; }; g",
      ],
      ["arithmetic", "JB_VALUE=outer", "(( JB_VALUE=7 ))"],
      ["printf -v", "JB_VALUE=outer", "printf -v JB_VALUE %s inner"],
      [
        "arithmetic with an exported outer variable",
        "export JB_VALUE=outer",
        "(( JB_VALUE=7 ))",
      ],
      [
        "printf -v with an exported outer variable",
        "export JB_VALUE=outer",
        "printf -v JB_VALUE %s inner",
      ],
      ["read", "JB_VALUE=outer", "read JB_VALUE <<<'inner'"],
      ["for", "JB_VALUE=outer", "for JB_VALUE in inner; do :; done"],
      [
        "read with an exported outer variable",
        "export JB_VALUE=outer",
        "read JB_VALUE <<<'inner'",
      ],
      [
        "for with an exported outer variable",
        "export JB_VALUE=outer",
        "for JB_VALUE in inner; do :; done",
      ],
    ])("%s restores the outer export status", async (_name, outer, assignment) => {
      const env = await setupFiles(testDir, {
        "probe.sh": '#!/bin/bash\nprintf "[%s]\\n" "$JB_VALUE"\n',
      });
      await compareOutputs(
        env,
        testDir,
        `chmod +x probe.sh; ${outer}; f() { local JB_VALUE; set -a; ${assignment}; set +a; ./probe.sh; }; f; ./probe.sh; echo "$JB_VALUE"`,
        undefined,
        undefined,
        import.meta.url,
      );
    });
  });

  describe("setting variables", () => {
    it("should set and use a variable", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "export FOO=bar; echo $FOO");
    });

    it("should set multiple variables", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "export A=1 B=2 C=3; echo $A $B $C");
    });

    it("should handle value with equals sign", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "export URL='http://x.com?a=1'; echo $URL",
      );
    });

    it("should handle empty value", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, 'export EMPTY=; echo "[$EMPTY]"');
    });
  });

  describe("variable usage", () => {
    it("should be available in subshell", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "export FOO=bar; (echo $FOO)");
    });

    it("should work with test command", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'export VAL=yes; [ "$VAL" = "yes" ] && echo matched',
      );
    });

    it("should work with numeric comparison", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "export NUM=10; [ $NUM -gt 5 ] && echo greater",
      );
    });

    it("should work in string interpolation", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'export NAME=world; echo "hello $NAME"',
      );
    });
  });

  describe("inline export", () => {
    it("should allow setting and using in same line", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "export X=42 && echo $X");
    });
  });
});
