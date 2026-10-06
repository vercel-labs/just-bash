import { combineAbortSignals } from "../abort-signals.js";
import type {
  PipelineNode,
  SimpleCommandNode,
  WordPart,
} from "../ast/types.js";
import {
  type ByteString,
  latin1FromBytes,
  stdoutAsBytes,
  unsafeBytesFromLatin1,
} from "../encoding.js";
import { ExecutionOutputAccumulator } from "../execution-output.js";
import {
  type ResourceLease,
  relinquishPipelineOutput,
} from "../execution-scope.js";
import { BrokenPipeError, BytePipe } from "../streams/byte-pipe.js";
import type { CommandStdio } from "../streams/command-stdio.js";
import type { ExecResult } from "../types.js";
import {
  type ResolveCommandResult,
  resolveCommand,
} from "./command-resolution.js";
import { ExecutionAbortedError, ExecutionLimitError } from "./errors.js";
import { SHELL_BUILTINS } from "./helpers/shell-constants.js";
import { beginIsolatedShellState } from "./state-transaction.js";
import type { InterpreterContext, InterpreterState } from "./types.js";

const MAX_STREAMING_STAGES = 64;
const STAGE_DEPTH = "streaming pipeline stages";

function isStaticPart(part: WordPart): boolean {
  return (
    part.type === "Literal" ||
    part.type === "SingleQuoted" ||
    part.type === "Escaped" ||
    (part.type === "DoubleQuoted" && part.parts.every(isStaticPart))
  );
}

export interface StreamingPipelineResult {
  result: ExecResult;
  statuses: number[];
}

