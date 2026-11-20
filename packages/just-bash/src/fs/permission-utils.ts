export class ReadPermissionError extends Error {
  readonly code = "EACCES";

  constructor(readonly path: string) {
    super(`EACCES: permission denied, open '${path}'`);
  }
}

export function isPermissionDenied(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code === "EACCES";
  }
  // @banned-pattern-ignore: checks only an errno prefix and does not forward error text
  return error instanceof Error && error.message.startsWith("EACCES");
}
