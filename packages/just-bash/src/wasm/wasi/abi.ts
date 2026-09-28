/** WASI Preview 1 ABI values (wasi_snapshot_preview1 / legacy witx). */
export const ERRNO_ACCES = 2;
export const ERRNO_AGAIN = 6;
export const ERRNO_BADF = 8;
export const ERRNO_BUSY = 10;
export const ERRNO_CANCELED = 11;
export const ERRNO_EXIST = 20;
export const ERRNO_FAULT = 21;
export const ERRNO_FBIG = 22;
export const ERRNO_ILSEQ = 25;
export const ERRNO_INVAL = 28;
export const ERRNO_IO = 29;
export const ERRNO_ISDIR = 31;
export const ERRNO_LOOP = 32;
export const ERRNO_MFILE = 33;
export const ERRNO_NAMETOOLONG = 37;
export const ERRNO_NOENT = 44;
export const ERRNO_NOSPC = 51;
export const ERRNO_NOTDIR = 54;
export const ERRNO_NOTEMPTY = 55;
export const ERRNO_NOTSUP = 58;
export const ERRNO_PERM = 63;
export const ERRNO_ROFS = 69;
export const ERRNO_SPIPE = 70;
export const ERRNO_XDEV = 75;
export const ERRNO_NOTCAPABLE = 76;

export const RIGHTS_FD_DATASYNC: number = 1 << 0;
export const RIGHTS_FD_READ: number = 1 << 1;
export const RIGHTS_FD_SEEK: number = 1 << 2;
export const RIGHTS_FD_FDSTAT_SET_FLAGS: number = 1 << 3;
export const RIGHTS_FD_SYNC: number = 1 << 4;
export const RIGHTS_FD_TELL: number = 1 << 5;
export const RIGHTS_FD_WRITE: number = 1 << 6;
export const RIGHTS_PATH_CREATE_DIRECTORY: number = 1 << 9;
export const RIGHTS_PATH_CREATE_FILE: number = 1 << 10;
export const RIGHTS_PATH_LINK_SOURCE: number = 1 << 11;
export const RIGHTS_PATH_LINK_TARGET: number = 1 << 12;
export const RIGHTS_PATH_OPEN: number = 1 << 13;
export const RIGHTS_FD_READDIR: number = 1 << 14;
export const RIGHTS_PATH_READLINK: number = 1 << 15;
export const RIGHTS_PATH_RENAME_SOURCE: number = 1 << 16;
export const RIGHTS_PATH_RENAME_TARGET: number = 1 << 17;
export const RIGHTS_PATH_FILESTAT_GET: number = 1 << 18;
export const RIGHTS_PATH_FILESTAT_SET_SIZE: number = 1 << 19;
export const RIGHTS_FD_FILESTAT_GET: number = 1 << 21;
export const RIGHTS_FD_FILESTAT_SET_SIZE: number = 1 << 22;
export const RIGHTS_PATH_SYMLINK: number = 1 << 24;
export const RIGHTS_PATH_REMOVE_DIRECTORY: number = 1 << 25;
export const RIGHTS_PATH_UNLINK_FILE: number = 1 << 26;

export const FILETYPE_UNKNOWN = 0;
export const FILETYPE_CHARACTER_DEVICE = 2;
export const FILETYPE_DIRECTORY = 3;
export const FILETYPE_REGULAR_FILE = 4;
export const FILETYPE_SYMBOLIC_LINK = 7;
export const FDFLAGS_APPEND = 1;
export const OFLAGS_CREAT = 1;
export const OFLAGS_DIRECTORY = 2;
export const OFLAGS_EXCL = 4;
export const OFLAGS_TRUNC = 8;

export interface Filestat {
  dev: bigint;
  ino: bigint;
  filetype: number;
  nlink: bigint;
  size: bigint;
  atim: bigint;
  mtim: bigint;
  ctim: bigint;
}

export interface Fdstat {
  fs_filetype: number;
  fs_flags: number;
  fs_rights_base: bigint;
  fs_rights_inherited: bigint;
}

export interface Dirent {
  d_next: bigint;
  d_ino: bigint;
  d_type: number;
  dir_name: Uint8Array;
}

export interface Prestat {
  name: Uint8Array;
}
