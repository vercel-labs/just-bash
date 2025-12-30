// Parser for sed scripts using lexer-based tokenization

import { SedLexer, type SedToken, SedTokenType } from "./lexer.js";
import type { AddressRange, SedAddress, SedCommand } from "./types.js";

interface ParseResult {
  commands: SedCommand[];
  error?: string;
}

class SedParser {
  private tokens: SedToken[] = [];
  private pos = 0;
  private extendedRegex = false;

  constructor(
    private scripts: string[],
    extendedRegex = false,
  ) {
    this.extendedRegex = extendedRegex;
  }

  parse(): ParseResult {
    const allCommands: SedCommand[] = [];

    for (const script of this.scripts) {
      const lexer = new SedLexer(script);
      this.tokens = lexer.tokenize();
      this.pos = 0;

      while (!this.isAtEnd()) {
        // Skip empty tokens
        if (
          this.check(SedTokenType.NEWLINE) ||
          this.check(SedTokenType.SEMICOLON)
        ) {
          this.advance();
          continue;
        }

        const result = this.parseCommand();
        if (result.error) {
          return { commands: [], error: result.error };
        }
        if (result.command) {
          allCommands.push(result.command);
        }
      }
    }

    return { commands: allCommands };
  }

  private parseCommand(): { command: SedCommand | null; error?: string } {
    // Parse optional address range
    const address = this.parseAddressRange();

    // Skip whitespace tokens
    while (
      this.check(SedTokenType.NEWLINE) ||
      this.check(SedTokenType.SEMICOLON)
    ) {
      this.advance();
    }

    if (this.isAtEnd()) {
      // Address with no command - treat as print
      if (
        address &&
        (address.start !== undefined || address.end !== undefined)
      ) {
        return { command: { type: "print", address } };
      }
      return { command: null };
    }

    const token = this.peek();

    switch (token.type) {
      case SedTokenType.COMMAND:
        return this.parseSimpleCommand(token, address);

      case SedTokenType.SUBSTITUTE:
        return this.parseSubstituteFromToken(token, address);

      case SedTokenType.TRANSLITERATE:
        return this.parseTransliterateFromToken(token, address);

      case SedTokenType.LABEL_DEF:
        this.advance();
        return {
          command: { type: "label", name: token.label || "" },
        };

      case SedTokenType.BRANCH:
        this.advance();
        return {
          command: { type: "branch", address, label: token.label },
        };

      case SedTokenType.BRANCH_ON_SUBST:
        this.advance();
        return {
          command: { type: "branchOnSubst", address, label: token.label },
        };

      case SedTokenType.BRANCH_ON_NO_SUBST:
        this.advance();
        return {
          command: { type: "branchOnNoSubst", address, label: token.label },
        };

      case SedTokenType.TEXT_CMD:
        this.advance();
        return this.parseTextCommand(token, address);

      case SedTokenType.FILE_READ:
        this.advance();
        return {
          command: {
            type: "readFile",
            address,
            filename: token.filename || "",
          },
        };

      case SedTokenType.FILE_READ_LINE:
        this.advance();
        return {
          command: {
            type: "readFileLine",
            address,
            filename: token.filename || "",
          },
        };

      case SedTokenType.FILE_WRITE:
        this.advance();
        return {
          command: {
            type: "writeFile",
            address,
            filename: token.filename || "",
          },
        };

      case SedTokenType.FILE_WRITE_LINE:
        this.advance();
        return {
          command: {
            type: "writeFirstLine",
            address,
            filename: token.filename || "",
          },
        };

      case SedTokenType.EXECUTE:
        this.advance();
        return {
          command: { type: "execute", address, command: token.command },
        };

      case SedTokenType.LBRACE:
        return this.parseGroup(address);

      case SedTokenType.RBRACE:
        // End of group - handled by parseGroup
        return { command: null };

      case SedTokenType.ERROR:
        return { command: null, error: `invalid command: ${token.value}` };

      default:
        // If we have an address but no recognized command, treat as print
        if (
          address &&
          (address.start !== undefined || address.end !== undefined)
        ) {
          return { command: { type: "print", address } };
        }
        return { command: null };
    }
  }

  private parseSimpleCommand(
    token: SedToken,
    address?: AddressRange,
  ): { command: SedCommand | null; error?: string } {
    this.advance();
    const cmd = token.value as string;

    switch (cmd) {
      case "p":
        return { command: { type: "print", address } };
      case "P":
        return { command: { type: "printFirstLine", address } };
      case "d":
        return { command: { type: "delete", address } };
      case "D":
        return { command: { type: "deleteFirstLine", address } };
      case "h":
        return { command: { type: "hold", address } };
      case "H":
        return { command: { type: "holdAppend", address } };
      case "g":
        return { command: { type: "get", address } };
      case "G":
        return { command: { type: "getAppend", address } };
      case "x":
        return { command: { type: "exchange", address } };
      case "n":
        return { command: { type: "next", address } };
      case "N":
        return { command: { type: "nextAppend", address } };
      case "q":
        return { command: { type: "quit", address } };
      case "Q":
        return { command: { type: "quitSilent", address } };
      case "z":
        return { command: { type: "zap", address } };
      case "=":
        return { command: { type: "lineNumber", address } };
      case "l":
        return { command: { type: "list", address } };
      case "F":
        return { command: { type: "printFilename", address } };
      case "v":
        return { command: { type: "version", address } };
      default:
        return { command: null, error: `unknown command: ${cmd}` };
    }
  }

