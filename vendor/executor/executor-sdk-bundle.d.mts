/** Vendored @executor/sdk bundle — re-exports createExecutor, createFsBackend, and types */

export interface SyncableFS {
  writeFileSync(path: string, content: string | Uint8Array): void;
  mkdirSync?(path: string, options?: { recursive?: boolean }): void;
  readFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

export interface FsStorageOptions {
  fs: SyncableFS;
  root?: string;
  resolveSecret?: (input: { secretId: string; context?: Record<string, unknown> }) => Promise<string | null> | string | null;
}

export declare function createFsBackend(options: FsStorageOptions): unknown;

export declare function createExecutor(options: {
  runtime?: unknown;
  storage?: unknown;
  tools?: Record<string, { description?: string; execute: (...args: unknown[]) => unknown }>;
  onToolApproval?: unknown;
  onInteraction?: unknown;
  resolveSecret?: unknown;
}): Promise<{
  execute: (code: string) => Promise<{ result: unknown; error?: string; logs?: string[] }>;
  sources: {
    add: (input: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
    list: () => Promise<unknown[]>;
    [key: string]: unknown;
  };
  close: () => Promise<void>;
  [key: string]: unknown;
}>;
