/**
 * specli - Turn any OpenAPI spec into a CLI
 *
 * This command wraps the specli npm package to provide OpenAPI CLI functionality.
 * Network access must be explicitly configured via BashEnvOptions.network.
 */

import { getExitCode, renderToString, specli } from "specli";
import { createStandardFetch } from "../../network/index.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

const specliHelp = {
  name: "specli",
  summary: "Turn any OpenAPI spec into a CLI",
  usage: "specli exec <spec> [resource] [action] [args...] [options]",
  description: `Execute commands dynamically from any OpenAPI spec URL or file path.

Use '__schema' as the resource to inspect available commands.`,
  options: [
    "    --server <url>        override server/base URL",
    "    --server-var <k=v>    server variable (repeatable)",
    "    --auth <scheme>       select auth scheme",
    "    --bearer-token <t>    bearer token for authentication",
    "    --oauth-token <t>     OAuth token (alias for --bearer-token)",
    "    --username <user>     basic auth username",
    "    --password <pass>     basic auth password",
    "    --api-key <key>       API key value",
    "    --profile <name>      profile name",
    "    --json                machine-readable output",
    "    --curl                print curl command without executing",
    "    --dry-run             print request details without executing",
    "    --header <h>          extra header (repeatable)",
    "    --timeout <ms>        request timeout in milliseconds",
    "    --help                display this help and exit",
  ],
  examples: [
    "specli exec ./openapi.json __schema",
    "specli exec ./openapi.json __schema --json",
    "specli exec ./openapi.json users list",
    "specli exec ./openapi.json users get abc123",
    "specli exec https://api.example.com/openapi.json users list --bearer-token $TOKEN",
  ],
};

interface ParsedOptions {
  spec: string;
  resource?: string;
  action?: string;
  positionalArgs: string[];
  flags: Record<string, unknown>;
  server?: string;
  serverVars: Record<string, string>;
  bearerToken?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  authScheme?: string;
  jsonOutput: boolean;
  curl: boolean;
  dryRun: boolean;
}

