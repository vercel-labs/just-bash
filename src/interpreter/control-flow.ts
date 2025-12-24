import type { ExecResult } from "../types.js";
import type { InterpreterContext } from "./types.js";

/**
 * Parse and execute an if statement
 * Syntax: if CONDITION; then COMMANDS; [elif CONDITION; then COMMANDS;]... [else COMMANDS;] fi
 */
export async function executeIfStatement(
  input: string,
  ctx: InterpreterContext,
): Promise<ExecResult> {
  const parsed = parseIfStatement(input);
  if (parsed.error) {
    return { stdout: "", stderr: parsed.error, exitCode: 2 };
  }

  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  // Evaluate conditions in order
  for (const branch of parsed.branches) {
    if (branch.condition === null) {
      // This is the else branch - execute it
      const result = await ctx.exec(branch.body);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
      break;
    }

    // Evaluate the condition
    const condResult = await ctx.exec(branch.condition);
    if (condResult.exitCode === 0) {
      // Condition is true, execute the body
      const result = await ctx.exec(branch.body);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
      break;
    }
  }

  return { stdout, stderr, exitCode };
}

/**
 * Parse if statement into structured form
 */
export function parseIfStatement(input: string): {
  branches: { condition: string | null; body: string }[];
  error?: string;
} {
  const branches: { condition: string | null; body: string }[] = [];

  // Tokenize preserving structure
  let rest = input.trim();

  // Must start with 'if'
  if (!rest.startsWith("if ") && !rest.startsWith("if;")) {
    return {
      branches: [],
      error: "bash: syntax error near unexpected token\n",
    };
  }
  rest = rest.slice(2).trim();

  // Parse: CONDITION; then BODY [elif CONDITION; then BODY]* [else BODY] fi
  let depth = 1;
  let pos = 0;
  let state: "condition" | "body" = "condition";
  let currentCondition = "";
  let currentBody = "";

  while (pos < rest.length && depth > 0) {
    // Check for here document - skip until delimiter
    const hereDocMatch = rest.slice(pos).match(/^<<(-?)(['"]?)(\w+)\2/);
    if (hereDocMatch) {
      const delimiter = hereDocMatch[3];
      const hereDocStart = hereDocMatch[0];
      // Add the << line to current accumulator
      if (state === "condition") {
        currentCondition += hereDocStart;
      } else {
        currentBody += hereDocStart;
      }
      pos += hereDocStart.length;

      // Find the end delimiter on its own line
      // First, skip to end of current line
      while (pos < rest.length && rest[pos] !== "\n") {
        if (state === "condition") {
          currentCondition += rest[pos];
        } else {
          currentBody += rest[pos];
        }
        pos++;
      }

      // Now scan lines until we find the delimiter
      while (pos < rest.length) {
        // Add the newline
        if (state === "condition") {
          currentCondition += rest[pos];
        } else {
          currentBody += rest[pos];
        }
        pos++;

        // Check if this line starts with the delimiter
        const _lineStart = pos;
        let lineContent = "";
        while (pos < rest.length && rest[pos] !== "\n") {
          lineContent += rest[pos];
          pos++;
        }

        // Check if this line is the delimiter
        if (lineContent.trim() === delimiter) {
          // Add the delimiter line to the body
          if (state === "condition") {
            currentCondition += lineContent;
          } else {
            currentBody += lineContent;
          }
          break;
        } else {
          // Not the delimiter, add the line content
          if (state === "condition") {
            currentCondition += lineContent;
          } else {
            currentBody += lineContent;
          }
        }
      }
      continue;
    }

    // Check for nested if
    if (rest.slice(pos).match(/^if\s/)) {
      if (state === "condition") {
        currentCondition += "if ";
      } else {
        currentBody += "if ";
      }
      pos += 3;
      depth++;
      continue;
    }

    // Check for fi
    if (rest.slice(pos).match(/^fi(\s|;|$)/)) {
      depth--;
      if (depth === 0) {
        // End of our if statement
        if (state === "body") {
          branches.push({
            condition: currentCondition.trim() || null,
            body: currentBody.trim(),
          });
        }
        break;
      } else {
        if (state === "condition") {
          currentCondition += "fi";
        } else {
          currentBody += "fi";
        }
        pos += 2;
        continue;
      }
    }

    // Check for 'then' (only at depth 1)
    if (depth === 1 && rest.slice(pos).match(/^then(\s|;|$)/)) {
      state = "body";
      pos += 4;
      // Skip semicolon/whitespace
      while (pos < rest.length && (rest[pos] === ";" || rest[pos] === " "))
        pos++;
      continue;
    }

    // Check for 'elif' (only at depth 1)
    if (depth === 1 && rest.slice(pos).match(/^elif\s/)) {
      // Save current branch
      if (currentCondition.trim() || currentBody.trim()) {
        branches.push({
          condition: currentCondition.trim(),
          body: currentBody.trim(),
        });
      }
      currentCondition = "";
      currentBody = "";
      state = "condition";
      pos += 5;
      continue;
    }

    // Check for 'else' (only at depth 1)
    if (depth === 1 && rest.slice(pos).match(/^else(\s|;|$)/)) {
      // Save current branch
      if (currentCondition.trim() || currentBody.trim()) {
        branches.push({
          condition: currentCondition.trim(),
          body: currentBody.trim(),
        });
      }
      currentCondition = "";
      currentBody = "";
      // else has no condition
      state = "body";
      pos += 4;
      // Skip semicolon/whitespace
      while (pos < rest.length && (rest[pos] === ";" || rest[pos] === " "))
        pos++;
      // Mark this as else branch (no condition)
      currentCondition = "";
      continue;
    }

    // Regular character
    if (state === "condition") {
      // Handle semicolon before 'then'
      if (rest[pos] === ";") {
        pos++;
        // Skip whitespace
        while (pos < rest.length && rest[pos] === " ") pos++;
        continue;
      }
      currentCondition += rest[pos];
    } else {
      currentBody += rest[pos];
    }
    pos++;
  }

  // Handle 'else' branch specially
  if (branches.length > 0 && branches[branches.length - 1].condition === "") {
    branches[branches.length - 1].condition = null;
  }

  if (depth !== 0) {
    return {
      branches: [],
      error: "bash: syntax error: unexpected end of file\n",
    };
  }

  if (branches.length === 0) {
    return {
      branches: [],
      error: "bash: syntax error near unexpected token\n",
    };
  }

  return { branches };
}

/**
 * Parse a for loop with proper nesting support
 */
function parseForLoop(input: string): {
  varName: string;
  listStr: string;
  body: string;
  rest: string;
} | null {
  // Match: for VAR in LIST; do or for VAR in LIST\ndo
  // Note: \s* after "in" allows empty list like "for i in; do"
  const headerMatch = input.match(
    /^for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s*(.*?)(?:\s*[;\n]\s*|\s+)do(?:\s*[;\n]|\s+)/s,
  );
  if (!headerMatch) return null;

  const varName = headerMatch[1];
  const listStr = headerMatch[2];
  let pos = headerMatch[0].length;

  // Find matching done with proper nesting
  let depth = 1;
  const bodyStart = pos;

  while (pos < input.length && depth > 0) {
    // Check if at start of line/command (for keyword detection)
    // Valid positions: start of input, after newline, after semicolon, or after "do" keyword
    const isAtLineStart = (() => {
      if (pos === 0) return true;
      let i = pos - 1;
      while (i >= 0 && (input[i] === " " || input[i] === "\t")) i--;
      if (i < 0 || input[i] === "\n" || input[i] === ";") return true;
      // Also check for "do" keyword before current position (e.g., "do for j in...")
      if (input[i] === "o" && i > 0 && input[i - 1] === "d") {
        // Make sure it's standalone "do", not part of another word like "undo"
        const beforeDo = i - 2;
        if (beforeDo < 0 || /[\s;\n]/.test(input[beforeDo])) return true;
      }
      return false;
    })();

    const slice = input.slice(pos);

    // Check for nested loops (for/while/until ... do)
    if (isAtLineStart && slice.match(/^(for|while|until)\s/)) {
      // Find 'do' to confirm it's a loop
      const loopMatch = slice.match(
        /^(for|while|until)\s.*?(?:\s*[;\n]\s*|\s+)do(?:\s*[;\n]|\s+)/s,
      );
      if (loopMatch) {
        depth++;
        pos += loopMatch[0].length;
        continue;
      }
    }

    // Check for done
    if (isAtLineStart && slice.match(/^done(?:\s|;|$|\|)/)) {
      depth--;
      if (depth === 0) {
        const body = input.slice(bodyStart, pos).trim();
        const rest = input.slice(pos + 4).trim(); // Skip "done"
        return { varName, listStr, body, rest };
      }
      pos += 4;
      continue;
    }

    pos++;
  }

  return null;
}

/**
 * Execute a for loop
 * Syntax: for VAR in LIST; do COMMANDS; done [| pipeline]
 * Supports both single-line (with semicolons) and multi-line (with newlines)
 */
export async function executeForLoop(
  input: string,
  ctx: InterpreterContext,
): Promise<ExecResult> {
  const parsed = parseForLoop(input);
  if (!parsed) {
    return {
      stdout: "",
      stderr: "bash: syntax error near for loop\n",
      exitCode: 2,
    };
  }

  const { varName, listStr, body, rest } = parsed;
  const loopResult = await executeForLoopBody(varName, listStr, body, ctx);

  // If there's content after done (like | sort), pipe the output
  const trimmedRest = rest?.trim();
  if (trimmedRest?.startsWith("|")) {
    const pipeCommand = trimmedRest.slice(1).trim();
    if (pipeCommand) {
      // Execute the piped command with loop output as stdin
      // Use printf to preserve the output and pipe it
      const escapedOutput = loopResult.stdout
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "'\"'\"'");
      const pipeResult = await ctx.exec(
        `printf '%s' '${escapedOutput}' | ${pipeCommand}`,
      );
      return {
        stdout: pipeResult.stdout,
        stderr: loopResult.stderr + pipeResult.stderr,
        exitCode: pipeResult.exitCode,
      };
    }
  } else if (trimmedRest) {
    // Non-pipe content after done - execute it separately
    const restResult = await ctx.exec(trimmedRest);
    return {
      stdout: loopResult.stdout + restResult.stdout,
      stderr: loopResult.stderr + restResult.stderr,
      exitCode: restResult.exitCode,
    };
  }

  return loopResult;
}

async function executeForLoopBody(
  varName: string,
  listStr: string,
  body: string,
  ctx: InterpreterContext,
): Promise<ExecResult> {
  // Expand the list (could contain command substitution, variables, or literals)
  const expandedList = await ctx.expandVariables(listStr.trim());
  const items = expandedList.split(/\s+/).filter((s) => s.length > 0);

  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let iterations = 0;

  for (const item of items) {
    if (iterations++ >= ctx.maxLoopIterations) {
      return {
        stdout,
        stderr:
          stderr +
          `bash: for loop: too many iterations (${ctx.maxLoopIterations}). Increase with maxLoopIterations option.\n`,
        exitCode: 1,
      };
    }

    // Set the loop variable
    ctx.env[varName] = item;

    // Execute the body
    const result = await ctx.exec(body);
    stdout += result.stdout;
    stderr += result.stderr;
    exitCode = result.exitCode;
  }

  // Clean up the loop variable
  delete ctx.env[varName];

  return { stdout, stderr, exitCode };
}

/**
 * Execute a while loop
 * Syntax: while CONDITION; do COMMANDS; done
 * Supports both single-line (with semicolons) and multi-line (with newlines)
 */
export async function executeWhileLoop(
  input: string,
  ctx: InterpreterContext,
): Promise<ExecResult> {
  // Parse: while CONDITION [;\n] do BODY [;\n] done
  const match = input.match(
    /^while\s+(.*?)(?:\s*[;\n]\s*|\s+)do(?:\s*[;\n]?\s*|\s+)(.*?)(?:\s*[;\n]\s*|\s*)done\s*$/s,
  );
  if (!match) {
    return {
      stdout: "",
      stderr: "bash: syntax error near while loop\n",
      exitCode: 2,
    };
  }
  const [, condition, body] = match;
  return executeWhileLoopBody(condition, body, ctx);
}

async function executeWhileLoopBody(
  condition: string,
  body: string,
  ctx: InterpreterContext,
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let iterations = 0;

  while (true) {
    if (iterations++ >= ctx.maxLoopIterations) {
      return {
        stdout,
        stderr:
          stderr +
          `bash: while loop: too many iterations (${ctx.maxLoopIterations}). Increase with maxLoopIterations option.\n`,
        exitCode: 1,
      };
    }

    // Evaluate the condition
    const condResult = await ctx.exec(condition);
    if (condResult.exitCode !== 0) {
      break; // Condition failed, exit loop
    }

    // Execute the body
    const result = await ctx.exec(body);
    stdout += result.stdout;
    stderr += result.stderr;
    exitCode = result.exitCode;
  }

  return { stdout, stderr, exitCode };
}

/**
 * Execute an until loop
 * Syntax: until CONDITION; do COMMANDS; done
 * Supports both single-line (with semicolons) and multi-line (with newlines)
 */
export async function executeUntilLoop(
  input: string,
  ctx: InterpreterContext,
): Promise<ExecResult> {
  // Parse: until CONDITION [;\n] do BODY [;\n] done
  const match = input.match(
    /^until\s+(.*?)(?:\s*[;\n]\s*|\s+)do(?:\s*[;\n]?\s*|\s+)(.*?)(?:\s*[;\n]\s*|\s*)done\s*$/s,
  );
  if (!match) {
    return {
      stdout: "",
      stderr: "bash: syntax error near until loop\n",
      exitCode: 2,
    };
  }
  const [, condition, body] = match;
  return executeUntilLoopBody(condition, body, ctx);
}

async function executeUntilLoopBody(
  condition: string,
  body: string,
  ctx: InterpreterContext,
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let iterations = 0;

  while (true) {
    if (iterations++ >= ctx.maxLoopIterations) {
      return {
        stdout,
        stderr:
          stderr +
          `bash: until loop: too many iterations (${ctx.maxLoopIterations}). Increase with maxLoopIterations option.\n`,
        exitCode: 1,
      };
    }

    // Evaluate the condition
    const condResult = await ctx.exec(condition);
    if (condResult.exitCode === 0) {
      break; // Condition succeeded, exit loop (opposite of while)
    }

    // Execute the body
    const result = await ctx.exec(body);
    stdout += result.stdout;
    stderr += result.stderr;
    exitCode = result.exitCode;
  }

  return { stdout, stderr, exitCode };
}
