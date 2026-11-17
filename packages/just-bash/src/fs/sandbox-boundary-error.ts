/**
 * A refusal by the sandbox itself: a path that resolves outside the root, a
 * symlink the policy does not allow, a special file, an entry swapped between
 * check and use. It keeps the `EACCES: ...` message the filesystems always
 * produced, but it is a policy decision, not a permission the user could
 * change, so callers that turn filesystem errnos into diagnostics (`errnoReason`)
 * must not translate it: it stays a hard failure.
 */
export class SandboxBoundaryError extends Error {
  readonly name = "SandboxBoundaryError";
}
