/**
 * git - A simulated git command for just-bash
 *
 * Implements core git functionality using the virtual filesystem.
 * Git repository data is stored in .git/ directory.
 */

import * as Diff from "diff";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";

// Git repository data structures
interface GitCommit {
  hash: string;
  parent: string | null;
  message: string;
  author: string;
  email: string;
  timestamp: number;
  tree: Record<string, string>; // path -> content hash
}

interface GitRepository {
  HEAD: string; // Current branch name or commit hash (detached)
  branches: Record<string, string>; // branch name -> commit hash
  commits: Record<string, GitCommit>; // commit hash -> commit data
  index: Record<string, string>; // staged files: path -> content hash
  objects: Record<string, string>; // content hash -> content
  config: Record<string, string>; // config key -> value
}

// Simple hash function for content addressing
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  // Make it look like a git hash (40 hex chars)
  const base = Math.abs(hash).toString(16).padStart(8, "0");
  return (base + base + base + base + base).slice(0, 40);
}

// Generate a commit hash from commit data
function hashCommit(commit: Omit<GitCommit, "hash">): string {
  const data = JSON.stringify({
    parent: commit.parent,
    message: commit.message,
    author: commit.author,
    timestamp: commit.timestamp,
    tree: commit.tree,
  });
  return hashContent(data);
}

const gitHelp = {
  name: "git",
  summary: "the stupid content tracker (simulated)",
  usage: "git [--version] [--help] <command> [<args>]",
  description: [
    "A simulated git for just-bash virtual filesystem.",
    "Supports basic repository operations.",
  ],
  options: [
    "    --version   print git version",
    "    --help      display this help",
  ],
  examples: [
    "git init                  Create an empty Git repository",
    "git status                Show the working tree status",
    "git add <file>...         Add file contents to the index",
    "git commit -m <message>   Record changes to the repository",
    "git log                   Show commit logs",
    "git branch                List branches",
    "git checkout <branch>     Switch branches",
    "git diff                  Show changes",
    "git config                Get and set options",
  ],
};

// Helper to get the git directory path
function getGitDir(ctx: CommandContext): string {
  return ctx.fs.resolvePath(ctx.cwd, ".git");
}

// Helper to load repository state
async function loadRepo(ctx: CommandContext): Promise<GitRepository | null> {
  const gitDir = getGitDir(ctx);
  const repoFile = `${gitDir}/repo.json`;

  try {
    const content = await ctx.fs.readFile(repoFile);
    return JSON.parse(content) as GitRepository;
  } catch {
    return null;
  }
}

// Helper to save repository state
async function saveRepo(
  ctx: CommandContext,
  repo: GitRepository,
): Promise<void> {
  const gitDir = getGitDir(ctx);
  const repoFile = `${gitDir}/repo.json`;
  await ctx.fs.writeFile(repoFile, JSON.stringify(repo, null, 2));
}

// Helper to get current branch name
function getCurrentBranch(repo: GitRepository): string | null {
  if (repo.HEAD.startsWith("refs/heads/")) {
    return repo.HEAD.slice("refs/heads/".length);
  }
  return null; // Detached HEAD
}

// Helper to get current commit hash
function getCurrentCommit(repo: GitRepository): string | null {
  const branch = getCurrentBranch(repo);
  if (branch) {
    return repo.branches[branch] || null;
  }
  // Detached HEAD - HEAD is the commit hash
  return repo.commits[repo.HEAD] ? repo.HEAD : null;
}

// Get all tracked files from the latest commit
function getTrackedFiles(repo: GitRepository): Record<string, string> {
  const commitHash = getCurrentCommit(repo);
  if (!commitHash) return {};
  const commit = repo.commits[commitHash];
  if (!commit) return {};
  return commit.tree;
}

// Directories to ignore in git (virtual filesystem special dirs)
const IGNORED_DIRS = new Set([".git", "bin", "dev", "proc", "tmp"]);

// Get working tree files (excluding .git and virtual dirs)
async function getWorkingTreeFiles(
  ctx: CommandContext,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  async function walkDir(dir: string, prefix: string): Promise<void> {
    let entries: string[];
    try {
      entries = await ctx.fs.readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      // Skip special directories
      if (IGNORED_DIRS.has(entry)) continue;

      const fullPath = dir === "/" ? `/${entry}` : `${dir}/${entry}`;
      const relativePath = prefix ? `${prefix}/${entry}` : entry;

      try {
        const stat = await ctx.fs.stat(fullPath);
        if (stat.isDirectory) {
          await walkDir(fullPath, relativePath);
        } else {
          const content = await ctx.fs.readFile(fullPath);
          files[relativePath] = content;
        }
      } catch {
        // Skip inaccessible files
      }
    }
  }

  await walkDir(ctx.cwd, "");
  return files;
}

// ============= SUBCOMMANDS =============

