// Parser for sed scripts

import type {
  AddressRange,
  SedAddress,
  SedCommand,
  StepAddress,
} from "./types.js";

// Unsupported sed commands with descriptions
const UNSUPPORTED_COMMANDS: Record<string, string> = {
  r: "r (read file) - file operations not supported",
  R: "R (read line from file) - file operations not supported",
  w: "w (write to file) - file operations not supported",
  W: "W (write first line to file) - file operations not supported",
  e: "e (execute shell command) - shell execution not supported",
  l: "l (list/escape special chars) - not implemented",
  F: "F (print filename) - not implemented",
  Q: "Q (quit without printing) - use 'q' instead",
  v: "v (version check) - not implemented",
};

interface ParseResult {
  command: SedCommand | null;
  error?: string;
}

function parseAddress(addr: string): SedAddress | undefined {
  if (addr === "$") return "$";

  // Check for step address: first~step (e.g., 0~2, 1~3)
  const stepMatch = addr.match(/^(\d+)~(\d+)$/);
  if (stepMatch) {
    return {
      first: parseInt(stepMatch[1], 10),
      step: parseInt(stepMatch[2], 10),
    } as StepAddress;
  }

  const num = parseInt(addr, 10);
  if (!Number.isNaN(num)) return num;
  // Pattern address /pattern/
  if (addr.startsWith("/") && addr.endsWith("/")) {
    return { pattern: addr.slice(1, -1) };
  }
  return undefined;
}

function parseAddressRange(script: string): {
  range?: AddressRange;
  rest: string;
} {
  let rest = script;
  let start: SedAddress | undefined;
  let end: SedAddress | undefined;

  // Check for step address first: first~step (e.g., 0~2)
  const stepMatch = rest.match(/^(\d+)~(\d+)/);
  if (stepMatch) {
    start = {
      first: parseInt(stepMatch[1], 10),
      step: parseInt(stepMatch[2], 10),
    } as StepAddress;
    rest = rest.slice(stepMatch[0].length);
    // Step addresses don't support ranges, return immediately
    return { range: { start, end: undefined }, rest };
  }

  // Check for $ address
  if (rest.startsWith("$")) {
    start = "$";
    rest = rest.slice(1);
    if (rest.startsWith(",")) {
      rest = rest.slice(1);
      // Parse end address
      const endMatch = rest.match(/^(\d+|\$)/);
      if (endMatch) {
        end = parseAddress(endMatch[1]);
        rest = rest.slice(endMatch[0].length);
      }
    }
    return { range: { start, end }, rest };
  }

  // Check for numeric address
  const numMatch = rest.match(/^(\d+)/);
  if (numMatch) {
    start = parseInt(numMatch[1], 10);
    rest = rest.slice(numMatch[0].length);
    if (rest.startsWith(",")) {
      rest = rest.slice(1);
      const endMatch = rest.match(/^(\d+|\$)/);
      if (endMatch) {
        end = parseAddress(endMatch[1]);
        rest = rest.slice(endMatch[0].length);
      }
    }
    return { range: { start, end }, rest };
  }

  // Check for pattern address /pattern/
  if (rest.startsWith("/")) {
    let i = 1;
    while (i < rest.length && rest[i] !== "/") {
      if (rest[i] === "\\" && i + 1 < rest.length) {
        i += 2; // Skip escaped character
      } else {
        i++;
      }
    }
    if (i < rest.length) {
      start = { pattern: rest.slice(1, i) };
      rest = rest.slice(i + 1);
      if (rest.startsWith(",")) {
        rest = rest.slice(1);
        // Parse end address (could be another pattern or number)
        if (rest.startsWith("/")) {
          let j = 1;
          while (j < rest.length && rest[j] !== "/") {
            if (rest[j] === "\\" && j + 1 < rest.length) {
              j += 2;
            } else {
              j++;
            }
          }
          if (j < rest.length) {
            end = { pattern: rest.slice(1, j) };
            rest = rest.slice(j + 1);
          }
        } else {
          const endMatch = rest.match(/^(\d+|\$)/);
          if (endMatch) {
            end = parseAddress(endMatch[1]);
            rest = rest.slice(endMatch[0].length);
          }
        }
      }
      return { range: { start, end }, rest };
    }
  }

  return { rest };
}

