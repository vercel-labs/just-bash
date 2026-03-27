/** Vendored @executor/sdk bundle — re-exports createExecutor and types */
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
