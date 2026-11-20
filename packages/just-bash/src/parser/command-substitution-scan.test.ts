import { describe, expect, it } from "vitest";
import { Lexer } from "./lexer.js";

/** Lex `echo <word> b` and return the token values. */
const tokenValues = (word: string): string[] =>
  new Lexer(`echo ${word} b`).tokenize().map((token) => token.value);

// The lexer must end a `$(...)` word at the same `)` as bash 5.2.
describe("command substitution scan - comments", () => {
  // A comment here hides a `)`, so the word ends at a later `)`.
  it.each([
    ["at the start of the body", "$(#c )\necho a)"],
    ["after ;", "$(true;#c )\necho a)"],
    ["after |", "$(echo a|#c )\ncat)"],
    ["after &&", "$(true&&#c )\necho a)"],
    ["after a subshell", "$( (echo a)#c )\n)"],
    ["after a case pattern", "$(case a in a)#c )\necho a;; esac)"],
    ["after a line continuation", "$(echo a \\\n#c )\n)"],
    ["after a heredoc body", "$(cat <<E\na\nE\n#c )\n)"],
  ])("skips a comment %s", (_name, word) => {
    expect(tokenValues(word)).toEqual(["echo", word, "b", ""]);
  });

  // A `#` here is text, so the first `)` ends the word.
  it.each([
    ["after a non-letter", "$(echo a-#c )"],
    ["after a quote", '$(echo "a"#c )'],
    ["after a command substitution", "$(echo $(echo a)#c )"],
    ["after a process substitution", "$(echo <(true)#c )"],
  ])("keeps a `#` %s", (_name, word) => {
    expect(tokenValues(word)).toEqual(["echo", word, "b", ""]);
  });
});
