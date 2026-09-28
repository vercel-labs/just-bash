import { RPC_BYTES } from "../protocol.js";
import type { Rpc } from "../rpc.js";
import * as WASI from "./abi.js";
import { WasiFault, type WasiMemory } from "./memory.js";
import { RemoteFd } from "./remote-fd.js";

/** Descriptor and path syscalls; host descriptors remain the authority. */
export function filesystemImports(
  memory: WasiMemory,
  rpc: Rpc,
): WebAssembly.ModuleImports {
  const fds = new Map(
    [0, 1, 2, 3].map((id) => [
      id,
      new RemoteFd(rpc, id, id === 3 ? "/" : undefined),
    ]),
  );
  const fd = (id: number): RemoteFd => {
    const result = fds.get(id >>> 0);
    if (!result) throw new WasiFault(WASI.ERRNO_BADF);
    return result;
  };
  const io = (
    write: boolean,
    id: number,
    vectors: number,
    count: number,
    result: number,
    offset?: bigint,
  ): number => {
    const target = fd(id);
    vectors >>>= 0;
    count >>>= 0;
    if (count > 1024) return WASI.ERRNO_INVAL;
    memory.bytes(vectors, count * 8);
    memory.bytes(result, 4);
    const ranges: Array<{ pointer: number; length: number }> = [];
    for (let i = 0; i < count; i++) {
      const pointer = memory.read32(vectors + i * 8);
      const length = memory.read32(vectors + i * 8 + 4);
      memory.bytes(pointer, length);
      ranges.push({ pointer, length });
    }
    let total = 0;
    for (const { pointer, length } of ranges) {
      if (!length) continue;
      const size = Math.min(length, RPC_BYTES);
      let transferred: number;
      let errno: number;
      if (write) {
        const response =
          offset === undefined
            ? target.write(memory.bytes(pointer, size))
            : target.pwrite(
                memory.bytes(pointer, size),
                offset + BigInt(total),
              );
        transferred = response.written;
        errno = response.errno;
      } else {
        const response =
          offset === undefined
            ? target.read(size)
            : target.pread(size, offset + BigInt(total));
        transferred = response.data.length;
        errno = response.errno;
        if (!errno) memory.bytes(pointer, transferred).set(response.data);
      }
      if (errno) {
        memory.u32(result, total);
        return total ? 0 : errno;
      }
      total += transferred;
      if (transferred < length) break;
    }
    memory.u32(result, total);
    return 0;
  };
  return {
    fd_read: (id: number, p: number, n: number, out: number) =>
      io(false, id, p, n, out),
    fd_write: (id: number, p: number, n: number, out: number) =>
      io(true, id, p, n, out),
    fd_pread: (id: number, p: number, n: number, offset: bigint, out: number) =>
      io(false, id, p, n, out, offset),
    fd_pwrite: (
      id: number,
      p: number,
      n: number,
      offset: bigint,
      out: number,
    ) => io(true, id, p, n, out, offset),
    fd_close(id: number) {
      const errno = fd(id).close();
      if (!errno) fds.delete(id >>> 0);
      return errno;
    },
    fd_renumber(source: number, target: number) {
      source >>>= 0;
      target >>>= 0;
      const value = fd(source);
      if (source === target) return 0;
      const previous = fds.get(target);
      if (previous) {
        const errno = previous.close();
        if (errno) return errno;
      }
      fds.set(target, value);
      fds.delete(source);
      return 0;
    },
    fd_fdstat_get(id: number, out: number) {
      memory.bytes(out, 24);
      const result = fd(id).getFdstat();
      if (result.fdstat) memory.fdstat(out, result.fdstat);
      return result.errno;
    },
    fd_fdstat_set_flags: (id: number, flags: number) => fd(id).setFlags(flags),
    fd_fdstat_set_rights: (id: number, rights: bigint, inherited: bigint) =>
      fd(id).setRights(rights, inherited),
    fd_filestat_get(id: number, out: number) {
      memory.bytes(out, 64);
      const result = fd(id).getFilestat();
      if (result.filestat) memory.filestat(out, result.filestat);
      return result.errno;
    },
    fd_filestat_set_size: (id: number, size: bigint) => fd(id).setSize(size),
    fd_sync: (id: number) => fd(id).sync(),
    fd_datasync: (id: number) =>
      rpc.call({ op: "datasync", fd: fd(id).handle }).errno,
    fd_seek(id: number, offset: bigint, whence: number, out: number) {
      memory.bytes(out, 8);
      const result = fd(id).seek(offset, whence);
      if (!result.errno) memory.u64(out, result.offset);
      return result.errno;
    },
    fd_tell(id: number, out: number) {
      memory.bytes(out, 8);
      const result = fd(id).tell();
      if (!result.errno) memory.u64(out, result.offset);
      return result.errno;
    },
    fd_prestat_get(id: number, out: number) {
      const target = memory.bytes(out, 8);
      const result = fd(id).getPrestat();
      if (result.prestat) {
        target.fill(0);
        memory.u32((out >>> 0) + 4, result.prestat.name.length);
      }
      return result.errno;
    },
    fd_prestat_dir_name(id: number, p: number, n: number) {
      const target = memory.bytes(p, n >>> 0),
        result = fd(id).getPrestat();
      if (!result.prestat) return result.errno;
      if (target.length < result.prestat.name.length)
        return WASI.ERRNO_NAMETOOLONG;
      target.set(result.prestat.name);
      return 0;
    },
    fd_readdir(id: number, p: number, n: number, cookie: bigint, out: number) {
      const target = memory.bytes(p, n >>> 0);
      memory.bytes(out, 4);
      const directory = fd(id);
      let used = 0;
      while (used < target.length) {
        const result = directory.readDirectoryEntry(cookie);
        if (result.errno) return result.errno;
        if (!result.dirent) break;
        const entry = result.dirent;
        const record = new Uint8Array(24 + entry.dir_name.length);
        const view = new DataView(record.buffer);
        view.setBigUint64(0, entry.d_next, true);
        view.setBigUint64(8, entry.d_ino, true);
        view.setUint32(16, entry.dir_name.length, true);
        view.setUint8(20, entry.d_type);
        record.set(entry.dir_name, 24);
        const length = Math.min(record.length, target.length - used);
        target.set(record.subarray(0, length), used);
        used += length;
        if (length < record.length) break;
        cookie = entry.d_next;
      }
      memory.u32(out, used);
      return 0;
    },
    path_open(
      id: number,
      flags: number,
      p: number,
      n: number,
      oflags: number,
      rights: bigint,
      inherited: bigint,
      fdflags: number,
      out: number,
    ) {
      memory.bytes(out, 4);
      const result = fd(id).open(
        flags,
        memory.path(p, n),
        oflags,
        rights,
        inherited,
        fdflags,
      );
      if (result.fd) {
        let slot = 0;
        while (fds.has(slot)) slot++;
        fds.set(slot, result.fd);
        memory.u32(out, slot);
      }
      return result.errno;
    },
    path_filestat_get(
      id: number,
      flags: number,
      p: number,
      n: number,
      out: number,
    ) {
      memory.bytes(out, 64);
      const result = fd(id).statAt(flags, memory.path(p, n));
      if (result.filestat) memory.filestat(out, result.filestat);
      return result.errno;
    },
    path_create_directory: (id: number, p: number, n: number) =>
      fd(id).mkdir(memory.path(p, n)),
    path_remove_directory: (id: number, p: number, n: number) =>
      fd(id).rmdir(memory.path(p, n)),
    path_unlink_file: (id: number, p: number, n: number) =>
      fd(id).unlink(memory.path(p, n)),
    path_readlink(
      id: number,
      p: number,
      n: number,
      output: number,
      size: number,
      out: number,
    ) {
      const target = memory.bytes(output, size >>> 0);
      memory.bytes(out, 4);
      const result = fd(id).readlink(memory.path(p, n), target.length);
      if (!result.errno) {
        target.set(result.data);
        memory.u32(out, result.data.length);
      }
      return result.errno;
    },
    path_rename: (
      oldfd: number,
      oldp: number,
      oldn: number,
      newfd: number,
      newp: number,
      newn: number,
    ) =>
      rpc.call({
        op: "rename",
        fd: fd(oldfd).handle,
        path: memory.path(oldp, oldn),
        targetFd: fd(newfd).handle,
        targetPath: memory.path(newp, newn),
      }).errno,
    path_link: (
      oldfd: number,
      flags: number,
      oldp: number,
      oldn: number,
      newfd: number,
      newp: number,
      newn: number,
    ) =>
      rpc.call({
        op: "link",
        fd: fd(oldfd).handle,
        path: memory.path(oldp, oldn),
        targetFd: fd(newfd).handle,
        targetPath: memory.path(newp, newn),
        flags,
      }).errno,
    path_symlink: (
      oldp: number,
      oldn: number,
      id: number,
      newp: number,
      newn: number,
    ) =>
      rpc.call({
        op: "symlink",
        fd: fd(id).handle,
        target: memory.path(oldp, oldn),
        path: memory.path(newp, newn),
      }).errno,
  };
}
