export function replacePositionalParams(
  env: Map<string, string>,
  args: string[],
): Map<string, string | undefined> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of env) {
    if (/^[1-9]\d*$/.test(key)) saved.set(key, value);
  }
  for (const key of saved.keys()) env.delete(key);
  args.forEach((arg, i) => {
    const key = String(i + 1);
    if (!saved.has(key)) saved.set(key, undefined);
    env.set(key, arg);
  });
  return saved;
}
