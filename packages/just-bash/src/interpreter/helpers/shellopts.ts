/**
 * SHELLOPTS and BASHOPTS variable helpers.
 *
 * SHELLOPTS is a colon-separated list of enabled shell options from `set -o`.
 * BASHOPTS is a colon-separated list of enabled bash-specific options from `shopt`.
 */

import type {
  InterpreterContext,
  ShellOptions,
  ShoptOptions,
} from "../types.js";

/** Fresh-shell options; inherited lists enable options on top of these defaults. */
export function initializeShellOptions(
  shellopts?: string,
  bashopts?: string,
): { options: ShellOptions; shoptOptions: ShoptOptions } {
  const options = createShellOptions(shellopts);
  const shoptOptions = createShoptOptions(bashopts);
  if (options.posix) shoptOptions.expand_aliases = true;
  return { options, shoptOptions };
}

export function createShellOptions(inherited?: string): ShellOptions {
  const options: ShellOptions = {
    errexit: false,
    pipefail: false,
    nounset: false,
    xtrace: false,
    verbose: false,
    posix: false,
    allexport: false,
    noclobber: false,
    noglob: false,
    noexec: false,
    vi: false,
    emacs: false,
  };
  for (const name of inherited?.split(":") ?? []) {
    if (Object.hasOwn(options, name)) {
      const option = name as keyof ShellOptions;
      if (option === "vi") options.emacs = false;
      if (option === "emacs") options.vi = false;
      options[option] = true;
    }
  }
  return options;
}

export function createShoptOptions(inherited?: string): ShoptOptions {
  const options: ShoptOptions = {
    extglob: false,
    dotglob: false,
    nullglob: false,
    failglob: false,
    globstar: false,
    globskipdots: true, // Default to true in bash >=5.2
    nocaseglob: false,
    nocasematch: false,
    expand_aliases: false,
    lastpipe: false,
    xpg_echo: false,
  };
  for (const name of inherited?.split(":") ?? []) {
    if (Object.hasOwn(options, name)) {
      options[name as keyof ShoptOptions] = true;
    }
  }
  return options;
}

/**
 * List of shell option names in the order they appear in SHELLOPTS.
 * This matches bash's ordering (alphabetical).
 */
const SHELLOPTS_OPTIONS: (keyof ShellOptions)[] = [
  "allexport",
  "emacs",
  "errexit",
  "noglob",
  "noclobber",
  "noexec",
  "nounset",
  "pipefail",
  "posix",
  "verbose",
  "vi",
  "xtrace",
];

/**
 * Options that are always enabled in bash (no-op in our implementation but
 * should appear in SHELLOPTS for compatibility).
 * These are in alphabetical order.
 */
const ALWAYS_ON_OPTIONS = ["braceexpand", "hashall", "interactive-comments"];

/**
 * Build the SHELLOPTS string from current shell options.
 * Returns a colon-separated list of enabled options (alphabetically sorted).
 * Includes always-on options like braceexpand, hashall, interactive-comments.
 */
export function buildShellopts(options: ShellOptions): string {
  const enabled: string[] = [];
  // Add always-on options and dynamic options in alphabetical order
  const allOptions = [
    ...ALWAYS_ON_OPTIONS.map((opt) => ({ name: opt, enabled: true })),
    ...SHELLOPTS_OPTIONS.map((opt) => ({ name: opt, enabled: options[opt] })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  for (const opt of allOptions) {
    if (opt.enabled) {
      enabled.push(opt.name);
    }
  }
  return enabled.join(":");
}

/**
 * Update the SHELLOPTS environment variable to reflect current shell options.
 * Should be called whenever shell options change (via set -o or shopt -o).
 */
export function updateShellopts(ctx: InterpreterContext): void {
  ctx.state.env.set("SHELLOPTS", buildShellopts(ctx.state.options));
}

/**
 * List of shopt option names in the order they appear in BASHOPTS.
 * This matches bash's ordering (alphabetical).
 */
const BASHOPTS_OPTIONS: (keyof ShoptOptions)[] = [
  "dotglob",
  "expand_aliases",
  "extglob",
  "failglob",
  "globskipdots",
  "globstar",
  "lastpipe",
  "nocaseglob",
  "nocasematch",
  "nullglob",
  "xpg_echo",
];

/**
 * Build the BASHOPTS string from current shopt options.
 * Returns a colon-separated list of enabled options (alphabetically sorted).
 */
export function buildBashopts(shoptOptions: ShoptOptions): string {
  const enabled: string[] = [];
  for (const opt of BASHOPTS_OPTIONS) {
    if (shoptOptions[opt]) {
      enabled.push(opt);
    }
  }
  return enabled.join(":");
}

/**
 * Update the BASHOPTS environment variable to reflect current shopt options.
 * Should be called whenever shopt options change.
 */
export function updateBashopts(ctx: InterpreterContext): void {
  ctx.state.env.set("BASHOPTS", buildBashopts(ctx.state.shoptOptions));
}
