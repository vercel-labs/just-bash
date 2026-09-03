// Default engine: re2js, a pure-JS port of RE2.

import { RE2JS, RE2JSSyntaxException } from "re2js";
import {
  type CompiledRegex,
  type RegexEngine,
  type RegexEngineFlags,
  type RegexMatcher,
  RegexSyntaxError,
} from "./engine.js";

type Re2jsMatcher = ReturnType<RE2JS["matcher"]>;

function convertFlags(flags: RegexEngineFlags): number {
  let re2Flags = 0;
  if (flags.ignoreCase) {
    re2Flags |= RE2JS.CASE_INSENSITIVE;
  }
  if (flags.multiline) {
    re2Flags |= RE2JS.MULTILINE;
  }
  if (flags.dotAll) {
    re2Flags |= RE2JS.DOTALL;
  }
  return re2Flags;
}

class Re2jsMatcherAdapter implements RegexMatcher {
  constructor(
    private readonly re2: RE2JS,
    private readonly matcher: Re2jsMatcher,
  ) {}

  find(start?: number): boolean {
    return this.matcher.find(start);
  }

  start(group?: number): number {
    return this.matcher.start(group);
  }

  end(group?: number): number {
    return this.matcher.end(group);
  }

  group(index = 0): string | null {
    if (index > this.re2.groupCount()) {
      return null;
    }
    return this.matcher.group(index);
  }

  groups(): (string | null)[] {
    const count = this.re2.groupCount();
    const groups = new Array<string | null>(count + 1);
    for (let i = 0; i <= count; i++) {
      groups[i] = this.matcher.group(i);
    }
    return groups;
  }

  namedGroups(): Record<string, string | null> {
    const named: Record<string, string | null> = Object.create(null);
    for (const [name, index] of Object.entries(this.re2.namedGroups())) {
      named[name] = this.matcher.group(index);
    }
    return named;
  }

  reset(input: string): void {
    // re2js's resetMatcherInput throws on raw strings and MatcherInput is not
    // exported, so retarget the existing wrapper; reset() re-reads its length.
    // biome-ignore lint/suspicious/noExplicitAny: reaching into re2js internals
    (this.matcher as any).matcherInput.charSequence = input;
    this.matcher.reset();
  }
}

class Re2jsCompiledRegex implements CompiledRegex {
  constructor(private readonly re2: RE2JS) {}

  matcher(input: string): RegexMatcher {
    return new Re2jsMatcherAdapter(this.re2, this.re2.matcher(input));
  }
}

export const re2jsEngine: RegexEngine = {
  compile(pattern, flags) {
    try {
      return new Re2jsCompiledRegex(
        RE2JS.compile(RE2JS.translateRegExp(pattern), convertFlags(flags)),
      );
    } catch (e) {
      if (e instanceof RE2JSSyntaxException) {
        throw new RegexSyntaxError(e.message || "");
      }
      throw e;
    }
  },
};
