import { ExecutionAbortedError } from "../interpreter/errors.js";

const REALPATH_CHECKPOINT_INTERVAL = 4096;

export interface RealpathOptions {
  /** Abort an in-progress component walk at the next checkpoint. */
  signal?: AbortSignal;
}

/**
 * Keep component-heavy realpath requests interruptible without changing the
 * order in which virtual path components are resolved.
 */
export async function realpathCheckpoint(options: {
  signal?: AbortSignal;
  work: number;
}): Promise<void> {
  if (options.signal?.aborted) throw new ExecutionAbortedError();
  if (options.work % REALPATH_CHECKPOINT_INTERVAL !== 0) return;

  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  if (options.signal?.aborted) throw new ExecutionAbortedError();
}
