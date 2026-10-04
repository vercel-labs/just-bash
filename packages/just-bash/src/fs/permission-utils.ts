export function isPermissionDenied(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message;
  return message.startsWith("EACCES");
}
