/**
 * Browser-compatible entry point for just-bash.
 *
 * Excludes Node.js-specific modules:
 * - OverlayFs (requires node:fs)
 * - ReadWriteFs (requires node:fs)
 * - Sandbox (uses OverlayFs)
 *
 * Note: The gzip/gunzip/zcat commands will fail at runtime in browsers
 * since they use node:zlib. All other commands work.
 */

export type { BashLogger, BashOptions, ExecOptions } from "./Bash.js";
export { Bash } from "./Bash.js";
export type {
  AllCommandName,
  CommandName,
  NetworkCommandName,
} from "./commands/registry.js";
export {
  getCommandNames,
  getNetworkCommandNames,
} from "./commands/registry.js";
export type { CustomCommand, LazyCommand } from "./custom-commands.js";
export { defineCommand } from "./custom-commands.js";
export { InMemoryFs } from "./fs/in-memory-fs/index.js";
export type {
  BufferEncoding,
  CpOptions,
  DirectoryEntry,
  FileContent,
  FileEntry,
  FileInit,
  FileSystemFactory,
  FsEntry,
  FsStat,
  InitialFiles,
  MkdirOptions,
  RmOptions,
  SymlinkEntry,
} from "./fs/interface.js";
export type { NetworkConfig } from "./network/index.js";
export {
  NetworkAccessDeniedError,
  RedirectNotAllowedError,
  TooManyRedirectsError,
} from "./network/index.js";
export type {
  BashExecResult,
  Command,
  CommandContext,
  ExecResult,
  IFileSystem,
} from "./types.js";
