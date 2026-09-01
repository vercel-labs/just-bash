import { describe, expect, it, vi } from "vitest";
import type {
  ArithCommandSubstNode,
  ArithmeticExpansionPart,
  SimpleCommandNode,
} from "../ast/types.js";
import { Parser } from "./parser.js";
import {
  scanBacktickSubstitutionEnd,
  scanCommandSubstitutionEnd,
} from "./parser-substitution.js";

const throwScanError = (message: string): never => {
  throw new Error(message);
};

const parseCommandSubstitution = (script: string): ArithCommandSubstNode => {
  const command = new Parser().parse(script).statements[0].pipelines[0]
    .commands[0] as SimpleCommandNode;
  const expansion = command.args[0].parts[0] as ArithmeticExpansionPart;
  if (expansion.type !== "ArithmeticExpansion") {
    throw new Error("expected arithmetic expansion");
  }
  const expression = expansion.expression.expression;
  if (expression.type !== "ArithBinary") {
    throw new Error("expected binary arithmetic expression");
  }
  if (expression.left.type !== "ArithCommandSubst") {
    throw new Error("expected arithmetic command substitution");
  }
  return expression.left;
};

describe("arithmetic command substitution parser", () => {
  it("keeps dollar-paren source text and parses its body", () => {
    const substitution = parseCommandSubstitution(
      'echo $(( $(printf "1 + 2") * 3 ))',
    );

    expect(substitution.command).toBe('printf "1 + 2"');
    expect(substitution.body?.statements).toHaveLength(1);
    expect(substitution.legacy).toBe(false);
  });

  it("keeps backtick source text and parses its body", () => {
    const substitution = parseCommandSubstitution(
      'echo $(( `printf "1 + 2"` * 3 ))',
    );

    expect(substitution.command).toBe('printf "1 + 2"');
    expect(substitution.body?.statements).toHaveLength(1);
    expect(substitution.legacy).toBe(true);
  });

  it("uses command substitution boundaries inside quoted command arguments", () => {
    const substitution = parseCommandSubstitution(
      'echo $(( $(printf ")" >&2; printf 1) + 1 ))',
    );

    expect(substitution.command).toBe('printf ")" >&2; printf 1');
    expect(substitution.body?.statements).toHaveLength(2);
  });

  it("parses each nested substitution body once", () => {
    const parse = vi.spyOn(Parser.prototype, "parse");
    try {
      new Parser().parse('echo $(( $(printf "$(printf 1)") + 1 ))');

      // The script, arithmetic substitution body, and nested word substitution.
      expect(parse).toHaveBeenCalledTimes(3);
    } finally {
      parse.mockRestore();
    }
  });

  it("scans heredoc bodies and escaped backticks without parsing them", () => {
    const heredoc = "$(cat <<'EOF'\n)\nEOF\nprintf 1\n) + 1";
    const backtick = "`printf \\`ignored\\`; printf 1` + 1";

    expect(scanCommandSubstitutionEnd(heredoc, 0, throwScanError)).toBe(
      heredoc.indexOf(" + 1"),
    );
    expect(
      scanBacktickSubstitutionEnd(backtick, 0, false, throwScanError),
    ).toBe(backtick.indexOf(" + 1"));
  });
});
