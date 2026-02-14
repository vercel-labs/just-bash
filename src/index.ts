// AST types (for plugin authors)
export type {
  CommandNode,
  PipelineNode,
  ScriptNode,
  SimpleCommandNode,
  StatementNode,
  WordNode,
} from "./ast/types.js";
export type { BashLogger, BashOptions, ExecOptions } from "./Bash.js";
export { Bash } from "./Bash.js";
export type {
  AllCommandName,
  CommandName,
  NetworkCommandName,
  PythonCommandName,
} from "./commands/registry.js";
export {
  getCommandNames,
  getNetworkCommandNames,
  getPythonCommandNames,
} from "./commands/registry.js";
// Custom commands API
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
export {
  MountableFs,
  type MountableFsOptions,
  type MountConfig,
} from "./fs/mountable-fs/index.js";
export { OverlayFs, type OverlayFsOptions } from "./fs/overlay-fs/index.js";
export {
  ReadWriteFs,
  type ReadWriteFsOptions,
} from "./fs/read-write-fs/index.js";
export type { NetworkConfig } from "./network/index.js";
export {
  NetworkAccessDeniedError,
  RedirectNotAllowedError,
  TooManyRedirectsError,
} from "./network/index.js";
// Parser
export { parse } from "./parser/parser.js";
export type {
  CommandFinished as SandboxCommandFinished,
  OutputMessage,
  SandboxOptions,
  WriteFilesInput,
} from "./sandbox/index.js";
// Vercel Sandbox API compatible exports
export { Command as SandboxCommand, Sandbox } from "./sandbox/index.js";
// Security module - defense-in-depth
export type {
  DefenseInDepthConfig,
  DefenseInDepthHandle,
  DefenseInDepthStats,
  SecurityViolation,
  SecurityViolationType,
} from "./security/index.js";
export {
  createConsoleViolationCallback,
  DefenseInDepthBox,
  SecurityViolationError,
  SecurityViolationLogger,
} from "./security/index.js";
// Transform API
export { BashTransformPipeline } from "./transform/pipeline.js";
export type { CommandCollectorMetadata } from "./transform/plugins/command-collector.js";
export { CommandCollectorPlugin } from "./transform/plugins/command-collector.js";
export type {
  TeeFileInfo,
  TeePluginMetadata,
  TeePluginOptions,
} from "./transform/plugins/tee-plugin.js";
export { TeePlugin } from "./transform/plugins/tee-plugin.js";
export { serialize } from "./transform/serialize.js";
export type {
  BashTransformResult,
  TransformContext,
  TransformPlugin,
  TransformResult,
} from "./transform/types.js";
export type {
  BashExecResult,
  Command,
  CommandContext,
  ExecResult,
  IFileSystem,
} from "./types.js";
