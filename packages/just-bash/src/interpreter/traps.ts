// Automa modifications: source migration of patch-trap-builtin.mjs.
import type { PipelineNode } from "../ast/types.js";
import { decodedTextFromResult, utf8ByteLength } from "../encoding.js";
import { ExecutionOutputAccumulator } from "../execution-output.js";
import { mapToRecord } from "../helpers/env.js";
import { parse } from "../parser/parser.js";
import type { ExecResult } from "../types.js";
import { ErrexitError, ExitError } from "./errors.js";
import { updateBashopts, updateShellopts } from "./helpers/shellopts.js";
import type { InterpreterContext } from "./types.js";

function automaTrapState(ctx: InterpreterContext) {
  ctx.state.automaTraps ??= new Map();
  return ctx.state.automaTraps;
}
export function automaTrapEligible(pipeline: PipelineNode): boolean {
  return (
    pipeline.commands.length > 1 ||
    [
      "SimpleCommand",
      "Subshell",
      "ArithmeticCommand",
      "ConditionalCommand",
    ].includes(pipeline.commands[0]?.type)
  );
}
export function automaTrapBuiltin(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  ctx.executionScope.throwIfAborted("trap");
  const traps = automaTrapState(ctx);
  let stdout = "",
    stderr = "",
    printing = false;
  if (args[0] === "--") args = args.slice(1);
  if (args[0] === "-p") {
    printing = true;
    args = args.slice(1);
  }
  if (!args.length || printing) {
    for (const name of args.length ? args : ["EXIT", "ERR"]) {
      const event = name === "0" ? "EXIT" : name;
      if (!["EXIT", "ERR"].includes(event)) {
        stderr += `bash: trap: ${name}: unsupported signal specification\n`;
        continue;
      }
      if (traps.has(event))
        stdout +=
          "trap -- '" +
          (traps.get(event) ?? "").replaceAll("'", "'\\''") +
          "' " +
          event +
          "\n";
    }
    return { stdout, stderr, exitCode: stderr ? 1 : 0 };
  }
  const action = args[0];
  if (args.length < 2)
    return {
      stdout: "",
      stderr: "bash: trap: usage: trap [-p] [action signal_spec ...]\n",
      exitCode: 2,
    };
  for (const name of args.slice(1)) {
    const event = name === "0" ? "EXIT" : name;
    if (!["EXIT", "ERR"].includes(event)) {
      stderr += `bash: trap: ${name}: unsupported signal specification\n`;
      continue;
    }
    ctx.state.automaTrapVersions ??= new Map();
    ctx.state.automaTrapVersions.set(
      event,
      (ctx.state.automaTrapVersions.get(event) || 0) + 1,
    );
    action === "-" ? traps.delete(event) : traps.set(event, action);
  }
  return { stdout, stderr, exitCode: stderr ? 1 : 0 };
}
export async function automaTrapRun(
  ctx: InterpreterContext,
  event: string,
  status: number,
): Promise<ExecResult | null> {
  const action = automaTrapState(ctx).get(event);
  ctx.state.automaTrapRunning ??= new Set();
  const running = ctx.state.automaTrapRunning;
  if (action === undefined || action === "" || running.has(event)) return null;
  ctx.executionScope.throwIfAborted(`trap ${event}`);
  if (action.length > ctx.limits.maxSourceBytes)
    ctx.executionScope.consumeLimited(
      "trap source",
      action.length,
      ctx.limits.maxSourceBytes,
      "trap",
    );
  const actionBytes = utf8ByteLength(action);
  if (actionBytes > ctx.limits.maxSourceBytes)
    ctx.executionScope.consumeLimited(
      "trap source",
      actionBytes,
      ctx.limits.maxSourceBytes,
      "trap",
    );
  ctx.executionScope.consumeInput(actionBytes, "trap action");
  const lease = ctx.executionScope.reserveBytes(actionBytes * 6, "trap parser");
  running.add(event);
  const savedExitStatus = ctx.state.automaTrapExitStatus;
  if (event === "EXIT") ctx.state.automaTrapExitStatus = status;
  ctx.state.lastExitCode = status;
  ctx.state.env.set("?", String(status));
  const output = new ExecutionOutputAccumulator(
    ctx.executionScope,
    `trap ${event}`,
  );
  try {
    const ast = parse(action, {
      maxHeredocSize: ctx.limits.maxHeredocSize,
    });
    for (const statement of ast.statements) {
      ctx.executionScope.throwIfAborted(`trap ${event}`);
      const result = await ctx.executeStatement(statement);
      output.appendResult(result, decodedTextFromResult(result));
    }
    return output.build(status);
  } catch (error) {
    output.prependTo(error);
    throw error;
  } finally {
    lease.release();
    running.delete(event);
    ctx.state.automaTrapExitStatus = savedExitStatus;
    ctx.state.lastExitCode = status;
    ctx.state.env.set("?", String(status));
  }
}
export async function automaTrapShell(
  ctx: InterpreterContext,
  run: () => Promise<ExecResult>,
): Promise<ExecResult> {
  let result: ExecResult;
  try {
    result = await run();
  } catch (error) {
    if (!(error instanceof ExitError) && !(error instanceof ErrexitError))
      throw error;
    result = {
      stdout: error.stdout,
      stderr: error.stderr,
      exitCode: error.exitCode,
      internalOutputAccounting: error.internalOutputAccounting,
      internalOutputSegments: error.internalOutputSegments,
    };
  }
  ctx.executionScope.throwIfAborted("shell EXIT trap");
  const output = new ExecutionOutputAccumulator(
    ctx.executionScope,
    "shell EXIT trap",
  );
  output.appendResult(result);
  let status = result.exitCode;
  if (!ctx.state.automaTrapExiting) {
    ctx.state.automaTrapExiting = true;
    try {
      const trap = await automaTrapRun(ctx, "EXIT", status);
      if (trap) output.appendResult(trap);
    } catch (error) {
      if (!(error instanceof ExitError) && !(error instanceof ErrexitError)) {
        output.prependTo(error);
        throw error;
      }
      output.appendResult({
        stdout: error.stdout,
        stderr: error.stderr,
        exitCode: error.exitCode,
        internalOutputAccounting: error.internalOutputAccounting,
        internalOutputSegments: error.internalOutputSegments,
      });
      status = error.exitCode;
    }
  }
  ctx.state.lastExitCode = status;
  ctx.state.env.set("?", String(status));
  return {
    ...result,
    ...output.build(status),
    env: mapToRecord(ctx.state.env),
  };
}
export async function automaTrapChild(
  ctx: InterpreterContext,
  run: () => Promise<ExecResult>,
  kind: "script" | "command" | "process" | "subshell" | "pipeline",
): Promise<ExecResult> {
  const state = ctx.state,
    saved = {
      automaTraps: state.automaTraps,
      automaTrapVersions: state.automaTrapVersions,
      automaTrapRunning: state.automaTrapRunning,
      automaTrapExiting: state.automaTrapExiting,
      automaTrapExitStatus: state.automaTrapExitStatus,
      inCondition: state.inCondition,
      automaTrapScriptDepth: state.automaTrapScriptDepth,
      options: state.options,
      shoptOptions: state.shoptOptions,
    };
  const handlers = new Map<string, string>();
  if (
    state.options.errtrace &&
    kind !== "script" &&
    state.automaTraps?.has("ERR")
  )
    handlers.set("ERR", state.automaTraps.get("ERR") ?? "");
  state.automaTraps = handlers;
  state.automaTrapVersions = new Map();
  state.automaTrapRunning = new Set(
    kind === "command" && saved.automaTrapRunning?.has("ERR") ? ["ERR"] : [],
  );
  state.automaTrapExiting = false;
  state.automaTrapExitStatus = undefined;
  if (kind === "script") state.inCondition = false;
  state.automaTrapScriptDepth = 1;
  state.options = { ...state.options };
  state.shoptOptions = { ...state.shoptOptions };
  if (
    (kind === "command" && !state.shoptOptions.inherit_errexit) ||
    kind === "script"
  )
    state.options.errexit = false;
  if (kind === "script") {
    state.options.errtrace = false;
    state.shoptOptions.inherit_errexit = false;
  }
  updateShellopts(ctx);
  updateBashopts(ctx);
  try {
    return await automaTrapShell(ctx, run);
  } finally {
    Object.assign(state, saved);
  }
}
export async function automaTrapFunction(
  ctx: InterpreterContext,
  run: () => Promise<ExecResult>,
): Promise<ExecResult> {
  const savedSafe = ctx.state.errexitSafe;
  const traps = automaTrapState(ctx),
    handler = traps.get("ERR"),
    inherit = ctx.state.options.errtrace;
  if (!inherit) traps.delete("ERR");
  try {
    return await run();
  } finally {
    ctx.state.errexitSafe = savedSafe;
    if (!inherit && !traps.has("ERR")) {
      if (handler !== undefined) traps.set("ERR", handler);
      else traps.delete("ERR");
    }
  }
}
export async function automaTrapPipeline(
  ctx: InterpreterContext,
  pipeline: PipelineNode,
  child: boolean,
  run: () => Promise<ExecResult>,
): Promise<ExecResult> {
  const saved = ctx.state.inCondition;
  ctx.state.inCondition = saved || pipeline.negated;
  try {
    return child ? await automaTrapChild(ctx, run, "pipeline") : await run();
  } finally {
    ctx.state.inCondition = saved;
  }
}
