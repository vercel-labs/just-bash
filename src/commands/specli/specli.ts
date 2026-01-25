/**
 * specli - Execute OpenAPI specs as CLI commands
 *
 * This command integrates specli into just-bash, allowing AI agents to make
 * API calls through OpenAPI specifications within the sandboxed bash environment.
 *
 * Usage: specli <spec> <resource> <action> [args...] [--options]
 *
 * Network access must be explicitly configured via BashEnvOptions.network.
 */

import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";

const specliHelp = {
  name: "specli",
  summary: "Execute OpenAPI specs as CLI commands",
  usage: "specli <spec> <resource> <action> [args...] [options]",
  options: [
    "Built-in commands (use instead of resource/action):",
    "  __schema                Show available resources and actions",
    "",
    "Global options:",
    "  --server <url>          Override server/base URL",
    "  --server-var <k=v>      Server URL template variable (repeatable)",
    "  --auth <scheme>         Auth scheme to use",
    "  --bearer-token <token>  Bearer token for authentication",
    "  --oauth-token <token>   OAuth token (alias for --bearer-token)",
    "  --api-key <key>         API key for authentication",
    "  --username <user>       Basic auth username",
    "  --password <pass>       Basic auth password",
    "  --json                  Output as JSON (default for programmatic use)",
    "",
    "Request options:",
    "  --dry-run               Preview request without sending",
    "  --curl                  Output as curl command",
    "  --timeout <ms>          Request timeout in milliseconds",
    "",
    "Examples:",
    "  specli ./openapi.json __schema",
    "  specli ./openapi.json users list --limit 10",
    "  specli ./openapi.json users get abc123",
    "  specli https://api.example.com/openapi.json posts create --title 'Hello'",
  ],
};

/**
 * Parse specli command arguments into structured options
 */
interface ParsedArgs {
  spec: string;
  resource: string;
  action: string;
  positionalArgs: string[];
  flags: Record<string, unknown>;
  globalOptions: {
    server?: string;
    serverVars?: Record<string, string>;
    auth?: string;
    bearerToken?: string;
    apiKey?: string;
    username?: string;
    password?: string;
    json?: boolean;
    dryRun?: boolean;
    curl?: boolean;
    timeout?: number;
  };
}

function parseArgs(
  args: string[],
  env: Record<string, string>,
): ParsedArgs | ExecResult {
  if (args.length < 1) {
    return {
      stdout: "",
      stderr: "specli: missing spec argument\nUsage: specli <spec> <resource> <action> [args...]\n",
      exitCode: 1,
    };
  }

  const spec = args[0];
  const remaining = args.slice(1);

  // Find where flags start (first arg starting with --)
  let flagStartIndex = remaining.findIndex((arg) => arg.startsWith("--"));
  if (flagStartIndex === -1) flagStartIndex = remaining.length;

  const positionalParts = remaining.slice(0, flagStartIndex);
  const flagParts = remaining.slice(flagStartIndex);

  // Extract resource and action
  const resource = positionalParts[0] || "";
  const action = positionalParts[1] || "";
  const positionalArgs = positionalParts.slice(2);

  // Parse flags
  const flags: Record<string, unknown> = {};
  const globalOptions: ParsedArgs["globalOptions"] = {};
  const serverVars: Record<string, string> = {};

  for (let i = 0; i < flagParts.length; i++) {
    const flag = flagParts[i];

    if (!flag.startsWith("--")) continue;

    const flagName = flag.slice(2);

    // Handle boolean flags
    if (flagName === "json") {
      globalOptions.json = true;
      continue;
    }
    if (flagName === "dry-run") {
      globalOptions.dryRun = true;
      continue;
    }
    if (flagName === "curl") {
      globalOptions.curl = true;
      continue;
    }

    // Handle value flags
    const nextArg = flagParts[i + 1];
    if (nextArg === undefined || nextArg.startsWith("--")) {
      // Boolean flag or missing value - treat as boolean
      flags[flagName] = true;
      continue;
    }

    i++; // consume the value

    // Global options
    switch (flagName) {
      case "server":
        globalOptions.server = nextArg;
        break;
      case "server-var": {
        const [key, ...valueParts] = nextArg.split("=");
        if (key && valueParts.length > 0) {
          serverVars[key] = valueParts.join("=");
        }
        break;
      }
      case "auth":
        globalOptions.auth = nextArg;
        break;
      case "bearer-token":
      case "oauth-token":
        globalOptions.bearerToken = nextArg;
        break;
      case "api-key":
        globalOptions.apiKey = nextArg;
        break;
      case "username":
        globalOptions.username = nextArg;
        break;
      case "password":
        globalOptions.password = nextArg;
        break;
      case "timeout":
        globalOptions.timeout = parseInt(nextArg, 10);
        break;
      default:
        // Action-specific flag - pass to specli
        // Handle nested object notation (e.g., --address.city NYC)
        flags[flagName] = nextArg;
        break;
    }
  }

  if (Object.keys(serverVars).length > 0) {
    globalOptions.serverVars = serverVars;
  }

  // Read auth from environment variables if not provided via flags
  if (!globalOptions.bearerToken && env.BEARER_TOKEN) {
    globalOptions.bearerToken = env.BEARER_TOKEN;
  }
  if (!globalOptions.apiKey && env.API_KEY) {
    globalOptions.apiKey = env.API_KEY;
  }
  if (!globalOptions.username && env.USERNAME) {
    globalOptions.username = env.USERNAME;
  }
  if (!globalOptions.password && env.PASSWORD) {
    globalOptions.password = env.PASSWORD;
  }

  return {
    spec,
    resource,
    action,
    positionalArgs,
    flags,
    globalOptions,
  };
}

