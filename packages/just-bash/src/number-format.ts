/**
 * C-style floating point conversions shared by bash `printf` and awk `printf`.
 *
 * JavaScript's `toExponential` and `toPrecision` differ from C in two ways that
 * matter here: the exponent has no minimum width (`1e+5` rather than `1e+05`),
 * and `toPrecision` switches to exponent notation at different thresholds than
 * `%g`.
 */

/** Pad the exponent to at least two digits, as C does (`e+5` -> `e+05`). */
function padExponent(str: string): string {
  return str.replace(/e([+-])(\d)$/, "e$10$2");
}

/** The digits of `%e`: `d.ddde+XX`, with `precision` digits after the point. */
export function formatExponential(num: number, precision: number): string {
  return padExponent(num.toExponential(precision));
}

/**
 * The digits of `%g`, which prints `num` with `precision` significant digits
 * (a precision of 0 counts as 1).
 *
 * Exponent form is used when the exponent X of the `%e` rendering, taken after
 * rounding, is below -4 or at least `precision`; otherwise fixed notation is
 * used. Trailing zeros of the mantissa (and a bare decimal point) are removed
 * unless `keepTrailingZeros` is set, which is what the `#` flag asks for.
 */
export function formatGeneral(
  num: number,
  precision: number,
  keepTrailingZeros = false,
): string {
  if (!Number.isFinite(num)) return String(num);
  const digits = precision === 0 ? 1 : precision;
  const exponential = num.toExponential(digits - 1);
  const exponent = Number(exponential.slice(exponential.indexOf("e") + 1));
  const result =
    exponent < -4 || exponent >= digits ? exponential : num.toPrecision(digits);
  if (keepTrailingZeros) return padExponent(result);

  // Only the mantissa is trimmed: the zeros of "1e+10" and "100000" are
  // significant, and the zeros of "1.50000e+10" are not.
  const split = result.indexOf("e");
  const mantissa = split === -1 ? result : result.slice(0, split);
  const suffix = split === -1 ? "" : result.slice(split);
  const trimmed = mantissa.includes(".")
    ? mantissa.replace(/\.?0+$/, "")
    : mantissa;
  return padExponent(trimmed + suffix);
}
