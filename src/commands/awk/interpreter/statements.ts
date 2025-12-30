/**
 * AWK Statement Execution
 *
 * Async statement executor supporting file I/O operations.
 */

import { ExecutionLimitError } from "../../../interpreter/errors.js";
import type { AwkArrayAccess, AwkExpr, AwkStmt, AwkVariable } from "../ast.js";
import { formatPrintf } from "../builtins.js";
import type { AwkRuntimeContext } from "./context.js";
import { evalExpr, setBlockExecutor } from "./expressions.js";
import { isTruthy, toAwkString, toNumber } from "./helpers.js";
import { deleteArray, deleteArrayElement } from "./variables.js";

// Register the block executor with expressions module (for user function calls)
setBlockExecutor(executeBlock);

/**
 * Execute a block of statements.
 */
export async function executeBlock(
  ctx: AwkRuntimeContext,
  statements: AwkStmt[],
): Promise<void> {
  for (const stmt of statements) {
    await executeStmt(ctx, stmt);
    if (shouldBreakExecution(ctx)) {
      break;
    }
  }
}

/**
 * Check if execution should break out of current block.
 */
function shouldBreakExecution(ctx: AwkRuntimeContext): boolean {
  return (
    ctx.shouldExit ||
    ctx.shouldNext ||
    ctx.shouldNextFile ||
    ctx.loopBreak ||
    ctx.loopContinue ||
    ctx.hasReturn
  );
}

/**
 * Execute a single statement.
 */
async function executeStmt(
  ctx: AwkRuntimeContext,
  stmt: AwkStmt,
): Promise<void> {
  switch (stmt.type) {
    case "block":
      await executeBlock(ctx, stmt.statements);
      break;

    case "expr_stmt":
      await evalExpr(ctx, stmt.expression);
      break;

    case "print":
      await executePrint(ctx, stmt.args, stmt.output);
      break;

    case "printf":
      await executePrintf(ctx, stmt.format, stmt.args, stmt.output);
      break;

    case "if":
      await executeIf(ctx, stmt);
      break;

    case "while":
      await executeWhile(ctx, stmt);
      break;

    case "do_while":
      await executeDoWhile(ctx, stmt);
      break;

    case "for":
      await executeFor(ctx, stmt);
      break;

    case "for_in":
      await executeForIn(ctx, stmt);
      break;

    case "break":
      ctx.loopBreak = true;
      break;

    case "continue":
      ctx.loopContinue = true;
      break;

    case "next":
      ctx.shouldNext = true;
      break;

    case "nextfile":
      ctx.shouldNextFile = true;
      break;

    case "exit":
      ctx.shouldExit = true;
      ctx.exitCode = stmt.code
        ? Math.floor(toNumber(await evalExpr(ctx, stmt.code)))
        : 0;
      break;

    case "return":
      ctx.hasReturn = true;
      ctx.returnValue = stmt.value ? await evalExpr(ctx, stmt.value) : "";
      break;

    case "delete":
      await executeDelete(ctx, stmt.target);
      break;
  }
}

/**
 * Execute print statement with optional file redirection.
 */
async function executePrint(
  ctx: AwkRuntimeContext,
  args: AwkExpr[],
  output?: { redirect: ">" | ">>"; file: AwkExpr },
): Promise<void> {
  const values: string[] = [];
  for (const arg of args) {
    values.push(toAwkString(await evalExpr(ctx, arg)));
  }
  const text = values.join(ctx.OFS) + ctx.ORS;

  if (output) {
    await writeToFile(ctx, output.redirect, output.file, text);
  } else {
    ctx.output += text;
  }
}

/**
 * Execute printf statement with optional file redirection.
 */
async function executePrintf(
  ctx: AwkRuntimeContext,
  format: AwkExpr,
  args: AwkExpr[],
  output?: { redirect: ">" | ">>"; file: AwkExpr },
): Promise<void> {
  const formatStr = toAwkString(await evalExpr(ctx, format));
  const values: (string | number)[] = [];
  for (const arg of args) {
    values.push(await evalExpr(ctx, arg));
  }
  const text = formatPrintf(formatStr, values);

  if (output) {
    await writeToFile(ctx, output.redirect, output.file, text);
  } else {
    ctx.output += text;
  }
}

/**
 * Write text to a file.
 */
async function writeToFile(
  ctx: AwkRuntimeContext,
  redirect: ">" | ">>",
  fileExpr: AwkExpr,
  text: string,
): Promise<void> {
  if (!ctx.fs || !ctx.cwd) {
    // No filesystem access - just append to output
    ctx.output += text;
    return;
  }

  const filename = toAwkString(await evalExpr(ctx, fileExpr));
  const filePath = ctx.fs.resolvePath(ctx.cwd, filename);

  if (redirect === ">") {
    // Overwrite mode: first write clears file, subsequent writes append
    if (!ctx.openedFiles.has(filePath)) {
      // First write - overwrite (write empty first, then append)
      await ctx.fs.writeFile(filePath, text);
      ctx.openedFiles.add(filePath);
    } else {
      // Subsequent write - append
      await ctx.fs.appendFile(filePath, text);
    }
  } else {
    // Append mode: always append
    if (!ctx.openedFiles.has(filePath)) {
      // First time seeing this file in append mode
      ctx.openedFiles.add(filePath);
    }
    await ctx.fs.appendFile(filePath, text);
  }
}

