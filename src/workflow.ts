/**
 * Workflow-compatible exports for just-bash.
 *
 * This entry point exports opaque handle classes that mirror the real
 * Bash and InMemoryFs classes but provide stub method implementations.
 * This is designed for workflow environments where:
 * - The Bash instance is serialized and passed between steps
 * - Actual execution happens in steps that import from "just-bash" (not "just-bash/workflow")
 * - Node.js APIs are not available at module load time
 *
 * IMPORTANT: This file must be completely self-contained with NO imports
 * from other internal modules (except @workflow/serde, ./BashHandle.js, and ./InMemoryFsHandle.js)
 * to avoid pulling in transitive dependencies during workflow discovery.
 *
 * Usage in workflow code:
 *   import { Bash } from "just-bash/workflow";
 *
 * Usage in step functions (where actual execution is needed):
 *   import { Bash } from "just-bash";
 *
 * NOTE: The classes exported here are OPAQUE HANDLES. Methods like exec(),
 * readFile(), and writeFile() will throw errors if called. Use the real
 * classes from "just-bash" in steps where you need to execute commands.
 */

// Re-export Workflow serde symbols for user convenience
export { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from '@workflow/serde';

// Bash opaque handle class and related types
export {
  Bash,
  type BashLogger,
  type BashOptions,
  createInitialState,
  type ExecOptions,
} from './BashHandle.js';

// InMemoryFs opaque handle class - needed for deserializing Bash.fs property
export { InMemoryFs } from './InMemoryFsHandle.js';
