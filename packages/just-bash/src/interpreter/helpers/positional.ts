const SINGLE_DIGIT_PARAMS = 9;

function inParamRange(
  env: Map<string, string>,
  i: number,
  min: number,
): boolean {
  return i <= Math.max(min, SINGLE_DIGIT_PARAMS) || env.has(String(i));
}

export function clearPositionalParams(env: Map<string, string>): void {
  for (let i = 1; inParamRange(env, i, 0); i++) env.delete(String(i));
}

export function replacePositionalParams(
  env: Map<string, string>,
  args: string[],
): Map<string, string | undefined> {
  const saved = new Map<string, string | undefined>();
  for (let i = 1; inParamRange(env, i, args.length); i++) {
    saved.set(String(i), env.get(String(i)));
  }
  clearPositionalParams(env);
  for (const [i, arg] of args.entries()) env.set(String(i + 1), arg);
  return saved;
}
