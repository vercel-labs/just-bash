/**
 * Pipeline Execution
 *
 * Handles execution of command pipelines (cmd1 | cmd2 | cmd3).
 *
 * Multi-command pipelines run all stages concurrently, connected by
 * PipeChannels. Every stage gets a StreamContext with writeStdout.
 *
 * Input routing: streaming commands (cat, head) get the raw channel as
 * stdinStream for incremental reads. Non-streaming commands get the
 * channel drained into a buffered stdin string.
 *
 * Output routing: determined at runtime — if the command wrote via
 * writeStdout, its output is already in the channel; otherwise the
 * pipeline pushes result.stdout. Commands must not do both (enforced
 * by an assertion in executeExternalCommand).
 */

import type { CommandNode, PipelineNode } from "../ast/types.js";
import { _performanceNow } from "../security/trusted-globals.js";
import type { ExecResult } from "../types.js";
import { BadSubstitutionError, ErrexitError, ExitError } from "./errors.js";
import { OK } from "./helpers/result.js";
import { BrokenPipeError, PipeChannel } from "./pipe-channel.js";
import type { InterpreterContext } from "./types.js";

/**
 * Streaming context threaded through to a command execution.
 * Allows commands to do incremental I/O instead of buffered strings.
 */
export interface StreamContext {
  /** Write stdout chunk. Always available — commands may use this or return stdout, not both. */
  writeStdout: (chunk: string) => Promise<void>;
  writeStderr: (chunk: string) => Promise<void>;
  stdinStream?: AsyncIterable<string>;
  abortUpstream: () => void;
  /**
   * Collected stdout from writeStdout calls (last-stage only).
   * The interpreter merges this into ExecResult.stdout before
   * applying redirections, so commands don't need to know their
   * pipeline position.
   */
  collectedStdout?: string;
}

/**
 * Type for executeCommand callback.
 * The optional streamCtx enables streaming I/O for pipeline stages.
 */
export type ExecuteCommandFn = (
  node: CommandNode,
  stdin: string,
  streamCtx?: StreamContext,
) => Promise<ExecResult>;

/**
 * Check if a CommandNode is a SimpleCommand whose registered command
 * has `streaming: true`. Used for input routing: streaming commands
 * get the raw PipeChannel as stdinStream instead of drained stdin.
 * Functions override commands, so a function with the same name
 * disables streaming.
 */
function isStreamingCommand(
  node: CommandNode,
  ctx: InterpreterContext,
): boolean {
  if (node.type !== "SimpleCommand" || !node.name) return false;
  if (node.name.parts.length !== 1 || node.name.parts[0].type !== "Literal")
    return false;
  const name = node.name.parts[0].value;
  // Functions override commands
  if (ctx.state.functions.has(name)) return false;
  const cmd = ctx.commands.get(name);
  return cmd?.streaming === true;
}

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

  // Single-command pipeline: fast path (no channels needed)
  if (node.commands.length <= 1) {
    return executeSingleCommandPipeline(ctx, node, executeCommand, startTime);
  }

  // Multi-command pipeline: concurrent execution with PipeChannels
  return executeMultiCommandPipeline(ctx, node, executeCommand, startTime);
}

/**
 * Fast path for single-command pipelines — identical to old behavior.
 */
async function executeSingleCommandPipeline(
  ctx: InterpreterContext,
  node: PipelineNode,
  executeCommand: ExecuteCommandFn,
  startTime: number,
): Promise<ExecResult> {
  const command = node.commands[0];
  let lastResult: ExecResult;

  try {
    lastResult = await executeCommand(command, "");
  } catch (error) {
    if (error instanceof BadSubstitutionError) {
      lastResult = {
        stdout: error.stdout,
        stderr: error.stderr,
        exitCode: 1,
      };
    } else {
      throw error;
    }
  }

  // PIPESTATUS for single SimpleCommand
  if (command.type === "SimpleCommand") {
    setPipestatus(ctx, [lastResult.exitCode]);
  }

  lastResult = applyNegation(node, lastResult);
  lastResult = applyTiming(node, lastResult, startTime);
  return lastResult;
}

/**
 * Concurrent multi-command pipeline.
 *
 * Creates N-1 PipeChannels connecting N stages. Each stage runs as a
 * concurrent Promise with a StreamContext providing writeStdout and
 * (for streaming commands) stdinStream.
 */
