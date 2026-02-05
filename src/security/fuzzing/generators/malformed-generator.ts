/**
 * Malformed Script Generator
 *
 * Generates intentionally broken bash scripts to stress-test
 * parser error recovery and interpreter robustness.
 *
 * 7 categories of broken scripts:
 * 1. Truncated - valid scripts cut at random point
 * 2. Unclosed quotes - unterminated string literals
 * 3. Unclosed parens - unterminated grouping constructs
 * 4. Missing keywords - incomplete compound commands
 * 5. Invalid operators - nonsensical operator sequences
 * 6. Byte-injected - random bytes inserted into valid scripts
 * 7. Degenerate - empty, whitespace-only, bare operators
 */

import fc from "fast-check";
import { bashScript } from "./grammar-generator.js";

// =============================================================================
// 1. Truncated Scripts
// =============================================================================

/** Valid script cut at a random point */
const truncatedScript: fc.Arbitrary<string> = bashScript.chain((script) =>
  fc
    .integer({ min: 1, max: Math.max(1, script.length - 1) })
    .map((cutPoint) => script.slice(0, cutPoint)),
);

// =============================================================================
// 2. Unclosed Quotes
// =============================================================================

const unclosedQuoteFragments = [
  'echo "hello',
  "echo 'hello",
  'x="value',
  "x='value",
  "echo \"nested 'quote",
  "cat <<EOF\nhello",
  'echo $"unterminated',
  "echo $'unterminated",
  'echo "$(echo hello',
  'echo "${var',
  'echo "hello world\nmore text',
  "echo 'multi\nline",
] as const;

const unclosedQuote: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...unclosedQuoteFragments),
  fc
    .tuple(
      fc.constantFrom('"', "'", '$"', "$'"),
      fc.stringOf(
        fc.constantFrom(
          ..."abcdefghijklmnopqrstuvwxyz 0123456789!@#%^&()-=+[]{}|;:,.<>?/",
        ),
        { maxLength: 30 },
      ),
    )
    .map(([quote, content]) => `echo ${quote}${content}`),
);

// =============================================================================
// 3. Unclosed Parens/Braces
// =============================================================================

const unclosedParenFragments = [
  "echo $(echo hello",
  "echo $((1 + 2",
  "echo $((1 + 2)",
  "(echo hello",
  "echo ${var",
  "echo ${var:-default",
  "echo ${#arr[",
  "{ echo hello",
  "echo ${var:0",
  "echo ${var/pattern",
  "echo ${!prefix",
  "echo $(( (1+2) * (3",
  "array=(one two",
] as const;

const unclosedParen: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...unclosedParenFragments),
  fc
    .tuple(
      fc.constantFrom("$(", "$((", "(", "${", "${!", "${#"),
      fc.stringOf(
        fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789 +*"),
        {
          maxLength: 20,
        },
      ),
    )
    .map(([open, content]) => `echo ${open}${content}`),
);

// =============================================================================
// 4. Missing Keywords
// =============================================================================

const missingKeywordFragments = [
  "if true; then echo yes",
  "if true; then echo yes; else echo no",
  "for i in 1 2 3; do echo $i",
  "while true; do echo loop",
  "until false; do echo loop",
  "case x in a) echo a",
  "case x in a) echo a;;",
  "if true; echo yes; fi",
  "for i; echo $i; done",
  "for in 1 2 3; do echo x; done",
  "then echo yes; fi",
  "do echo loop; done",
  "done",
  "fi",
  "esac",
  "if; then; fi",
  "for; do; done",
  "while; do; done",
  "select x in; do; done",
  "case in esac",
] as const;

const missingKeyword: fc.Arbitrary<string> = fc.constantFrom(
  ...missingKeywordFragments,
);

// =============================================================================
// 5. Invalid Operators
// =============================================================================

const invalidOperatorFragments = [
  "echo hello ||| world",
  "echo hello &&& world",
  "echo hello >>>> file",
  "echo hello ;;;",
  "echo hello <<<< world",
  "echo hello |&&| world",
  "echo hello >>| world",
  "echo hello &|& world",
  "echo hello ;;;&& world",
  "echo hello |&|&| world",
  "echo hello >>> world",
  "echo hello <<<",
  "||",
  "&&",
  ";;",
  ">>>",
  "|&|",
  "& &",
  "| |",
] as const;

const invalidOperator: fc.Arbitrary<string> = fc.constantFrom(
  ...invalidOperatorFragments,
);

// =============================================================================
// 6. Byte-Injected Scripts
// =============================================================================

/** Random bytes inserted into valid scripts */
const byteInjectedScript: fc.Arbitrary<string> = bashScript.chain((script) =>
  fc
    .tuple(
      fc.integer({ min: 0, max: Math.max(0, script.length - 1) }),
      fc.stringOf(
        fc.integer({ min: 0, max: 255 }).map((n) => String.fromCharCode(n)),
        { minLength: 1, maxLength: 5 },
      ),
    )
    .map(([pos, bytes]) => script.slice(0, pos) + bytes + script.slice(pos)),
);

// =============================================================================
// 7. Degenerate Scripts
// =============================================================================

const degenerateFragments = [
  "",
  " ",
  "\t",
  "\n",
  "\n\n\n",
  "  \t  \n  ",
  "#",
  "# comment only",
  "# comment\n# comment",
  ";",
  ";;",
  "&",
  "|",
  ">",
  "<",
  "(",
  ")",
  "{",
  "}",
  "!",
  "\\",
  "\0",
  "\x01",
  "\x7f",
  "\xff",
] as const;

const degenerateScript: fc.Arbitrary<string> = fc.constantFrom(
  ...degenerateFragments,
);

// =============================================================================
// Mutated Compound - takes valid compound commands and randomly deletes ranges
// =============================================================================

const mutatedCompound: fc.Arbitrary<string> = bashScript.chain((script) => {
  if (script.length < 3) return fc.constant(script);
  return fc
    .tuple(
      fc.integer({ min: 0, max: script.length - 2 }),
      fc.integer({ min: 1, max: Math.min(10, script.length - 1) }),
    )
    .map(([start, len]) => {
      const end = Math.min(start + len, script.length);
      return script.slice(0, start) + script.slice(end);
    });
});

// =============================================================================
// Combined Generator
// =============================================================================

/** Combined malformed script generator with weighted categories */
export const malformedScript: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: truncatedScript },
  { weight: 3, arbitrary: unclosedQuote },
  { weight: 3, arbitrary: unclosedParen },
  { weight: 4, arbitrary: missingKeyword },
  { weight: 3, arbitrary: invalidOperator },
  { weight: 3, arbitrary: byteInjectedScript },
  { weight: 2, arbitrary: degenerateScript },
  { weight: 3, arbitrary: mutatedCompound },
);

/** Export individual generators for targeted testing */
export {
  truncatedScript,
  unclosedQuote,
  unclosedParen,
  missingKeyword,
  invalidOperator,
  byteInjectedScript,
  degenerateScript,
  mutatedCompound,
};
