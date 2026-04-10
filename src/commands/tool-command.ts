/**
 * Auto-generated CLI commands from executor tools.
 *
 * Converts executor tool definitions into bash namespace commands:
 *   math.add    → `math add --a 1 --b 2`
 *   petstore.listPets → `petstore list-pets --status available`
 *
 * Input modes (highest precedence first):
 *   1. Flags:   --key value, --key=value, key=value
 *   2. --json:  --json '{"key":"value"}'
 *   3. stdin:   echo '{"key":"value"}' | namespace command
 */

import type { Command, CommandContext, ExecResult } from "../types.js";

// ── Naming ──────────────────────────────────────────────────────

/**
 * Convert camelCase to kebab-case.
 * `listPets` → `list-pets`, `getPetById` → `get-pet-by-id`
 */
export function camelToKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

// ── Arg Parsing ─────────────────────────────────────────────────

/** Sentinel returned when --help is detected. */
const HELP_SENTINEL: unique symbol = Symbol("help");

/**
 * Coerce a string value to its natural JSON type.
 * Try JSON.parse first (handles numbers, booleans, arrays, objects).
 * Fall back to string.
 */
function coerceValue(raw: string): unknown {
  if (raw === "") return "";
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Parse CLI arguments into a JSON object for tool invocation.
 *
 * Precedence (highest wins):
 *   1. Flags (--key value, --key=value, key=value)
 *   2. --json '{...}'
 *   3. Piped stdin JSON
 *
 * Returns HELP_SENTINEL if --help is detected.
 */
export function parseToolCliArgs(
  args: string[],
  stdin: string,
): Record<string, unknown> | typeof HELP_SENTINEL {
  // Base: piped stdin JSON
  let result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  const trimmedStdin = stdin.trim();
  if (trimmedStdin) {
    try {
      const parsed = JSON.parse(trimmedStdin);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        Object.assign(result, parsed);
      }
    } catch {
      // Not JSON stdin — ignore
    }
  }

  // Layer: --json flag (overrides stdin)
  let jsonFlagValue: string | undefined;
  const remainingArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help") return HELP_SENTINEL;
    if (args[i] === "--json" && i + 1 < args.length) {
      jsonFlagValue = args[++i];
    } else if (args[i].startsWith("--json=")) {
      jsonFlagValue = args[i].slice(7);
    } else {
      remainingArgs.push(args[i]);
    }
  }

  if (jsonFlagValue !== undefined) {
    try {
      const parsed = JSON.parse(jsonFlagValue);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        result = Object.assign(
          Object.create(null) as Record<string, unknown>,
          result,
          parsed,
        );
      }
    } catch {
      // Malformed --json — ignore, flags will still apply
    }
  }

  // Top layer: flags and key=value pairs (highest precedence)
  for (let i = 0; i < remainingArgs.length; i++) {
    const arg = remainingArgs[i];

    // --key=value
    if (arg.startsWith("--") && arg.includes("=")) {
      const eqIdx = arg.indexOf("=");
      const key = arg.slice(2, eqIdx);
      if (key) result[key] = coerceValue(arg.slice(eqIdx + 1));
      continue;
    }

    // --key value
    if (arg.startsWith("--") && arg.length > 2) {
      const key = arg.slice(2);
      if (
        i + 1 < remainingArgs.length &&
        !remainingArgs[i + 1].startsWith("--")
      ) {
        result[key] = coerceValue(remainingArgs[++i]);
      } else {
        // Boolean flag: --verbose → { verbose: true }
        result[key] = true;
      }
      continue;
    }

    // key=value
    const eqIdx = arg.indexOf("=");
    if (eqIdx > 0) {
      const key = arg.slice(0, eqIdx);
      result[key] = coerceValue(arg.slice(eqIdx + 1));
      continue;
    }

    // Single positional arg that looks like JSON object
    if (remainingArgs.length === 1 && arg.startsWith("{")) {
      try {
        const parsed = JSON.parse(arg);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          Object.assign(result, parsed);
        }
      } catch {
        // Not JSON — ignore
      }
    }
  }

  return result;
}

// ── Help Formatting ─────────────────────────────────────────────

export interface ToolSubcommand {
  /** Kebab-case subcommand name */
  name: string;
  /** Original tool path (e.g. "math.add") */
  originalPath: string;
  /** Tool description */
  description?: string;
  /** Additional aliases (e.g. original camelCase name) */
  aliases?: string[];
}

function formatNamespaceHelp(
  namespace: string,
  subcommands: ToolSubcommand[],
): string {
  const lines: string[] = [];
  lines.push(`Executor tools: ${namespace}`);
  lines.push("");
  lines.push("USAGE");
  lines.push(`  ${namespace} <command> [flags]`);
  lines.push("");
  lines.push("COMMANDS");

  // Align descriptions
  const maxLen = Math.max(...subcommands.map((s) => s.name.length), 0);
  for (const sub of subcommands) {
    const pad = " ".repeat(Math.max(2, maxLen - sub.name.length + 4));
    const desc = sub.description ?? "";
    lines.push(`  ${sub.name}${pad}${desc}`);
  }

  lines.push("");
  lines.push("EXAMPLES");
  if (subcommands.length > 0) {
    const first = subcommands[0];
    lines.push(`  ${namespace} ${first.name} key=value`);
  }
  if (subcommands.length > 1) {
    const second = subcommands[1];
    lines.push(`  ${namespace} ${second.name} --key value`);
  }

  lines.push("");
  lines.push("LEARN MORE");
  lines.push(`  ${namespace} <command> --help`);
  lines.push("");
  return lines.join("\n");
}

