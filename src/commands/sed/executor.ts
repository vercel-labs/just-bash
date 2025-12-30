// Executor for sed commands

import { ExecutionLimitError } from "../../interpreter/errors.js";
import type {
  AddressRange,
  BranchCommand,
  BranchOnNoSubstCommand,
  BranchOnSubstCommand,
  GroupCommand,
  SedAddress,
  SedCommand,
  SedExecutionLimits,
  SedState,
  StepAddress,
  SubstituteCommand,
  TransliterateCommand,
} from "./types.js";

const DEFAULT_MAX_ITERATIONS = 10000;

export function createInitialState(
  totalLines: number,
  filename?: string,
  rangeStates?: Map<string, import("./types.js").RangeState>,
): SedState {
  return {
    patternSpace: "",
    holdSpace: "",
    lineNumber: 0,
    totalLines,
    deleted: false,
    printed: false,
    quit: false,
    quitSilent: false,
    exitCode: undefined,
    appendBuffer: [],
    substitutionMade: false,
    lineNumberOutput: [],
    restartCycle: false,
    currentFilename: filename,
    pendingFileReads: [],
    pendingFileWrites: [],
    pendingExecute: undefined,
    rangeStates: rangeStates || new Map(),
  };
}

function isStepAddress(address: SedAddress): address is StepAddress {
  return typeof address === "object" && "first" in address && "step" in address;
}