function parseExecArgs(
  args: string[],
): { ok: true; options: ParsedOptions } | { ok: false; error: ExecResult } {
  if (args.length === 0) {
    return {
      ok: false,
      error: {
        stdout: "",
        stderr: "specli exec: missing spec argument\n",
        exitCode: 1,
      },
    };
  }

  const spec = args[0];
  const positionalArgs: string[] = [];
  const flags: Record<string, unknown> = {};
  const serverVars: Record<string, string> = {};

  let server: string | undefined;
  let bearerToken: string | undefined;
  let apiKey: string | undefined;
  let username: string | undefined;
  let password: string | undefined;
  let authScheme: string | undefined;
  let jsonOutput = false;
  let curl = false;
  let dryRun = false;

  let i = 1; // Start after spec
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--server" && i + 1 < args.length) {
      server = args[++i];
    } else if (arg.startsWith("--server=")) {
      server = arg.slice("--server=".length);
    } else if (arg === "--server-var" && i + 1 < args.length) {
      const kv = args[++i];
      const eqIdx = kv.indexOf("=");
      if (eqIdx > 0) {
        serverVars[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1);
      }
    } else if (arg.startsWith("--server-var=")) {
      const kv = arg.slice("--server-var=".length);
      const eqIdx = kv.indexOf("=");
      if (eqIdx > 0) {
        serverVars[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1);
      }
    } else if (arg === "--auth" && i + 1 < args.length) {
      authScheme = args[++i];
    } else if (arg.startsWith("--auth=")) {
      authScheme = arg.slice("--auth=".length);
    } else if (
      (arg === "--bearer-token" || arg === "--oauth-token") &&
      i + 1 < args.length
    ) {
      bearerToken = args[++i];
    } else if (
      arg.startsWith("--bearer-token=") ||
      arg.startsWith("--oauth-token=")
    ) {
      bearerToken = arg.slice(arg.indexOf("=") + 1);
    } else if (arg === "--username" && i + 1 < args.length) {
      username = args[++i];
    } else if (arg.startsWith("--username=")) {
      username = arg.slice("--username=".length);
    } else if (arg === "--password" && i + 1 < args.length) {
      password = args[++i];
    } else if (arg.startsWith("--password=")) {
      password = arg.slice("--password=".length);
    } else if (arg === "--api-key" && i + 1 < args.length) {
      apiKey = args[++i];
    } else if (arg.startsWith("--api-key=")) {
      apiKey = arg.slice("--api-key=".length);
    } else if (arg === "--profile" && i + 1 < args.length) {
      // Skip profile for now (requires file system config)
      i++;
    } else if (arg.startsWith("--profile=")) {
      // Skip profile for now
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--curl") {
      curl = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--header" && i + 1 < args.length) {
      const header = args[++i];
      const colonIdx = header.indexOf(":");
      const eqIdx = header.indexOf("=");
      const sepIdx =
        colonIdx > 0
          ? eqIdx > 0
            ? Math.min(colonIdx, eqIdx)
            : colonIdx
          : eqIdx;
      if (sepIdx > 0) {
        const name = header.slice(0, sepIdx).trim();
        const value = header.slice(sepIdx + 1).trim();
        if (!flags.header) flags.header = {};
        (flags.header as Record<string, string>)[name] = value;
      }
    } else if (arg.startsWith("--header=")) {
      const header = arg.slice("--header=".length);
      const colonIdx = header.indexOf(":");
      const eqIdx = header.indexOf("=");
      const sepIdx =
        colonIdx > 0
          ? eqIdx > 0
            ? Math.min(colonIdx, eqIdx)
            : colonIdx
          : eqIdx;
      if (sepIdx > 0) {
        const name = header.slice(0, sepIdx).trim();
        const value = header.slice(sepIdx + 1).trim();
        if (!flags.header) flags.header = {};
        (flags.header as Record<string, string>)[name] = value;
      }
    } else if (arg === "--timeout" && i + 1 < args.length) {
      flags.timeout = parseInt(args[++i], 10);
    } else if (arg.startsWith("--timeout=")) {
      flags.timeout = parseInt(arg.slice("--timeout=".length), 10);
    } else if (arg === "--accept" && i + 1 < args.length) {
      flags.accept = args[++i];
    } else if (arg.startsWith("--accept=")) {
      flags.accept = arg.slice("--accept=".length);
    } else if (arg === "--data" && i + 1 < args.length) {
      flags.data = args[++i];
    } else if (arg.startsWith("--data=")) {
      flags.data = arg.slice("--data=".length);
    } else if (arg === "--content-type" && i + 1 < args.length) {
      flags.contentType = args[++i];
    } else if (arg.startsWith("--content-type=")) {
      flags.contentType = arg.slice("--content-type=".length);
    } else if (arg.startsWith("--") && !arg.startsWith("--no-")) {
      // Handle dynamic flags from the spec (e.g., --name, --email)
      const eqIdx = arg.indexOf("=");
      if (eqIdx > 0) {
        const name = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        flags[name] = value;
      } else if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        const name = arg.slice(2);
        flags[name] = args[++i];
      } else {
        // Boolean flag
        const name = arg.slice(2);
        flags[name] = true;
      }
    } else if (arg.startsWith("--no-")) {
      const name = arg.slice(5);
      flags[name] = false;
    } else if (!arg.startsWith("-")) {
      positionalArgs.push(arg);
    }

    i++;
  }

  const resource = positionalArgs[0];
  const action = positionalArgs[1];
  const restArgs = positionalArgs.slice(2);

  return {
    ok: true,
    options: {
      spec,
      resource,
      action,
      positionalArgs: restArgs,
      flags,
      server,
      serverVars,
      bearerToken,
      apiKey,
      username,
      password,
      authScheme,
      jsonOutput,
      curl,
      dryRun,
    },
  };
}