async function gitInit(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  if (args.includes("--help")) {
    return showHelp({
      name: "git init",
      summary: "Create an empty Git repository",
      usage: "git init [-q | --quiet] [--bare]",
      options: [
        "-q, --quiet  Only print error and warning messages",
        "--bare       Create a bare repository",
      ],
    });
  }

  const quiet = args.includes("-q") || args.includes("--quiet");
  const bare = args.includes("--bare");

  // Check for unknown options
  for (const arg of args) {
    if (
      arg.startsWith("-") &&
      arg !== "-q" &&
      arg !== "--quiet" &&
      arg !== "--bare"
    ) {
      return {
        stdout: "",
        stderr: `error: unknown option '${arg}'\n`,
        exitCode: 129,
      };
    }
  }

  const gitDir = getGitDir(ctx);

  // Check if already initialized
  const exists = await ctx.fs.exists(gitDir);
  if (exists) {
    const repo = await loadRepo(ctx);
    if (repo) {
      if (!quiet) {
        return {
          stdout: `Reinitialized existing Git repository in ${gitDir}/\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }
  }

  // Create .git directory
  await ctx.fs.mkdir(gitDir, { recursive: true });

  // Initialize repository state
  const repo: GitRepository = {
    HEAD: "refs/heads/main",
    branches: {},
    commits: {},
    index: {},
    objects: {},
    config: {
      "core.bare": bare ? "true" : "false",
      "user.name": ctx.env.GIT_AUTHOR_NAME || ctx.env.USER || "User",
      "user.email":
        ctx.env.GIT_AUTHOR_EMAIL || `${ctx.env.USER || "user"}@localhost`,
    },
  };

  await saveRepo(ctx, repo);

  if (!quiet) {
    return {
      stdout: `Initialized empty Git repository in ${gitDir}/\n`,
      stderr: "",
      exitCode: 0,
    };
  }
  return { stdout: "", stderr: "", exitCode: 0 };
}

async function gitStatus(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  if (args.includes("--help")) {
    return showHelp({
      name: "git status",
      summary: "Show the working tree status",
      usage: "git status [<options>] [--] [<pathspec>...]",
      options: [
        "-s, --short          Give output in short format",
        "-b, --branch         Show branch info in short format",
        "--porcelain          Give output in porcelain format",
      ],
    });
  }

  const repo = await loadRepo(ctx);
  if (!repo) {
    return {
      stdout: "",
      stderr:
        "fatal: not a git repository (or any of the parent directories): .git\n",
      exitCode: 128,
    };
  }

  // Parse combined short flags (e.g., -sb)
  let short = args.includes("-s") || args.includes("--short");
  const porcelain = args.includes("--porcelain");
  let showBranch = args.includes("-b") || args.includes("--branch");

  // Handle combined flags like -sb
  for (const arg of args) {
    if (arg.startsWith("-") && !arg.startsWith("--") && arg.length > 2) {
      if (arg.includes("s")) short = true;
      if (arg.includes("b")) showBranch = true;
    }
  }

  // Check for unknown options
  for (const arg of args) {
    if (
      arg.startsWith("--") &&
      arg !== "--short" &&
      arg !== "--branch" &&
      arg !== "--porcelain"
    ) {
      return {
        stdout: "",
        stderr: `error: unknown option '${arg}'\n`,
        exitCode: 129,
      };
    }
    // Check short options
    if (arg.startsWith("-") && !arg.startsWith("--")) {
      for (const c of arg.slice(1)) {
        if (c !== "s" && c !== "b") {
          return {
            stdout: "",
            stderr: `error: unknown option '-${c}'\n`,
            exitCode: 129,
          };
        }
      }
    }
  }

  const branch = getCurrentBranch(repo);
  const trackedFiles = getTrackedFiles(repo);
  const workingFiles = await getWorkingTreeFiles(ctx);

  // Categorize files
  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];
  const deleted: string[] = [];
  const stagedDeleted: string[] = [];

  // Check indexed (staged) files
  for (const [path, contentHash] of Object.entries(repo.index)) {
    const trackedHash = trackedFiles[path];
    if (trackedHash !== contentHash) {
      if (workingFiles[path] === undefined) {
        stagedDeleted.push(path);
      } else {
        staged.push(path);
      }
    }
  }

  // Check working tree
  for (const [path, content] of Object.entries(workingFiles)) {
    const contentHash = hashContent(content);
    const indexHash = repo.index[path];
    const trackedHash = trackedFiles[path];

    if (!trackedHash && !indexHash) {
      untracked.push(path);
    } else if (indexHash && indexHash !== contentHash) {
      modified.push(path);
    } else if (!indexHash && trackedHash && trackedHash !== contentHash) {
      modified.push(path);
    }
  }

  // Check for deleted files (in tracked but not in working)
  for (const path of Object.keys(trackedFiles)) {
    if (!workingFiles[path] && !repo.index[path]) {
      deleted.push(path);
    }
  }

  // Format output
  if (porcelain || short) {
    let output = "";

    if (short && showBranch) {
      output += `## ${branch || "(HEAD detached)"}\n`;
    }

    for (const file of staged) {
      output += `A  ${file}\n`;
    }
    for (const file of stagedDeleted) {
      output += `D  ${file}\n`;
    }
    for (const file of modified) {
      output += ` M ${file}\n`;
    }
    for (const file of deleted) {
      output += ` D ${file}\n`;
    }
    for (const file of untracked) {
      output += `?? ${file}\n`;
    }

    return { stdout: output, stderr: "", exitCode: 0 };
  }

  // Long format
  let output = "";
  const currentCommit = getCurrentCommit(repo);

  if (branch) {
    output += `On branch ${branch}\n`;
  } else {
    output += `HEAD detached at ${repo.HEAD.slice(0, 7)}\n`;
  }

  if (!currentCommit) {
    output += "\nNo commits yet\n";
  }

  const hasStaged = staged.length > 0 || stagedDeleted.length > 0;
  const hasChanges = modified.length > 0 || deleted.length > 0;
  const hasUntracked = untracked.length > 0;

  if (hasStaged) {
    output += "\nChanges to be committed:\n";
    output += '  (use "git restore --staged <file>..." to unstage)\n';
    for (const file of staged) {
      output += `\tnew file:   ${file}\n`;
    }
    for (const file of stagedDeleted) {
      output += `\tdeleted:    ${file}\n`;
    }
  }

  if (hasChanges) {
    output += "\nChanges not staged for commit:\n";
    output += '  (use "git add <file>..." to update what will be committed)\n';
    for (const file of modified) {
      output += `\tmodified:   ${file}\n`;
    }
    for (const file of deleted) {
      output += `\tdeleted:    ${file}\n`;
    }
  }

  if (hasUntracked) {
    output += "\nUntracked files:\n";
    output +=
      '  (use "git add <file>..." to include in what will be committed)\n';
    for (const file of untracked) {
      output += `\t${file}\n`;
    }
  }

  if (!hasStaged && !hasChanges && !hasUntracked) {
    if (currentCommit) {
      output += "nothing to commit, working tree clean\n";
    } else {
      output +=
        '\nnothing to commit (create/copy files and use "git add" to track)\n';
    }
  }

  return { stdout: output, stderr: "", exitCode: 0 };
}

async function gitAdd(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  if (args.includes("--help")) {
    return showHelp({
      name: "git add",
      summary: "Add file contents to the index",
      usage: "git add [<options>] [--] <pathspec>...",
      options: [
        "-A, --all     Add all files",
        "-u, --update  Update tracked files",
        "-n, --dry-run Don't actually add files",
      ],
    });
  }

  const repo = await loadRepo(ctx);
  if (!repo) {
    return {
      stdout: "",
      stderr:
        "fatal: not a git repository (or any of the parent directories): .git\n",
      exitCode: 128,
    };
  }

  const addAll = args.includes("-A") || args.includes("--all");
  const update = args.includes("-u") || args.includes("--update");
  const dryRun = args.includes("-n") || args.includes("--dry-run");

  // Filter out option flags to get pathspecs
  const pathspecs = args.filter(
    (a) =>
      !a.startsWith("-") &&
      a !== "-A" &&
      a !== "--all" &&
      a !== "-u" &&
      a !== "--update" &&
      a !== "-n" &&
      a !== "--dry-run" &&
      a !== "--",
  );

  // Check for unknown options
  for (const arg of args) {
    if (
      arg.startsWith("-") &&
      arg !== "-A" &&
      arg !== "--all" &&
      arg !== "-u" &&
      arg !== "--update" &&
      arg !== "-n" &&
      arg !== "--dry-run" &&
      arg !== "--"
    ) {
      return {
        stdout: "",
        stderr: `error: unknown option '${arg}'\n`,
        exitCode: 129,
      };
    }
  }

  if (!addAll && pathspecs.length === 0) {
    return {
      stdout: "",
      stderr:
        "Nothing specified, nothing added.\n" +
        "Maybe you wanted to say 'git add .'?\n",
      exitCode: 0,
    };
  }

  const workingFiles = await getWorkingTreeFiles(ctx);
  const trackedFiles = getTrackedFiles(repo);

  // Determine which files to add
  let filesToAdd: string[] = [];

  if (addAll || pathspecs.includes(".")) {
    // Add all files
    filesToAdd = Object.keys(workingFiles);
    // Also handle deletions
    for (const path of Object.keys(trackedFiles)) {
      if (!workingFiles[path]) {
        // File was deleted - remove from index
        if (!dryRun) {
          delete repo.index[path];
        }
      }
    }
  } else if (update) {
    // Only update tracked files
    filesToAdd = Object.keys(workingFiles).filter(
      (f) => trackedFiles[f] !== undefined,
    );
  } else {
    // Add specified files
    for (const spec of pathspecs) {
      // Handle glob-like patterns simply
      if (spec.includes("*")) {
        const pattern = spec.replace(/\*/g, ".*");
        const regex = new RegExp(`^${pattern}$`);
        for (const file of Object.keys(workingFiles)) {
          if (regex.test(file)) {
            filesToAdd.push(file);
          }
        }
      } else {
        // Check if it's a directory
        const fullPath = ctx.fs.resolvePath(ctx.cwd, spec);
        try {
          const stat = await ctx.fs.stat(fullPath);
          if (stat.isDirectory) {
            // Add all files in directory
            for (const file of Object.keys(workingFiles)) {
              if (file.startsWith(`${spec}/`) || file === spec) {
                filesToAdd.push(file);
              }
            }
          } else {
            filesToAdd.push(spec);
          }
        } catch {
          // File doesn't exist
          return {
            stdout: "",
            stderr: `fatal: pathspec '${spec}' did not match any files\n`,
            exitCode: 128,
          };
        }
      }
    }
  }

  // Add files to index
  for (const file of filesToAdd) {
    const content = workingFiles[file];
    if (content !== undefined) {
      const contentHash = hashContent(content);
      if (!dryRun) {
        repo.index[file] = contentHash;
        repo.objects[contentHash] = content;
      }
    }
  }

  if (!dryRun) {
    await saveRepo(ctx, repo);
  }

  return { stdout: "", stderr: "", exitCode: 0 };
}

async function gitCommit(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  if (args.includes("--help")) {
    return showHelp({
      name: "git commit",
      summary: "Record changes to the repository",
      usage: "git commit [<options>] [--] [<pathspec>...]",
      options: [
        "-m <msg>           Use given message as commit message",
        "-a, --all          Stage all modified files",
        "--amend            Amend previous commit",
        "--allow-empty      Allow empty commit",
      ],
    });
  }

  const repo = await loadRepo(ctx);
  if (!repo) {
    return {
      stdout: "",
      stderr:
        "fatal: not a git repository (or any of the parent directories): .git\n",
      exitCode: 128,
    };
  }

  // Parse arguments
  let message: string | null = null;
  const amendFlag = args.includes("--amend");
  const allFlag = args.includes("-a") || args.includes("--all");
  const allowEmpty = args.includes("--allow-empty");

  // Find -m message
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-m" && i + 1 < args.length) {
      message = args[i + 1];
      break;
    }
    if (args[i].startsWith("-m")) {
      message = args[i].slice(2);
      break;
    }
  }

  // Check for unknown options
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (
      arg.startsWith("-") &&
      arg !== "-m" &&
      arg !== "-a" &&
      arg !== "--all" &&
      arg !== "--amend" &&
      arg !== "--allow-empty" &&
      arg !== "--"
    ) {
      // Skip the message value after -m
      if (args[i - 1] !== "-m" && !args[i - 1]?.startsWith("-m")) {
        return {
          stdout: "",
          stderr: `error: unknown option '${arg}'\n`,
          exitCode: 129,
        };
      }
    }
  }

  if (!message) {
    return {
      stdout: "",
      stderr: "error: switch `m' requires a value\n",
      exitCode: 128,
    };
  }

  // If -a, stage all modified tracked files
  if (allFlag) {
    const workingFiles = await getWorkingTreeFiles(ctx);
    const trackedFiles = getTrackedFiles(repo);

    for (const [path, content] of Object.entries(workingFiles)) {
      if (trackedFiles[path] !== undefined) {
        const contentHash = hashContent(content);
        repo.index[path] = contentHash;
        repo.objects[contentHash] = content;
      }
    }
  }

  // Check if there's anything to commit
  const trackedFiles = getTrackedFiles(repo);
  const hasChanges =
    Object.keys(repo.index).length > 0 ||
    Object.keys(repo.index).some((k) => repo.index[k] !== trackedFiles[k]);

  if (!hasChanges && !allowEmpty && !amendFlag) {
    return {
      stdout: "",
      stderr: "nothing to commit, working tree clean\n",
      exitCode: 1,
    };
  }

  // Build tree from index + existing tracked files
  const tree: Record<string, string> = { ...trackedFiles };
  for (const [path, hash] of Object.entries(repo.index)) {
    tree[path] = hash;
  }

  const currentCommit = getCurrentCommit(repo);
  const author = repo.config["user.name"] || "User";
  const email = repo.config["user.email"] || "user@localhost";
  const timestamp = Date.now();

  let commit: GitCommit;

  if (amendFlag && currentCommit) {
    // Amend previous commit
    const prevCommit = repo.commits[currentCommit];
    commit = {
      hash: "", // Will be computed
      parent: prevCommit.parent,
      message,
      author,
      email,
      timestamp,
      tree,
    };
  } else {
    commit = {
      hash: "", // Will be computed
      parent: currentCommit,
      message,
      author,
      email,
      timestamp,
      tree,
    };
  }

  commit.hash = hashCommit(commit);

  // Store commit
  repo.commits[commit.hash] = commit;

  // Update branch pointer
  const branch = getCurrentBranch(repo);
  if (branch) {
    repo.branches[branch] = commit.hash;
  } else {
    // Detached HEAD
    repo.HEAD = commit.hash;
  }

  // Clear index (staged files become committed)
  repo.index = {};

  await saveRepo(ctx, repo);

  const shortHash = commit.hash.slice(0, 7);
  const filesChanged = Object.keys(tree).length;

  return {
    stdout: `[${branch || "HEAD"} ${shortHash}] ${message}\n ${filesChanged} file${filesChanged !== 1 ? "s" : ""} changed\n`,
    stderr: "",
    exitCode: 0,
  };
}

