import type { Pipeline } from "../shell/index.js";
import type { ExecResult } from "../types.js";
import type { InterpreterContext } from "./types.js";

export interface HereDocContext extends InterpreterContext {
  /** Parse a command string into pipelines */
  parse: (cmd: string) => Pipeline[];
  /** Execute a pipeline with initial stdin */
  executePipeline: (pipeline: Pipeline, stdin: string) => Promise<ExecResult>;
}

/**
 * Execute a command with here document (<<EOF)
 * Format: command <<DELIMITER\nbody\nDELIMITER
 * Also handles: command <<DELIMITER | other_command
 */
export async function executeWithHereDoc(
  input: string,
  ctx: HereDocContext,
): Promise<ExecResult> {
  // Find the << and parse the delimiter (may have pipe or other content after)
  const hereDocMatch = input.match(/<<(-?)(['"]?)(\w+)\2/);
  if (!hereDocMatch) {
    // << might be comparison in arithmetic, fall back to normal execution
    const pipelines = ctx.parse(input);
    let stdin = "";
    let lastResult: ExecResult = { stdout: "", stderr: "", exitCode: 0 };
    for (const pipeline of pipelines) {
      const result = await ctx.executePipeline(pipeline, stdin);
      stdin = result.stdout;
      lastResult = result;
    }
    return lastResult;
  }

  const stripTabs = hereDocMatch[1] === "-";
  const quoted = hereDocMatch[2] !== "";
  const delimiter = hereDocMatch[3];

  // Find the position of <<DELIMITER
  const hereDocStart = input.indexOf(hereDocMatch[0]);
  const hereDocEnd = hereDocStart + hereDocMatch[0].length;

  // Get command before << and any pipe/content after <<DELIMITER on the same line
  const commandPart = input.slice(0, hereDocStart).trim();
  const afterDelimiter = input.slice(hereDocEnd);

  // Check if there's a pipe or other command on the same line
  const firstNewline = afterDelimiter.indexOf("\n");
  let sameLineContent = "";
  let bodyStart: string;

  if (firstNewline === -1) {
    // No newline - everything is on one line (no body yet)
    sameLineContent = afterDelimiter.trim();
    bodyStart = "";
  } else {
    sameLineContent = afterDelimiter.slice(0, firstNewline).trim();
    bodyStart = afterDelimiter.slice(firstNewline + 1);
  }

  // Check for pipe or redirection on same line
  let pipeCommand = "";
  let outputRedirect = "";
  if (sameLineContent.startsWith("|")) {
    pipeCommand = sameLineContent.slice(1).trim();
  } else if (sameLineContent.startsWith(">")) {
    // Capture redirection (>, >>)
    outputRedirect = sameLineContent;
  }

  // Find the body and end delimiter
  const lines = bodyStart.split("\n");

  const bodyLines: string[] = [];
  let foundEnd = false;
  let endIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineToCheck = stripTabs ? line.replace(/^\t+/, "") : line;

    // Check if this line is the end delimiter
    if (lineToCheck.trim() === delimiter) {
      foundEnd = true;
      endIndex = i;
      break;
    }

    bodyLines.push(line);
  }

  if (!foundEnd) {
    return {
      stdout: "",
      stderr: `bash: warning: here-document delimited by end-of-file (wanted '${delimiter}')\n`,
      exitCode: 0,
    };
  }

  // Build the here document content
  let hereDocContent = bodyLines.join("\n");
  if (bodyLines.length > 0) {
    hereDocContent += "\n"; // Add trailing newline like real bash
  }

  // Expand variables unless delimiter was quoted
  if (!quoted) {
    hereDocContent = await ctx.expandVariables(hereDocContent);
  }

  // Execute the command with here document as stdin
  let result: ExecResult;

  if (pipeCommand) {
    // Handle: cat <<EOF | grep pattern
    const fullCommand = `${commandPart} | ${pipeCommand}`;
    const pipelines = ctx.parse(fullCommand);
    if (pipelines.length === 0) {
      result = { stdout: "", stderr: "", exitCode: 0 };
    } else {
      result = await ctx.executePipeline(pipelines[0], hereDocContent);
    }
  } else if (outputRedirect) {
    // Handle: cat <<EOF > file or cat <<EOF >> file
    const pipelines = ctx.parse(commandPart);
    if (pipelines.length === 0) {
      result = { stdout: "", stderr: "", exitCode: 0 };
    } else {
      const cmdResult = await ctx.executePipeline(pipelines[0], hereDocContent);
      // Apply the redirection to the output
      const isAppend = outputRedirect.startsWith(">>");
      const filePath = outputRedirect.slice(isAppend ? 2 : 1).trim();
      const resolvedPath = ctx.resolvePath(filePath);
      try {
        if (isAppend) {
          const fileExists = await ctx.fs.exists(resolvedPath);
          const existing = fileExists
            ? await ctx.fs.readFile(resolvedPath)
            : "";
          await ctx.fs.writeFile(resolvedPath, existing + cmdResult.stdout);
        } else {
          await ctx.fs.writeFile(resolvedPath, cmdResult.stdout);
        }
        result = {
          stdout: "",
          stderr: cmdResult.stderr,
          exitCode: cmdResult.exitCode,
        };
      } catch (e) {
        result = {
          stdout: "",
          stderr: `bash: ${filePath}: ${(e as Error).message}\n`,
          exitCode: 1,
        };
      }
    }
  } else {
    // Normal case: just the command
    const pipelines = ctx.parse(commandPart);
    if (pipelines.length === 0) {
      result = { stdout: "", stderr: "", exitCode: 0 };
    } else {
      result = await ctx.executePipeline(pipelines[0], hereDocContent);
    }
  }

  // If there's content after the end delimiter, execute it too
  const remaining = lines
    .slice(endIndex + 1)
    .join("\n")
    .trim();
  if (remaining) {
    const restResult = await ctx.exec(remaining);
    return {
      stdout: result.stdout + restResult.stdout,
      stderr: result.stderr + restResult.stderr,
      exitCode: restResult.exitCode,
    };
  }

  return result;
}