function parseSedScript(script: string): ParseResult {
  const trimmed = script.trim();
  if (!trimmed) {
    return { command: null };
  }

  // Parse address range first
  const { range, rest } = parseAddressRange(trimmed);
  const cmd = rest.trim();

  // Empty command with address - treat as print
  if (!cmd && range) {
    return { command: { type: "print", address: range } };
  }

  // Handle single-character commands
  const firstChar = cmd[0];

  switch (firstChar) {
    case "p":
      return { command: { type: "print", address: range } };

    case "d":
      return { command: { type: "delete", address: range } };

    case "h":
      return { command: { type: "hold", address: range } };

    case "H":
      return { command: { type: "holdAppend", address: range } };

    case "g":
      // Check if this is 'g' command or part of substitution flags
      if (cmd.length === 1 || /^\s/.test(cmd[1])) {
        return { command: { type: "get", address: range } };
      }
      break;

    case "G":
      return { command: { type: "getAppend", address: range } };

    case "x":
      return { command: { type: "exchange", address: range } };

    case "n":
      return { command: { type: "next", address: range } };

    case "N":
      return { command: { type: "nextAppend", address: range } };

    case "P":
      // Print first line (up to newline)
      return { command: { type: "printFirstLine", address: range } };

    case "D":
      // Delete first line (up to newline), restart cycle
      return { command: { type: "deleteFirstLine", address: range } };

    case "q":
      return { command: { type: "quit", address: range } };

    case "z":
      // Zap/empty pattern space (GNU extension)
      return { command: { type: "zap", address: range } };

    case "=":
      return { command: { type: "lineNumber", address: range } };

    case "y":
      // Transliterate command: y/source/dest/
      return parseTransliterate(cmd, range);

    case "b": {
      // Branch command: b [label]
      const label = cmd.slice(1).trim();
      return {
        command: { type: "branch", address: range, label: label || undefined },
      };
    }

    case "t": {
      // Branch on substitution: t [label]
      const label = cmd.slice(1).trim();
      return {
        command: {
          type: "branchOnSubst",
          address: range,
          label: label || undefined,
        },
      };
    }

    case "T": {
      // Branch if NO substitution made: T [label]
      const label = cmd.slice(1).trim();
      return {
        command: {
          type: "branchOnNoSubst",
          address: range,
          label: label || undefined,
        },
      };
    }

    case "{":
      // Grouped commands - parse recursively
      return parseGroupedCommands(cmd, range);

    case ":": {
      // Label definition: :name
      const name = cmd.slice(1).trim();
      if (!name) {
        return { command: null, error: "missing label name" };
      }
      return { command: { type: "label", name } };
    }

    case "a":
      // Append command: a\ or a text
      if (cmd[1] === "\\" || cmd[1] === " ") {
        const text = cmd.slice(2).replace(/^[\s]*/, "");
        return { command: { type: "append", address: range, text } };
      }
      break;

    case "i":
      // Insert command: i\ or i text
      if (cmd[1] === "\\" || cmd[1] === " ") {
        const text = cmd.slice(2).replace(/^[\s]*/, "");
        return { command: { type: "insert", address: range, text } };
      }
      break;

    case "c":
      // Change command: c\ or c text
      if (cmd[1] === "\\" || cmd[1] === " ") {
        const text = cmd.slice(2).replace(/^[\s]*/, "");
        return { command: { type: "change", address: range, text } };
      }
      break;

    case "s":
      // Substitution command
      return parseSubstitute(cmd, range);
  }

  // Try parsing as substitution if it starts with 's'
  if (cmd.startsWith("s")) {
    return parseSubstitute(cmd, range);
  }

  // Check if this is an unsupported command
  if (firstChar && UNSUPPORTED_COMMANDS[firstChar]) {
    return {
      command: null,
      error: `unsupported command: ${UNSUPPORTED_COMMANDS[firstChar]}`,
    };
  }

  return { command: null, error: `invalid command: ${script}` };
}