function formatSubcommandHelp(namespace: string, sub: ToolSubcommand): string {
  const full = `${namespace} ${sub.name}`;
  const lines: string[] = [];

  if (sub.description) {
    lines.push(sub.description);
    lines.push("");
  }

  lines.push("USAGE");
  lines.push(`  ${full} [key=value ...]`);
  lines.push(`  ${full} [--key value ...]`);
  lines.push(`  ${full} --json '{...}'`);
  lines.push(`  <stdin> | ${full}`);
  lines.push("");
  lines.push("FLAGS");
  lines.push("  --json string    Pass all arguments as a JSON object");
  lines.push("  --help           Show this help");
  lines.push("");
  lines.push("EXAMPLES");
  lines.push(`  ${full} key=value`);
  lines.push(`  ${full} --key value`);
  lines.push(`  ${full} --json '{"key":"value"}'`);
  lines.push(`  echo '{"key":"value"}' | ${full}`);
  lines.push(`  ${full} key=value | jq -r .field`);
  lines.push("");
  return lines.join("\n");
}

// ── Command Factory ─────────────────────────────────────────────

/**
 * Create a namespace command that dispatches to tool subcommands.
 *
 * @param namespace - Command name (e.g. "math", "countries")
 * @param subcommands - Subcommand definitions
 * @param invokeTool - Tool invoker: (toolPath, argsJson) → resultJson
 */
function createNamespaceCommand(
  namespace: string,
  subcommands: ToolSubcommand[],
  invokeTool: (path: string, argsJson: string) => Promise<string>,
): Command {
  // Build lookup: subcommand name → tool info (including aliases)
  const lookup: Map<string, ToolSubcommand> = new Map();
  for (const sub of subcommands) {
    lookup.set(sub.name, sub);
    if (sub.aliases) {
      for (const alias of sub.aliases) {
        if (!lookup.has(alias)) {
          lookup.set(alias, sub);
        }
      }
    }
  }

  return {
    name: namespace,
    trusted: true,
    async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
      // No args or --help → namespace help
      if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
        return {
          stdout: formatNamespaceHelp(namespace, subcommands),
          stderr: "",
          exitCode: 0,
        };
      }

      // First arg is the subcommand
      const subName = args[0];
      const sub = lookup.get(subName);

      if (!sub) {
        return {
          stdout: "",
          stderr: `${namespace}: unknown command "${subName}"\nRun '${namespace} --help' for usage.\n`,
          exitCode: 1,
        };
      }

      const subArgs = args.slice(1);

      // Parse arguments
      const parsed = parseToolCliArgs(subArgs, ctx.stdin);
      if (parsed === HELP_SENTINEL) {
        return {
          stdout: formatSubcommandHelp(namespace, sub),
          stderr: "",
          exitCode: 0,
        };
      }

      // Invoke the tool
      try {
        const argsJson =
          Object.keys(parsed).length > 0 ? JSON.stringify(parsed) : "";
        const resultJson = await invokeTool(sub.originalPath, argsJson);
        const stdout = resultJson ? `${resultJson}\n` : "";
        return { stdout, stderr: "", exitCode: 0 };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          stdout: "",
          stderr: `${namespace} ${sub.name}: ${message}\n`,
          exitCode: 1,
        };
      }
    },
  };
}

// ── Grouping Helpers ────────────────────────────────────────────

export interface ToolEntry {
  /** Full tool path (e.g. "math.add", "petstore.listPets") */
  path: string;
  /** Tool description */
  description?: string;
}

/**
 * Group tool entries by namespace (first dot-segment) and build
 * namespace commands.
 */
export function buildNamespaceCommands(
  tools: ToolEntry[],
  invokeTool: (path: string, argsJson: string) => Promise<string>,
): Command[] {
  // Group by namespace
  const groups: Map<string, ToolSubcommand[]> = new Map();

  for (const tool of tools) {
    const dotIdx = tool.path.indexOf(".");
    if (dotIdx === -1) continue; // Skip tools without a namespace

    const namespace = tool.path.slice(0, dotIdx);
    const rawName = tool.path.slice(dotIdx + 1);
    const kebabName = camelToKebab(rawName);

    const sub: ToolSubcommand = {
      name: kebabName,
      originalPath: tool.path,
      description: tool.description,
    };

    // Add camelCase alias if different from kebab
    if (kebabName !== rawName) {
      sub.aliases = [rawName];
    }

    let group = groups.get(namespace);
    if (!group) {
      group = [];
      groups.set(namespace, group);
    }
    group.push(sub);
  }

  // Build one command per namespace
  const commands: Command[] = [];
  for (const [namespace, subs] of groups) {
    commands.push(createNamespaceCommand(namespace, subs, invokeTool));
  }
  return commands;
}