/**
 * Execute if statement.
 */
async function executeIf(
  ctx: AwkRuntimeContext,
  stmt: { condition: AwkExpr; consequent: AwkStmt; alternate?: AwkStmt },
): Promise<void> {
  if (isTruthy(await evalExpr(ctx, stmt.condition))) {
    await executeStmt(ctx, stmt.consequent);
  } else if (stmt.alternate) {
    await executeStmt(ctx, stmt.alternate);
  }
}

/**
 * Execute while loop.
 */
async function executeWhile(
  ctx: AwkRuntimeContext,
  stmt: { condition: AwkExpr; body: AwkStmt },
): Promise<void> {
  let iterations = 0;

  while (isTruthy(await evalExpr(ctx, stmt.condition))) {
    iterations++;
    if (iterations > ctx.maxIterations) {
      throw new ExecutionLimitError(
        `awk: while loop exceeded maximum iterations (${ctx.maxIterations})`,
        "iterations",
        ctx.output,
      );
    }

    ctx.loopContinue = false;
    await executeStmt(ctx, stmt.body);

    if (ctx.loopBreak) {
      ctx.loopBreak = false;
      break;
    }
    if (ctx.shouldExit || ctx.shouldNext || ctx.hasReturn) {
      break;
    }
  }
}

/**
 * Execute do-while loop.
 */
async function executeDoWhile(
  ctx: AwkRuntimeContext,
  stmt: { body: AwkStmt; condition: AwkExpr },
): Promise<void> {
  let iterations = 0;

  do {
    iterations++;
    if (iterations > ctx.maxIterations) {
      throw new ExecutionLimitError(
        `awk: do-while loop exceeded maximum iterations (${ctx.maxIterations})`,
        "iterations",
        ctx.output,
      );
    }

    ctx.loopContinue = false;
    await executeStmt(ctx, stmt.body);

    if (ctx.loopBreak) {
      ctx.loopBreak = false;
      break;
    }
    if (ctx.shouldExit || ctx.shouldNext || ctx.hasReturn) {
      break;
    }
  } while (isTruthy(await evalExpr(ctx, stmt.condition)));
}

/**
 * Execute for loop.
 */
async function executeFor(
  ctx: AwkRuntimeContext,
  stmt: {
    init?: AwkExpr;
    condition?: AwkExpr;
    update?: AwkExpr;
    body: AwkStmt;
  },
): Promise<void> {
  if (stmt.init) {
    await evalExpr(ctx, stmt.init);
  }

  let iterations = 0;

  while (!stmt.condition || isTruthy(await evalExpr(ctx, stmt.condition))) {
    iterations++;
    if (iterations > ctx.maxIterations) {
      throw new ExecutionLimitError(
        `awk: for loop exceeded maximum iterations (${ctx.maxIterations})`,
        "iterations",
        ctx.output,
      );
    }

    ctx.loopContinue = false;
    await executeStmt(ctx, stmt.body);

    if (ctx.loopBreak) {
      ctx.loopBreak = false;
      break;
    }
    if (ctx.shouldExit || ctx.shouldNext || ctx.hasReturn) {
      break;
    }

    if (stmt.update) {
      await evalExpr(ctx, stmt.update);
    }
  }
}

/**
 * Execute for-in loop (iterate over array keys).
 */
async function executeForIn(
  ctx: AwkRuntimeContext,
  stmt: { variable: string; array: string; body: AwkStmt },
): Promise<void> {
  const array = ctx.arrays[stmt.array];
  if (!array) return;

  for (const key of Object.keys(array)) {
    ctx.vars[stmt.variable] = key;

    ctx.loopContinue = false;
    await executeStmt(ctx, stmt.body);

    if (ctx.loopBreak) {
      ctx.loopBreak = false;
      break;
    }
    if (ctx.shouldExit || ctx.shouldNext || ctx.hasReturn) {
      break;
    }
  }
}

/**
 * Execute delete statement.
 */
async function executeDelete(
  ctx: AwkRuntimeContext,
  target: AwkArrayAccess | AwkVariable,
): Promise<void> {
  if (target.type === "array_access") {
    const key = toAwkString(await evalExpr(ctx, target.key));
    deleteArrayElement(ctx, target.array, key);
  } else if (target.type === "variable") {
    deleteArray(ctx, target.name);
  }
}
