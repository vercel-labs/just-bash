import { utf8ByteLength } from "../encoding.js";
import { resolvePath } from "../fs/path-utils.js";
import { RPC_BYTES } from "./protocol.js";
import type { Rpc } from "./rpc.js";
import type {
  WasmFileStat,
  WasmFileSystem,
  WasmInputStream,
  WasmOutputStream,
} from "./types.js";
import * as WASI from "./wasi/abi.js";
import { RemoteFd } from "./wasi/remote-fd.js";
import type { WorkerInput } from "./worker-types.js";

function check(errno: number, operation: string): void {
  if (errno)
    throw Object.assign(
      new Error(`WASM ${operation} failed (WASI errno ${errno})`),
      { errno },
    );
}

function content(
  data: string | Uint8Array,
  maximum = Number.MAX_SAFE_INTEGER,
): Uint8Array {
  if (typeof data === "string") {
    if (utf8ByteLength(data) > maximum)
      throw new Error("WASM file size limit exceeded");
    return new TextEncoder().encode(data);
  }
  if (!(data instanceof Uint8Array))
    throw new TypeError("Expected a string or Uint8Array");
  if (data.length > maximum) throw new Error("WASM file size limit exceeded");
  return data;
}

function read(fd: RemoteFd, size = RPC_BYTES): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 1)
    throw new RangeError("Read size must be a positive integer");
  const result = fd.read(Math.min(size, RPC_BYTES));
  check(result.errno, "read");
  return result.data;
}

function write(fd: RemoteFd, data: Uint8Array): void {
  let position = 0;
  while (position < data.length) {
    const result = fd.write(data.subarray(position, position + RPC_BYTES));
    check(result.errno, "write");
    if (result.written < 1 || result.written > data.length - position)
      throw new Error("Invalid WASM write response");
    position += result.written;
  }
}

export function createAdapterIo(
  input: WorkerInput,
  rpc: Rpc,
): {
  stdin: WasmInputStream;
  stdout: WasmOutputStream;
  stderr: WasmOutputStream;
  fs: WasmFileSystem;
} {
  const root = new RemoteFd(rpc, 3);
  const stdin = new RemoteFd(rpc, 0);
  const output = (id: number): WasmOutputStream => {
    const fd = new RemoteFd(rpc, id);
    return {
      write(data) {
        write(fd, content(data));
      },
    };
  };
  const resolve = (path: string): string => {
    if (
      typeof path !== "string" ||
      path.includes("\0") ||
      utf8ByteLength(path) > 4096
    )
      throw new Error("Invalid WASM virtual path");
    return resolvePath(input.cwd, path);
  };
  const relative = (path: string): string => resolve(path).slice(1) || ".";
  const open = (
    path: string,
    rights: number,
    oflags = 0,
    flags = 0,
  ): RemoteFd => {
    const result = root.open(
      1,
      relative(path),
      oflags,
      BigInt(rights),
      0n,
      flags,
    );
    check(result.errno, "open");
    if (!(result.fd instanceof RemoteFd))
      throw new Error("Missing WASM file descriptor");
    return result.fd;
  };
  const writeFile = (
    path: string,
    data: string | Uint8Array,
    append: boolean,
  ): void => {
    const bytes = content(data, input.limits.maxFileBytes);
    const fd = open(
      path,
      WASI.RIGHTS_FD_WRITE,
      WASI.OFLAGS_CREAT | (append ? 0 : WASI.OFLAGS_TRUNC),
      append ? WASI.FDFLAGS_APPEND : 0,
    );
    try {
      write(fd, bytes);
    } finally {
      check(fd.close(), "close");
    }
  };
  const fs: WasmFileSystem = {
    resolve,
    readFile(path) {
      const fd = open(path, WASI.RIGHTS_FD_READ | WASI.RIGHTS_FD_FILESTAT_GET);
      try {
        const stat = fd.getFilestat();
        check(stat.errno, "stat");
        if (
          !stat.filestat ||
          stat.filestat.filetype !== WASI.FILETYPE_REGULAR_FILE
        )
          throw new Error("WASM readFile requires a regular file");
        const size = Number(stat.filestat.size);
        if (
          !Number.isSafeInteger(size) ||
          size < 0 ||
          size > input.limits.maxFileBytes
        )
          throw new Error("WASM file size limit exceeded");
        const bytes = new Uint8Array(size);
        let position = 0;
        while (position < size) {
          const chunk = read(fd, size - position);
          if (!chunk.length) break;
          bytes.set(chunk, position);
          position += chunk.length;
        }
        return position === size ? bytes : bytes.subarray(0, position);
      } finally {
        check(fd.close(), "close");
      }
    },
    writeFile(path, data) {
      writeFile(path, data, false);
    },
    appendFile(path, data) {
      writeFile(path, data, true);
    },
    stat(path): WasmFileStat {
      const result = root.statAt(1, relative(path));
      check(result.errno, "stat");
      if (!result.filestat) throw new Error("Missing WASM file stat");
      const stat = result.filestat;
      return {
        type:
          stat.filetype === WASI.FILETYPE_REGULAR_FILE
            ? "file"
            : stat.filetype === WASI.FILETYPE_DIRECTORY
              ? "directory"
              : stat.filetype === WASI.FILETYPE_SYMBOLIC_LINK
                ? "symlink"
                : "other",
        size: Number(stat.size),
        mtimeMs: Number(stat.mtim / 1_000_000n),
      };
    },
    readdir(path) {
      const fd = open(path, WASI.RIGHTS_FD_READDIR, WASI.OFLAGS_DIRECTORY);
      try {
        const names: string[] = [];
        let cookie = 0n;
        for (;;) {
          const result = fd.readDirectoryEntry(cookie);
          check(result.errno, "readdir");
          if (!result.dirent) return names;
          names.push(new TextDecoder().decode(result.dirent.dir_name));
          cookie = result.dirent.d_next;
        }
      } finally {
        check(fd.close(), "close");
      }
    },
    mkdir(path) {
      check(root.mkdir(relative(path)), "mkdir");
    },
    unlink(path) {
      check(root.unlink(relative(path)), "unlink");
    },
    rmdir(path) {
      check(root.rmdir(relative(path)), "rmdir");
    },
    rename(source, target) {
      check(
        rpc.call({
          op: "rename",
          fd: 3,
          path: relative(source),
          targetFd: 3,
          targetPath: relative(target),
        }).errno,
        "rename",
      );
    },
  };
  return {
    fs,
    stdout: output(1),
    stderr: output(2),
    stdin: {
      read(size) {
        return read(stdin, size);
      },
      readAll() {
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const chunk = read(stdin);
          if (!chunk.length) break;
          if (chunk.length > input.limits.maxFileBytes - size)
            throw new Error("WASM stdin readAll limit exceeded");
          chunks.push(chunk);
          size += chunk.length;
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        return bytes;
      },
    },
  };
}
