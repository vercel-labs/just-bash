/**
 * InMemoryFsHandle - Opaque handle for InMemoryFs class in workflow environments.
 *
 * This class mirrors the InMemoryFs class's instance properties but provides
 * stub/empty method implementations. It is designed for use in workflow
 * environments where the actual filesystem operations are not needed, but the
 * type structure must match for serialization/deserialization.
 *
 * IMPORTANT: This file must be completely self-contained with NO imports
 * from other internal modules (except @workflow/serde) to avoid pulling
 * in transitive dependencies during workflow discovery.
 */

import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from '@workflow/serde';

// =============================================================================
// Inline Type Definitions
// =============================================================================

type FileContent = string | Uint8Array;

interface FileEntry {
  type: 'file';
  content: Uint8Array;
  mode: number;
  mtime: Date;
}

interface DirectoryEntry {
  type: 'directory';
  mode: number;
  mtime: Date;
}

interface SymlinkEntry {
  type: 'symlink';
  target: string;
  mode: number;
  mtime: Date;
}

type FsEntry = FileEntry | DirectoryEntry | SymlinkEntry;

interface FsStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
  mode: number;
  mtime: Date;
}

// =============================================================================
// InMemoryFs Opaque Handle Class
// =============================================================================

/**
 * InMemoryFs - Opaque handle class for workflow environments.
 *
 * This class has the same serialization interface as the real InMemoryFs class,
 * but all methods are stubs that throw errors or return empty results.
 * Use this in workflow code where you need type compatibility without
 * actual filesystem operations.
 */
export class InMemoryFs {
  private data: Map<string, FsEntry> = new Map();

  constructor() {
    // Create root directory
    this.data.set('/', { type: 'directory', mode: 0o755, mtime: new Date() });
  }

  /**
   * Serialize InMemoryFs instance for Workflow DevKit.
   * Format must match the real InMemoryFs class for cross-context compatibility.
   */
  static [WORKFLOW_SERIALIZE](instance: InMemoryFs) {
    return { data: instance.data };
  }

  /**
   * Deserialize InMemoryFs instance for Workflow DevKit.
   * Format must match the real InMemoryFs class for cross-context compatibility.
   */
  static [WORKFLOW_DESERIALIZE](serialized: {
    data: Map<string, FsEntry>;
  }): InMemoryFs {
    const fs = Object.create(InMemoryFs.prototype) as InMemoryFs;
    fs.data = serialized.data;
    return fs;
  }

  // =============================================================================
  // Stub Methods - All throw errors in workflow handle
  // =============================================================================

  resolvePath(_base: string, _path: string): string {
    throw new Error(
      'resolvePath() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async readFile(_path: string): Promise<string> {
    throw new Error(
      'readFile() cannot be called on workflow InMemoryFs handle.'
    );
  }

  readFileSync(_path: string, _encoding?: string): string | Uint8Array {
    throw new Error(
      'readFileSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async writeFile(_path: string, _content: FileContent): Promise<void> {
    throw new Error(
      'writeFile() cannot be called on workflow InMemoryFs handle.'
    );
  }

  writeFileSync(_path: string, _content: FileContent): void {
    throw new Error(
      'writeFileSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async appendFile(_path: string, _content: FileContent): Promise<void> {
    throw new Error(
      'appendFile() cannot be called on workflow InMemoryFs handle.'
    );
  }

  appendFileSync(_path: string, _content: FileContent): void {
    throw new Error(
      'appendFileSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async unlink(_path: string): Promise<void> {
    throw new Error('unlink() cannot be called on workflow InMemoryFs handle.');
  }

  unlinkSync(_path: string): void {
    throw new Error(
      'unlinkSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async mkdir(_path: string): Promise<void> {
    throw new Error('mkdir() cannot be called on workflow InMemoryFs handle.');
  }

  mkdirSync(_path: string): void {
    throw new Error(
      'mkdirSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async rmdir(_path: string): Promise<void> {
    throw new Error('rmdir() cannot be called on workflow InMemoryFs handle.');
  }

  rmdirSync(_path: string): void {
    throw new Error(
      'rmdirSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async rm(_path: string): Promise<void> {
    throw new Error('rm() cannot be called on workflow InMemoryFs handle.');
  }

  rmSync(_path: string): void {
    throw new Error('rmSync() cannot be called on workflow InMemoryFs handle.');
  }

  async readdir(_path: string): Promise<string[]> {
    throw new Error(
      'readdir() cannot be called on workflow InMemoryFs handle.'
    );
  }

  readdirSync(_path: string): string[] {
    throw new Error(
      'readdirSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async stat(_path: string): Promise<FsStat> {
    throw new Error('stat() cannot be called on workflow InMemoryFs handle.');
  }

  statSync(_path: string): FsStat {
    throw new Error(
      'statSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async lstat(_path: string): Promise<FsStat> {
    throw new Error('lstat() cannot be called on workflow InMemoryFs handle.');
  }

  lstatSync(_path: string): FsStat {
    throw new Error(
      'lstatSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async exists(_path: string): Promise<boolean> {
    throw new Error('exists() cannot be called on workflow InMemoryFs handle.');
  }

  existsSync(_path: string): boolean {
    throw new Error(
      'existsSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async rename(_oldPath: string, _newPath: string): Promise<void> {
    throw new Error('rename() cannot be called on workflow InMemoryFs handle.');
  }

  renameSync(_oldPath: string, _newPath: string): void {
    throw new Error(
      'renameSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async cp(_src: string, _dest: string): Promise<void> {
    throw new Error('cp() cannot be called on workflow InMemoryFs handle.');
  }

  cpSync(_src: string, _dest: string): void {
    throw new Error('cpSync() cannot be called on workflow InMemoryFs handle.');
  }

  async symlink(_target: string, _path: string): Promise<void> {
    throw new Error(
      'symlink() cannot be called on workflow InMemoryFs handle.'
    );
  }

  symlinkSync(_target: string, _path: string): void {
    throw new Error(
      'symlinkSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async readlink(_path: string): Promise<string> {
    throw new Error(
      'readlink() cannot be called on workflow InMemoryFs handle.'
    );
  }

  readlinkSync(_path: string): string {
    throw new Error(
      'readlinkSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async realpath(_path: string): Promise<string> {
    throw new Error(
      'realpath() cannot be called on workflow InMemoryFs handle.'
    );
  }

  realpathSync(_path: string): string {
    throw new Error(
      'realpathSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async chmod(_path: string, _mode: number): Promise<void> {
    throw new Error('chmod() cannot be called on workflow InMemoryFs handle.');
  }

  chmodSync(_path: string, _mode: number): void {
    throw new Error(
      'chmodSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async truncate(_path: string, _len?: number): Promise<void> {
    throw new Error(
      'truncate() cannot be called on workflow InMemoryFs handle.'
    );
  }

  truncateSync(_path: string, _len?: number): void {
    throw new Error(
      'truncateSync() cannot be called on workflow InMemoryFs handle.'
    );
  }

  async utimes(_path: string, _atime: Date, _mtime: Date): Promise<void> {
    throw new Error('utimes() cannot be called on workflow InMemoryFs handle.');
  }

  utimesSync(_path: string, _atime: Date, _mtime: Date): void {
    throw new Error(
      'utimesSync() cannot be called on workflow InMemoryFs handle.'
    );
  }
}