export async function executeStreamingPipeline(
  ctx: InterpreterContext,
  node: PipelineNode,
  execute: (
    node: SimpleCommandNode,
    state: InterpreterState,
    stdin: string,
    stdio: CommandStdio | undefined,
    resolved: Extract<ResolveCommandResult, { cmd: unknown }>,
  ) => Promise<ExecResult>,
): Promise<StreamingPipelineResult | undefined> {
  if (
    node.commands.length < 2 ||
    ctx.executionScope.depthOf(STAGE_DEPTH) + node.commands.length >
      MAX_STREAMING_STAGES ||
    node.pipeStderr?.some(Boolean) ||
    ctx.state.shoptOptions.lastpipe ||
    ctx.state.shoptOptions.expand_aliases ||
    ctx.state.groupStdin !== undefined ||
    ctx.state.fileDescriptors?.size ||
    ctx.state.closedStandardFds?.size ||
    ctx.state.extraArgs
  )
    return;

  const candidates: Array<{ node: SimpleCommandNode; name: string }> = [];
  for (const command of node.commands) {
    if (
      command.type !== "SimpleCommand" ||
      command.redirections.length ||
      command.assignments.length ||
      command.name?.parts.length !== 1 ||
      command.name.parts[0].type !== "Literal" ||
      !command.args.every((arg) => arg.parts.every(isStaticPart))
    )
      return;
    const name = command.name.parts[0].value;
    if (SHELL_BUILTINS.has(name) || ctx.state.functions.has(name)) return;
    const registered = ctx.commands.get(name.split("/").pop() ?? name);
    if (
      !registered ||
      (registered.internalIsExtension && !registered.streaming)
    )
      return;
    candidates.push({ node: command, name });
  }
  if (
    !candidates.some(
      ({ name }) => ctx.commands.get(name.split("/").pop() ?? name)?.streaming,
    )
  )
    return;

  const stages: Array<{
    node: SimpleCommandNode;
    streaming: boolean;
    extension: boolean;
    resolved: Extract<ResolveCommandResult, { cmd: unknown }>;
  }> = [];
  for (const candidate of candidates) {
    const resolved = await resolveCommand(ctx, candidate.name);
    if (!resolved || !("cmd" in resolved)) return;
    stages.push({
      node: candidate.node,
      streaming: resolved.cmd.streaming === true,
      extension: resolved.cmd.internalIsExtension === true,
      resolved,
    });
  }

  if (
    ctx.executionScope.depthOf(STAGE_DEPTH) + stages.length >
    MAX_STREAMING_STAGES
  )
    return;

  const abort = new AbortController();
  const combined = combineAbortSignals(ctx.state.signal, abort.signal);
  const pipes = stages.slice(1).map(() => new BytePipe(ctx.executionScope));
  const output = new ExecutionOutputAccumulator(ctx.executionScope, "pipeline");
  let cancelled = false;
  const cancel = (error: unknown) => {
    if (cancelled) return;
    cancelled = true;
    for (const pipe of pipes) pipe.cancel(error);
  };
  const onAbort = () =>
    cancel(new ExecutionAbortedError("", "bash: execution aborted\n"));
  combined.signal?.addEventListener("abort", onAbort, { once: true });
  if (combined.signal?.aborted) onAbort();
  let failure: unknown;
  let failed = false;
  const stageLeases: ResourceLease[] = [];

  try {
    const commandCounts = stages.map(() => {
      const count = ctx.executionScope.chargeCommand();
      stageLeases.push(
        ctx.executionScope.enterDepth(
          STAGE_DEPTH,
          MAX_STREAMING_STAGES,
          "pipeline stages",
        ),
      );
      return count;
    });
    const results = await Promise.all(
      stages.map(async (stage, index): Promise<ExecResult> => {
        const state = { ...ctx.state };
        beginIsolatedShellState(state);
        state.lastArg = "";
        state.signal = combined.signal;
        const input = pipes[index - 1];
        const next = pipes[index];
        let inputLease: ResourceLease | undefined;
        let inputBytes = 0;
        let bufferedInputBytes = 0;
        const collectInput = async (limit: number): Promise<string> => {
          let content = "";
          for (;;) {
            const chunk = await stdio.read();
            if (chunk === null) return content;
            const value = latin1FromBytes(chunk);
            if (value.length > limit - content.length) {
              throw new ExecutionLimitError(
                "pipeline: buffered input size limit exceeded",
                "string_length",
              );
            }
            inputLease?.release();
            inputLease = ctx.executionScope.reserveBytes(
              "pipeline input",
              bufferedInputBytes + value.length,
              "pipeline",
            );
            bufferedInputBytes += value.length;
            content += value;
          }
        };
        const stdio: CommandStdio = {
          read: async () => {
            const chunk = input ? await input.read() : null;
            if (chunk !== null) {
              inputBytes += latin1FromBytes(chunk).length;
              if (inputBytes > ctx.limits.maxInputBytes) {
                throw new ExecutionLimitError(
                  "pipeline: input size limit exceeded",
                  "string_length",
                );
              }
            }
            return chunk;
          },
          readAll: async () =>
            unsafeBytesFromLatin1(
              await collectInput(
                Math.min(ctx.limits.maxStringLength, ctx.limits.maxInputBytes),
              ),
            ),
          write: async (chunk: ByteString) => {
            ctx.executionScope.consumeWork(1, "pipeline");
            if (latin1FromBytes(chunk).length > ctx.limits.maxStringLength) {
              throw new ExecutionLimitError(
                "pipeline: chunk size limit exceeded",
                "string_length",
              );
            }
            if (next) await next.write(chunk);
            else output.append("stdout", latin1FromBytes(chunk), 0, "bytes");
          },
        };
        try {
          state.commandCount = commandCounts[index];
          const stdin =
            !stage.streaming && input
              ? await collectInput(
                  Math.min(
                    ctx.limits.maxStringLength,
                    ctx.limits.maxInputBytes,
                    ctx.limits.maxOutputSize,
                  ),
                )
              : "";
          const outputCheckpoint = ctx.executionScope.outputBytesUsed;
          const rawResult = await execute(
            stage.node,
            state,
            stdin,
            stage.streaming ? stdio : undefined,
            stage.resolved,
          );
          const result = ctx.executionScope.accountResult(
            rawResult,
            "pipeline",
            stage.extension
              ? undefined
              : Math.max(
                  0,
                  ctx.executionScope.outputBytesUsed - outputCheckpoint,
                ),
          );
          output.append(
            "stderr",
            result.stderr,
            result.internalOutputAccounting?.stderr ?? 0,
          );
          if (result.stdout) {
            relinquishPipelineOutput(
              ctx.executionScope,
              result.internalOutputAccounting?.stdout ?? 0,
              "pipeline",
            );
            await stdio.write(stdoutAsBytes(result));
          }
          return { stdout: "", stderr: "", exitCode: result.exitCode };
        } catch (error) {
          if (error instanceof BrokenPipeError)
            return { stdout: "", stderr: "", exitCode: 141 };
          if (!failed) {
            failure = error;
            failed = true;
          }
          cancel(error);
          abort.abort();
          return { stdout: "", stderr: "", exitCode: 1 };
        } finally {
          input?.cancel();
          next?.end();
          inputLease?.release();
        }
      }),
    );
    if (failed) {
      output.prependTo(failure);
      throw failure;
    }
    const statuses = results.map((result) => result.exitCode);
    return {
      result: output.build(statuses[statuses.length - 1], {
        stdoutKind: "bytes",
      }),
      statuses,
    };
  } finally {
    for (const lease of stageLeases) lease.release();
    cancel(new BrokenPipeError());
    combined.signal?.removeEventListener("abort", onAbort);
    combined.cleanup();
  }
}
