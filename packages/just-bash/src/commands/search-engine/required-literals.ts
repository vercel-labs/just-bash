/**
 * Required literals of a search pattern: substrings every match contains, so
 * a line or file without them can be skipped before the regex engine runs.
 *
 * The analysis is conservative. A construct it does not model either requires
 * nothing or disables the filter for the whole pattern, so a skipped line is
 * never one the regex would match; the filter may only keep lines the regex
 * then rejects.
 */

export interface PreFilter {
  /**
   * Text can match only if it contains every needle of at least one group:
   * the pattern's alternatives, each with the literals it requires.
   */
  groups: string[][];
  /**
   * Top-level alternatives that match exactly one literal: text containing one
   * matches the pattern, so RE2 is needed only for the match's position. Under
   * ignoreCase they are lowercase ASCII.
   */
  exact: string[];
  /** Needles are lowercase ASCII, and text is case-folded before the check. */
  ignoreCase: boolean;
}

/** Groups kept for a pattern; a larger product keeps one side instead. */
// @banned-pattern-ignore: bounds the prefilter analysis; past it the filter requires less and output is unchanged
const MAX_GROUPS = 64;
/** Needles kept per group, the longest first. */
// @banned-pattern-ignore: bounds the prefilter analysis; past it the filter requires less and output is unchanged
const MAX_NEEDLES = 8;
/** Group nesting the analysis follows before it gives up on a pattern. */
// @banned-pattern-ignore: bounds the prefilter analysis; past it the pattern is scanned without a filter
const MAX_DEPTH = 64;

/** What part of a pattern requires: alternatives of needle sets. `[[]]` requires nothing. */
type Requirement = string[][];

const NOTHING: Requirement = [[]];

const CONTROL_ESCAPES = new Map([
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["f", "\f"],
  ["v", "\v"],
]);

/** Escapes of a character class or an assertion: they match no fixed text. */
const CLASS_ESCAPES = "dDwWsSbB";

/** A construct whose meaning the analysis does not model. */
class UnsupportedPattern extends Error {}

function requiresNothing(requirement: Requirement): boolean {
  return requirement.some((group) => group.length === 0);
}

/** A group without needles another needle contains, at most MAX_NEEDLES of them, the longest first. */
function capped(group: string[]): string[] {
  const unique = [...new Set(group)].sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const needle of unique) {
    if (kept.length === MAX_NEEDLES) break;
    if (!kept.some((longer) => longer.includes(needle))) kept.push(needle);
  }
  return kept;
}