function parseTransliterate(cmd: string, range?: AddressRange): ParseResult {
  // y/source/dest/
  if (!cmd.startsWith("y") || cmd.length < 4) {
    return { command: null, error: "invalid transliteration" };
  }

  const delimiter = cmd[1];
  let i = 2;
  let source = "";
  let dest = "";

  // Parse source characters
  while (i < cmd.length && cmd[i] !== delimiter) {
    if (cmd[i] === "\\" && i + 1 < cmd.length) {
      // Handle escape sequences
      const next = cmd[i + 1];
      if (next === "n") {
        source += "\n";
      } else if (next === "t") {
        source += "\t";
      } else {
        source += next;
      }
      i += 2;
    } else {
      source += cmd[i];
      i++;
    }
  }

  if (i >= cmd.length) {
    return { command: null, error: "unterminated transliteration source" };
  }

  i++; // Skip delimiter

  // Parse destination characters
  while (i < cmd.length && cmd[i] !== delimiter) {
    if (cmd[i] === "\\" && i + 1 < cmd.length) {
      const next = cmd[i + 1];
      if (next === "n") {
        dest += "\n";
      } else if (next === "t") {
        dest += "\t";
      } else {
        dest += next;
      }
      i += 2;
    } else {
      dest += cmd[i];
      i++;
    }
  }

  if (source.length !== dest.length) {
    return {
      command: null,
      error: "transliteration sets must have same length",
    };
  }

  return {
    command: {
      type: "transliterate",
      address: range,
      source,
      dest,
    },
  };
}

function parseSubstitute(cmd: string, range?: AddressRange): ParseResult {
  // s/pattern/replacement/flags
  if (!cmd.startsWith("s") || cmd.length < 4) {
    return { command: null, error: "invalid substitution" };
  }

  const delimiter = cmd[1];
  let pattern = "";
  let replacement = "";
  let flags = "";

  // Find pattern (handle escaped delimiters)
  let i = 2;
  while (i < cmd.length && cmd[i] !== delimiter) {
    if (cmd[i] === "\\" && i + 1 < cmd.length) {
      pattern += cmd[i] + cmd[i + 1];
      i += 2;
    } else {
      pattern += cmd[i];
      i++;
    }
  }

  if (i >= cmd.length) {
    return { command: null, error: "unterminated substitution pattern" };
  }

  i++; // Skip delimiter

  // Find replacement
  while (i < cmd.length && cmd[i] !== delimiter) {
    if (cmd[i] === "\\" && i + 1 < cmd.length) {
      replacement += cmd[i] + cmd[i + 1];
      i += 2;
    } else {
      replacement += cmd[i];
      i++;
    }
  }

  if (i < cmd.length) {
    i++; // Skip delimiter
    flags = cmd.slice(i);
  }

  // Parse numeric flags for Nth occurrence (e.g., s/foo/bar/2)
  let nthOccurrence: number | undefined;
  const numericMatch = flags.match(/(\d+)/);
  if (numericMatch) {
    nthOccurrence = parseInt(numericMatch[1], 10);
  }

  return {
    command: {
      type: "substitute",
      address: range,
      pattern,
      replacement,
      global: flags.includes("g"),
      ignoreCase: flags.includes("i"),
      printOnMatch: flags.includes("p"),
      nthOccurrence,
    },
  };
}

