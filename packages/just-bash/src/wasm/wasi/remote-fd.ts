import { RPC_BYTES } from "../protocol.js";
import type { Rpc } from "../rpc.js";
import type { FileStat } from "../worker-types.js";
import * as WASI from "./abi.js";

function filestat(stat: FileStat | null): WASI.Filestat | null {
  if (!stat) return null;
  const timestamp = BigInt(Math.max(0, Math.trunc(stat.mtime))) * 1_000_000n;
  return {
    dev: BigInt(stat.dev),
    ino: BigInt(stat.ino),
    filetype: stat.type,
    nlink: 1n,
    size: BigInt(stat.size),
    atim: timestamp,
    mtim: timestamp,
    ctim: timestamp,
  };
}

/** Descriptor proxy; all path resolution and rights checks happen in the host. */
export class RemoteFd {
  constructor(
    readonly rpc: Rpc,
    readonly handle: number,
    private readonly preopen?: string,
  ) {}

  close(): number {
    return this.rpc.call({ op: "close", fd: this.handle }).errno;
  }
  sync(): number {
    return this.rpc.call({ op: "sync", fd: this.handle }).errno;
  }
  getPrestat(): { errno: number; prestat: WASI.Prestat | null } {
    return {
      errno: this.preopen === undefined ? WASI.ERRNO_BADF : 0,
      prestat:
        this.preopen === undefined
          ? null
          : { name: new TextEncoder().encode(this.preopen) },
    };
  }
  getFdstat(): { errno: number; fdstat: WASI.Fdstat | null } {
    const response = this.rpc.json<{
      type: number;
      flags: number;
      rights: string;
      inheriting: string;
    }>({ op: "fdstat", fd: this.handle });
    if (!response.value) return { errno: response.errno, fdstat: null };
    const stat: WASI.Fdstat = {
      fs_filetype: response.value.type,
      fs_flags: response.value.flags,
      fs_rights_base: BigInt(response.value.rights),
      fs_rights_inherited: BigInt(response.value.inheriting),
    };
    return { errno: 0, fdstat: stat };
  }
  setFlags(flags: number): number {
    return this.rpc.call({ op: "flags", fd: this.handle, flags }).errno;
  }
  setRights(rights: bigint, inheriting: bigint): number {
    return this.rpc.call({
      op: "rights",
      fd: this.handle,
      rights: String(rights),
      inheritingRights: String(inheriting),
    }).errno;
  }
  getFilestat(): { errno: number; filestat: WASI.Filestat | null } {
    const response = this.rpc.json<FileStat>({ op: "stat", fd: this.handle });
    return { errno: response.errno, filestat: filestat(response.value) };
  }
  setSize(size: bigint): number {
    return this.rpc.call({ op: "resize", fd: this.handle, size: Number(size) })
      .errno;
  }
  read(size: number): { errno: number; data: Uint8Array } {
    return this.rpc.call({
      op: "read",
      fd: this.handle,
      size: Math.min(size, RPC_BYTES),
    });
  }
  pread(size: number, offset: bigint): { errno: number; data: Uint8Array } {
    return this.rpc.call({
      op: "read",
      fd: this.handle,
      size: Math.min(size, RPC_BYTES),
      offset: Number(offset),
    });
  }
  write(data: Uint8Array): { errno: number; written: number } {
    const response = this.rpc.json<number>({
      op: "write",
      fd: this.handle,
      data: data.subarray(0, RPC_BYTES),
    });
    return { errno: response.errno, written: response.value ?? 0 };
  }
  pwrite(data: Uint8Array, offset: bigint): { errno: number; written: number } {
    const response = this.rpc.json<number>({
      op: "write",
      fd: this.handle,
      offset: Number(offset),
      data: data.subarray(0, RPC_BYTES),
    });
    return { errno: response.errno, written: response.value ?? 0 };
  }
  seek(offset: bigint, whence: number): { errno: number; offset: bigint } {
    const response = this.rpc.json<number>({
      op: "seek",
      fd: this.handle,
      offset: String(offset),
      whence,
    });
    return { errno: response.errno, offset: BigInt(response.value ?? 0) };
  }
  tell(): { errno: number; offset: bigint } {
    const response = this.rpc.json<number>({ op: "tell", fd: this.handle });
    return { errno: response.errno, offset: BigInt(response.value ?? 0) };
  }
  readDirectoryEntry(cookie: bigint): {
    errno: number;
    dirent: WASI.Dirent | null;
  } {
    const response = this.rpc.json<{
      next: number;
      ino: string;
      name: string;
      type: number;
    }>({ op: "readdir", fd: this.handle, cookie: Number(cookie) });
    return {
      errno: response.errno,
      dirent: response.value
        ? {
            d_next: BigInt(response.value.next),
            d_ino: BigInt(response.value.ino),
            dir_name: new TextEncoder().encode(response.value.name),
            d_type: response.value.type,
          }
        : null,
    };
  }
  open(
    dirflags: number,
    path: string,
    oflags: number,
    rights: bigint,
    inheriting: bigint,
    flags: number,
  ): { errno: number; fd: RemoteFd | null } {
    const response = this.rpc.json<number>({
      op: "open",
      fd: this.handle,
      path,
      lookupFlags: dirflags,
      openFlags: oflags,
      rights: String(rights),
      inheritingRights: String(inheriting),
      flags,
    });
    return {
      errno: response.errno,
      fd:
        response.value === null ? null : new RemoteFd(this.rpc, response.value),
    };
  }
  statAt(
    flags: number,
    path: string,
  ): { errno: number; filestat: WASI.Filestat | null } {
    const response = this.rpc.json<FileStat>({
      op: "pathstat",
      fd: this.handle,
      path,
      flags,
    });
    return { errno: response.errno, filestat: filestat(response.value) };
  }
  mkdir(path: string): number {
    return this.rpc.call({ op: "mkdir", fd: this.handle, path }).errno;
  }
  rmdir(path: string): number {
    return this.rpc.call({ op: "rmdir", fd: this.handle, path }).errno;
  }
  unlink(path: string): number {
    return this.rpc.call({ op: "unlink", fd: this.handle, path }).errno;
  }
  readlink(path: string, size: number): { errno: number; data: Uint8Array } {
    return this.rpc.call({
      op: "readlink",
      fd: this.handle,
      path,
      size: Math.min(size, RPC_BYTES),
    });
  }
}