/** Groups with a duplicate removed: capped groups list their needles in one order. */
function distinct(groups: Requirement): Requirement {
  const seen = new Set<string>();
  return groups.filter((group) => {
    const key = group.join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function either(left: Requirement, right: Requirement): Requirement {
  if (requiresNothing(left) || requiresNothing(right)) return NOTHING;
  const groups = distinct([...left, ...right]);
  return groups.length > MAX_GROUPS ? NOTHING : groups;
}

function both(left: Requirement, right: Requirement): Requirement {
  if (requiresNothing(left)) return right;
  if (requiresNothing(right)) return left;
  // Each side alone is still required; keep the one with fewer alternatives.
  if (left.length * right.length > MAX_GROUPS) {
    return left.length <= right.length ? left : right;
  }
  const groups: Requirement = [];
  for (const a of left) {
    for (const b of right) groups.push(capped([...a, ...b]));
  }
  return distinct(groups);
}

type Atom = { literal: string } | { requirement: Requirement };

/** A parsed part of a pattern; `exact` is the one literal it matches, when it matches only that. */
interface Parsed {
  exact: string | null;
  requirement: Requirement;
}

class RequirementParser {
  private position = 0;

  constructor(private readonly pattern: string) {}

  parse(): { exact: string[]; requirement: Requirement } {
    const exact: string[] = [];
    let requirement: Requirement | null = null;
    for (;;) {
      const alternative = this.concatenation(0);
      if (alternative.exact) exact.push(alternative.exact);
      requirement =
        requirement === null
          ? alternative.requirement
          : either(requirement, alternative.requirement);
      if (this.pattern[this.position] !== "|") break;
      this.position++;
    }
    // A stray ")" is a syntax error the engine reports; nothing to filter.
    if (this.position < this.pattern.length) throw new UnsupportedPattern();
    return { exact, requirement };
  }

  private alternation(depth: number): Parsed {
    if (depth > MAX_DEPTH) throw new UnsupportedPattern();
    const first = this.concatenation(depth);
    let requirement = first.requirement;
    let exact = first.exact;
    while (this.pattern[this.position] === "|") {
      this.position++;
      requirement = either(requirement, this.concatenation(depth).requirement);
      exact = null;
    }
    return { exact, requirement };
  }

  private concatenation(depth: number): Parsed {
    let requirement = NOTHING;
    let exact: string | null = "";
    let run = "";
    const flush = (): void => {
      if (run !== "") requirement = both(requirement, [[run]]);
      run = "";
    };
    while (this.position < this.pattern.length) {
      const char = this.pattern[this.position];
      if (char === "|" || char === ")") break;
      const atom = this.atom(depth);
      const minimum = this.quantifier();
      if ("literal" in atom && minimum === null) {
        run += atom.literal;
        if (exact !== null) exact += atom.literal;
        continue;
      }
      exact = null;
      if ("literal" in atom) {
        if (minimum === 0) {
          flush();
        } else {
          // The first repetition follows the run and the last precedes what comes next.
          run += atom.literal;
          flush();
          run = atom.literal;
        }
        continue;
      }
      flush();
      if (minimum === null || minimum > 0) {
        requirement = both(requirement, atom.requirement);
      }
    }
    flush();
    return { exact, requirement };
  }

  private atom(depth: number): Atom {
    const char = this.pattern[this.position];
    switch (char) {
      case "(": {
        const group = this.group(depth);
        // A group of one literal joins the literals around it.
        return group.exact === null
          ? { requirement: group.requirement }
          : { literal: group.exact };
      }
      case "[":
        this.characterClass();
        return { requirement: NOTHING };
      case "\\":
        return this.escape();
      case "{":
        // A brace that is not a quantifier reads differently across engines.
        throw new UnsupportedPattern();
      case ".":
      case "^":
      case "$":
      case "]":
      case "}":
      case "*":
      case "+":
      case "?":
        this.position++;
        return { requirement: NOTHING };
      default: {
        // One code point, so a surrogate pair stays whole.
        const literal = String.fromCodePoint(
          this.pattern.codePointAt(this.position) ?? 0,
        );
        this.position += literal.length;
        return { literal };
      }
    }
  }

  private group(depth: number): Parsed {
    this.position++;
    if (this.pattern[this.position] === "?") {
      if (this.pattern[this.position + 1] === ":") {
        this.position += 2;
      } else {
        const name = this.groupName();
        // Inline flags and lookaround change what the group matches.
        if (name === 0) throw new UnsupportedPattern();
        this.position += name;
      }
    }
    const parsed = this.alternation(depth + 1);
    if (this.pattern[this.position] !== ")") throw new UnsupportedPattern();
    this.position++;
    return parsed;
  }

  /** The length of a `?<name>` or `?P<name>` group prefix at the position, or 0. */
  private groupName(): number {
    let index = this.position + 1;
    if (this.pattern[index] === "P") index++;
    if (this.pattern[index] !== "<") return 0;
    index++;
    const start = index;
    while (index < this.pattern.length && isWordChar(this.pattern[index])) {
      index++;
    }
    const first = this.pattern[start];
    if (
      index === start ||
      (first >= "0" && first <= "9") ||
      this.pattern[index] !== ">"
    ) {
      return 0;
    }
    return index + 1 - this.position;
  }

  private characterClass(): void {
    this.position++;
    if (this.pattern[this.position] === "^") this.position++;
    // Engines disagree on whether a leading "]" is a member or closes the class.
    if (this.pattern[this.position] === "]") throw new UnsupportedPattern();
    while (
      this.position < this.pattern.length &&
      this.pattern[this.position] !== "]"
    ) {
      this.position += this.pattern[this.position] === "\\" ? 2 : 1;
    }
    if (this.position >= this.pattern.length) throw new UnsupportedPattern();
    this.position++;
  }

  private escape(): Atom {
    const next = this.pattern[this.position + 1];
    if (next === undefined) throw new UnsupportedPattern();
    this.position += 2;
    const control = CONTROL_ESCAPES.get(next);
    if (control !== undefined) return { literal: control };
    if (CLASS_ESCAPES.includes(next)) return { requirement: NOTHING };
    // \x, \u, \p, \c, \0, back-references and the like are not modelled.
    if (isWordChar(next)) throw new UnsupportedPattern();
    return { literal: next };
  }

  /** The minimum count of the quantifier at the position, consumed, or null when none follows. */
  private quantifier(): number | null {
    const char = this.pattern[this.position];
    let minimum: number;
    if (char === "*" || char === "?") {
      this.position++;
      minimum = 0;
    } else if (char === "+") {
      this.position++;
      minimum = 1;
    } else if (char === "{") {
      minimum = this.braces();
    } else {
      return null;
    }
    if (this.pattern[this.position] === "?") this.position++;
    // A doubled or possessive quantifier is not modelled.
    const after = this.pattern[this.position];
    if (after === "*" || after === "+" || after === "?" || after === "{") {
      throw new UnsupportedPattern();
    }
    return minimum;
  }

  /** The minimum of a `{n}`, `{n,}` or `{n,m}` quantifier at the position, consumed. */
  private braces(): number {
    let index = this.position + 1;
    const start = index;
    while (isDigit(this.pattern[index])) index++;
    if (index === start) throw new UnsupportedPattern();
    const minimum = Number(this.pattern.slice(start, index));
    if (this.pattern[index] === ",") {
      index++;
      while (isDigit(this.pattern[index])) index++;
    }
    if (this.pattern[index] !== "}") throw new UnsupportedPattern();
    this.position = index + 1;
    return minimum;
  }
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function isWordChar(char: string): boolean {
  return (
    isDigit(char) ||
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    char === "_"
  );
}

/** The ASCII runs of a needle, lowercased: what RE2's case folding requires of them as text. */
function foldedAsciiRuns(needle: string): string[] {
  const runs: string[] = [];
  let run = "";
  for (let index = 0; index < needle.length; index++) {
    const code = needle.charCodeAt(index);
    if (code > 0x7f) {
      if (run !== "") runs.push(run);
      run = "";
    } else {
      run +=
        code >= 0x41 && code <= 0x5a
          ? String.fromCharCode(code + 32)
          : needle[index];
    }
  }
  if (run !== "") runs.push(run);
  return runs;
}

/**
 * The literals a JavaScript-syntax pattern requires, or null when it requires
 * none the analysis can prove.
 *
 * Under ignoreCase only the ASCII runs of needles are kept: RE2 folds some
 * non-ASCII letters (such as ς and σ) that lowercasing does not equate.
 */
export function requiredLiterals(
  pattern: string,
  ignoreCase: boolean,
): PreFilter | null {
  let parsed: { exact: string[]; requirement: Requirement };
  try {
    parsed = new RequirementParser(pattern).parse();
  } catch (error) {
    if (error instanceof UnsupportedPattern) return null;
    throw error;
  }
  const groups: string[][] = [];
  for (const group of parsed.requirement) {
    const needles = ignoreCase ? group.flatMap(foldedAsciiRuns) : group;
    if (needles.length === 0) return null;
    groups.push(capped(needles));
  }
  const exact = ignoreCase
    ? parsed.exact.filter(isAscii).map((literal) => literal.toLowerCase())
    : parsed.exact;
  return groups.length === 0
    ? null
    : { groups: distinct(groups), exact: [...new Set(exact)], ignoreCase };
}

function isAscii(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}

/**
 * Case-folds text for ASCII needles as RE2 does: of the non-ASCII letters RE2
 * folds into ASCII, U+212A (K) lowercases to k, but U+017F (ſ) lowercases to
 * itself, so it becomes s.
 */
function foldCase(text: string): string {
  const lower = text.toLowerCase();
  return lower.includes("ſ") ? lower.replaceAll("ſ", "s") : lower;
}

/** Whether text may match: it contains every needle of at least one group. */
export function preFilterMatches(preFilter: PreFilter, text: string): boolean {
  return containsGroup(
    preFilter.groups,
    preFilter.ignoreCase ? foldCase(text) : text,
  );
}

/**
 * What text's literals settle: "match" when it contains an exact alternative,
 * "no-match" when it lacks every group, else "unknown" and RE2 decides.
 */
export function preFilterVerdict(
  preFilter: PreFilter,
  text: string,
): "match" | "no-match" | "unknown" {
  const haystack = preFilter.ignoreCase ? foldCase(text) : text;
  // Of all non-ASCII characters, only K (U+212A) and İ (U+0130) lowercase to
  // something with ASCII in it. RE2 folds K to k, but not İ to the i of its
  // "i̇", so under ignoreCase an exact literal decides only text without İ.
  if (
    preFilter.exact.length > 0 &&
    (!preFilter.ignoreCase || !text.includes("İ"))
  ) {
    for (const literal of preFilter.exact) {
      if (haystack.includes(literal)) return "match";
    }
  }
  return containsGroup(preFilter.groups, haystack) ? "unknown" : "no-match";
}

function containsGroup(groups: string[][], haystack: string): boolean {
  for (let g = 0; g < groups.length; g++) {
    const needles = groups[g];
    let found = true;
    for (let n = 0; n < needles.length; n++) {
      if (!haystack.includes(needles[n])) {
        found = false;
        break;
      }
    }
    if (found) return true;
  }
  return false;
}