async function executeMultiCommandPipeline(
  ctx: InterpreterContext,
  node: PipelineNode,
  executeCommand: ExecuteCommandFn,
  startTime: number,
): Promise<ExecResult> {
  const n = node.commands.length;
  const savedLastArg = ctx.state.lastArg;

  // Create N-1 channels between stages
  const channels: PipeChannel[] = [];
  for (let i = 0; i < n - 1; i++) {
    channels.push(new PipeChannel());
  }

  // Save groupStdin before concurrent launch — the first stage inherits
  // it (for inner pipelines inside groups), all others must not see it.
  // We clear it here and pass it explicitly to avoid races between
  // concurrent stages modifying shared state.
  const parentGroupStdin = ctx.state.groupStdin;
  ctx.state.groupStdin = undefined;

  // Track per-stage results
  interface StageResult {
    result: ExecResult;
    index: number;
  }

  // Launch all stages concurrently
  const stagePromises: Promise<StageResult>[] = node.commands.map(
    (command, i) => {
      const isFirst = i === 0;
      const isLast = i === n - 1;
      const inputChannel = isFirst ? null : channels[i - 1];
      const outputChannel = isLast ? null : channels[i];
      const pipeStderrToNext = !isLast && (node.pipeStderr?.[i] ?? false);
      const isStreaming = isStreamingCommand(command, ctx);
      const runsInSubshell = !isLast || !ctx.state.shoptOptions.lastpipe;

      return runStage(
        ctx,
        command,
        executeCommand,
        inputChannel,
        outputChannel,
        pipeStderrToNext,
        isStreaming,
        runsInSubshell,
        isFirst,
        i,
        isFirst ? parentGroupStdin : undefined,
      );
    },
  );

  // Await all stages
  const settled = await Promise.allSettled(stagePromises);

  // Collect results
  const pipestatusExitCodes: number[] = [];
  let accumulatedStderr = "";
  let lastResult: ExecResult = OK;
  const stageErrors: unknown[] = [];

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    const isLast = i === n - 1;

    if (outcome.status === "fulfilled") {
      const { result } = outcome.value;
      pipestatusExitCodes.push(result.exitCode);

      if (!isLast) {
        const pipeStderrToNext = node.pipeStderr?.[i] ?? false;
        if (!pipeStderrToNext) {
          accumulatedStderr += result.stderr;
        }
      } else {
        lastResult = result;
      }
    } else {
      // Stage rejected — check if it's a control flow error we should handle
      const error = outcome.reason;
      if (error instanceof BadSubstitutionError) {
        pipestatusExitCodes.push(1);
        if (!isLast) {
          accumulatedStderr += error.stderr;
        } else {
          lastResult = {
            stdout: error.stdout,
            stderr: error.stderr,
            exitCode: 1,
          };
        }
      } else if (error instanceof ExitError) {
        pipestatusExitCodes.push(error.exitCode);
        if (!isLast) {
          accumulatedStderr += error.stderr;
        } else {
          lastResult = {
            stdout: error.stdout,
            stderr: error.stderr,
            exitCode: error.exitCode,
          };
        }
      } else if (error instanceof ErrexitError) {
        pipestatusExitCodes.push(error.exitCode);
        if (!isLast) {
          accumulatedStderr += error.stderr;
        } else {
          lastResult = {
            stdout: error.stdout,
            stderr: error.stderr,
            exitCode: error.exitCode,
          };
        }
      } else {
        // Fatal error — collect and re-throw after cleanup
        stageErrors.push(error);
        pipestatusExitCodes.push(1);
      }
    }
  }

  // If any stage had a fatal error, re-throw the first one
  if (stageErrors.length > 0) {
    throw stageErrors[0];
  }

  // Merge stderr from non-last stages
  if (accumulatedStderr) {
    lastResult = {
      ...lastResult,
      stderr: accumulatedStderr + lastResult.stderr,
    };
  }

  // Set PIPESTATUS
  setPipestatus(ctx, pipestatusExitCodes);

  // Pipefail: use rightmost failing exit code
  if (ctx.state.options.pipefail) {
    let pipefailExitCode = 0;
    for (const code of pipestatusExitCodes) {
      if (code !== 0) pipefailExitCode = code;
    }
    if (pipefailExitCode !== 0) {
      lastResult = { ...lastResult, exitCode: pipefailExitCode };
    }
  }

  // Handle $_ restoration
  if (!ctx.state.shoptOptions.lastpipe) {
    ctx.state.lastArg = savedLastArg;
  }

  lastResult = applyNegation(node, lastResult);
  lastResult = applyTiming(node, lastResult, startTime);
  return lastResult;
}

/**
 * Run a single pipeline stage.
 *
 * All stages get a StreamContext with writeStdout. Input routing depends
 * on isStreaming: streaming commands get the raw channel as stdinStream,
 * non-streaming commands get the channel drained into stdin.
 *
 * Output routing is runtime: if result.stdout is non-empty, push it to
 * the output channel (non-streaming path). If empty, output already went
 * via writeStdout during execution (streaming path). Commands must not
 * do both — enforced by assertion in executeExternalCommand.
 */
