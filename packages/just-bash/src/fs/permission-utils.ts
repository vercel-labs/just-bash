export function isPermissionDenied(error: unknown): boolean {
  // @banned-pattern-ignore: checks only an errno prefix and does not forward error text
  return error instanceof Error && error.message.startsWith("EACCES");
}
