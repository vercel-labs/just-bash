/** A copy failed while opening its existing destination for writing. */
export class CopyDestinationOpenError extends Error {
  constructor(
    readonly code: string,
    readonly path: string,
  ) {
    super(`${code}: cannot open destination for writing, cp '${path}'`);
    this.name = "CopyDestinationOpenError";
  }
}
