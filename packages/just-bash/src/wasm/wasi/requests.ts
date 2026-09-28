/** Descriptor operations accepted by the host. Guest pointers never cross this boundary. */
export type WasiOperation = { fd: number } & (
  | { op: "close" | "stat" | "fdstat" | "tell" | "sync" | "datasync" }
  | { op: "read"; size: number; offset?: number }
  | { op: "write"; data: Uint8Array; offset?: number }
  | {
      op: "open";
      path: string;
      lookupFlags: number;
      openFlags: number;
      rights: string;
      inheritingRights: string;
      flags: number;
    }
  | { op: "flags"; flags: number }
  | { op: "rights"; rights: string; inheritingRights: string }
  | { op: "seek"; offset: string; whence: number }
  | { op: "resize"; size: number }
  | { op: "readdir"; cookie: number }
  | { op: "pathstat"; path: string; flags: number }
  | { op: "mkdir" | "unlink" | "rmdir"; path: string }
  | { op: "readlink"; path: string; size: number }
  | { op: "symlink"; target: string; path: string }
  | { op: "rename"; path: string; targetFd: number; targetPath: string }
  | {
      op: "link";
      path: string;
      targetFd: number;
      targetPath: string;
      flags: number;
    }
);

export type WasiRequest = WasiOperation & { type: "request" };
