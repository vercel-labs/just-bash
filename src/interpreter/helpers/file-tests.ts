import type { InterpreterContext } from "../types.js";

/**
 * Resolve a path relative to the current working directory.
 */
function resolvePath(ctx: InterpreterContext, path: string): string {
  return ctx.fs.resolvePath(ctx.state.cwd, path);
}

/**
 * File test operators supported by bash: -e, -a, -f, -d, -r, -w, -x, -s, -L, -h
 */
export const FILE_TEST_OPERATORS = [
  "-e",
  "-a",
  "-f",
  "-d",
  "-r",
  "-w",
  "-x",
  "-s",
  "-L",
  "-h",
] as const;

export type FileTestOperator = (typeof FILE_TEST_OPERATORS)[number];

export function isFileTestOperator(op: string): op is FileTestOperator {
  return FILE_TEST_OPERATORS.includes(op as FileTestOperator);
}

/**
 * Evaluates a file test operator (-e, -f, -d, etc.) against a path.
 * Returns a boolean result.
 *
 * @param ctx - Interpreter context with filesystem access
 * @param operator - The file test operator (e.g., "-f", "-d", "-e")
 * @param operand - The path to test (will be resolved relative to cwd)
 */
export async function evaluateFileTest(
  ctx: InterpreterContext,
  operator: string,
  operand: string,
): Promise<boolean> {
  const path = resolvePath(ctx, operand);

  switch (operator) {
    case "-e":
    case "-a":
      // File exists
      return ctx.fs.exists(path);

    case "-f": {
      // Regular file
      if (await ctx.fs.exists(path)) {
        const stat = await ctx.fs.stat(path);
        return stat.isFile;
      }
      return false;
    }

    case "-d": {
      // Directory
      if (await ctx.fs.exists(path)) {
        const stat = await ctx.fs.stat(path);
        return stat.isDirectory;
      }
      return false;
    }

    case "-r":
    case "-w":
    case "-x":
      // Readable/writable/executable - in virtual fs, just check existence
      return ctx.fs.exists(path);

    case "-s": {
      // File exists and has size > 0
      if (await ctx.fs.exists(path)) {
        const content = await ctx.fs.readFile(path);
        return content.length > 0;
      }
      return false;
    }

    case "-L":
    case "-h": {
      // Symbolic link
      if (await ctx.fs.exists(path)) {
        const stat = await ctx.fs.lstat(path);
        return stat.isSymbolicLink;
      }
      return false;
    }

    default:
      return false;
  }
}
