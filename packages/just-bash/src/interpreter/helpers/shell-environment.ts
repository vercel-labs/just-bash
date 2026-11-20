import type { IFileSystem } from "../../fs/interface.js";
import { evaluateBinaryFileTest } from "./file-tests.js";

export function isShellParameterName(name: string): boolean {
  return /^(?:[0-9]+|[?#@*$!-])$/.test(name);
}

export async function resolveShellPwd(
  fs: IFileSystem,
  cwd: string,
  inheritedPwd: string | undefined,
): Promise<string> {
  if (inheritedPwd === cwd) return inheritedPwd;
  if (
    inheritedPwd?.startsWith("/") &&
    (await evaluateBinaryFileTest(
      { fs, state: { cwd } },
      "-ef",
      inheritedPwd,
      cwd,
    ))
  ) {
    return inheritedPwd;
  }
  return fs.realpath(cwd).catch(() => cwd);
}

const INHERITABLE_DEFAULTS = [
  ["PATH", "/usr/bin:/bin"],
  ["OSTYPE", "linux-gnu"],
  ["MACHTYPE", "x86_64-pc-linux-gnu"],
  ["HOSTTYPE", "x86_64"],
  ["HOSTNAME", "localhost"],
] as const;

const RESET_DEFAULTS = [
  ["IFS", " \t\n"],
  ["OPTIND", "1"],
] as const;

export const SHELL_ENV_DEFAULTS: ReadonlyArray<readonly [string, string]> = [
  ...INHERITABLE_DEFAULTS,
  ...RESET_DEFAULTS,
];

export function applyShellEnvironmentDefaults(env: Map<string, string>): void {
  for (const [name, value] of INHERITABLE_DEFAULTS) {
    if (!env.has(name)) env.set(name, value);
  }
  for (const [name, value] of RESET_DEFAULTS) {
    env.set(name, value);
  }
}
