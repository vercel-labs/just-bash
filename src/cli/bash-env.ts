/**
 * bash-env CLI - A secure alternative to bash for AI agents
 *
 * Executes bash scripts in an isolated environment using OverlayFS.
 * Reads from the real filesystem, but writes stay in memory.
 *
 * Usage:
 *   bash-env [options] [root-path]
 *   bash-env -c 'script' [root-path]
 *   echo 'script' | bash-env [root-path]
 *   bash-env script.sh [root-path]
 *
 * Options:
 *   -c <script>       Execute the script from command line argument
 *   -e, --errexit     Exit immediately if a command exits with non-zero status
 *   --root <path>     Root directory for OverlayFS (default: current directory)
 *   --cwd <path>      Working directory within the sandbox (default: /)
 *   --json            Output results as JSON
 *   -h, --help        Show this help message
 *   -v, --version     Show version
 *
 * Arguments:
 *   script.sh         Script file to execute (reads from OverlayFS)
 *   root-path         Root directory (alternative to --root)
 *
 * Examples:
 *   # Execute inline script in current directory
 *   bash-env -c 'ls -la'
 *
 *   # Execute script from stdin with specific root
 *   echo 'cat README.md' | bash-env --root /path/to/project
 *
 *   # Execute script file
 *   bash-env ./deploy.sh
 *
 *   # Execute with errexit mode
 *   bash-env -e -c 'set -e; false; echo "not reached"'
 */

import { resolve } from "node:path";
import { BashEnv } from "../BashEnv.js";
import { OverlayFs } from "../overlay-fs/index.js";

interface CliOptions {
  script?: string;
  scriptFile?: string;
  root: string;
  cwd: string;
  cwdOverridden: boolean;
  errexit: boolean;
  allowWrite: boolean;
  json: boolean;
  help: boolean;
  version: boolean;
}

function printHelp(): void {
  console.log(`bash-env - A secure bash environment for AI agents

Usage:
  bash-env [options] [script-file]
  bash-env -c 'script' [options]
  echo 'script' | bash-env [options]

Options:
  -c <script>       Execute the script from command line argument
  -e, --errexit     Exit immediately if a command exits with non-zero status
  --root <path>     Root directory for OverlayFS (default: current directory)
  --cwd <path>      Working directory within the sandbox (default: project mount point)
  --allow-write     Allow write operations (default: read-only)
  --json            Output results as JSON (stdout, stderr, exitCode)
  -h, --help        Show this help message
  -v, --version     Show version

Security:
  - Reads from the real filesystem (read-only via OverlayFS)
  - Write operations are blocked by default (use --allow-write to enable)
  - Cannot escape the root directory
  - No network access

Filesystem:
  The root directory is mounted at /home/user/project in the virtual filesystem.
  The working directory starts at this mount point.

Examples:
  # List files in current directory
  bash-env -c 'ls -la'

  # Execute with specific root
  bash-env -c 'cat package.json' --root /path/to/project

  # Pipe script from stdin
  echo 'find . -name "*.ts" | head -5' | bash-env

  # Execute a script file
  bash-env ./scripts/build.sh

  # Get JSON output for programmatic use
  bash-env -c 'echo hello' --json

  # Allow write operations (writes stay in memory)
  bash-env -c 'echo test > /tmp/file.txt && cat /tmp/file.txt' --allow-write
`);
}

