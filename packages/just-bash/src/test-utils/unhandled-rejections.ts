/**
 * Track process-level unhandled rejections for the duration of one call.
 *
 * A cancelled invocation can abandon work that settles later, and an abandoned
 * promise that rejects would otherwise escape into a host that treats unhandled
 * rejections as fatal. The listener is always removed, so a failed assertion
 * cannot leak it into later tests.
 */
export async function withUnhandledRejectionsTracked<T>(
  run: () => Promise<T>,
): Promise<{ result: T; rejections: unknown[] }> {
  const rejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    rejections.push(reason);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    const result = await run();
    return { result, rejections };
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
}
