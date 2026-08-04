import { ExecutionLimitError } from "../errors.js";

/** Append untrusted collections without argument spreading and with a cumulative cap. */
export function appendBoundedElements<T>(
  target: T[],
  values: readonly T[],
  maximum: number,
  site: string,
): void {
  if (target.length > maximum - values.length) {
    throw new ExecutionLimitError(
      `${site} element limit exceeded (${maximum})`,
      "array_elements",
    );
  }
  for (const value of values) target.push(value);
}
