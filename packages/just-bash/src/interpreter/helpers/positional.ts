export function replacePositionalParams(
  env: Map<string, string>,
  args: string[],
): Map<string, string | undefined> {
  const saved = new Map<string, string | undefined>();
  for (let i = 1; i <= args.length || env.has(String(i)); i++) {
    const key = String(i);
    saved.set(key, env.get(key));
    if (i <= args.length) env.set(key, args[i - 1]);
    else env.delete(key);
  }
  return saved;
}
