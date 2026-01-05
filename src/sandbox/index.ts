// New API
export {
  BashSandbox,
  type BashSandboxOptions,
  type ToolOptions,
} from "./BashSandbox.js";
export type {
  ExecOptions as SandboxExecOptions,
  ExecResult as SandboxExecResult,
  FileContent,
  FileInput,
  SandboxProvider,
} from "./provider.js";
export {
  BashProvider,
  type BashProviderOptions,
} from "./providers/bash-provider.js";
export {
  VercelProvider,
  type VercelProviderOptions,
} from "./providers/vercel-provider.js";

// Legacy API (deprecated but kept for backwards compatibility)
export type {
  CommandFinished,
  OutputMessage,
  SandboxOptions,
  WriteFilesInput,
} from "./Sandbox.js";
export {
  Command,
  Sandbox,
} from "./Sandbox.js";