async function gitLog(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  if (args.includes("--help")) {
    return showHelp({
      name: "git log",
      summary: "Show commit logs",
      usage: "git log [<options>] [<revision range>]",
      options: [
        "-n <num>           Limit output to <num> commits",
        "--oneline          Output in one-line format",
        "--format=<format>  Pretty-print format",
      ],
    });
  }

  const repo = await loadRepo(ctx);
  if (!repo) {
    return {
      stdout: "",
      stderr:
        "fatal: not a git repository (or any of the parent directories): .git\n",
      exitCode: 128,
    };
  }

  const oneline = args.includes("--oneline");
  let limit = -1;
  let format: string | null = null;

  // Parse -n
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-n" && i + 1 < args.length) {
      limit = parseInt(args[i + 1], 10);
    }
    if (args[i].startsWith("-n") && args[i].length > 2) {
      limit = parseInt(args[i].slice(2), 10);
    }
    if (args[i].startsWith("--format=")) {
      format = args[i].slice("--format=".length);
    }
  }

  const currentCommit = getCurrentCommit(repo);
  if (!currentCommit) {
    return {
      stdout: "",
      stderr: "fatal: your current branch does not have any commits yet\n",
      exitCode: 128,
    };
  }

  let output = "";
  let commit: GitCommit | null = repo.commits[currentCommit];
  let count = 0;

  while (commit && (limit < 0 || count < limit)) {
    if (oneline) {
      output += `${commit.hash.slice(0, 7)} ${commit.message}\n`;
    } else if (format === "short") {
      output += `commit ${commit.hash}\n`;
      output += `Author: ${commit.author}\n`;
      output += `\n    ${commit.message}\n\n`;
    } else {
      const date = new Date(commit.timestamp);
      output += `commit ${commit.hash}\n`;
      output += `Author: ${commit.author} <${commit.email}>\n`;
      output += `Date:   ${date.toUTCString()}\n`;
      output += `\n    ${commit.message}\n\n`;
    }

    count++;
    commit = commit.parent ? repo.commits[commit.parent] : null;
  }

  return { stdout: output, stderr: "", exitCode: 0 };
}

