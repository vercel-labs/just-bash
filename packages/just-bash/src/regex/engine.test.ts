import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { matchGlob } from "../utils/glob.js";
import {
  type CompiledRegex,
  type RegexEngine,
  type RegexEngineFlags,
  type RegexMatcher,
  RegexSyntaxError,
} from "./engine.js";
import { currentRegexEngine, runWithRegexEngine } from "./engine-context.js";
import { re2jsEngine } from "./re2js-engine.js";
import { createUserRegex } from "./user-regex.js";

// Test-only reference adapter over the host RegExp. It exists to prove the
// RegexMatcher/CompiledRegex surface is sufficient for every UserRegex
// operation; it is deliberately not exported, since it backtracks.
class HostRegExpMatcher implements RegexMatcher {
  private match: RegExpExecArray | null = null;

  constructor(
    private readonly regex: RegExp,
    private input: string,
  ) {}

  find(start = 0): boolean {
    if (start > this.input.length) {
      this.match = null;
      return false;
    }
    this.regex.lastIndex = start;
    this.match = this.regex.exec(this.input);
    return this.match !== null;
  }

  start(group = 0): number {
    return this.indices()[group]?.[0] ?? -1;
  }

  end(group = 0): number {
    return this.indices()[group]?.[1] ?? -1;
  }

  group(index = 0): string | null {
    return this.match?.[index] ?? null;
  }

  groups(): (string | null)[] {
    return this.match ? [...this.match].map((g) => g ?? null) : [];
  }

  namedGroups(): Record<string, string | null> {
    const named: Record<string, string | null> = Object.create(null);
    for (const [name, value] of Object.entries(this.match?.groups ?? {})) {
      named[name] = value ?? null;
    }
    return named;
  }

  reset(input: string): void {
    this.input = input;
    this.match = null;
  }

  private indices(): Array<[number, number] | undefined> {
    const indices = (
      this.match as
        | (RegExpExecArray & { indices?: Array<[number, number]> })
        | null
    )?.indices;
    return indices ?? [];
  }
}

const hostRegExpEngine: RegexEngine = {
  compile(pattern: string, flags: RegexEngineFlags): CompiledRegex {
    let regex: RegExp;
    try {
      regex = new RegExp(
        pattern,
        `gd${flags.ignoreCase ? "i" : ""}${flags.multiline ? "m" : ""}${flags.dotAll ? "s" : ""}`,
      );
    } catch (e) {
      throw new RegexSyntaxError((e as Error).message);
    }
    return { matcher: (input) => new HostRegExpMatcher(regex, input) };
  },
};

interface Recorded {
  pattern: string;
  flags: RegexEngineFlags;
}

// Delegates to re2js but records every compile, so tests can see which engine
// an execution resolved without changing behaviour.
function recordingEngine(): RegexEngine & { seen: Recorded[] } {
  const seen: Recorded[] = [];
  return {
    seen,
    compile(pattern, flags) {
      seen.push({ pattern, flags });
      return re2jsEngine.compile(pattern, flags);
    },
  };
}