  private parseSubstituteFromToken(
    token: SedToken,
    address?: AddressRange,
  ): { command: SedCommand | null; error?: string } {
    this.advance();

    const flags = token.flags || "";
    let nthOccurrence: number | undefined;
    const numMatch = flags.match(/(\d+)/);
    if (numMatch) {
      nthOccurrence = parseInt(numMatch[1], 10);
    }

    return {
      command: {
        type: "substitute",
        address,
        pattern: token.pattern || "",
        replacement: token.replacement || "",
        global: flags.includes("g"),
        ignoreCase: flags.includes("i") || flags.includes("I"),
        printOnMatch: flags.includes("p"),
        nthOccurrence,
        extendedRegex: this.extendedRegex,
      },
    };
  }

  private parseTransliterateFromToken(
    token: SedToken,
    address?: AddressRange,
  ): { command: SedCommand | null; error?: string } {
    this.advance();

    const source = token.source || "";
    const dest = token.dest || "";

    if (source.length !== dest.length) {
      return {
        command: null,
        error: "transliteration sets must have same length",
      };
    }

    return {
      command: {
        type: "transliterate",
        address,
        source,
        dest,
      },
    };
  }

  private parseTextCommand(
    token: SedToken,
    address?: AddressRange,
  ): { command: SedCommand | null; error?: string } {
    const cmd = token.value as string;
    const text = token.text || "";

    switch (cmd) {
      case "a":
        return { command: { type: "append", address, text } };
      case "i":
        return { command: { type: "insert", address, text } };
      case "c":
        return { command: { type: "change", address, text } };
      default:
        return { command: null, error: `unknown text command: ${cmd}` };
    }
  }

  private parseGroup(address?: AddressRange): {
    command: SedCommand | null;
    error?: string;
  } {
    this.advance(); // consume {

    const commands: SedCommand[] = [];

    while (!this.isAtEnd() && !this.check(SedTokenType.RBRACE)) {
      // Skip empty tokens
      if (
        this.check(SedTokenType.NEWLINE) ||
        this.check(SedTokenType.SEMICOLON)
      ) {
        this.advance();
        continue;
      }

      const result = this.parseCommand();
      if (result.error) {
        return { command: null, error: result.error };
      }
      if (result.command) {
        commands.push(result.command);
      }
    }

    if (!this.check(SedTokenType.RBRACE)) {
      return { command: null, error: "unmatched brace in grouped commands" };
    }
    this.advance(); // consume }

    return {
      command: { type: "group", address, commands },
    };
  }

  private parseAddressRange(): AddressRange | undefined {
    // Try to parse first address
    const start = this.parseAddress();
    if (start === undefined) {
      return undefined;
    }

    // Check for range separator
    let end: SedAddress | undefined;
    if (this.check(SedTokenType.COMMA)) {
      this.advance();
      end = this.parseAddress();
    }

    return { start, end };
  }

  private parseAddress(): SedAddress | undefined {
    const token = this.peek();

    switch (token.type) {
      case SedTokenType.NUMBER:
        this.advance();
        return token.value as number;

      case SedTokenType.DOLLAR:
        this.advance();
        return "$";

      case SedTokenType.PATTERN:
        this.advance();
        return { pattern: token.pattern || (token.value as string) };

      case SedTokenType.STEP:
        this.advance();
        return {
          first: token.first || 0,
          step: token.step || 0,
        };

      default:
        return undefined;
    }
  }

  private peek(): SedToken {
    return (
      this.tokens[this.pos] || {
        type: SedTokenType.EOF,
        value: "",
        line: 0,
        column: 0,
      }
    );
  }

  private advance(): SedToken {
    if (!this.isAtEnd()) {
      this.pos++;
    }
    return this.tokens[this.pos - 1];
  }

  private check(type: SedTokenType): boolean {
    return this.peek().type === type;
  }

  private isAtEnd(): boolean {
    return this.peek().type === SedTokenType.EOF;
  }
}

/**
 * Parse multiple sed scripts into a list of commands.
 * This is the main entry point for parsing sed scripts.
 */
export function parseMultipleScripts(
  scripts: string[],
  extendedRegex = false,
): {
  commands: SedCommand[];
  error?: string;
} {
  const parser = new SedParser(scripts, extendedRegex);
  return parser.parse();
}