export const specliCommand: Command = {
  name: "specli",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(specliHelp);
    }

    // First argument should be subcommand
    if (args.length === 0) {
      return {
        stdout: "",
        stderr: "specli: missing subcommand (use 'exec' or '--help')\n",
        exitCode: 1,
      };
    }

    const subcommand = args[0];

    if (subcommand === "compile") {
      return {
        stdout: "",
        stderr:
          "specli compile: not supported (requires Bun runtime)\nUse 'bunx specli compile' directly instead.\n",
        exitCode: 1,
      };
    }

    if (subcommand !== "exec") {
      return unknownOption("specli", subcommand);
    }

    // ctx.fetch is required for network access
    if (!ctx.fetch) {
      return {
        stdout: "",
        stderr: "specli: network access not available\n",
        exitCode: 1,
      };
    }

    // Parse exec arguments
    const parsed = parseExecArgs(args.slice(1));
    if (!parsed.ok) {
      return parsed.error;
    }

    const opts = parsed.options;

    // Resolve spec path if it's a local file
    let specPath = opts.spec;
    if (!specPath.startsWith("http://") && !specPath.startsWith("https://")) {
      specPath = ctx.fs.resolvePath(ctx.cwd, specPath);
    }

    // Create fetch wrapper for specli
    const fetchWrapper = createStandardFetch(ctx.fetch);

    // Create fs wrapper for specli to read from our virtual filesystem
    const fsWrapper = {
      readFile: (path: string) => ctx.fs.readFile(path),
    };

    try {
      // Create specli client with our secure fetch and fs wrappers
      const client = await specli({
        spec: specPath,
        server: opts.server,
        serverVars:
          Object.keys(opts.serverVars).length > 0 ? opts.serverVars : undefined,
        bearerToken: opts.bearerToken,
        apiKey: opts.apiKey,
        basicAuth:
          opts.username && opts.password
            ? { username: opts.username, password: opts.password }
            : undefined,
        authScheme: opts.authScheme,
        fetch: fetchWrapper,
        fs: fsWrapper,
      });

      // Handle __schema special resource
      if (opts.resource === "__schema") {
        const schemaResult = client.schema();
        const output = renderToString(schemaResult, {
          format: opts.jsonOutput ? "json" : "text",
        });

        return {
          stdout: output,
          stderr: "",
          exitCode: 0,
        };
      }

      // Need resource and action for exec
      if (!opts.resource) {
        return {
          stdout: "",
          stderr:
            "specli exec: missing resource (use '__schema' to list available resources)\n",
          exitCode: 1,
        };
      }

      if (!opts.action) {
        // Try to get help for the resource
        const resources = client.list();
        const resource = resources.find((r) => r.name === opts.resource);
        if (resource) {
          let output = `${resource.name} actions:\n`;
          for (const action of resource.actions) {
            const argStr =
              action.args.length > 0 ? ` <${action.args.join("> <")}>` : "";
            const summary = action.summary ? ` - ${action.summary}` : "";
            output += `  ${action.name}${argStr}${summary}\n`;
          }
          return { stdout: output, stderr: "", exitCode: 0 };
        }
        return {
          stdout: "",
          stderr: `specli exec: unknown resource '${opts.resource}'\n`,
          exitCode: 1,
        };
      }

      // Execute the action
      if (opts.curl || opts.dryRun) {
        opts.flags.curl = opts.curl;
        opts.flags.dryRun = opts.dryRun;
      }

      const result = await client.exec(
        opts.resource,
        opts.action,
        opts.positionalArgs.length > 0 ? opts.positionalArgs : undefined,
        Object.keys(opts.flags).length > 0 ? opts.flags : undefined,
      );

      // Render result
      const output = renderToString(result, {
        format: opts.jsonOutput ? "json" : "text",
      });
      const exitCode = getExitCode(result);

      return {
        stdout: `${output}\n`,
        stderr: "",
        exitCode,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        stdout: "",
        stderr: `specli: ${message}\n`,
        exitCode: 1,
      };
    }
  },
};
