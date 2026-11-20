import type { ExecutionScope } from "../execution-scope.js";
import { createExclusiveOn } from "../fs/create-exclusive.js";
import type { IFileSystem } from "../fs/interface.js";
import { dirname } from "../fs/path-utils.js";
import { FileTraversalBudget } from "../fs/traversal.js";
import type { ExecutionLimits } from "../limits.js";
import { getErrorCode } from "./helpers/errors.js";
import type { InterpreterState } from "./types.js";

/**
 * A shell-local creation policy, shared by redirections and command capabilities.
 * Default 0022 delegates unchanged: native directory backends need no POSIX mode
 * capability for ordinary writes. A different mask must be applied at creation,
 * so a backend without atomic mode-aware creation fails before writing content.
 * Explicit createExclusive/chmod calls already carry a mode and stay explicit.
 */
export function withUmaskFileSystem(
  fs: IFileSystem,
  state: InterpreterState,
  limits: Required<ExecutionLimits>,
  scope: ExecutionScope,
): IFileSystem {
  const mask = () => state.fileCreationMask ?? 0o022;
  const budget = () =>
    new FileTraversalBudget({
      limits,
      executionScope: scope,
      signal: state.signal,
      site: "umask",
    });
  async function prepareFile(path: string, mode = 0o666): Promise<string> {
    if (mask() === 0o022) return path;
    const traversal = budget();
    let target = path;
    for (let depth = 0; ; depth++) {
      traversal.visit(depth);
      try {
        await fs.stat(target);
        return await fs.realpath(target);
      } catch (error) {
        if (getErrorCode(error) !== "ENOENT") throw error;
      }
      // A dangling symlink is not a missing directory entry. Resolve only the
      // final link through backend capabilities; parent validation stays there.
      let link = false;
      try {
        link = (await fs.lstat(target)).isSymbolicLink;
      } catch (error) {
        if (getErrorCode(error) !== "ENOENT") throw error;
      }
      if (link) {
        target = fs.resolvePath(dirname(target), await fs.readlink(target));
        continue;
      }
      scope.throwIfAborted("umask create");
      await createExclusiveOn(fs, target, { mode: mode & ~mask() & 0o7777 });
      return target;
    }
  }
  const facade: IFileSystem = {
    readFile: fs.readFile.bind(fs),
    readFileBuffer: fs.readFileBuffer.bind(fs),
    exists: fs.exists.bind(fs),
    stat: fs.stat.bind(fs),
    lstat: fs.lstat.bind(fs),
    readdir: fs.readdir.bind(fs),
    rm: fs.rm.bind(fs),
    mv: fs.mv.bind(fs),
    resolvePath: fs.resolvePath.bind(fs),
    getAllPaths: fs.getAllPaths.bind(fs),
    chmod: fs.chmod.bind(fs),
    symlink: fs.symlink.bind(fs),
    link: fs.link.bind(fs),
    readlink: fs.readlink.bind(fs),
    realpath: fs.realpath.bind(fs),
    utimes: fs.utimes.bind(fs),
    async writeFile(path, content, options) {
      const target = await prepareFile(path);
      scope.throwIfAborted("umask write");
      await fs.writeFile(target, content, options);
    },
    async appendFile(path, content, options) {
      const target = await prepareFile(path);
      scope.throwIfAborted("umask append");
      await fs.appendFile(target, content, options);
    },
    async mkdir(path, options) {
      scope.throwIfAborted("umask mkdir");
      if (mask() === 0o022) return fs.mkdir(path, options);
      if (!options?.recursive)
        return createExclusiveOn(fs, path, {
          mode: 0o777 & ~mask(),
          directory: true,
        });
      const normalized = fs.resolvePath("/", path);
      const traversal = budget();
      let current = "/";
      let depth = 0;
      for (const part of normalized.split("/")) {
        if (!part) continue;
        traversal.visit(depth++);
        current = fs.resolvePath(current, part);
        try {
          const entry = await fs.stat(current);
          if (!entry.isDirectory)
            throw new Error(`ENOTDIR: not a directory, mkdir '${current}'`);
        } catch (error) {
          if (getErrorCode(error) !== "ENOENT") throw error;
          scope.throwIfAborted("umask mkdir");
          await createExclusiveOn(fs, current, {
            mode: 0o777 & ~mask(),
            directory: true,
          });
        }
      }
    },
    async cp(source, destination, options) {
      if (mask() === 0o022) return fs.cp(source, destination, options);
      const stat = await fs.stat(source);
      if (stat.isDirectory)
        throw new Error(
          "ENOTSUP: recursive filesystem copy cannot apply a shell creation mask; use the cp command",
        );
      let existingMode: number | undefined;
      try {
        existingMode = (await fs.stat(destination)).mode;
      } catch (error) {
        if (getErrorCode(error) !== "ENOENT") throw error;
      }
      const target = await prepareFile(destination, stat.mode);
      scope.throwIfAborted("umask copy");
      await fs.cp(source, target, options);
      const mode = existingMode ?? stat.mode & ~mask();
      if (((await fs.stat(target)).mode & 0o7777) !== (mode & 0o7777)) {
        scope.throwIfAborted("umask copy mode");
        await fs.chmod(target, mode & 0o7777);
      }
    },
  };
  if (fs.readFileBytes) facade.readFileBytes = fs.readFileBytes.bind(fs);
  if (fs.readdirWithFileTypes)
    facade.readdirWithFileTypes = fs.readdirWithFileTypes.bind(fs);
  if (fs.createExclusive) facade.createExclusive = fs.createExclusive.bind(fs);
  return facade;
}