describe("regexEngine option", () => {
  it("defaults to re2js outside and inside an execution", async () => {
    expect(currentRegexEngine()).toBe(re2jsEngine);
    const result = await new Bash().exec(`[[ x =~ ^x$ ]] && echo matched`);
    expect(result.stdout).toBe("matched\n");
  });

  it("routes every pattern of an execution through the instance's engine", async () => {
    const engine = recordingEngine();
    const bash = new Bash({ regexEngine: engine });

    const result = await bash.exec(
      [
        `printf 'Abc\\nxyz\\n' | grep -iE 'a.c'`,
        `echo 'k1=v1;k2=v2' | awk -F'[;=]' '{ print $4 }'`,
        `[[ ord-42 =~ ^([a-z]+)-([0-9]+)$ ]] && echo "\${BASH_REMATCH[2]}"`,
        `echo hello | sed -E 's/l+/L/'`,
      ].join("\n"),
    );

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("Abc\nv2\n42\nheLo\n");
    const patterns = engine.seen.map((entry) => entry.pattern);
    expect(patterns).toContain("a.c");
    expect(patterns).toContain("[;=]");
    expect(patterns).toContain("^([a-z]+)-([0-9]+)$");
    expect(patterns).toContain("l+");
    expect(engine.seen.find((entry) => entry.pattern === "a.c")?.flags).toEqual(
      {
        ignoreCase: true,
        multiline: false,
        dotAll: false,
        unicode: false,
      },
    );
  });

  it("keeps concurrently executing instances on their own engines", async () => {
    const first = recordingEngine();
    const second = recordingEngine();
    const script = (tag: string) =>
      `sleep 0.01; echo ${tag} | grep -E '^${tag}$'; sleep 0.01; echo ${tag} | grep -E '${tag}+'`;

    const [a, b] = await Promise.all([
      new Bash({ regexEngine: first }).exec(script("first")),
      new Bash({ regexEngine: second }).exec(script("second")),
    ]);

    expect(a.stdout).toBe("first\nfirst\n");
    expect(b.stdout).toBe("second\nsecond\n");
    expect(first.seen.map((entry) => entry.pattern)).toEqual([
      "^first$",
      "first+",
    ]);
    expect(second.seen.map((entry) => entry.pattern)).toEqual([
      "^second$",
      "second+",
    ]);
  });

  it("does not leak the engine past the execution", async () => {
    const engine = recordingEngine();
    await new Bash({ regexEngine: engine }).exec("echo x | grep x");
    expect(currentRegexEngine()).toBe(re2jsEngine);
    createUserRegex("after");
    expect(engine.seen.map((entry) => entry.pattern)).toEqual(["x"]);
  });

  it("passes the u flag to the engine", () => {
    const engine = recordingEngine();
    runWithRegexEngine(engine, () => createUserRegex("\\u{1F600}", "u"));
    expect(engine.seen[0]?.flags.unicode).toBe(true);
  });

  it("keeps glob caches separate per engine", () => {
    const first = recordingEngine();
    const second = recordingEngine();
    runWithRegexEngine(first, () => matchGlob("a.txt", "*.txt"));
    runWithRegexEngine(first, () => matchGlob("b.txt", "*.txt"));
    runWithRegexEngine(second, () => matchGlob("c.txt", "*.txt"));
    expect(first.seen.length).toBe(1);
    expect(second.seen.length).toBe(1);
  });

  it("wraps the engine's RegexSyntaxError in the standard invalid-pattern message", async () => {
    const engine: RegexEngine = {
      compile() {
        throw new RegexSyntaxError("engine says no");
      },
    };
    expect(() =>
      runWithRegexEngine(engine, () => createUserRegex("x")),
    ).toThrow(/^Invalid regular expression: \/x\/: engine says no/);
    expect(() =>
      runWithRegexEngine(engine, () => createUserRegex("(?=x)")),
    ).toThrow(/Lookahead/);

    const result = await new Bash({ regexEngine: engine }).exec(
      "echo x | grep x",
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/grep: invalid regular expression/);
  });

  it("lets other engine errors propagate untouched", () => {
    const engine: RegexEngine = {
      compile() {
        throw new TypeError("engine crashed");
      },
    };
    expect(() =>
      runWithRegexEngine(engine, () => createUserRegex("x")),
    ).toThrow(TypeError);
  });

  describe("every UserRegex operation works against a non-default engine", () => {
    const withHost = <T>(fn: () => T): T =>
      runWithRegexEngine(hostRegExpEngine, fn);

    it("test, exec, search", () => {
      const regex = withHost(() => createUserRegex("(\\d+)-(\\d+)", "i"));
      expect(regex.test("id 12-34")).toBe(true);
      const match = regex.exec("id 12-34");
      expect(match && [...match]).toEqual(["12-34", "12", "34"]);
      expect(match?.index).toBe(3);
      expect(regex.search("id 12-34")).toBe(3);
      expect(regex.search("nothing")).toBe(-1);
    });

    it("global match, replace with $n, callback replace, split, matchAll", () => {
      const global = withHost(() => createUserRegex("(\\d)", "g"));
      expect(global.match("a1b2c3")).toEqual(["1", "2", "3"]);
      expect(global.replace("a1b2c3", "[$1]")).toBe("a[1]b[2]c[3]");
      expect(global.replace("a1b2c3", (m) => `<${m}>`)).toBe("a<1>b<2>c<3>");
      expect(global.split("a1b2c3")).toEqual(["a", "b", "c", ""]);
      expect([...global.matchAll("a1b2")].map((m) => [m[0], m.index])).toEqual([
        ["1", 1],
        ["2", 3],
      ]);
    });

    it("named groups and zero-length matches", () => {
      const named = withHost(() =>
        createUserRegex("(?<year>\\d{4})-(?<month>\\d{2})"),
      );
      expect(named.exec("on 2026-09")?.groups).toEqual({
        year: "2026",
        month: "09",
      });

      const empty = withHost(() => createUserRegex("x*", "g"));
      expect(empty.replace("abc", "-")).toBe("-a-b-c-");
      expect(empty.match("abc")).toEqual(["", "", "", ""]);
    });

    it("lastIndex advances with exec on a global pattern", () => {
      const regex = withHost(() => createUserRegex("a", "g"));
      expect(regex.exec("aXa")?.index).toBe(0);
      expect(regex.lastIndex).toBe(1);
      expect(regex.exec("aXa")?.index).toBe(2);
      expect(regex.exec("aXa")).toBeNull();
      expect(regex.lastIndex).toBe(0);
    });

    it("reuses one matcher across inputs through reset", () => {
      const regex = withHost(() => createUserRegex("b"));
      expect(regex.test("abc")).toBe(true);
      expect(regex.test("xyz")).toBe(false);
      expect(regex.search("aab")).toBe(2);
    });

    it("runs whole scripts end to end with the same output as the default engine", async () => {
      const script = [
        `echo 'ord-12 pending 34' | sed -E 's/(ord)-([0-9]+) (\\w+) ([0-9]+)/\\3:\\2:\\4:\\1/'`,
        `echo 'a1b22c333' | grep -oE '[0-9]+' | tr '\\n' ,; echo`,
        `printf '%s\\n' shipped pending delivered | awk '/^(ship|deliv)/ { n++ } END { print n }'`,
        `echo '{"id":"ord-7"}' | jq -r '.id | capture("(?<k>[a-z]+)-(?<n>[0-9]+)") | .n'`,
        `for f in a.txt b.md; do case $f in *.txt) echo T;; *) echo O;; esac; done`,
      ].join("\n");
      const expected = await new Bash().exec(script);
      const actual = await new Bash({ regexEngine: hostRegExpEngine }).exec(
        script,
      );
      expect(expected.stderr).toBe("");
      expect(actual).toEqual(expected);
    });
  });
});
