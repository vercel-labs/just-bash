import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "./defense-in-depth-box.js";

/**
 * Fail closed when execution is expected to run inside defense async context.
 */
export function assertDefenseContext(
  requireDefenseContext: boolean | undefined,
  component: string,
  phase: string,
): void {
  if (!requireDefenseContext) return;
  if (DefenseInDepthBox.isInSandboxedContext()) return;

  const message = `${component} ${phase} attempted outside defense context`;
  throw new SecurityViolationError(message, {
    timestamp: Date.now(),
    type: "missing_defense_context",
    message,
    path: "DefenseInDepthBox.context",
    stack: new Error().stack,
    executionId: DefenseInDepthBox.getCurrentExecutionId(),
  });
}

/**
 * Guard an async boundary by checking context both before and after await.
 */
export async function awaitWithDefenseContext<T>(
  requireDefenseContext: boolean | undefined,
  component: string,
  phase: string,
  op: () => Promise<T>,
): Promise<T> {
  assertDefenseContext(
    requireDefenseContext,
    component,
    `${phase} (pre-await)`,
  );
  const result = await op();
  assertDefenseContext(
    requireDefenseContext,
    component,
    `${phase} (post-await)`,
  );
  return result;
}

/**
 * Bind a callback to the current defense async context and assert defense
 * invariants on callback entry.
 */
export function bindDefenseContextCallback<TArgs extends unknown[], TResult>(
  requireDefenseContext: boolean | undefined,
  component: string,
  phase: string,
  callback: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  const guarded = ((...args: TArgs) => {
    assertDefenseContext(requireDefenseContext, component, phase);
    return callback(...args);
  }) as (...args: TArgs) => TResult;

  if (!requireDefenseContext) {
    return guarded;
  }
  return DefenseInDepthBox.bindCurrentContext(guarded) as (
    ...args: TArgs
  ) => TResult;
}
