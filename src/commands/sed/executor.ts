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

export function createInitialState(totalLines: number): SedState {
  return {
    patternSpace: "",
    holdSpace: "",
    lineNumber: 0,
    totalLines,
    deleted: false,
    printed: false,
    quit: false,
    appendBuffer: [],
    substitutionMade: false,
    lineNumberOutput: [],
    restartCycle: false,
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

function isInRange(
  range: AddressRange | undefined,
  lineNum: number,
  totalLines: number,
  line: string,
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
    // Address range
    const startNum =
      typeof start === "number" ? start : start === "$" ? totalLines : 1;
    const endNum =
      typeof end === "number" ? end : end === "$" ? totalLines : totalLines;

    // Pattern addresses in ranges need special handling
    if (typeof start === "object" && "pattern" in start) {
      // For pattern ranges, check if we're in the range
      // This is a simplified implementation - real sed tracks range state
      const startMatches = matchesAddress(start, lineNum, totalLines, line);
      if (startMatches) return true;
    }

    return lineNum >= startNum && lineNum <= endNum;
  }

  return true;
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
  if (!isInRange(cmd.address, lineNumber, totalLines, patternSpace)) {
    return;
  }

  switch (cmd.type) {
    case "substitute": {
      const subCmd = cmd as SubstituteCommand;
      let flags = "";
      if (subCmd.global) flags += "g";
      if (subCmd.ignoreCase) flags += "i";

      // Note: JavaScript RegExp always uses ERE (Extended Regular Expressions) syntax,
      // so -E/-r flag doesn't change behavior. BRE patterns may not work as expected.
      // This matches the most common use case since agents typically use -E anyway.
      try {
        const regex = new RegExp(subCmd.pattern, flags);
        const original = state.patternSpace;

        // Handle Nth occurrence
        if (
          subCmd.nthOccurrence &&
          subCmd.nthOccurrence > 0 &&
          !subCmd.global
        ) {
          let count = 0;
          const nth = subCmd.nthOccurrence;
          state.patternSpace = state.patternSpace.replace(
            new RegExp(subCmd.pattern, `g${subCmd.ignoreCase ? "i" : ""}`),
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

        const hadMatch = original !== state.patternSpace;
        if (hadMatch) {
          state.substitutionMade = true;
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

    if (state.deleted || state.quit || state.restartCycle) break;

    const cmd = commands[i];

    // Handle N command specially - it needs to append next line inline
    if (cmd.type === "nextAppend") {
      if (
        isInRange(
          cmd.address,
          state.lineNumber,
          state.totalLines,
          state.patternSpace,
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