async function runStage(
  ctx: InterpreterContext,
  command: CommandNode,
  executeCommand: ExecuteCommandFn,
  inputChannel: PipeChannel | null,
  outputChannel: PipeChannel | null,
  pipeStderrToNext: boolean,
  isStreaming: boolean,
  runsInSubshell: boolean,
  isFirst: boolean,
  index: number,
  groupStdin?: string,
): Promise<{ result: ExecResult; index: number }> {
  // Subshell context: save env
  const savedEnv = runsInSubshell ? new Map(ctx.state.env) : null;

  // Clear $_ for pipeline commands
  ctx.state.lastArg = "";

  // Set groupStdin for this stage — already cleared by parent for
  // non-first stages, and passed explicitly for the first stage to
  // avoid concurrent races on shared state.
  ctx.state.groupStdin = groupStdin;

  try {
    // --- Input routing ---
    // Streaming commands get the raw channel for incremental reads.
    // Non-streaming commands get the channel drained into a string.
    // For the first stage with no input channel, groupStdin flows
    // through as the stdin parameter so inner commands can use it.
    let stdin = "";
    if (!isStreaming && inputChannel) {
      for await (const chunk of inputChannel) {
        stdin += chunk;
      }
    } else if (isFirst && !inputChannel && groupStdin) {
      stdin = groupStdin;
    }

    // --- Build StreamContext ---
    let stageStderr = "";
    const streamCtx: StreamContext = {
      writeStdout: outputChannel
        ? async (chunk: string) => {
            await outputChannel.write(chunk);
          }
        : async (chunk: string) => {
            streamCtx.collectedStdout =
              (streamCtx.collectedStdout ?? "") + chunk;
          },
      writeStderr: async (chunk: string) => {
        stageStderr += chunk;
      },
      stdinStream: isStreaming ? (inputChannel ?? undefined) : undefined,
      abortUpstream: () => {
        if (inputChannel) inputChannel.abort();
      },
    };

    // --- Execute ---
    let result = await executeCommand(command, stdin, streamCtx);

    // --- Output routing ---
    if (outputChannel) {
      // Push buffered stdout to channel. Streaming commands return
      // stdout="" (enforced by assertion in executeExternalCommand),
      // so this is a no-op for them — their output already went via
      // writeStdout during execution.
      try {
        const output = pipeStderrToNext
          ? result.stderr + result.stdout
          : result.stdout;
        if (output) {
          await outputChannel.write(output);
        }
      } catch (error) {
        if (error instanceof BrokenPipeError) {
          outputChannel.close();
          return {
            result: {
              stdout: "",
              stderr: pipeStderrToNext ? "" : result.stderr,
              exitCode: 141,
            },
            index,
          };
        }
        throw error;
      }
      outputChannel.close();

      if (pipeStderrToNext) {
        return {
          result: { stdout: "", stderr: "", exitCode: result.exitCode },
          index,
        };
      }
      return {
        result: {
          stdout: "",
          stderr: stageStderr + result.stderr,
          exitCode: result.exitCode,
        },
        index,
      };
    }

    // Last stage — collectedStdout is merged into ExecResult by the
    // interpreter (before redirections). Merge any streaming stderr here.
    if (stageStderr) {
      result = { ...result, stderr: stageStderr + result.stderr };
    }
    return { result, index };
  } catch (error) {
    // Push any stdout from the error before closing the channel,
    // so downstream stages still see partial output (e.g., errexit
    // after some echo statements in a group).
    if (outputChannel) {
      if (
        (error instanceof ErrexitError || error instanceof ExitError) &&
        error.stdout
      ) {
        try {
          await outputChannel.write(error.stdout);
        } catch {
          // Ignore BrokenPipeError — downstream already closed
        }
      }
      outputChannel.close();
    }
    throw error;
  } finally {
    // Restore env for subshell commands
    if (savedEnv) {
      ctx.state.env = savedEnv;
    }
  }
}

// ============================================================================
// Shared helpers
// ============================================================================

function setPipestatus(ctx: InterpreterContext, codes: number[]): void {
  // Clear previous entries
  for (const key of ctx.state.env.keys()) {
    if (key.startsWith("PIPESTATUS_")) {
      ctx.state.env.delete(key);
    }
  }
  for (let i = 0; i < codes.length; i++) {
    ctx.state.env.set(`PIPESTATUS_${i}`, String(codes[i]));
  }
  ctx.state.env.set("PIPESTATUS__length", String(codes.length));
}

function applyNegation(node: PipelineNode, result: ExecResult): ExecResult {
  if (node.negated) {
    return { ...result, exitCode: result.exitCode === 0 ? 1 : 0 };
  }
  return result;
}

function applyTiming(
  node: PipelineNode,
  result: ExecResult,
  startTime: number,
): ExecResult {
  if (!node.timed) return result;

  const endTime = _performanceNow();
  const elapsedSeconds = (endTime - startTime) / 1000;
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;

  let timingOutput: string;
  if (node.timePosix) {
    timingOutput = `real ${elapsedSeconds.toFixed(2)}\nuser 0.00\nsys 0.00\n`;
  } else {
    const realStr = `${minutes}m${seconds.toFixed(3)}s`;
    timingOutput = `\nreal\t${realStr}\nuser\t0m0.000s\nsys\t0m0.000s\n`;
  }

  return { ...result, stderr: result.stderr + timingOutput };
}