function printVersion(): void {
  console.log("bash-env 1.0.0");
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    root: process.cwd(),
    cwd: "/",
    cwdOverridden: false,
    errexit: false,
    allowWrite: false,
    json: false,
    help: false,
    version: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      i++;
    } else if (arg === "-v" || arg === "--version") {
      options.version = true;
      i++;
    } else if (arg === "-c") {
      if (i + 1 >= args.length) {
        console.error("Error: -c requires a script argument");
        process.exit(1);
      }
      options.script = args[i + 1];
      i += 2;
    } else if (arg === "-e" || arg === "--errexit") {
      options.errexit = true;
      i++;
    } else if (arg === "--root") {
      if (i + 1 >= args.length) {
        console.error("Error: --root requires a path argument");
        process.exit(1);
      }
      options.root = resolve(args[i + 1]);
      i += 2;
    } else if (arg === "--cwd") {
      if (i + 1 >= args.length) {
        console.error("Error: --cwd requires a path argument");
        process.exit(1);
      }
      options.cwd = args[i + 1];
      options.cwdOverridden = true;
      i += 2;
    } else if (arg === "--json") {
      options.json = true;
      i++;
    } else if (arg === "--allow-write") {
      options.allowWrite = true;
      i++;
    } else if (arg.startsWith("-")) {
      // Handle combined short options like -ec
      if (arg.length > 2 && !arg.startsWith("--")) {
        const flags = arg.slice(1);
        for (const flag of flags) {
          if (flag === "e") {
            options.errexit = true;
          } else if (flag === "h") {
            options.help = true;
          } else if (flag === "v") {
            options.version = true;
          } else if (flag === "c") {
            // -c must be last in combined flags
            if (i + 1 >= args.length) {
              console.error("Error: -c requires a script argument");
              process.exit(1);
            }
            options.script = args[i + 1];
            i++;
            break;
          } else {
            console.error(`Error: Unknown option: -${flag}`);
            process.exit(1);
          }
        }
        i++;
      } else {
        console.error(`Error: Unknown option: ${arg}`);
        process.exit(1);
      }
    } else {
      // Positional argument - could be script file or root path
      if (!options.scriptFile && !options.script) {
        options.scriptFile = arg;
      } else if (options.scriptFile && options.root === process.cwd()) {
        // Second positional is root
        options.root = resolve(arg);
      }
      i++;
    }
  }

  return options;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.version) {
    printVersion();
    process.exit(0);
  }

  let script: string;

  if (options.script) {
    // Script from -c argument
    script = options.script;
  } else if (options.scriptFile) {
    // Script from file - we'll read it via OverlayFS
    const fs = new OverlayFs({ root: options.root });
    const mountPoint = fs.getMountPoint();
    try {
      // Resolve script file path relative to mount point
      const virtualPath = options.scriptFile.startsWith("/")
        ? options.scriptFile
        : `${mountPoint}/${options.scriptFile}`;
      script = await fs.readFile(virtualPath, "utf-8");
    } catch (e) {
      console.error(`Error: Cannot read script file: ${options.scriptFile}`);
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  } else if (!process.stdin.isTTY) {
    // Script from stdin
    script = await readStdin();
  } else {
    // No script provided - show help
    printHelp();
    process.exit(1);
  }

  if (!script.trim()) {
    // Empty script is a no-op
    if (options.json) {
      console.log(JSON.stringify({ stdout: "", stderr: "", exitCode: 0 }));
    }
    process.exit(0);
  }

  // Create OverlayFS - files are mounted at /home/user/project by default
  // Read-only by default for security (use --allow-write to enable writes)
  const fs = new OverlayFs({
    root: options.root,
    readOnly: !options.allowWrite,
  });
  const mountPoint = fs.getMountPoint();

  // Use mount point as cwd unless explicitly overridden
  const cwd = options.cwdOverridden ? options.cwd : mountPoint;

  const env = new BashEnv({
    fs,
    cwd,
  });

  // Prepend set -e if errexit is enabled
  if (options.errexit) {
    script = `set -e\n${script}`;
  }

  try {
    const result = await env.exec(script);

    if (options.json) {
      console.log(
        JSON.stringify({
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        }),
      );
    } else {
      // Output stdout and stderr directly
      if (result.stdout) {
        process.stdout.write(result.stdout);
      }
      if (result.stderr) {
        process.stderr.write(result.stderr);
      }
    }

    process.exit(result.exitCode);
  } catch (e) {
    if (options.json) {
      console.log(
        JSON.stringify({
          stdout: "",
          stderr: e instanceof Error ? e.message : String(e),
          exitCode: 1,
        }),
      );
    } else {
      console.error(e instanceof Error ? e.message : String(e));
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
