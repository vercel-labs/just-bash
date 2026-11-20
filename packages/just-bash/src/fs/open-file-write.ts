import type { ExecutionScope, ResourceLease } from "../execution-scope.js";
import type { BufferEncoding, IFileSystem } from "./interface.js";

const openIdentity = Symbol("openIdentity");

export type FileWriteHandle = (
  content: string,
  encoding: BufferEncoding,
  append: boolean,
) => Promise<void>;

export interface FileWriteOpenOptions {
  scope: ExecutionScope;
  append: boolean;
}

type OpenFileWrite = (
  path: string,
  options: FileWriteOpenOptions,
) => Promise<FileWriteHandle | undefined>;
const openers = new WeakMap<IFileSystem, OpenFileWrite>();
const disposables = new WeakMap<
  FileWriteHandle,
  { owners: number; close: () => Promise<void> }
>();
const scopeFiles = new WeakMap<ExecutionScope, Set<() => Promise<void>>>();

export function registerFileWriteOpener(
  fs: IFileSystem,
  open: OpenFileWrite,
): void {
  openers.set(fs, open);
}

export function getFileWriteHandle(
  fs: IFileSystem,
  path: string,
  options: FileWriteOpenOptions,
): Promise<FileWriteHandle | undefined> | undefined {
  return openers.get(fs)?.(path, options);
}

/** The opener is the first owner. FDs, saved state and prepared routes may share it. */
export function manageFileWrite(
  write: FileWriteHandle,
  close: () => Promise<void>,
  scope: ExecutionScope,
  lease: ResourceLease,
): FileWriteHandle {
  scope.consumeWork(0, "file redirection");
  let files = scopeFiles.get(scope);
  if (!files) {
    files = new Set();
    const active = files;
    scope.registerCleanup(async () => {
      const results = await Promise.allSettled(
        [...active].map((dispose) => dispose()),
      );
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length)
        throw new AggregateError(errors, "closing file descriptors failed");
    });
    scopeFiles.set(scope, files);
  }
  const active = files;
  let closing: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    if (!closing) {
      lease.release();
      closing = close().finally(() => active.delete(dispose));
    }
    return closing;
  };
  active.add(dispose);
  disposables.set(write, { owners: 1, close: dispose });
  return write;
}

export function retainFileWrite(write: FileWriteHandle | undefined): void {
  const resource = write && disposables.get(write);
  if (resource) resource.owners++;
}

export function releaseFileWrite(write: FileWriteHandle | undefined): void {
  const resource = write && disposables.get(write);
  if (resource && --resource.owners === 0) {
    void resource.close().catch(() => {});
  }
}

export function fileWriteHandle(
  fs: IFileSystem,
  path: string,
  identity: string,
): FileWriteHandle {
  return (content, encoding, append) => {
    const options = { encoding, [openIdentity]: identity };
    return append
      ? fs.appendFile(path, content, options)
      : fs.writeFile(path, content, options);
  };
}

export function isOpenFileWrite(
  options: unknown,
  identity: string | undefined,
  path: string,
): boolean {
  if (options && typeof options === "object" && openIdentity in options) {
    if (options[openIdentity] !== identity) {
      throw new Error(`EBADF: opened file changed, write '${path}'`);
    }
    return true;
  }
  return false;
}
