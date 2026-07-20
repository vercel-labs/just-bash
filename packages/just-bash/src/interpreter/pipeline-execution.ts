/**
 * Pipeline Execution
 *
 * Handles execution of command pipelines (cmd1 | cmd2 | cmd3).
 */

import type { CommandNode, PipelineNode } from "../ast/types.js";
import {
  encodeUtf8ToBytes,
  latin1FromBytes,
  stdoutAsBytes,
} from "../encoding.js";
import { relinquishPipelineOutput } from "../execution-scope.js";
import { _performanceNow } from "../security/trusted-globals.js";
import type { ExecResult } from "../types.js";
import { BadSubstitutionError, ErrexitError, ExitError } from "./errors.js";
import { clearArray, cloneArrays, setArrayElement } from "./helpers/array.js";
import { OK } from "./helpers/result.js";
import type { InterpreterContext } from "./types.js";

/**
 * Type for executeCommand callback
 */
export type ExecuteCommandFn = (
  node: CommandNode,
  stdin: string,
) => Promise<ExecResult>;

/**
 * Execute a pipeline node (command or sequence of piped commands).
 */
export async function executePipeline(
  ctx: InterpreterContext,
  node: PipelineNode,
  executeCommand: ExecuteCommandFn,
): Promise<ExecResult> {
  // Record start time for timed pipelines
  const startTime = node.timed ? _performanceNow() : 0;

  let stdin = "";
  let lastResult: ExecResult = OK;
  let pipefailExitCode = 0; // Track rightmost failing command
  const pipestatusExitCodes: number[] = []; // Track all exit codes for PIPESTATUS
  let accumulatedStderr = ""; // Accumulate stderr from all pipeline commands
  let accumulatedStderrBytes = 0;

  // For multi-command pipelines, save parent's $_ because pipeline commands
  // run in subshell-like contexts and should not affect parent's $_
  // (except the last command when lastpipe is enabled)
  const isMultiCommandPipeline = node.commands.length > 1;
  const savedLastArg = ctx.state.lastArg;

  for (let i = 0; i < node.commands.length; i++) {
    const command = node.commands[i];
    const isLast = i === node.commands.length - 1;
    const isFirst = i === 0;

    // In a multi-command pipeline, each command runs in a subshell context
    // where $_ starts empty (subshells don't inherit $_ from parent in same way)
    if (isMultiCommandPipeline) {
      // Clear $_ for each pipeline command - they each get fresh subshell context
      ctx.state.lastArg = "";

      // After the first command, clear groupStdin so subsequent commands
      // only see stdin from the pipeline (even if empty), not the original groupStdin
      // This prevents commands like head from incorrectly falling back to groupStdin
      // when they receive empty output from a previous command (e.g., grep with no matches)
      if (!isFirst) {
        ctx.state.groupStdin = undefined;
      }
    }

    // Determine if this command runs in a subshell context
    // In bash, all commands except the last run in subshells
    // With lastpipe enabled, the last command runs in the current shell
    const runsInSubshell =
      isMultiCommandPipeline && (!isLast || !ctx.state.shoptOptions.lastpipe);

    // Save environment for commands running in subshell context
    // This prevents variable assignments (e.g., ${cmd=echo}) from leaking to parent
    const savedEnv = runsInSubshell ? new Map(ctx.state.env) : null;
    const savedArrays = runsInSubshell ? cloneArrays(ctx.state.arrays) : null;

    let result: ExecResult;
    const outputCheckpoint = ctx.executionScope.outputBytesUsed;
    try {
      ctx.state.commandCount = ctx.executionScope.chargeCommand();
      result = await executeCommand(command, stdin);
    } catch (error) {
      // BadSubstitutionError should fail the command but not abort the script
      if (error instanceof BadSubstitutionError) {
        result = {
          stdout: error.stdout,
          stderr: error.stderr,
          exitCode: 1,
        };
      }
      // In a MULTI-command pipeline, each command runs in a subshell context
      // So exit/return/errexit only affect that segment, not the whole script
      // For single commands, let these errors propagate to terminate the script
      else if (error instanceof ExitError && node.commands.length > 1) {
        result = {
          stdout: error.stdout,
          stderr: error.stderr,
          exitCode: error.exitCode,
        };
      } else if (error instanceof ErrexitError && node.commands.length > 1) {
        // Errexit inside a pipeline segment should only fail that segment
        // The pipeline's exit code comes from the last command (or pipefail)
        result = {
          stdout: error.stdout,
          stderr: error.stderr,
          exitCode: error.exitCode,
        };
      } else {
        // Restore environment before re-throwing
        if (savedEnv) {
          ctx.state.env = savedEnv;
          ctx.state.arrays = savedArrays ?? new Map();
        }
        throw error;
      }
    }

    // Restore environment for subshell commands to prevent variable assignment leakage
    if (savedEnv) {
      ctx.state.env = savedEnv;
      ctx.state.arrays = savedArrays ?? new Map();
    }

    // Charge every stage before it can become a retained pipeline
    // intermediate. Metadata prevents the final visible result from being
    // charged twice.
    result = ctx.executionScope.accountResult(
      result,
      "pipeline",
      ctx.executionScope.outputBytesUsed - outputCheckpoint,
    );

    if (!isLast) {
      // A non-final stdout is retained only until the next stage consumes it.
      // Keep the prospective stage check above, then return its accounting
      // credit so a pass-through pipeline is bounded by peak retained output
      // instead of charging the same bytes once per stage.
      const pipeStderrToNext = node.pipeStderr?.[i] ?? false;
      const releasedStdout = result.internalOutputAccounting?.stdout ?? 0;
      const releasedStderr = pipeStderrToNext
        ? (result.internalOutputAccounting?.stderr ?? 0)
        : 0;
      relinquishPipelineOutput(
        ctx.executionScope,
        releasedStdout + releasedStderr,
        "pipeline",
      );
      result = {
        ...result,
        internalOutputAccounting: {
          stdout: 0,
          stderr: pipeStderrToNext
            ? 0
            : (result.internalOutputAccounting?.stderr ?? 0),
        },
      };
    }

    // Track exit code for PIPESTATUS
    pipestatusExitCodes.push(result.exitCode);

    // Track the exit code of failing commands for pipefail
    if (result.exitCode !== 0) {
      pipefailExitCode = result.exitCode;
    }

    if (!isLast) {
      // Pipeline contract: the next command's stdin is a byte buffer.
      // `stdoutAsBytes` consults the upstream's explicit `stdoutKind`
      // (or legacy `stdoutEncoding === "binary"`) and converts text →
      // UTF-8 bytes / passes byte buffers through. No content-based
      // heuristics — the producer's metadata is the source of truth.
      // Check if this pipe is |& (pipe stderr to next command's stdin too)
      const pipeStderrToNext = node.pipeStderr?.[i] ?? false;
      if (pipeStderrToNext) {
        // |& pipes stderr + stdout. stderr is text (no producer marks it
        // binary today); UTF-8 encode it before concatenating with the
        // stdout bytes so the merged stream is byte-shaped end-to-end.
        stdin =
          latin1FromBytes(encodeUtf8ToBytes(result.stderr)) +
          latin1FromBytes(stdoutAsBytes(result));
      } else {
        // Regular | only pipes stdout; stderr goes to the parent
        stdin = latin1FromBytes(stdoutAsBytes(result));
        accumulatedStderr += result.stderr;
        accumulatedStderrBytes += result.internalOutputAccounting?.stderr ?? 0;
      }
      lastResult = {
        stdout: "",
        stderr: "",
        exitCode: result.exitCode,
      };
    } else {
      lastResult = result;
    }
  }

  // Merge stderr from all non-last pipeline commands into the final result.
  // In bash, stderr from each pipeline command goes to the terminal (parent),
  // not through the pipe. Only stdout flows through pipes.
  if (accumulatedStderr) {
    lastResult = {
      ...lastResult,
      stderr: accumulatedStderr + lastResult.stderr,
      internalOutputAccounting: {
        stdout: lastResult.internalOutputAccounting?.stdout ?? 0,
        stderr:
          accumulatedStderrBytes +
          (lastResult.internalOutputAccounting?.stderr ?? 0),
      },
    };
  }

  // Set PIPESTATUS array with exit codes from all pipeline commands
  // For single-command pipelines with compound commands, don't set PIPESTATUS here -
  // let inner statements set it (e.g., non-matching case statements should leave
  // PIPESTATUS unchanged, matching bash behavior).
  // For multi-command pipelines or simple commands, always set PIPESTATUS.
  const shouldSetPipestatus =
    node.commands.length > 1 ||
    (node.commands.length === 1 && node.commands[0].type === "SimpleCommand");

  const effectivePipestatus =
    lastResult.internalPipeStatusOverride ?? pipestatusExitCodes;
  if (shouldSetPipestatus) {
    // Clear any previous PIPESTATUS entries
    clearArray(ctx, "PIPESTATUS");
    // Set new PIPESTATUS entries
    for (let i = 0; i < effectivePipestatus.length; i++) {
      setArrayElement(ctx, "PIPESTATUS", i, String(effectivePipestatus[i]));
    }
  }

  // If pipefail is enabled, use the rightmost failing exit code
  if (ctx.state.options.pipefail && pipefailExitCode !== 0) {
    lastResult = {
      ...lastResult,
      exitCode: pipefailExitCode,
    };
  }

  if (node.negated) {
    lastResult = {
      ...lastResult,
      exitCode: lastResult.exitCode === 0 ? 1 : 0,
    };
  }

  // Output timing info for timed pipelines
  if (node.timed) {
    const endTime = _performanceNow();
    const elapsedSeconds = (endTime - startTime) / 1000;
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    let timingOutput: string;
    if (node.timePosix) {
      // POSIX format (-p): decimal format without leading zeros
      timingOutput = `real ${elapsedSeconds.toFixed(2)}\nuser 0.00\nsys 0.00\n`;
    } else {
      // Default bash format: real/user/sys with XmY.YYYs
      const realStr = `${minutes}m${seconds.toFixed(3)}s`;
      timingOutput = `\nreal\t${realStr}\nuser\t0m0.000s\nsys\t0m0.000s\n`;
    }

    lastResult = {
      ...lastResult,
      stderr: lastResult.stderr + timingOutput,
    };
  }

  // Handle $_ for multi-command pipelines:
  // - With lastpipe enabled: $_ is set by the last command (already done above)
  // - Without lastpipe: $_ should be restored to the value before the pipeline
  //   (since all commands ran in subshells that don't affect parent's $_)
  if (isMultiCommandPipeline && !ctx.state.shoptOptions.lastpipe) {
    ctx.state.lastArg = savedLastArg;
  }
  // With lastpipe, the last command already updated $_ in the main shell context

  lastResult = ctx.executionScope.accountResult(lastResult, "pipeline");
  const { internalPipeStatusOverride: _internalOverride, ...publicResult } =
    lastResult;
  return publicResult;
}
