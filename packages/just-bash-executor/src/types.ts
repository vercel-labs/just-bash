/**
 * Public types for `@just-bash/executor`.
 *
 * Mirror `@executor-js/sdk` shapes without importing the SDK at type-resolution
 * time, so consumers who only use inline tools don't pay for SDK imports.
 */

/** Tool definition for inline registration. */
export interface ExecutorToolDef {
  description?: string;
  // biome-ignore lint/suspicious/noExplicitAny: matches @executor/sdk SimpleTool signature
  execute: (...args: any[]) => unknown;
}

/**
 * Elicitation context passed to the handler when a tool requests user input.
 * Mirrors @executor-js/sdk's ElicitationContext without importing the SDK.
 */
export interface ExecutorElicitationContext {
  readonly toolId: string;
  readonly args: unknown;
  readonly request:
    | {
        readonly _tag: "FormElicitation";
        readonly message: string;
        readonly requestedSchema: Record<string, unknown>;
      }
    | {
        readonly _tag: "UrlElicitation";
        readonly message: string;
        readonly url: string;
        readonly elicitationId: string;
      };
}

/**
 * Response from an elicitation handler.
 */
export interface ExecutorElicitationResponse {
  readonly action: "accept" | "decline" | "cancel";
  readonly content?: Record<string, unknown>;
}

/**
 * Handler for tool elicitation requests (form input, OAuth URLs, etc.).
 * Compatible with @executor-js/sdk's ElicitationHandler.
 */
export type ExecutorElicitationHandler = (
  ctx: ExecutorElicitationContext,
) => Promise<ExecutorElicitationResponse>;

/**
 * Executor SDK instance type (subset of `@executor-js/sdk`'s public API).
 * Kept as an opaque type to avoid requiring the SDK at import time.
 */
export interface ExecutorSDKHandle {
  tools: {
    list: (filter?: {
      sourceId?: string;
      query?: string;
    }) => Promise<readonly unknown[]>;
    invoke: (
      toolId: string,
      args: unknown,
      options: { onElicitation: ExecutorElicitationHandler | "accept-all" },
    ) => Promise<{ data: unknown; error: unknown; status?: number }>;
  };
  sources: {
    add: (input: Record<string, unknown>) => Promise<void>;
    list: () => Promise<readonly unknown[]>;
  };
  close: () => Promise<void>;
}

/** Approval request payload passed to the onToolApproval callback. */
export interface ExecutorApprovalRequest {
  toolPath: string;
  sourceId: string;
  sourceName: string;
  operationKind: "read" | "write" | "delete" | "execute" | "unknown";
  args: unknown;
  reason: string;
  approvalLabel: string | null;
}

/** Approval response from a custom onToolApproval callback. */
export type ExecutorApprovalResponse =
  | { approved: true }
  | { approved: false; reason?: string };

/** Configuration for createExecutor. */
export interface ExecutorConfig {
  /** Tool map: keys are dot-separated paths (e.g. "math.add"), values are tool definitions. */
  tools?: Record<string, ExecutorToolDef>;
  /**
   * Async setup function that receives the SDK instance.
   * Use this to add sources that auto-discover tools.
   *
   * Supported source kinds:
   * - `"custom"` — direct tool registration (inline `{ execute }` functions)
   * - `"graphql"` — auto-discovers tools via schema introspection (`@executor-js/plugin-graphql`)
   * - `"openapi"` — auto-discovers tools from an OpenAPI spec (`@executor-js/plugin-openapi`)
   * - `"mcp"` — connects to an MCP server and discovers tools (`@executor-js/plugin-mcp`)
   */
  setup?: (sdk: ExecutorSDKHandle) => Promise<void>;
  /**
   * Additional @executor-js/sdk plugins to load.
   * Passed directly to createExecutor({ plugins: [...] }).
   */
  // biome-ignore lint/suspicious/noExplicitAny: AnyPlugin type from @executor-js/sdk; avoid requiring SDK at import time
  plugins?: any[];
  /**
   * Tool approval callback for the SDK pipeline.
   * Called when an SDK-registered tool invocation requires approval.
   * Defaults to "allow-all" when not provided.
   *
   * Note: inline tools (registered via `tools`) bypass approval — the user
   * controls `execute()` directly.
   */
  onToolApproval?:
    | "allow-all"
    | "deny-all"
    | ((request: ExecutorApprovalRequest) => Promise<ExecutorApprovalResponse>);
  /**
   * Elicitation handler for the SDK pipeline.
   * Called when a tool requests user input (form data, OAuth approval, etc.).
   * Defaults to declining all elicitation requests.
   *
   * Pass "accept-all" to auto-approve (not recommended for untrusted tools).
   */
  onElicitation?: ExecutorElicitationHandler | "accept-all";
  /**
   * When true (default), executor tools are returned as bash namespace
   * commands in `executor.commands`. Set to false if you only want script-level
   * `tools` proxy access via `invokeTool`.
   */
  exposeToolsAsCommands?: boolean;
}