// Parse grouped commands: { cmd1; cmd2; ... }
function parseGroupedCommands(cmd: string, range?: AddressRange): ParseResult {
  // Find matching closing brace, handling nested braces and escapes
  let depth = 1;
  let i = 1; // Start after opening brace
  let inSubstitution = false;
  let subDelimiter = "";
  let subDelimCount = 0;

  while (i < cmd.length && depth > 0) {
    const ch = cmd[i];

    // Handle escape sequences
    if (ch === "\\" && i + 1 < cmd.length) {
      i += 2;
      continue;
    }

    // Track substitution commands to avoid counting braces in patterns
    if (
      !inSubstitution &&
      ch === "s" &&
      i + 1 < cmd.length &&
      /[^a-zA-Z0-9]/.test(cmd[i + 1])
    ) {
      inSubstitution = true;
      subDelimiter = cmd[i + 1];
      subDelimCount = 0;
      i++;
      continue;
    }

    if (inSubstitution && ch === subDelimiter) {
      subDelimCount++;
      if (subDelimCount >= 3) {
        inSubstitution = false;
      }
      i++;
      continue;
    }

    if (!inSubstitution) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    i++;
  }

  if (depth !== 0) {
    return { command: null, error: "unmatched brace in grouped commands" };
  }

  const innerCommands = cmd.slice(1, i - 1).trim();
  const parts = splitBySemicolon(innerCommands);

  const commands: SedCommand[] = [];
  for (const part of parts) {
    const result = parseSedScript(part);
    if (result.error) {
      return { command: null, error: result.error };
    }
    if (result.command) {
      commands.push(result.command);
    }
  }

  return {
    command: {
      type: "group",
      address: range,
      commands,
    },
  };
}

export function parseMultipleScripts(
  scripts: string[],
  extendedRegex = false,
): {
  commands: SedCommand[];
  error?: string;
} {
  const commands: SedCommand[] = [];

  for (const script of scripts) {
    // Split script by semicolons (but not within patterns/replacements)
    const parts = splitBySemicolon(script);

    for (const part of parts) {
      const result = parseSedScript(part);
      if (result.error) {
        return { commands: [], error: result.error };
      }
      if (result.command) {
        // Mark substitute commands with extended regex flag
        if (result.command.type === "substitute" && extendedRegex) {
          result.command.extendedRegex = true;
        }
        commands.push(result.command);
      }
    }
  }

  return { commands };
}

function splitBySemicolon(script: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSubstitution = false;
  let delimiter = "";
  let delimiterCount = 0;
  let braceDepth = 0;
  let i = 0;

  while (i < script.length) {
    const char = script[i];

    // Handle escape sequences
    if (char === "\\" && i + 1 < script.length) {
      current += char + script[i + 1];
      i += 2;
      continue;
    }

    // Track brace depth for grouped commands
    if (!inSubstitution) {
      if (char === "{") {
        braceDepth++;
        current += char;
        i++;
        continue;
      }
      if (char === "}") {
        braceDepth--;
        current += char;
        i++;
        continue;
      }
    }

    // Detect start of substitution command
    if (
      !inSubstitution &&
      char === "s" &&
      i + 1 < script.length &&
      /[^a-zA-Z0-9]/.test(script[i + 1])
    ) {
      delimiter = script[i + 1];
      delimiterCount = 0;
      inSubstitution = true;
      current += char;
      i++;
      continue;
    }

    // Track delimiters in substitution
    if (inSubstitution && char === delimiter) {
      delimiterCount++;
      current += char;
      // A substitution has 3 delimiters: s/pattern/replacement/
      // After the 3rd delimiter, we're done with the substitution (may have flags after)
      if (delimiterCount >= 3) {
        inSubstitution = false;
      }
      i++;
      continue;
    }

    // Only split on semicolons when not inside a substitution or braces
    if (!inSubstitution && braceDepth === 0 && char === ";") {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = "";
      i++;
      continue;
    }

    current += char;
    i++;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}