async function gitBranch(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  if (args.includes("--help")) {
    return showHelp({
      name: "git branch",
      summary: "List, create, or delete branches",
      usage: "git branch [<options>] [<branchname>]",
      options: [
        "-a, --all     List both remote and local branches",
        "-d, --delete  Delete branch",
        "-D            Force delete branch",
        "-m, --move    Move/rename branch",
      ],
    });
  }

  const repo = await loadRepo(ctx);
  if (!repo) {
    return {
      stdout: "",
      stderr:
        "fatal: not a git repository (or any of the parent directories): .git\n",
      exitCode: 128,
    };
  }

  const deleteFlag = args.includes("-d") || args.includes("--delete");
  const forceDelete = args.includes("-D");
  const moveFlag = args.includes("-m") || args.includes("--move");
  // Note: -a/--all is parsed but only affects remote branch listing (not implemented)
  void (args.includes("-a") || args.includes("--all"));

  // Filter out flags to get branch names
  const branchArgs = args.filter(
    (a) =>
      !a.startsWith("-") &&
      a !== "-d" &&
      a !== "--delete" &&
      a !== "-D" &&
      a !== "-m" &&
      a !== "--move" &&
      a !== "-a" &&
      a !== "--all",
  );

  // Check for unknown options
  for (const arg of args) {
    if (
      arg.startsWith("-") &&
      arg !== "-d" &&
      arg !== "--delete" &&
      arg !== "-D" &&
      arg !== "-m" &&
      arg !== "--move" &&
      arg !== "-a" &&
      arg !== "--all"
    ) {
      return {
        stdout: "",
        stderr: `error: unknown option '${arg}'\n`,
        exitCode: 129,
      };
    }
  }

  const currentBranch = getCurrentBranch(repo);

  // Delete branch
  if (deleteFlag || forceDelete) {
    if (branchArgs.length === 0) {
      return {
        stdout: "",
        stderr: "error: branch name required\n",
        exitCode: 1,
      };
    }
    const branchName = branchArgs[0];
    if (branchName === currentBranch) {
      return {
        stdout: "",
        stderr: `error: Cannot delete branch '${branchName}' checked out\n`,
        exitCode: 1,
      };
    }
    if (!repo.branches[branchName]) {
      return {
        stdout: "",
        stderr: `error: branch '${branchName}' not found.\n`,
        exitCode: 1,
      };
    }
    delete repo.branches[branchName];
    await saveRepo(ctx, repo);
    return {
      stdout: `Deleted branch ${branchName}\n`,
      stderr: "",
      exitCode: 0,
    };
  }

  // Rename branch
  if (moveFlag) {
    if (branchArgs.length < 2) {
      return {
        stdout: "",
        stderr: "error: need old and new branch name\n",
        exitCode: 1,
      };
    }
    const [oldName, newName] = branchArgs;
    if (!repo.branches[oldName]) {
      return {
        stdout: "",
        stderr: `error: branch '${oldName}' not found.\n`,
        exitCode: 1,
      };
    }
    repo.branches[newName] = repo.branches[oldName];
    delete repo.branches[oldName];
    if (currentBranch === oldName) {
      repo.HEAD = `refs/heads/${newName}`;
    }
    await saveRepo(ctx, repo);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  // Create branch
  if (branchArgs.length > 0) {
    const branchName = branchArgs[0];
    if (repo.branches[branchName]) {
      return {
        stdout: "",
        stderr: `fatal: a branch named '${branchName}' already exists\n`,
        exitCode: 128,
      };
    }
    const commitHash = getCurrentCommit(repo);
    if (!commitHash) {
      return {
        stdout: "",
        stderr: "fatal: Not a valid object name: 'HEAD'.\n",
        exitCode: 128,
      };
    }
    repo.branches[branchName] = commitHash;
    await saveRepo(ctx, repo);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  // List branches
  let output = "";
  const branches = Object.keys(repo.branches).sort();

  // Always include current branch even if not in branches list yet
  if (currentBranch && !branches.includes(currentBranch)) {
    branches.unshift(currentBranch);
  }

  for (const branch of branches) {
    if (branch === currentBranch) {
      output += `* ${branch}\n`;
    } else {
      output += `  ${branch}\n`;
    }
  }

  return { stdout: output, stderr: "", exitCode: 0 };
}

async function gitCheckout(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  if (args.includes("--help")) {
    return showHelp({
      name: "git checkout",
      summary: "Switch branches or restore working tree files",
      usage: "git checkout [<options>] <branch>",
      options: [
        "-b <branch>   Create and checkout new branch",
        "-B <branch>   Force create and checkout new branch",
      ],
    });
  }

  const repo = await loadRepo(ctx);
  if (!repo) {
    return {
      stdout: "",
      stderr:
        "fatal: not a git repository (or any of the parent directories): .git\n",
      exitCode: 128,
    };
  }

  const createBranch = args.includes("-b");
  const forceCreate = args.includes("-B");

  // Filter out flags
  const branchArgs = args.filter(
    (a) => !a.startsWith("-") && a !== "-b" && a !== "-B",
  );

  // Check for unknown options
  for (const arg of args) {
    if (arg.startsWith("-") && arg !== "-b" && arg !== "-B") {
      return {
        stdout: "",
        stderr: `error: unknown option '${arg}'\n`,
        exitCode: 129,
      };
    }
  }

  if (branchArgs.length === 0) {
    return {
      stdout: "",
      stderr: "error: you must specify path(s) to checkout\n",
      exitCode: 1,
    };
  }

  const target = branchArgs[0];

  // Create and checkout branch
  if (createBranch || forceCreate) {
    if (repo.branches[target] && !forceCreate) {
      return {
        stdout: "",
        stderr: `fatal: a branch named '${target}' already exists\n`,
        exitCode: 128,
      };
    }
    const commitHash = getCurrentCommit(repo);
    if (!commitHash && !forceCreate) {
      return {
        stdout: "",
        stderr: "fatal: Not a valid object name: 'HEAD'.\n",
        exitCode: 128,
      };
    }
    repo.branches[target] = commitHash || "";
    repo.HEAD = `refs/heads/${target}`;
    await saveRepo(ctx, repo);
    return {
      stdout: `Switched to a new branch '${target}'\n`,
      stderr: "",
      exitCode: 0,
    };
  }

  // Checkout existing branch
  if (repo.branches[target]) {
    repo.HEAD = `refs/heads/${target}`;

    // Restore working tree to match branch
    const commit = repo.commits[repo.branches[target]];
    if (commit) {
      // Clear working tree and restore from commit
      for (const [path, contentHash] of Object.entries(commit.tree)) {
        const content = repo.objects[contentHash];
        if (content !== undefined) {
          const fullPath = ctx.fs.resolvePath(ctx.cwd, path);
          // Ensure directory exists
          const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
          if (dir) {
            await ctx.fs.mkdir(dir, { recursive: true });
          }
          await ctx.fs.writeFile(fullPath, content);
        }
      }
    }

    repo.index = {};
    await saveRepo(ctx, repo);
    return {
      stdout: `Switched to branch '${target}'\n`,
      stderr: "",
      exitCode: 0,
    };
  }

  // Checkout commit (detached HEAD)
  if (repo.commits[target]) {
    repo.HEAD = target;
    repo.index = {};
    await saveRepo(ctx, repo);
    return {
      stdout: `Note: switching to '${target}'.\n\nYou are in 'detached HEAD' state.\n`,
      stderr: "",
      exitCode: 0,
    };
  }

  return {
    stdout: "",
    stderr: `error: pathspec '${target}' did not match any file(s) known to git\n`,
    exitCode: 1,
  };
}

async function gitDiff(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  if (args.includes("--help")) {
    return showHelp({
      name: "git diff",
      summary: "Show changes between commits, commit and working tree, etc",
      usage: "git diff [<options>] [<commit>] [--] [<path>...]",
      options: [
        "--staged, --cached  Show staged changes",
        "--stat              Show diffstat",
        "--name-only         Show only names of changed files",
      ],
    });
  }

  const repo = await loadRepo(ctx);
  if (!repo) {
    return {
      stdout: "",
      stderr:
        "fatal: not a git repository (or any of the parent directories): .git\n",
      exitCode: 128,
    };
  }

  const staged = args.includes("--staged") || args.includes("--cached");
  const stat = args.includes("--stat");
  const nameOnly = args.includes("--name-only");

  // Check for unknown options
  for (const arg of args) {
    if (
      arg.startsWith("-") &&
      arg !== "--staged" &&
      arg !== "--cached" &&
      arg !== "--stat" &&
      arg !== "--name-only" &&
      arg !== "--"
    ) {
      return {
        stdout: "",
        stderr: `error: unknown option '${arg}'\n`,
        exitCode: 129,
      };
    }
  }

  const trackedFiles = getTrackedFiles(repo);
  const workingFiles = await getWorkingTreeFiles(ctx);

  let output = "";

  if (staged) {
    // Show diff between HEAD and index
    for (const [path, contentHash] of Object.entries(repo.index)) {
      const oldContent = trackedFiles[path]
        ? repo.objects[trackedFiles[path]] || ""
        : "";
      const newContent = repo.objects[contentHash] || "";

      if (oldContent !== newContent) {
        if (nameOnly) {
          output += `${path}\n`;
        } else if (stat) {
          const diff = Diff.diffLines(oldContent, newContent);
          let added = 0;
          let removed = 0;
          for (const part of diff) {
            if (part.added) added += part.count || 0;
            if (part.removed) removed += part.count || 0;
          }
          output += ` ${path} | ${added + removed} ${"+".repeat(added)}${"-".repeat(removed)}\n`;
        } else {
          output += Diff.createTwoFilesPatch(
            `a/${path}`,
            `b/${path}`,
            oldContent,
            newContent,
          );
        }
      }
    }
  } else {
    // Show diff between index/HEAD and working tree
    const baseFiles =
      Object.keys(repo.index).length > 0 ? repo.index : trackedFiles;

    for (const [path, content] of Object.entries(workingFiles)) {
      const baseHash = baseFiles[path];
      const baseContent = baseHash ? repo.objects[baseHash] || "" : "";
      const currentHash = hashContent(content);

      if (baseHash && baseHash !== currentHash) {
        if (nameOnly) {
          output += `${path}\n`;
        } else if (stat) {
          const diff = Diff.diffLines(baseContent, content);
          let added = 0;
          let removed = 0;
          for (const part of diff) {
            if (part.added) added += part.count || 0;
            if (part.removed) removed += part.count || 0;
          }
          output += ` ${path} | ${added + removed} ${"+".repeat(added)}${"-".repeat(removed)}\n`;
        } else {
          output += Diff.createTwoFilesPatch(
            `a/${path}`,
            `b/${path}`,
            baseContent,
            content,
          );
        }
      }
    }
  }

  return { stdout: output, stderr: "", exitCode: 0 };
}

async function gitConfig(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  if (args.includes("--help")) {
    return showHelp({
      name: "git config",
      summary: "Get and set repository or global options",
      usage: "git config [<options>] [name] [value]",
      options: [
        "--list, -l    List all config variables",
        "--get         Get value of a config variable",
        "--unset       Remove a config variable",
        "--global      Use global config file (ignored in simulation)",
        "--local       Use repository config file",
      ],
    });
  }

  const repo = await loadRepo(ctx);
  if (!repo) {
    return {
      stdout: "",
      stderr:
        "fatal: not a git repository (or any of the parent directories): .git\n",
      exitCode: 128,
    };
  }

  const listFlag = args.includes("--list") || args.includes("-l");
  const getFlag = args.includes("--get");
  const unsetFlag = args.includes("--unset");

  // Filter flags to get positional arguments
  const configArgs = args.filter((a) => !a.startsWith("-"));

  if (listFlag) {
    let output = "";
    for (const [key, value] of Object.entries(repo.config)) {
      output += `${key}=${value}\n`;
    }
    return { stdout: output, stderr: "", exitCode: 0 };
  }

  if (unsetFlag) {
    const key = configArgs[0];
    if (!key) {
      return {
        stdout: "",
        stderr: "error: key does not contain a section\n",
        exitCode: 1,
      };
    }
    delete repo.config[key];
    await saveRepo(ctx, repo);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  if (getFlag || configArgs.length === 1) {
    const key = configArgs[0];
    if (!key) {
      return {
        stdout: "",
        stderr: "error: key does not contain a section\n",
        exitCode: 1,
      };
    }
    const value = repo.config[key];
    if (value === undefined) {
      return { stdout: "", stderr: "", exitCode: 1 };
    }
    return { stdout: `${value}\n`, stderr: "", exitCode: 0 };
  }

  // Set config value
  if (configArgs.length >= 2) {
    const [key, ...valueParts] = configArgs;
    const value = valueParts.join(" ");
    repo.config[key] = value;
    await saveRepo(ctx, repo);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  return {
    stdout: "",
    stderr: "error: key does not contain a section\n",
    exitCode: 1,
  };
}

async function gitRm(args: string[], ctx: CommandContext): Promise<ExecResult> {
  if (args.includes("--help")) {
    return showHelp({
      name: "git rm",
      summary: "Remove files from the working tree and from the index",
      usage: "git rm [<options>] [--] <file>...",
      options: [
        "-f, --force       Force removal",
        "-r                Allow recursive removal",
        "--cached          Only remove from the index",
        "-n, --dry-run     Don't actually remove files",
      ],
    });
  }

  const repo = await loadRepo(ctx);
  if (!repo) {
    return {
      stdout: "",
      stderr:
        "fatal: not a git repository (or any of the parent directories): .git\n",
      exitCode: 128,
    };
  }

  // Note: -f/--force allows removing modified files without confirmation
  // -r allows recursive removal of directories (both parsed but basic impl)
  void (args.includes("-f") || args.includes("--force"));
  void args.includes("-r");
  const cached = args.includes("--cached");
  const dryRun = args.includes("-n") || args.includes("--dry-run");

  const files = args.filter(
    (a) =>
      !a.startsWith("-") &&
      a !== "-f" &&
      a !== "--force" &&
      a !== "-r" &&
      a !== "--cached" &&
      a !== "-n" &&
      a !== "--dry-run" &&
      a !== "--",
  );

  // Check for unknown options
  for (const arg of args) {
    if (
      arg.startsWith("-") &&
      arg !== "-f" &&
      arg !== "--force" &&
      arg !== "-r" &&
      arg !== "--cached" &&
      arg !== "-n" &&
      arg !== "--dry-run" &&
      arg !== "--"
    ) {
      return {
        stdout: "",
        stderr: `error: unknown option '${arg}'\n`,
        exitCode: 129,
      };
    }
  }

  if (files.length === 0) {
    return {
      stdout: "",
      stderr: "fatal: No pathspec was given. Which files should I remove?\n",
      exitCode: 128,
    };
  }

  const trackedFiles = getTrackedFiles(repo);
  let output = "";

  for (const file of files) {
    if (!trackedFiles[file] && !repo.index[file]) {
      return {
        stdout: "",
        stderr: `fatal: pathspec '${file}' did not match any files\n`,
        exitCode: 128,
      };
    }

    if (!dryRun) {
      // Remove from index
      delete repo.index[file];

      // Remove from working tree (unless --cached)
      if (!cached) {
        const fullPath = ctx.fs.resolvePath(ctx.cwd, file);
        try {
          await ctx.fs.rm(fullPath, { force: true });
        } catch {
          // File may not exist
        }
      }
    }
    output += `rm '${file}'\n`;
  }

  if (!dryRun) {
    await saveRepo(ctx, repo);
  }

  return { stdout: output, stderr: "", exitCode: 0 };
}

async function gitReset(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  if (args.includes("--help")) {
    return showHelp({
      name: "git reset",
      summary: "Reset current HEAD to the specified state",
      usage: "git reset [<mode>] [<commit>]",
      options: [
        "--soft         Only reset HEAD",
        "--mixed        Reset HEAD and index (default)",
        "--hard         Reset HEAD, index, and working tree",
      ],
    });
  }

  const repo = await loadRepo(ctx);
  if (!repo) {
    return {
      stdout: "",
      stderr:
        "fatal: not a git repository (or any of the parent directories): .git\n",
      exitCode: 128,
    };
  }

  const soft = args.includes("--soft");
  const hard = args.includes("--hard");
  // mixed is default

  // Check for unknown options
  for (const arg of args) {
    if (
      arg.startsWith("-") &&
      arg !== "--soft" &&
      arg !== "--mixed" &&
      arg !== "--hard"
    ) {
      return {
        stdout: "",
        stderr: `error: unknown option '${arg}'\n`,
        exitCode: 129,
      };
    }
  }

  // Filter out mode flags
  const targetArgs = args.filter((a) => !a.startsWith("-"));

  // Default to HEAD if no target specified
  let targetCommit = getCurrentCommit(repo);

  if (targetArgs.length > 0) {
    const target = targetArgs[0];
    // Check if it's HEAD~N notation
    const headMatch = target.match(/^HEAD~(\d+)$/);
    if (headMatch) {
      let n = parseInt(headMatch[1], 10);
      let commit = targetCommit;
      while (n > 0 && commit) {
        const c = repo.commits[commit];
        commit = c?.parent || null;
        n--;
      }
      targetCommit = commit;
    } else if (repo.commits[target]) {
      targetCommit = target;
    } else if (repo.branches[target]) {
      targetCommit = repo.branches[target];
    }
  }

  if (!targetCommit) {
    return {
      stdout: "",
      stderr: "fatal: Failed to resolve 'HEAD' as a valid ref.\n",
      exitCode: 128,
    };
  }

  // Update branch to point to target commit
  const branch = getCurrentBranch(repo);
  if (branch) {
    repo.branches[branch] = targetCommit;
  }

  // Reset index unless --soft
  if (!soft) {
    repo.index = {};
  }

  // Reset working tree if --hard
  if (hard) {
    const commit = repo.commits[targetCommit];
    if (commit) {
      for (const [path, contentHash] of Object.entries(commit.tree)) {
        const content = repo.objects[contentHash];
        if (content !== undefined) {
          const fullPath = ctx.fs.resolvePath(ctx.cwd, path);
          const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
          if (dir) {
            await ctx.fs.mkdir(dir, { recursive: true });
          }
          await ctx.fs.writeFile(fullPath, content);
        }
      }
    }
  }

  await saveRepo(ctx, repo);

  return {
    stdout: `HEAD is now at ${targetCommit.slice(0, 7)}\n`,
    stderr: "",
    exitCode: 0,
  };
}

async function gitRevParse(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  if (args.includes("--help")) {
    return showHelp({
      name: "git rev-parse",
      summary: "Pick out and massage parameters",
      usage: "git rev-parse [<options>] <args>...",
      options: [
        "--git-dir          Show git directory path",
        "--show-toplevel    Show working tree path",
        "--short            Output shorter unique object name",
        "--verify           Verify exactly one parameter",
        "--abbrev-ref       Use short ref name",
      ],
    });
  }

  const repo = await loadRepo(ctx);

  const showGitDir = args.includes("--git-dir");
  const showToplevel = args.includes("--show-toplevel");
  const short = args.includes("--short");
  const abbrevRef = args.includes("--abbrev-ref");

  // Check for unknown options (but allow positional arguments)
  for (const arg of args) {
    if (
      arg.startsWith("--") &&
      arg !== "--git-dir" &&
      arg !== "--show-toplevel" &&
      arg !== "--short" &&
      arg !== "--verify" &&
      arg !== "--abbrev-ref"
    ) {
      return {
        stdout: "",
        stderr: `error: unknown option '${arg}'\n`,
        exitCode: 129,
      };
    }
  }

  if (showGitDir) {
    if (!repo) {
      return {
        stdout: "",
        stderr:
          "fatal: not a git repository (or any of the parent directories): .git\n",
        exitCode: 128,
      };
    }
    return { stdout: `${getGitDir(ctx)}\n`, stderr: "", exitCode: 0 };
  }

  if (showToplevel) {
    if (!repo) {
      return {
        stdout: "",
        stderr:
          "fatal: not a git repository (or any of the parent directories): .git\n",
        exitCode: 128,
      };
    }
    return { stdout: `${ctx.cwd}\n`, stderr: "", exitCode: 0 };
  }

  // Parse refs
  const refs = args.filter((a) => !a.startsWith("-"));

  if (!repo) {
    return {
      stdout: "",
      stderr:
        "fatal: not a git repository (or any of the parent directories): .git\n",
      exitCode: 128,
    };
  }

  let output = "";
  for (const ref of refs) {
    if (ref === "HEAD") {
      if (abbrevRef) {
        const branch = getCurrentBranch(repo);
        output += `${branch || "HEAD"}\n`;
      } else {
        const commit = getCurrentCommit(repo);
        if (commit) {
          output += short ? `${commit.slice(0, 7)}\n` : `${commit}\n`;
        } else {
          output += "HEAD\n";
        }
      }
    } else if (repo.branches[ref]) {
      const commit = repo.branches[ref];
      output += short ? `${commit.slice(0, 7)}\n` : `${commit}\n`;
    } else if (repo.commits[ref]) {
      output += short ? `${ref.slice(0, 7)}\n` : `${ref}\n`;
    }
  }

  return { stdout: output, stderr: "", exitCode: 0 };
}

async function gitShow(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  if (args.includes("--help")) {
    return showHelp({
      name: "git show",
      summary: "Show various types of objects",
      usage: "git show [<options>] [<object>...]",
      options: [
        "--stat        Show diffstat",
        "--name-only   Show only names of changed files",
      ],
    });
  }

  const repo = await loadRepo(ctx);
  if (!repo) {
    return {
      stdout: "",
      stderr:
        "fatal: not a git repository (or any of the parent directories): .git\n",
      exitCode: 128,
    };
  }

  const nameOnly = args.includes("--name-only");
  const stat = args.includes("--stat");

  const refs = args.filter((a) => !a.startsWith("-"));
  const target = refs[0] || "HEAD";

  let commitHash: string | null = null;

  if (target === "HEAD") {
    commitHash = getCurrentCommit(repo);
  } else if (repo.branches[target]) {
    commitHash = repo.branches[target];
  } else if (repo.commits[target]) {
    commitHash = target;
  }

  if (!commitHash || !repo.commits[commitHash]) {
    return {
      stdout: "",
      stderr: `fatal: bad object ${target}\n`,
      exitCode: 128,
    };
  }

  const commit = repo.commits[commitHash];
  const date = new Date(commit.timestamp);

  let output = "";
  output += `commit ${commit.hash}\n`;
  output += `Author: ${commit.author} <${commit.email}>\n`;
  output += `Date:   ${date.toUTCString()}\n`;
  output += `\n    ${commit.message}\n`;

  // Show diff from parent
  if (commit.parent) {
    const parentCommit = repo.commits[commit.parent];
    if (parentCommit) {
      output += "\n";
      for (const [path, contentHash] of Object.entries(commit.tree)) {
        const oldHash = parentCommit.tree[path];
        if (oldHash !== contentHash) {
          const oldContent = oldHash ? repo.objects[oldHash] || "" : "";
          const newContent = repo.objects[contentHash] || "";

          if (nameOnly) {
            output += `${path}\n`;
          } else if (stat) {
            const diff = Diff.diffLines(oldContent, newContent);
            let added = 0;
            let removed = 0;
            for (const part of diff) {
              if (part.added) added += part.count || 0;
              if (part.removed) removed += part.count || 0;
            }
            output += ` ${path} | ${added + removed} ${"+".repeat(added)}${"-".repeat(removed)}\n`;
          } else {
            output += Diff.createTwoFilesPatch(
              `a/${path}`,
              `b/${path}`,
              oldContent,
              newContent,
            );
          }
        }
      }
    }
  }

  return { stdout: output, stderr: "", exitCode: 0 };
}

// ============= MAIN COMMAND =============

export const gitCommand: Command = {
  name: "git",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args) && args.length === 1) {
      return showHelp(gitHelp);
    }

    if (args.includes("--version")) {
      return {
        stdout: "git version 2.43.0 (just-bash simulation)\n",
        stderr: "",
        exitCode: 0,
      };
    }

    const subcommand = args[0];
    const subArgs = args.slice(1);

    switch (subcommand) {
      case "init":
        return gitInit(subArgs, ctx);
      case "status":
        return gitStatus(subArgs, ctx);
      case "add":
        return gitAdd(subArgs, ctx);
      case "commit":
        return gitCommit(subArgs, ctx);
      case "log":
        return gitLog(subArgs, ctx);
      case "branch":
        return gitBranch(subArgs, ctx);
      case "checkout":
        return gitCheckout(subArgs, ctx);
      case "diff":
        return gitDiff(subArgs, ctx);
      case "config":
        return gitConfig(subArgs, ctx);
      case "rm":
        return gitRm(subArgs, ctx);
      case "reset":
        return gitReset(subArgs, ctx);
      case "rev-parse":
        return gitRevParse(subArgs, ctx);
      case "show":
        return gitShow(subArgs, ctx);
      case undefined:
        return showHelp(gitHelp);
      default:
        return {
          stdout: "",
          stderr: `git: '${subcommand}' is not a git command. See 'git --help'.\n`,
          exitCode: 1,
        };
    }
  },
};
