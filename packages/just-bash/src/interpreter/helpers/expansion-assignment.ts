import type { InterpreterContext } from "../types.js";

/** Expansion assignments affect their shell scope, unlike temporary prefix installation. */
export function setExpansionVariable(
  ctx: InterpreterContext,
  name: string,
  value: string,
): void {
  ctx.state.env.set(name, value);
  ctx.onExpansionAssignment?.(name, value);
}
