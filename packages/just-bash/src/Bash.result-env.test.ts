import { describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";
import { nullPrototype } from "./commands/query-engine/safe-object.js";

describe("execution result environment", () => {
  describe("prefix binding cleanup", () => {
    it.each([
      ['v=outer; TMP=$(v=inner) :; echo "$v"', "outer\n"],
      ['a=(outer); TMP=$(a[0]=inner) :; echo "${a[0]}"', "outer\n"],
      ['V=$(echo a)$((Y=1)) :; echo "$Y"', "1\n"],
      ['Y=0; Y=temporary V=$(echo a)$((Y=1)) :; echo "$Y"', "1\n"],
      ['Y=0; Y=1 V=$(echo a)$((Y=1)) :; echo "$Y"', "1\n"],
      [
        'a=(outer keep); a=(temp) V=$(echo a)$((a[1]=5)) :; printf "<%s>\\n" "${a[@]}"',
        "<outer>\n<5>\n",
      ],
      ['v=outer; TMP=<(v=inner) :; echo "$v"', "outer\n"],
      ['v=outer; TMP=$(v=inner; exit) :; echo "$v"', "outer\n"],
      ['v=outer; TMP=$(v=inner; echo "$(v=nested)") :; echo "$v"', "outer\n"],
    ])("keeps RHS substitution state isolated: %s", async (script, stdout) => {
      const result = await new Bash().exec(script);
      expect(result.stdout).toBe(stdout);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("excludes substitution-only assignments from replacement result environments", async () => {
      const result = await new Bash().exec(
        "TEMP=secret OUT=$(LEAK=$TEMP) true",
        {
          env: {},
          replaceEnv: true,
        },
      );
      expect(result.env).toStrictEqual(nullPrototype({ "?": "0" }));
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
    it.each([
      ["TEMP=one TEMP=two :", "0"],
      ["TEMP=one TEMP=$((TEMP=5)) :", "5"],
      ["TEMP=5 TEMP=$((TEMP=5)) :", "5"],
    ])("separates repeated temporary writes from RHS mutations: %s", async (command, expected) => {
      const result = await new Bash().exec(`TEMP=0; ${command}; echo "$TEMP"`);
      expect(result.stdout).toBe(`${expected}\n`);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
    it("restores associative array contents and type together", async () => {
      const result = await new Bash().exec(
        'declare -A a=([key]=value); a=(temp) unset a; printf "lookup=<%s>\\n" "${a[key]}"; declare -p a',
      );
      expect(result.stdout).toBe(
        "lookup=<value>\ndeclare -A a=(['key']=value)\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
    it.each([
      'TEMP=old; f() { TEMP=$((TEMP=5)) return; }; f; echo "$TEMP"',
      'TEMP=old; for i in 1; do TEMP=$((TEMP=5)) break; done; echo "$TEMP"',
      'TEMP=old; for i in 1; do TEMP=$((TEMP=5)) continue; done; echo "$TEMP"',
    ])("preserves prefix RHS side effects across normal control transfers: %s", async (script) => {
      const result = await new Bash().exec(script);
      expect(result.stdout).toBe("5\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.env.TEMP).toBe("5");
    });
    it("preserves RHS side effects after successful prefix commands", async () => {
      const result = await new Bash().exec(
        'TEMP=original; TEMP=$((TEMP=5)) :; echo "$TEMP"; TEMP=$((TEMP=6)) echo command; echo "$TEMP"',
      );
      expect(result.stdout).toBe("5\ncommand\n6\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.env.TEMP).toBe("6");
    });
    it.each([
      "TEMP=secret eval 'echo ${MISSING:?required}'",
      "TEMP=(one) echo ${MISSING:?required}",
      "TEMP=$((TEMP=5)) echo ${MISSING:?required}",
    ])("restores pre-expansion prefix state for %s", async (command) => {
      const result = await new Bash().exec(command, {
        env: { TEMP: "original" },
        replaceEnv: true,
      });
      expect(result.env.TEMP).toBe("original");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("bash: required\n");
      expect(result.exitCode).toBe(1);
    });
    it.each([
      [undefined, "TEMP=secret echo ${MISSING:?required}"],
      ["original", "TEMP=secret echo ${MISSING:?required}"],
      [undefined, "TEMP=one TEMP=two echo ${MISSING:?required}"],
      ["original", "TEMP=one TEMP=two echo ${MISSING:?required}"],
      [undefined, "TEMP=one TEMP=two OTHER=${MISSING:?required} echo"],
      ["original", "TEMP=one TEMP=two OTHER=${MISSING:?required} echo"],
    ])("unwinds temporary bindings after expansion failure (TEMP=%s, %s)", async (original, command) => {
      const bash = new Bash();
      const result = await bash.exec(`MARKER=kept; ${command}`, {
        env: original === undefined ? {} : { TEMP: original },
        replaceEnv: true,
      });
      expect(result.env).toStrictEqual(
        nullPrototype(
          original === undefined
            ? { MARKER: "kept", "?": "0" }
            : { MARKER: "kept", "?": "0", TEMP: original },
        ),
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("bash: required\n");
      expect(result.exitCode).toBe(1);
    });

    it("retains explicit-exit prefix bindings following Bash 3.2", async () => {
      const result = await new Bash().exec("TEMP=secret exit 7", {
        env: {},
        replaceEnv: true,
      });
      expect(result.env.TEMP).toBe("secret");
      expect(result.exitCode).toBe(7);
    });

    it("restores array state after command-scoped array assignments", async () => {
      const result = await new Bash().exec(
        'TEMP=(original); TEMP=(one) :; printf "[%s]\\n" "${TEMP[@]}"',
      );
      expect(result.stdout).toBe("[original]\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("preserves array RHS side effects beneath temporary bindings", async () => {
      const result = await new Bash().exec(
        'a=(old); a=("$((a[0]=5))") :; printf "array=<%s>\\n" "${a[0]}"',
      );
      expect(result.stdout).toBe("array=<5>\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it.each([
      "TEMP=$((TEMP=5)) OTHER=${MISSING:?required} echo",
      "TEMP=$((TEMP=5)) eval 'echo ${MISSING:?required}'",
    ])("preserves completed RHS side effects when a later operation fails: %s", async (command) => {
      const result = await new Bash().exec(`TEMP=0; ${command}`, {
        env: {},
        replaceEnv: true,
      });
      expect(result.env.TEMP).toBe("5");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("bash: required\n");
      expect(result.exitCode).toBe(1);
    });

    it("retains prefix bindings after a completed POSIX special builtin", async () => {
      const result = await new Bash().exec("set -o posix; TEMP=kept :; exit", {
        env: {},
        replaceEnv: true,
      });
      expect(result.env.TEMP).toBe("kept");
      expect(result.exitCode).toBe(0);
    });
  });
  describe("result isolation", () => {
    it.each([
      ["normal execution", "echo ok", 0],
      ["empty script", "", 0],
      ["whitespace-only script", " \n\t", 0],
      ["exit", "exit 7", 7],
      ["syntax error", "if", 2],
      ["lexer error", "echo '", 2],
      ["arithmetic error", "echo $((1 / 0))", 1],
    ])("returns the replacement environment after %s", async (_name, script, status) => {
      const bash = new Bash({ env: { SECRET: "example-only" } });
      const result = await bash.exec(script, {
        env: { MARKER: "replacement" },
        replaceEnv: true,
      });
      expect(
        Object.keys(result.env).filter((name) => name !== "?"),
      ).toStrictEqual(["MARKER"]);
      expect(result.env.MARKER).toBe("replacement");
      expect(Object.getPrototypeOf(result.env)).toBeNull();
      expect(result.exitCode).toBe(status);
    });

    it("keeps assignments made before exit in the returned environment", async () => {
      const bash = new Bash({ env: { SECRET: "example-only" } });
      const result = await bash.exec("MARKER=changed; ADDED=value; exit 7", {
        env: { MARKER: "replacement" },
        replaceEnv: true,
      });
      expect(result.env).toStrictEqual(
        nullPrototype({ MARKER: "changed", ADDED: "value", "?": "0" }),
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(7);
    });

    it("uses the replacement environment when source validation fails", async () => {
      const bash = new Bash({
        env: { SECRET: "example-only" },
        executionLimits: { maxSourceBytes: 4 },
      });
      const result = await bash.exec("echo too-long", {
        env: { MARKER: "replacement" },
        replaceEnv: true,
      });
      expect(result.env).toStrictEqual(
        nullPrototype({ MARKER: "replacement" }),
      );
      expect(result.exitCode).toBe(126);
    });

    it("keeps runtime assignments when the execution limit is reached", async () => {
      const bash = new Bash({
        env: { SECRET: "example-only" },
        executionLimits: { maxLoopIterations: 2 },
      });
      const result = await bash.exec("MARKER=changed; while true; do :; done", {
        env: { MARKER: "replacement" },
        replaceEnv: true,
      });
      expect(result.env).toStrictEqual(
        nullPrototype({ MARKER: "changed", "?": "0" }),
      );
      expect(result.exitCode).toBe(126);
    });

    it("preserves merge semantics on empty and exit result paths", async () => {
      const bash = new Bash({ env: { KEEP: "constructor" } });
      const empty = await bash.exec("", { env: { MARKER: "per-exec" } });
      const exited = await bash.exec("exit", { env: { MARKER: "per-exec" } });
      expect(empty.env.KEEP).toBe("constructor");
      expect(empty.env.MARKER).toBe("per-exec");
      expect(exited.env).toStrictEqual(empty.env);
    });
  });
});
