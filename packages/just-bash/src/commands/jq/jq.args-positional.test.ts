import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq positional-argument flags", () => {
  describe("--args", () => {
    it("collects remaining tokens as string positional args", async () => {
      const env = new Bash();
      const result = await env.exec("jq -cn '$ARGS.positional' --args a b c");
      expect(result.stdout).toBe('["a","b","c"]\n');
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("always keeps positional args as strings even when numeric-looking", async () => {
      const env = new Bash();
      const result = await env.exec("jq -cn '$ARGS.positional' --args 1 2 3");
      expect(result.stdout).toBe('["1","2","3"]\n');
      expect(result.exitCode).toBe(0);
    });

    it("treats the first non-option token as the filter, not a positional", async () => {
      const env = new Bash();
      const result = await env.exec("jq -cn --args '$ARGS.positional' a b c");
      expect(result.stdout).toBe('["a","b","c"]\n');
      expect(result.exitCode).toBe(0);
    });

    it("still parses known flags after --args", async () => {
      const env = new Bash();
      const result = await env.exec("jq -n --args '$ARGS.positional' a -c b");
      expect(result.stdout).toBe('["a","b"]\n');
      expect(result.exitCode).toBe(0);
    });
  });

  describe("--jsonargs", () => {
    it("parses remaining tokens as JSON positional args", async () => {
      const env = new Bash();
      const result = await env.exec(
        "jq -cn '$ARGS.positional' --jsonargs 1 '\"x\"' true",
      );
      expect(result.stdout).toBe('[1,"x",true]\n');
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("parses JSON objects and arrays as positional args", async () => {
      const env = new Bash();
      const result = await env.exec(
        "jq -cn '$ARGS.positional' --jsonargs '{\"a\":1}' '[1,2]'",
      );
      expect(result.stdout).toBe('[{"a":1},[1,2]]\n');
      expect(result.exitCode).toBe(0);
    });

    it("errors with exit code 2 on invalid JSON", async () => {
      const env = new Bash();
      const result = await env.exec(
        "jq -n '$ARGS.positional' --jsonargs 1 notjson",
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "jq: invalid JSON text passed to --jsonargs\n",
      );
      expect(result.exitCode).toBe(2);
    });
  });

  describe("mode switching and combinations", () => {
    it("switches from --args to --jsonargs mode mid-stream", async () => {
      const env = new Bash();
      const result = await env.exec(
        "jq -cn '$ARGS.positional' --args a --jsonargs 1",
      );
      expect(result.stdout).toBe('["a",1]\n');
      expect(result.exitCode).toBe(0);
    });

    it("populates both $ARGS.named and $ARGS.positional", async () => {
      const env = new Bash();
      const result = await env.exec("jq -cn '$ARGS' --arg k v --args a b");
      expect(result.stdout).toBe(
        '{"positional":["a","b"],"named":{"k":"v"}}\n',
      );
      expect(result.exitCode).toBe(0);
    });

    it("interleaves --arg after --args", async () => {
      const env = new Bash();
      const result = await env.exec("jq -cn '$ARGS' --args a --arg k v");
      expect(result.stdout).toBe('{"positional":["a"],"named":{"k":"v"}}\n');
      expect(result.exitCode).toBe(0);
    });
  });

  describe("empty and default", () => {
    it("returns [] when --args is given with no following tokens", async () => {
      const env = new Bash();
      const result = await env.exec("jq -cn '$ARGS.positional' --args");
      expect(result.stdout).toBe("[]\n");
      expect(result.exitCode).toBe(0);
    });

    it("does not treat --args positionals as input files", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{\"v\":1}' | jq -c '.v' --args a b");
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });
  });
});
