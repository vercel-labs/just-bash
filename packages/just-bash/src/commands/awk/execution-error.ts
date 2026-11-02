// Automa modifications: retain upstream AWK error output without text deduplication.
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { AwkRuntimeContext } from "./interpreter/context.js";

const outputOwners = new WeakMap<ExecutionLimitError, AwkRuntimeContext>();

export function awkLimitWithOutput(
  ctx: AwkRuntimeContext,
  message: string,
  kind: ExecutionLimitError["limitType"],
): ExecutionLimitError {
  const error = new ExecutionLimitError(message, kind, ctx.output);
  outputOwners.set(error, ctx);
  return error;
}

export function preserveAwkOutput(
  error: ExecutionLimitError,
  ctx: AwkRuntimeContext,
): void {
  if (outputOwners.get(error) !== ctx) error.prependOutput(ctx.output, "");
}
