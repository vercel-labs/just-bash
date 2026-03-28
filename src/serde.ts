/**
 * Serialization types for Bash and InMemoryFs.
 *
 * Used by `toJSON()` / `fromJSON()` methods and `@workflow/serde` symbols.
 */

import type { ExecutionLimits } from "./limits.js";
import type { DefenseInDepthConfig } from "./security/types.js";

/**
 * Serialized representation of a single filesystem entry.
 * Lazy file entries are excluded (they contain non-serializable functions
 * and are recreated by initFilesystem on deserialization).
 */
export interface SerializedFsEntry {
  type: "file" | "directory" | "symlink";
  /** File content (files only) — Uint8Array is natively supported by devalue */
  content?: Uint8Array;
  /** Symlink target path (symlinks only) */
  target?: string;
  /** Unix permission mode */
  mode: number;
  /** Modification time — Date is natively supported by devalue */
  mtime: Date;
}

/**
 * Serialized representation of an InMemoryFs instance.
 */
export interface SerializedInMemoryFs {
  /** Map of normalized paths to serialized filesystem entries */
  entries: Map<string, SerializedFsEntry>;
}

/**
 * Serialized representation of a Bash instance.
 */
export interface SerializedBash {
  /** Configuration needed to reconstruct the Bash environment */
  config: SerializedBashConfig;
  /** Complete interpreter state (signal excluded — runtime-only) */
  state: Omit<import("./interpreter/types.js").InterpreterState, "signal">;
  /** Serialized filesystem */
  fs: SerializedInMemoryFs;
}

export interface SerializedBashConfig {
  limits: Required<ExecutionLimits>;
  useDefaultLayout: boolean;
  jsBootstrapCode?: string;
  defenseInDepthConfig?: DefenseInDepthConfig | boolean;
  processInfo: {
    pid: number;
    ppid: number;
    uid: number;
    gid: number;
  };
}

/**
 * The InterpreterState fields are all Maps, Sets, plain objects, and primitives —
 * all natively supported by devalue. The `signal` field is excluded
 * (runtime-only, not serializable).
 */
export type { InterpreterState } from "./interpreter/types.js";
