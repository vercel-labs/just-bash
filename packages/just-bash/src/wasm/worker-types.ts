import type { ResolvedCommandContext } from "../types.js";
import type { WasmCommandOptions, WasmLimits } from "./types.js";
import type { WasiRequest } from "./wasi/requests.js";

export interface WorkerInput {
  /** An invocation-owned buffer transferred to the worker. */
  wasm: Uint8Array<ArrayBuffer>;
  args: string[];
  env: string[];
  cwd: string;
  adapter?: string;
  buffer: SharedArrayBuffer;
  limits: WasmLimits;
}

export type WorkerMessage =
  | WasiRequest
  | { type: "done"; exitCode: number }
  | { type: "error"; message: string };

export interface WasmWorker {
  postMessage(input: WorkerInput): void;
  listen(
    message: (message: WorkerMessage) => void,
    error: () => void,
  ): () => void;
  terminate(): Promise<void>;
}

export type WorkerFactory = (
  options: WasmCommandOptions,
  context: ResolvedCommandContext,
) => WasmWorker;

export interface FileStat {
  type: number;
  size: number;
  mtime: number;
  ino: string;
  dev: string;
}