/**
 * Expand nested flag notation to objects
 * e.g., { "address.city": "NYC" } -> { address: { city: "NYC" } }
 */
function expandNestedFlags(
  flags: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(flags)) {
    if (key.includes(".")) {
      const parts = key.split(".");
      let current: Record<string, unknown> = result;

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!(part in current)) {
          current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
      }

      current[parts[parts.length - 1]] = value;
    } else {
      result[key] = value;
    }
  }

  return result;
}

export const specliCommand: Command = {
  name: "specli",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(specliHelp);
    }

    // Parse arguments
    const parsed = parseArgs(args, ctx.env);
    if ("exitCode" in parsed) {
      return parsed;
    }

    const { spec, resource, action, positionalArgs, flags, globalOptions } =
      parsed;

    // Validate we have at least a spec
    if (!spec) {
      return {
        stdout: "",
        stderr: "specli: missing spec argument\nUsage: specli <spec> <resource> <action> [args...]\n",
        exitCode: 1,
      };
    }

    // Check if resource is a built-in command
    const isSchemaCommand = resource === "__schema" || resource === "";

    // Validate resource/action for non-builtin commands
    if (!isSchemaCommand && !resource) {
      return {
        stdout: "",
        stderr: "specli: missing resource argument\nUsage: specli <spec> <resource> <action> [args...]\n",
        exitCode: 1,
      };
    }

    // Network check - specli needs fetch to make API calls
    // Note: We still allow __schema and --dry-run/--curl without network
    const needsNetwork =
      !isSchemaCommand && !globalOptions.dryRun && !globalOptions.curl;

    if (needsNetwork && !ctx.fetch) {
      return {
        stdout: "",
        stderr:
          "specli: network access required but not configured\n" +
          "Configure network access when creating the Bash instance:\n" +
          "  new Bash({ network: { allowedUrlPrefixes: ['https://api.example.com'] } })\n",
        exitCode: 1,
      };
    }

    try {
      // Dynamically import specli to support lazy loading
      const { specli, renderToString, getExitCode, getOutputStream, isError } =
        await import("specli");

      // Resolve spec path if it's a relative file path
      let resolvedSpec = spec;
      if (!spec.startsWith("http://") && !spec.startsWith("https://")) {
        resolvedSpec = ctx.fs.resolvePath(ctx.cwd, spec);
      }

      // Create a custom fetch that uses ctx.fetch for network requests
      // This ensures all requests go through just-bash's secure network layer
      const secureFetch: typeof fetch = async (input, init) => {
        if (!ctx.fetch) {
          throw new Error("Network access not configured");
        }

        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method || "GET";
        const headers: Record<string, string> = {};

        if (init?.headers) {
          if (init.headers instanceof Headers) {
            init.headers.forEach((value, key) => {
              headers[key] = value;
            });
          } else if (Array.isArray(init.headers)) {
            for (const [key, value] of init.headers) {
              headers[key] = value;
            }
          } else {
            Object.assign(headers, init.headers);
          }
        }

        const result = await ctx.fetch(url, {
          method,
          headers,
          body: init?.body as string | undefined,
        });

        // Convert just-bash fetch result to standard Response
        return new Response(result.body, {
          status: result.status,
          statusText: result.statusText,
          headers: new Headers(result.headers),
        });
      };

      // Create specli filesystem adapter for reading spec files
      const specliFs = {
        readFile: async (path: string): Promise<string> => {
          return ctx.fs.readFile(path);
        },
      };

      // Create specli client
      const client = await specli({
        spec: resolvedSpec,
        server: globalOptions.server,
        serverVars: globalOptions.serverVars,
        bearerToken: globalOptions.bearerToken,
        apiKey: globalOptions.apiKey,
        basicAuth:
          globalOptions.username && globalOptions.password
            ? {
                username: globalOptions.username,
                password: globalOptions.password,
              }
            : undefined,
        authScheme: globalOptions.auth,
        fetch: needsNetwork ? secureFetch : undefined,
        fs: specliFs,
      });

      // Handle built-in commands
      if (isSchemaCommand) {
        const result = client.schema();
        const output = renderToString(result, {
          format: globalOptions.json ? "json" : "text",
        });
        return {
          stdout: output,
          stderr: "",
          exitCode: getExitCode(result),
        };
      }

      // Handle whoami
      if (resource === "whoami") {
        const result = client.whoami();
        const output = renderToString(result, {
          format: globalOptions.json ? "json" : "text",
        });
        return {
          stdout: output,
          stderr: "",
          exitCode: getExitCode(result),
        };
      }

      // Validate we have an action for regular commands
      if (!action) {
        // Show help for the resource
        const resources = client.list();
        const resourceInfo = resources.find(
          (r) => r.name.toLowerCase() === resource.toLowerCase(),
        );

        if (!resourceInfo) {
          return {
            stdout: "",
            stderr: `specli: unknown resource '${resource}'\nRun 'specli ${spec} __schema' to see available resources.\n`,
            exitCode: 1,
          };
        }

        // List actions for this resource
        const lines = [
          `Resource: ${resourceInfo.name}`,
          "",
          "Actions:",
        ];
        for (const act of resourceInfo.actions) {
          const summary = act.summary ? ` - ${act.summary}` : "";
          lines.push(`  ${act.name}${summary}`);
        }
        lines.push("");
        lines.push(`Run 'specli ${spec} ${resource} <action> --help' for action details.`);

        return {
          stdout: lines.join("\n") + "\n",
          stderr: "",
          exitCode: 0,
        };
      }

      // Handle --help for specific action
      if (args.includes("--help") && resource && action) {
        const help = client.help(resource, action);
        if (!help) {
          return {
            stdout: "",
            stderr: `specli: unknown action '${action}' for resource '${resource}'\n`,
            exitCode: 1,
          };
        }

        const lines = [
          `${help.method} ${help.path}`,
          help.summary ? `\n${help.summary}` : "",
          "",
        ];

        if (help.args.length > 0) {
          lines.push("Arguments:");
          for (const arg of help.args) {
            const desc = arg.description ? ` - ${arg.description}` : "";
            lines.push(`  <${arg.name}>${desc}`);
          }
          lines.push("");
        }

        if (help.flags.length > 0) {
          lines.push("Flags:");
          for (const flag of help.flags) {
            const required = flag.required ? " (required)" : "";
            const desc = flag.description ? ` - ${flag.description}` : "";
            lines.push(`  --${flag.name} <${flag.type}>${required}${desc}`);
          }
        }

        return {
          stdout: lines.join("\n") + "\n",
          stderr: "",
          exitCode: 0,
        };
      }

      // Execute the API call
      const expandedFlags = expandNestedFlags(flags);

      let result;
      if (globalOptions.dryRun || globalOptions.curl) {
        result = await client.prepare(
          resource,
          action,
          positionalArgs,
          expandedFlags,
        );

        // Convert prepare result to curl if requested
        if (globalOptions.curl && result.type === "prepared") {
          result = {
            type: "curl" as const,
            curl: result.request.curl,
            request: result.request,
          };
        }
      } else {
        result = await client.exec(
          resource,
          action,
          positionalArgs,
          expandedFlags,
        );
      }

      // Render the result
      const output = renderToString(result, {
        format: globalOptions.json ? "json" : "text",
      });
      const exitCode = getExitCode(result);
      const stream = getOutputStream(result);

      if (stream === "stderr" || isError(result)) {
        return {
          stdout: "",
          stderr: output,
          exitCode,
        };
      }

      return {
        stdout: output,
        stderr: "",
        exitCode,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        stdout: "",
        stderr: `specli: ${message}\n`,
        exitCode: 1,
      };
    }
  },
};
