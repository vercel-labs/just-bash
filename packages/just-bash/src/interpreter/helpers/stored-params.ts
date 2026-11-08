export const INTMAX_MAX: bigint = 2n ** 63n - 1n;
const INTMAX_DIGITS = String(INTMAX_MAX).length;

export function leadingInteger(text: string): bigint | undefined {
  const match = /^\s*([+-]?)0*(\d{1,20})/.exec(text);
  if (!match) return undefined;
  const [, sign, digits] = match;
  const magnitude =
    digits.length > INTMAX_DIGITS ? INTMAX_MAX + 1n : BigInt(digits);
  return sign === "-" ? -magnitude : magnitude;
}

export function positionalCount(env: Map<string, string>): bigint {
  const count = leadingInteger(env.get("#") || "0");
  return count !== undefined && count > 0n && count <= INTMAX_MAX ? count : 0n;
}

export function moveStoredParams(
  env: Map<string, string>,
  count: bigint,
  n: bigint,
): string[] {
  return count <= BigInt(env.size)
    ? moveWalked(env, Number(count), Number(n))
    : moveScanned(env, count, n);
}

function moveWalked(
  env: Map<string, string>,
  count: number,
  n: number,
): string[] {
  const kept: string[] = [];
  for (let i = 1; i <= count; i++) {
    const key = String(i);
    const value = env.get(key);
    if (value === undefined) continue;
    env.delete(key);
    if (i > n) {
      env.set(String(i - n), value);
      kept.push(value);
    }
  }
  return kept;
}

function moveScanned(
  env: Map<string, string>,
  count: bigint,
  n: bigint,
): string[] {
  const last = String(count);
  const stored = [...env]
    .filter(
      ([key]) =>
        key.length <= last.length &&
        /^[1-9]\d*$/.test(key) &&
        BigInt(key) <= count,
    )
    .map(([key, value]): [bigint, string] => [BigInt(key), value])
    .sort(([a], [b]) => (a < b ? -1 : 1));

  for (const [index] of stored) {
    env.delete(String(index));
  }

  const kept = stored.filter(([index]) => index > n);
  for (const [index, value] of kept) {
    env.set(String(index - n), value);
  }
  return kept.map(([, value]) => value);
}
