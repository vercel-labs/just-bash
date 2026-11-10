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
