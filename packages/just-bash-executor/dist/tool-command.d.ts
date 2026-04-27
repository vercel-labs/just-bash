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
import type { Command } from "just-bash";
/**
 * Convert camelCase to kebab-case.
 * `listPets` → `list-pets`, `getPetById` → `get-pet-by-id`
 */
export declare function camelToKebab(name: string): string;
/** Sentinel returned when --help is detected. */
declare const HELP_SENTINEL: unique symbol;
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
export declare function parseToolCliArgs(args: string[], stdin: string): Record<string, unknown> | typeof HELP_SENTINEL;
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
export declare function buildNamespaceCommands(tools: ToolEntry[], invokeTool: (path: string, argsJson: string) => Promise<string>): Command[];
export {};
