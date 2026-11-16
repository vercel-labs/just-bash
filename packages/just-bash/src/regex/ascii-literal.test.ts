import { describe, expect, it } from "vitest";
import { createUserRegex, type UserRegex } from "./user-regex.js";

/**
 * A case-insensitive ASCII literal is searched with a native RegExp instead of
 * RE2. Wrapping the same literal in a non-capturing group keeps it on RE2, so
 * each test runs both forms and expects identical results.
 */
function literalOf(regex: UserRegex): unknown {
  return (regex as unknown as { _foldedLiteral: unknown })._foldedLiteral;
}

function pair(pattern: string, flags: string): [UserRegex, UserRegex] {
  const fast = createUserRegex(pattern, flags);
  const re2 = createUserRegex(`(?:${pattern})`, flags);
  expect(literalOf(fast)).not.toBeNull();
  expect(literalOf(re2)).toBeNull();
  return [fast, re2];
}

function outcome(run: () => unknown): unknown {
  try {
    return { value: run() };
  } catch (error) {
    return { error: (error as Error).name };
  }
}

const INPUTS = [
  "",
  "needle",
  "NEEDLE",
  "a NeEdLe in a haystack of needles",
  "needleneedle",
  "need",
  "no match here",
  // Non-ASCII inputs, including the two characters that RE2 folds to an
  // ASCII letter.
  "\u212Aelvin",
  "\u017Fun",
  "\u0130stanbul",
  "stra\u00DFe NEEDLE",
  "\u{1F600} needle \u{1F600} NEEDLE",
  "caf\u00E9 Kelvin \u017Fun sun",
];

const PATTERNS = ["needle", "NEEDLE", "kelvin", "sun", "istanbul", "a"];

describe("case-insensitive ASCII literal search", () => {
  it("only applies to case-insensitive printable ASCII literals", () => {
    expect(literalOf(createUserRegex("Needle", "i"))).not.toBeNull();
    expect(literalOf(createUserRegex("a\\.b\\(c\\)", "gi"))).not.toBeNull();
    expect(literalOf(createUserRegex("needle", "g"))).toBeNull();
    expect(literalOf(createUserRegex("ne+dle", "i"))).toBeNull();
    expect(literalOf(createUserRegex("\\bneedle\\b", "i"))).toBeNull();
    expect(literalOf(createUserRegex("^needle", "i"))).toBeNull();
    expect(literalOf(createUserRegex("a\\nb", "i"))).toBeNull();
    expect(literalOf(createUserRegex("caf\u00E9", "i"))).toBeNull();
    expect(literalOf(createUserRegex("a\tb", "i"))).toBeNull();
    expect(literalOf(createUserRegex("", "i"))).toBeNull();
    expect(literalOf(createUserRegex("a".repeat(1024), "i"))).not.toBeNull();
    expect(literalOf(createUserRegex("a".repeat(1025), "i"))).toBeNull();
  });

  it("matches like RE2 in test, search and exec", () => {
    for (const pattern of PATTERNS) {
      const [fast, re2] = pair(pattern, "i");
      for (const input of INPUTS) {
        expect(fast.test(input)).toBe(re2.test(input));
        expect(fast.search(input)).toBe(re2.search(input));
        expect(outcome(() => fast.exec(input))).toEqual(
          outcome(() => re2.exec(input)),
        );
      }
    }
  });

  it("iterates global matches like RE2", () => {
    for (const pattern of PATTERNS) {
      const [fast, re2] = pair(pattern, "gi");
      for (const input of INPUTS) {
        expect(fast.match(input)).toEqual(re2.match(input));
        expect([...fast.matchAll(input)]).toEqual([...re2.matchAll(input)]);
        const fastExec: unknown[] = [];
        const re2Exec: unknown[] = [];
        for (let m = fast.exec(input); m !== null; m = fast.exec(input)) {
          fastExec.push([m[0], m.index, fast.lastIndex]);
        }
        for (let m = re2.exec(input); m !== null; m = re2.exec(input)) {
          re2Exec.push([m[0], m.index, re2.lastIndex]);
        }
        expect(fastExec).toEqual(re2Exec);
      }
    }
  });

  it("replaces and splits like RE2", () => {
    for (const flags of ["i", "gi"]) {
      for (const pattern of PATTERNS) {
        const [fast, re2] = pair(pattern, flags);
        for (const input of INPUTS) {
          expect(fast.replace(input, "<$&>")).toBe(re2.replace(input, "<$&>"));
          expect(fast.replace(input, "[$0]")).toBe(re2.replace(input, "[$0]"));
          const callback = (match: string, ...args: unknown[]) =>
            `${match.toUpperCase()}@${args.join(",")}`;
          expect(fast.replace(input, callback)).toBe(
            re2.replace(input, callback),
          );
          expect(fast.split(input)).toEqual(re2.split(input));
          expect(fast.split(input, 2)).toEqual(re2.split(input, 2));
        }
      }
    }
  });

  it("matches escaped metacharacters literally", () => {
    const [fast, re2] = pair("a\\.b", "gi");
    for (const input of ["A.B", "axb", "a.b A.b aXb"]) {
      expect(fast.match(input)).toEqual(re2.match(input));
    }
    expect(fast.match("A.B axb a.b")).toEqual(["A.B", "a.b"]);
  });

  it("leaves long literals on RE2", () => {
    const long = "ab".repeat(600);
    const regex = createUserRegex(long, "gi");
    expect(literalOf(regex)).toBeNull();
    expect(regex.match(`x${long.toUpperCase()}x${long}`)).toEqual([
      long.toUpperCase(),
      long,
    ]);
  });

  it("rejects an out-of-range lastIndex like RE2", () => {
    const [fast, re2] = pair("needle", "gi");
    fast.lastIndex = 100;
    re2.lastIndex = 100;
    expect(outcome(() => fast.exec("needle"))).toEqual(
      outcome(() => re2.exec("needle")),
    );
  });

  it("switches between ASCII and non-ASCII inputs on one instance", () => {
    const [fast, re2] = pair("kelvin", "gi");
    const inputs = ["KELVIN", "\u212Aelvin", "KELVIN", "kelvin \u212Aelvin"];
    for (const input of [...inputs, ...[...inputs].reverse()]) {
      expect(fast.test(input)).toBe(re2.test(input));
      expect(fast.match(input)).toEqual(re2.match(input));
    }
  });
});
