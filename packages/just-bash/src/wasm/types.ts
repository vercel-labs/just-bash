import type { WasiContext } from "./wasi/types.js";

export type { WasiContext as WasmWasiContext } from "./wasi/types.js";

/** Register a core WebAssembly module as a shell command. */
export interface WasmCommandOptions {
  /** Bytes, or a lazy host loader. Loaders receive this invocation's cancellation signal. */
  wasm: Uint8Array | ((signal: AbortSignal) => Promise<Uint8Array>);
  /** Wall time including loading and compilation (default: 30 seconds). */
  timeoutMs?: number;
  /** Maximum linear memory, rounded down to 64 KiB pages (default: 256 MiB). */
  maxMemoryBytes?: number;
  /** Maximum module bytes (default: 64 MiB). */
  maxModuleBytes?: number;
  /** Maximum size of an individual virtual file (default: 64 MiB). */
  maxFileBytes?: number;
  /** Maximum function table elements (default: 1,000,000). */
  maxTableElements?: number;
  /** Browser worker asset URL, when the bundler cannot resolve the default asset. */
  workerUrl?: string | URL;
  /**
   * Defaults to "wasi" for WASI Preview 1 commands. For other ABIs, supply an
   * absolute URL to a trusted JavaScript module whose default export is a
   * WasmAdapter. The module is imported inside each invocation's worker.
   */
  adapter?: "wasi" | string | URL;
}

/** Explicit WASI Preview 1 registration uses the default adapter. */
export type WasiCommandOptions = Omit<WasmCommandOptions, "adapter">;

export interface WasmLimits {
  timeoutMs: number;
  maxMemoryBytes: number;
  maxModuleBytes: number;
  maxFileBytes: number;
  maxTableElements: number;
}

/** Trusted worker module's default export. Return an exit code, or void for 0. */
export type WasmAdapter = (
  context: WasmAdapterContext,
  // biome-ignore lint/suspicious/noConfusingVoidType: adapters may finish without an explicit return, synchronously or asynchronously.
) => number | void | Promise<number | void>;

export interface WasmInputStream {
  /** Read up to 64 KiB. An empty result means EOF. */
  read(size?: number): Uint8Array;
  /** Read the remaining input, bounded by maxFileBytes. */
  readAll(): Uint8Array;
}

export interface WasmOutputStream {
  /** Write strings or bytes in bounded frames. Stdout preserves bytes; stderr decodes UTF-8. */
  write(data: string | Uint8Array): void;
}

export interface WasmFileStat {
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  mtimeMs: number;
}

/** Synchronous operations on the shell's async filesystem via the worker bridge. */
export interface WasmFileSystem {
  /** Resolve against the shell cwd. Absolute paths refer to the virtual root. */
  resolve(path: string): string;
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: string | Uint8Array): void;
  appendFile(path: string, data: string | Uint8Array): void;
  stat(path: string): WasmFileStat;
  readdir(path: string): string[];
  mkdir(path: string): void;
  unlink(path: string): void;
  rmdir(path: string): void;
  rename(source: string, target: string): void;
}

export interface WasmAdapterContext {
  readonly name: string;
  /** Shell arguments, excluding the command name. */
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: ReadonlyMap<string, string>;
  readonly limits: Readonly<WasmLimits>;
  /**
   * Compiled module with capped memory/table maxima, for SDKs that instantiate
   * internally. Limits apply per instance; the adapter must create only one.
   */
  readonly module: WebAssembly.Module;
  /**
   * Instantiate the bounded module once. Only explicitly supplied imports are
   * linked. Imported memories/tables must declare compatible capped maxima.
   */
  instantiate(imports?: WebAssembly.Imports): Promise<WebAssembly.Instance>;
  readonly stdin: WasmInputStream;
  readonly stdout: WasmOutputStream;
  readonly stderr: WasmOutputStream;
  readonly fs: WasmFileSystem;
  readonly wasi: WasiContext;
}