function matchesAddress(
  address: SedAddress,
  lineNum: number,
  totalLines: number,
  line: string,
): boolean {
  if (address === "$") {
    return lineNum === totalLines;
  }
  if (typeof address === "number") {
    return lineNum === address;
  }
  // Step address: first~step (e.g., 0~2 matches lines 0, 2, 4, ...)
  if (isStepAddress(address)) {
    const { first, step } = address;
    if (step === 0) return lineNum === first;
    return (lineNum - first) % step === 0 && lineNum >= first;
  }
  if (typeof address === "object" && "pattern" in address) {
    try {
      const regex = new RegExp(address.pattern);
      return regex.test(line);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Serialize an address range to a string for use as a map key.
 */
function serializeRange(range: AddressRange): string {
  const serializeAddr = (addr: SedAddress | undefined): string => {
    if (addr === undefined) return "undefined";
    if (addr === "$") return "$";
    if (typeof addr === "number") return String(addr);
    if ("pattern" in addr) return `/${addr.pattern}/`;
    if ("first" in addr) return `${addr.first}~${addr.step}`;
    return "unknown";
  };
  return `${serializeAddr(range.start)},${serializeAddr(range.end)}`;
}

function isInRange(
  range: AddressRange | undefined,
  lineNum: number,
  totalLines: number,
  line: string,
  rangeStates?: Map<string, import("./types.js").RangeState>,
): boolean {
  if (!range || (!range.start && !range.end)) {
    return true; // No address means match all lines
  }

  const start = range.start;
  const end = range.end;

  if (start !== undefined && end === undefined) {
    // Single address
    return matchesAddress(start, lineNum, totalLines, line);
  }

  if (start !== undefined && end !== undefined) {
    // Address range - needs state tracking for pattern addresses
    const hasPatternStart = typeof start === "object" && "pattern" in start;
    const hasPatternEnd = typeof end === "object" && "pattern" in end;

    // If both are numeric, simple range check
    if (!hasPatternStart && !hasPatternEnd) {
      const startNum =
        typeof start === "number" ? start : start === "$" ? totalLines : 1;
      const endNum =
        typeof end === "number" ? end : end === "$" ? totalLines : totalLines;
      return lineNum >= startNum && lineNum <= endNum;
    }

    // For pattern ranges, use state tracking
    if (rangeStates) {
      const rangeKey = serializeRange(range);
      let rangeState = rangeStates.get(rangeKey);

      if (!rangeState) {
        rangeState = { active: false };
        rangeStates.set(rangeKey, rangeState);
      }

      if (!rangeState.active) {
        // Not in range yet - check if start matches
        if (matchesAddress(start, lineNum, totalLines, line)) {
          rangeState.active = true;
          rangeState.startLine = lineNum;
          rangeStates.set(rangeKey, rangeState);

          // Check if end also matches on the same line
          if (matchesAddress(end, lineNum, totalLines, line)) {
            rangeState.active = false;
            rangeStates.set(rangeKey, rangeState);
          }
          return true;
        }
        return false;
      } else {
        // Already in range - check if end matches
        if (matchesAddress(end, lineNum, totalLines, line)) {
          rangeState.active = false;
          rangeStates.set(rangeKey, rangeState);
        }
        return true;
      }
    }

    // Fallback for no range state tracking (shouldn't happen)
    const startMatches = matchesAddress(start, lineNum, totalLines, line);
    return startMatches;
  }

  return true;
}

/**
 * Convert Basic Regular Expression (BRE) to Extended Regular Expression (ERE).
 * In BRE: +, ?, |, (, ) are literal; \+, \?, \|, \(, \) are special
 * In ERE: +, ?, |, (, ) are special; \+, \?, \|, \(, \) are literal
 */
function breToEre(pattern: string): string {
  // This conversion handles the main differences between BRE and ERE:
  // 1. Unescape BRE special chars (\+, \?, \|, \(, \)) to make them special in ERE
  // 2. Escape ERE special chars (+, ?, |, (, )) that are literal in BRE

  let result = "";
  let i = 0;

  while (i < pattern.length) {
    if (pattern[i] === "\\") {
      if (i + 1 < pattern.length) {
        const next = pattern[i + 1];
        // BRE escaped chars that become special in ERE
        if (next === "+" || next === "?" || next === "|") {
          result += next; // Remove backslash to make it special
          i += 2;
          continue;
        }
        if (next === "(" || next === ")") {
          result += next; // Remove backslash for grouping
          i += 2;
          continue;
        }
        if (next === "{" || next === "}") {
          result += next; // Remove backslash for quantifiers
          i += 2;
          continue;
        }
        // Keep other escaped chars as-is
        result += pattern[i] + next;
        i += 2;
        continue;
      }
    }

    // ERE special chars that should be literal in BRE (without backslash)
    if (
      pattern[i] === "+" ||
      pattern[i] === "?" ||
      pattern[i] === "|" ||
      pattern[i] === "(" ||
      pattern[i] === ")"
    ) {
      result += `\\${pattern[i]}`; // Add backslash to make it literal
      i++;
      continue;
    }

    result += pattern[i];
    i++;
  }

  return result;
}

/**
 * Escape pattern space for the `l` (list) command.
 * Shows non-printable characters as escape sequences and ends with $.
 */
function escapeForList(input: string): string {
  let result = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const code = ch.charCodeAt(0);

    if (ch === "\\") {
      result += "\\\\";
    } else if (ch === "\t") {
      result += "\\t";
    } else if (ch === "\n") {
      result += "$\n";
    } else if (ch === "\r") {
      result += "\\r";
    } else if (ch === "\x07") {
      result += "\\a";
    } else if (ch === "\b") {
      result += "\\b";
    } else if (ch === "\f") {
      result += "\\f";
    } else if (ch === "\v") {
      result += "\\v";
    } else if (code < 32 || code >= 127) {
      // Non-printable: show as octal
      result += `\\${code.toString(8).padStart(3, "0")}`;
    } else {
      result += ch;
    }
  }
  return `${result}$`;
}

function processReplacement(
  replacement: string,
  match: string,
  groups: string[],
): string {
  let result = "";
  let i = 0;

  while (i < replacement.length) {
    if (replacement[i] === "\\") {
      if (i + 1 < replacement.length) {
        const next = replacement[i + 1];
        if (next === "&") {
          result += "&";
          i += 2;
          continue;
        }
        if (next === "n") {
          result += "\n";
          i += 2;
          continue;
        }
        if (next === "t") {
          result += "\t";
          i += 2;
          continue;
        }
        // Back-references \1 through \9
        const digit = parseInt(next, 10);
        if (digit >= 1 && digit <= 9) {
          result += groups[digit - 1] || "";
          i += 2;
          continue;
        }
        // Other escaped characters
        result += next;
        i += 2;
        continue;
      }
    }

    if (replacement[i] === "&") {
      result += match;
      i++;
      continue;
    }

    result += replacement[i];
    i++;
  }

  return result;
}

function executeCommand(cmd: SedCommand, state: SedState): void {
  const { lineNumber, totalLines, patternSpace } = state;

  // Labels don't have addresses and are handled separately
  if (cmd.type === "label") {
    return;
  }

  // Check if command applies to current line
  if (
    !isInRange(
      cmd.address,
      lineNumber,
      totalLines,
      patternSpace,
      state.rangeStates,
    )
  ) {
    return;
  }

  switch (cmd.type) {
    case "substitute": {
      const subCmd = cmd as SubstituteCommand;
      let flags = "";
      if (subCmd.global) flags += "g";
      if (subCmd.ignoreCase) flags += "i";

      // Convert BRE to ERE if not using extended regex mode
      // BRE: +, ?, |, (, ) are literal; \+, \?, \|, \(, \) are special
      // ERE (JavaScript): +, ?, |, (, ) are special
      const pattern = subCmd.extendedRegex
        ? subCmd.pattern
        : breToEre(subCmd.pattern);

      try {
        const regex = new RegExp(pattern, flags);

        // Check if pattern matches FIRST - for t/T command tracking
        // t should branch if substitution matched, even if replacement is same as original
        const hasMatch = regex.test(state.patternSpace);
        // Reset lastIndex after test() for global regex
        regex.lastIndex = 0;

        if (hasMatch) {
          // Mark substitution as successful BEFORE replacement (for t/T commands)
          state.substitutionMade = true;

          // Handle Nth occurrence
          if (
            subCmd.nthOccurrence &&
            subCmd.nthOccurrence > 0 &&
            !subCmd.global
          ) {
            let count = 0;
            const nth = subCmd.nthOccurrence;
            state.patternSpace = state.patternSpace.replace(
              new RegExp(pattern, `g${subCmd.ignoreCase ? "i" : ""}`),
              (match, ...args) => {
                count++;
                if (count === nth) {
                  const groups = args.slice(0, -2) as string[];
                  return processReplacement(subCmd.replacement, match, groups);
                }
                return match;
              },
            );
          } else {
            state.patternSpace = state.patternSpace.replace(
              regex,
              (match, ...args) => {
                // Extract captured groups (all args before the last two which are offset and string)
                const groups = args.slice(0, -2) as string[];
                return processReplacement(subCmd.replacement, match, groups);
              },
            );
          }

          if (subCmd.printOnMatch) {
            state.printed = true;
          }
        }
      } catch {
        // Invalid regex, skip
      }
      break;
    }

    case "print":
      state.printed = true;
      break;

    case "printFirstLine": {
      // P - print up to first newline
      const newlineIdx = state.patternSpace.indexOf("\n");
      if (newlineIdx !== -1) {
        state.lineNumberOutput.push(state.patternSpace.slice(0, newlineIdx));
      } else {
        state.lineNumberOutput.push(state.patternSpace);
      }
      break;
    }

    case "delete":
      state.deleted = true;
      break;

    case "deleteFirstLine": {
      // D - delete up to first newline, restart cycle if more content
      const newlineIdx = state.patternSpace.indexOf("\n");
      if (newlineIdx !== -1) {
        state.patternSpace = state.patternSpace.slice(newlineIdx + 1);
        // Restart the cycle from the beginning with remaining content
        state.restartCycle = true;
      } else {
        state.deleted = true;
      }
      break;
    }

    case "zap":
      // z - empty pattern space (GNU extension)
      state.patternSpace = "";
      break;

    case "append":
      state.appendBuffer.push(cmd.text);
      break;

    case "insert":
      // Insert happens before the current line
      // We'll handle this in the main loop by prepending
      state.appendBuffer.unshift(`__INSERT__${cmd.text}`);
      break;

    case "change":
      // Replace the current line entirely
      state.patternSpace = cmd.text;
      state.deleted = true; // Don't print original
      state.appendBuffer.push(cmd.text);
      break;

    case "hold":
      // h - Copy pattern space to hold space
      state.holdSpace = state.patternSpace;
      break;

    case "holdAppend":
      // H - Append pattern space to hold space (with newline)
      if (state.holdSpace) {
        state.holdSpace += `\n${state.patternSpace}`;
      } else {
        state.holdSpace = state.patternSpace;
      }
      break;

    case "get":
      // g - Copy hold space to pattern space
      state.patternSpace = state.holdSpace;
      break;

    case "getAppend":
      // G - Append hold space to pattern space (with newline)
      state.patternSpace += `\n${state.holdSpace}`;
      break;

    case "exchange": {
      // x - Exchange pattern and hold spaces
      const temp = state.patternSpace;
      state.patternSpace = state.holdSpace;
      state.holdSpace = temp;
      break;
    }

    case "next":
      // n - Print pattern space (if not in quiet mode), read next line
      // This will be handled in the main loop
      state.printed = true;
      break;

    case "quit":
      state.quit = true;
      if (cmd.exitCode !== undefined) {
        state.exitCode = cmd.exitCode;
      }
      break;

    case "quitSilent":
      // Q - quit without printing pattern space
      state.quit = true;
      state.quitSilent = true;
      if (cmd.exitCode !== undefined) {
        state.exitCode = cmd.exitCode;
      }
      break;

    case "list": {
      // l - list pattern space with escapes
      const escaped = escapeForList(state.patternSpace);
      state.lineNumberOutput.push(escaped);
      break;
    }

    case "printFilename":
      // F - print current filename
      if (state.currentFilename) {
        state.lineNumberOutput.push(state.currentFilename);
      }
      break;

    case "version":
      // v - version check (we always pass, just a no-op for compatibility)
      break;

    case "readFile":
      // r - queue file read (deferred execution)
      state.pendingFileReads.push({ filename: cmd.filename, wholeFile: true });
      break;

    case "readFileLine":
      // R - queue single line file read (deferred execution)
      state.pendingFileReads.push({ filename: cmd.filename, wholeFile: false });
      break;

    case "writeFile":
      // w - queue file write (deferred execution)
      state.pendingFileWrites.push({
        filename: cmd.filename,
        content: `${state.patternSpace}\n`,
      });
      break;

    case "writeFirstLine": {
      // W - queue first line file write (deferred execution)
      const newlineIdx = state.patternSpace.indexOf("\n");
      const firstLine =
        newlineIdx !== -1
          ? state.patternSpace.slice(0, newlineIdx)
          : state.patternSpace;
      state.pendingFileWrites.push({
        filename: cmd.filename,
        content: `${firstLine}\n`,
      });
      break;
    }

    case "execute":
      // e - queue shell execution (deferred execution)
      if (cmd.command) {
        // e command - execute specified command, append output
        state.pendingExecute = { command: cmd.command, replacePattern: false };
      } else {
        // e (no args) - execute pattern space, replace with output
        state.pendingExecute = {
          command: state.patternSpace,
          replacePattern: true,
        };
      }
      break;

    case "transliterate":
      // y/source/dest/ - Transliterate characters
      state.patternSpace = executeTransliterate(
        state.patternSpace,
        cmd as TransliterateCommand,
      );
      break;

    case "lineNumber":
      // = - Print line number
      state.lineNumberOutput.push(String(state.lineNumber));
      break;

    case "branch":
      // b [label] - Will be handled in executeCommands
      break;

    case "branchOnSubst":
      // t [label] - Will be handled in executeCommands
      break;

    case "branchOnNoSubst":
      // T [label] - Will be handled in executeCommands
      break;

    case "group":
      // Grouped commands - will be handled in executeCommands
      break;
  }
}

function executeTransliterate(
  input: string,
  cmd: TransliterateCommand,
): string {
  let result = "";
  for (const char of input) {
    const idx = cmd.source.indexOf(char);
    if (idx !== -1) {
      result += cmd.dest[idx];
    } else {
      result += char;
    }
  }
  return result;
}

export interface ExecuteContext {
  lines: string[];
  currentLineIndex: number;
}

export function executeCommands(
  commands: SedCommand[],
  state: SedState,
  ctx?: ExecuteContext,
  limits?: SedExecutionLimits,
): number {
  // Build label index for branching
  const labelIndex = new Map<string, number>();
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (cmd.type === "label") {
      labelIndex.set(cmd.name, i);
    }
  }

  const maxIterations = limits?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  let totalIterations = 0;

  let linesConsumed = 0;
  let i = 0;
  while (i < commands.length) {
    totalIterations++;
    if (totalIterations > maxIterations) {
      throw new ExecutionLimitError(
        `sed: command execution exceeded maximum iterations (${maxIterations})`,
        "iterations",
      );
    }

    if (state.deleted || state.quit || state.quitSilent || state.restartCycle)
      break;

    const cmd = commands[i];

    // Handle N command specially - it needs to append next line inline
    if (cmd.type === "nextAppend") {
      if (
        isInRange(
          cmd.address,
          state.lineNumber,
          state.totalLines,
          state.patternSpace,
          state.rangeStates,
        )
      ) {
        if (
          ctx &&
          ctx.currentLineIndex + linesConsumed + 1 < ctx.lines.length
        ) {
          linesConsumed++;
          const nextLine = ctx.lines[ctx.currentLineIndex + linesConsumed];
          state.patternSpace += `\n${nextLine}`;
          state.lineNumber = ctx.currentLineIndex + linesConsumed + 1;
        } else {
          // If no next line, N quits without printing current pattern space
          // This matches real bash behavior
          state.quit = true;
          state.deleted = true;
          break;
        }
      }
      i++;
      continue;
    }

    // Handle branching commands specially
    if (cmd.type === "branch") {
      const branchCmd = cmd as BranchCommand;
      // Check if address matches
      if (
        isInRange(
          branchCmd.address,
          state.lineNumber,
          state.totalLines,
          state.patternSpace,
          state.rangeStates,
        )
      ) {
        if (branchCmd.label) {
          const target = labelIndex.get(branchCmd.label);
          if (target !== undefined) {
            i = target;
            continue;
          }
        }
        // Branch without label means jump to end
        break;
      }
      i++;
      continue;
    }

    if (cmd.type === "branchOnSubst") {
      const branchCmd = cmd as BranchOnSubstCommand;
      // Check if address matches
      if (
        isInRange(
          branchCmd.address,
          state.lineNumber,
          state.totalLines,
          state.patternSpace,
          state.rangeStates,
        )
      ) {
        if (state.substitutionMade) {
          state.substitutionMade = false; // Reset flag
          if (branchCmd.label) {
            const target = labelIndex.get(branchCmd.label);
            if (target !== undefined) {
              i = target;
              continue;
            }
          }
          // Branch without label means jump to end
          break;
        }
      }
      i++;
      continue;
    }

    // T - branch if NO substitution made (since last line read)
    if (cmd.type === "branchOnNoSubst") {
      const branchCmd = cmd as BranchOnNoSubstCommand;
      // Check if address matches
      if (
        isInRange(
          branchCmd.address,
          state.lineNumber,
          state.totalLines,
          state.patternSpace,
          state.rangeStates,
        )
      ) {
        if (!state.substitutionMade) {
          if (branchCmd.label) {
            const target = labelIndex.get(branchCmd.label);
            if (target !== undefined) {
              i = target;
              continue;
            }
          }
          // Branch without label means jump to end
          break;
        }
      }
      i++;
      continue;
    }

    // Grouped commands - execute recursively
    if (cmd.type === "group") {
      const groupCmd = cmd as GroupCommand;
      if (
        isInRange(
          groupCmd.address,
          state.lineNumber,
          state.totalLines,
          state.patternSpace,
          state.rangeStates,
        )
      ) {
        // Execute all commands in the group
        executeCommands(groupCmd.commands, state, ctx, limits);
      }
      i++;
      continue;
    }

    executeCommand(cmd, state);
    i++;
  }

  return linesConsumed;
}
