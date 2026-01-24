/**
 * SHELLOPTS variable helpers.
 *
 * SHELLOPTS is a colon-separated list of enabled shell options.
 * In bash, it includes options from `set -o` like errexit, nounset, pipefail, xtrace, etc.
 */

import type { InterpreterContext, ShellOptions } from "../types.js";

/**
 * List of shell option names in the order they appear in SHELLOPTS.
 * This matches bash's ordering (alphabetical).
 */
const SHELLOPTS_OPTIONS: (keyof ShellOptions)[] = [
  "allexport",
  "errexit",
  "noglob",
  "noclobber",
  "noexec",
  "nounset",
  "pipefail",
  "posix",
  "verbose",
  "xtrace",
];

/**
 * Build the SHELLOPTS string from current shell options.
 * Returns a colon-separated list of enabled options (alphabetically sorted).
 */
export function buildShellopts(options: ShellOptions): string {
  const enabled: string[] = [];
  for (const opt of SHELLOPTS_OPTIONS) {
    if (options[opt]) {
      enabled.push(opt);
    }
  }
  return enabled.join(":");
}

/**
 * Update the SHELLOPTS environment variable to reflect current shell options.
 * Should be called whenever shell options change (via set -o or shopt -o).
 */
export function updateShellopts(ctx: InterpreterContext): void {
  ctx.state.env.SHELLOPTS = buildShellopts(ctx.state.options);
}
