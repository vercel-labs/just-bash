import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const input = JSON.stringify("x".repeat(98));

describe("jq named-argument flags", () => {
  it.each([
    ["--rawfile", "--rawfile"],
    ["--slurpfile", "--slurpfile"],
    ["--rawfile", "--slurpfile"],
    ["--slurpfile", "--rawfile"],
  ])("reserves a copy for each stdin %s and %s binding", async (first, second) => {
    const bash = new Bash({
      executionLimits: { maxLiveBytes: 200, maxInputBytes: 100 },
    });
    const one = await bash.exec(`jq -n ${first} a - empty`, { stdin: input });
    expect(one.stdout).toBe("");
    expect(one.stderr).toBe("");
    expect(one.exitCode).toBe(0);

    const two = await bash.exec(`jq -n ${first} a - ${second} b - empty`, {
      stdin: input,
    });
    expect(two.stdout).toBe("");
    expect(two.stderr).toBe("bash: jq: live byte limit exceeded (200 bytes)\n");
    expect(two.exitCode).toBe(126);
  });

  it("releases a stdin binding reservation before the next command", async () => {
    const bash = new Bash({
      executionLimits: { maxLiveBytes: 200, maxInputBytes: 100 },
    });
    const result = await bash.exec(
      "jq -n --rawfile a - empty; jq -n --rawfile b - empty",
      { stdin: input },
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  describe("--arg", () => {
    it("binds $NAME to the string VALUE", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{}' | jq --arg name World '{greeting: (\"Hello \" + $name)}'",
      );
      expect(result.stdout).toBe('{\n  "greeting": "Hello World"\n}\n');
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("always binds a string even when VALUE looks numeric", async () => {
      const env = new Bash();
      const result = await env.exec("jq -n --arg x 5 '$x'");
      expect(result.stdout).toBe('"5"\n');
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("multiple --arg", () => {
    it("populates $ARGS.named in order", async () => {
      const env = new Bash();
      const result = await env.exec(
        "jq -cn --arg a foo --arg b bar --arg c baz '$ARGS.named'",
      );
      expect(result.stdout).toBe('{"a":"foo","b":"bar","c":"baz"}\n');
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("binds each $NAME for use in a filter", async () => {
      const env = new Bash();
      const result = await env.exec(
        "jq -n --arg first Ada --arg last Lovelace '$first + \" \" + $last'",
      );
      expect(result.stdout).toBe('"Ada Lovelace"\n');
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("--argjson", () => {
    it("binds $NAME to a JSON number", async () => {
      const env = new Bash();
      const result = await env.exec("jq -n --argjson x 5 '$x'");
      expect(result.stdout).toBe("5\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("binds $NAME to a JSON object", async () => {
      const env = new Bash();
      const result = await env.exec("jq -n --argjson x '{\"a\":1}' '$x.a'");
      expect(result.stdout).toBe("1\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("errors on invalid JSON with exit code 2", async () => {
      const env = new Bash();
      const result = await env.exec("jq -n --argjson x notjson '$x'");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("jq: invalid JSON text passed to --argjson\n");
      expect(result.exitCode).toBe(2);
    });
  });

  describe("--rawfile", () => {
    it("binds $NAME to the raw file contents including newlines", async () => {
      const env = new Bash();
      const result = await env.exec(
        "printf 'line1\\nline2\\n' > rf.txt && jq -n --rawfile r rf.txt '$r'",
      );
      expect(result.stdout).toBe('"line1\\nline2\\n"\n');
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("--slurpfile", () => {
    it("binds $NAME to the array of JSON values in FILE", async () => {
      const env = new Bash();
      const result = await env.exec(
        "printf '1 2 3\\n' > sf.json && jq -cn --slurpfile s sf.json '$s'",
      );
      expect(result.stdout).toBe("[1,2,3]\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("errors with exit code 2 when the file is missing", async () => {
      const env = new Bash();
      const result = await env.exec("jq -n --slurpfile s nope.json '$s'");
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(2);
    });

    it.each([
      [
        "delpaths",
        '[["a"],["b","c"]]',
        "delpaths($a[0]) | $b",
        '[[["a"],["b","c"]]]\n',
      ],
      [
        "fromstream",
        '{"a":1}',
        'fromstream(([[], $a[0]], [["b"], 2])) | $b',
        '[{"a":1}]\n',
      ],
      [
        "tostream",
        '{"a":1}',
        "[$a,$b] | tostream",
        '[[0,0,"a"],1]\n[[1,0,"a"],1]\n[[]]\n',
      ],
    ])("keeps other bindings independent of %s", async (_name, stdin, filter, expected) => {
      const env = new Bash();
      const result = await env.exec(
        `jq -cn --slurpfile a - --slurpfile b - '${filter}'`,
        { stdin },
      );
      expect(result.stdout).toBe(expected);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("$ARGS", () => {
    it("exposes all named bindings via $ARGS.named", async () => {
      const env = new Bash();
      const result = await env.exec(
        "jq -cn --arg a 1 --argjson b 2 '$ARGS.named'",
      );
      expect(result.stdout).toBe('{"a":"1","b":2}\n');
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("orders $ARGS as positional then named", async () => {
      const env = new Bash();
      const result = await env.exec("jq -cn --arg a 1 '$ARGS'");
      expect(result.stdout).toBe('{"positional":[],"named":{"a":"1"}}\n');
      expect(result.exitCode).toBe(0);
    });

    it("returns {} for $ARGS.named when no args are given", async () => {
      const env = new Bash();
      const result = await env.exec("jq -cn '$ARGS.named'");
      expect(result.stdout).toBe("{}\n");
      expect(result.exitCode).toBe(0);
    });

    it("returns [] for $ARGS.positional", async () => {
      const env = new Bash();
      const result = await env.exec("jq -cn '$ARGS.positional'");
      expect(result.stdout).toBe("[]\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("errors and safety", () => {
    it("errors with exit code 2 on a missing operand", async () => {
      const env = new Bash();
      const result = await env.exec("jq -n --arg x");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "jq: --arg takes two parameters (e.g. --arg varname value)\n",
      );
      expect(result.exitCode).toBe(2);
    });

    it("keeps a __proto__ arg name as a plain data key (faithful to real jq)", async () => {
      const env = new Bash();
      const result = await env.exec(
        "jq -cn --arg __proto__ pwned '$ARGS.named'",
      );
      expect(result.stdout).toBe('{"__proto__":"pwned"}\n');
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("reads through a __proto__ arg without inheriting (returns null)", async () => {
      const env = new Bash();
      const result = await env.exec(
        "jq -cn --argjson __proto__ '{\"pwned\":123}' '$ARGS.named.pwned'",
      );
      expect(result.stdout).toBe("null\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("does not pollute Object.prototype via a __proto__ arg name", async () => {
      const env = new Bash();
      const result = await env.exec(
        "jq -cn --arg __proto__ pwned '$ARGS.named'",
      );
      expect(result.stdout).toBe('{"__proto__":"pwned"}\n');
      expect(result.exitCode).toBe(0);
      expect(({} as Record<string, unknown>).pwned).toBeUndefined();
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    });

    it("leaves other unknown long options unchanged", async () => {
      const env = new Bash();
      const result = await env.exec("jq -n --bogus '.'");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("jq: unrecognized option '--bogus'\n");
      expect(result.exitCode).toBe(1);
    });
  });
});
