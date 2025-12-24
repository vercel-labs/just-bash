/**
 * source/. - Execute commands from a file in current environment builtin
 */

import { type ParseException, parse } from "../../parser/parser.js";
import type { ExecResult } from "../../types.js";
import type { InterpreterContext } from "../types.js";

export async function handleSource(
  ctx: InterpreterContext,
  args: string[],
): Promise<ExecResult> {
  if (args.length === 0) {
    return {
      stdout: "",
      stderr: "bash: source: filename argument required\n",
      exitCode: 2,
    };
  }

  const filename = args[0];
  const filePath = ctx.fs.resolvePath(ctx.state.cwd, filename);

  let content: string;
  try {
    content = await ctx.fs.readFile(filePath);
  } catch {
    return {
      stdout: "",
      stderr: `bash: ${filename}: No such file or directory\n`,
      exitCode: 1,
    };
  }

  // Save and set positional parameters from additional args
  const savedPositional: Record<string, string | undefined> = {};
  if (args.length > 1) {
    // Save current positional parameters
    for (let i = 1; i <= 9; i++) {
      savedPositional[String(i)] = ctx.state.env[String(i)];
    }
    savedPositional["#"] = ctx.state.env["#"];
    savedPositional["@"] = ctx.state.env["@"];

    // Set new positional parameters
    const scriptArgs = args.slice(1);
    ctx.state.env["#"] = String(scriptArgs.length);
    ctx.state.env["@"] = scriptArgs.join(" ");
    for (let i = 0; i < scriptArgs.length && i < 9; i++) {
      ctx.state.env[String(i + 1)] = scriptArgs[i];
    }
    // Clear any remaining positional parameters
    for (let i = scriptArgs.length + 1; i <= 9; i++) {
      delete ctx.state.env[String(i)];
    }
  }

  try {
    const ast = parse(content);
    const result = await ctx.executeScript(ast);

    // Restore positional parameters if we changed them
    if (args.length > 1) {
      for (const [key, value] of Object.entries(savedPositional)) {
        if (value === undefined) {
          delete ctx.state.env[key];
        } else {
          ctx.state.env[key] = value;
        }
      }
    }

    return result;
  } catch (error) {
    // Restore positional parameters on error
    if (args.length > 1) {
      for (const [key, value] of Object.entries(savedPositional)) {
        if (value === undefined) {
          delete ctx.state.env[key];
        } else {
          ctx.state.env[key] = value;
        }
      }
    }

    if ((error as ParseException).name === "ParseException") {
      return {
        stdout: "",
        stderr: `bash: ${filename}: ${(error as Error).message}\n`,
        exitCode: 2,
      };
    }
    throw error;
  }
}
