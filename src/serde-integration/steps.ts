/**
 * Step functions for serde integration tests.
 *
 * Steps serialize/deserialize Bash instances explicitly using toJSON()/fromJSON().
 * The serialized form (SerializedBash) uses only devalue-compatible types
 * (Map, Date, Uint8Array, plain objects), so it flows natively through the
 * workflow runtime without needing WORKFLOW_SERIALIZE/WORKFLOW_DESERIALIZE
 * in the workflow sandbox.
 *
 * All imports are dynamic to avoid pulling Node.js modules into the workflow bundle.
 */

// ---------------------------------------------------------------------------
// Helpers to load Bash/InMemoryFs without static import analysis.
// The @vite-ignore comment prevents esbuild/vite from resolving these
// dynamic imports during the workflow bundle build, which would pull
// Node.js-dependent code into the workflow sandbox.
// ---------------------------------------------------------------------------
// Import just-bash by package name (self-reference via package.json exports).
// The @vite-ignore comment prevents esbuild from statically resolving this
// during the workflow bundle build (which would pull Node.js code into the sandbox).
// At runtime, Node.js resolves "just-bash" via the package.json exports field,
// which points to the built bundle in dist/.
const PKG = "just-bash";

async function loadBash() {
  return (await import(/* @vite-ignore */ PKG)).Bash;
}
async function loadInMemoryFs() {
  return (await import(/* @vite-ignore */ PKG)).InMemoryFs;
}

// ---------------------------------------------------------------------------
// Create + serialize steps
// ---------------------------------------------------------------------------

export async function createAndSerializeBash(options: {
  files?: Record<string, string>;
  env?: Record<string, string>;
  cwd?: string;
  maxCommandCount?: number;
  processInfo?: { pid: number; ppid: number; uid: number; gid: number };
}) {
  "use step";
  const Bash = await loadBash();
  const bash = new Bash({
    files: options.files,
    env: options.env,
    cwd: options.cwd,
    executionLimits: options.maxCommandCount
      ? { maxCommandCount: options.maxCommandCount }
      : undefined,
    processInfo: options.processInfo,
  });
  return bash.toJSON();
}

export async function createAndSerializeInMemoryFs(
  files: Record<string, string>,
) {
  "use step";
  const InMemoryFs = await loadInMemoryFs();
  const fs = new InMemoryFs(files);
  return fs.toJSON();
}

export async function createInMemoryFsWithBinaryAndSerialize(
  path: string,
  data: Uint8Array,
) {
  "use step";
  const InMemoryFs = await loadInMemoryFs();
  const fs = new InMemoryFs();
  await fs.writeFile(path, data);
  return fs.toJSON();
}

// ---------------------------------------------------------------------------
// Deserialize + operate steps
// ---------------------------------------------------------------------------

export async function deserializeAndExec(
  serialized: SerializedBash,
  script: string,
) {
  "use step";
  const Bash = await loadBash();
  const bash = Bash.fromJSON(serialized);
  const result = await bash.exec(script);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

export async function deserializeExecAndReserialize(
  serialized: any,
  script: string,
) {
  "use step";
  const Bash = await loadBash();
  const bash = Bash.fromJSON(serialized);
  const result = await bash.exec(script);
  return {
    result: { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
    serialized: bash.toJSON(),
  };
}

export async function deserializeFsAndRead(
  serialized: SerializedInMemoryFs,
  path: string,
) {
  "use step";
  const InMemoryFs = await loadInMemoryFs();
  const fs = InMemoryFs.fromJSON(serialized);
  return fs.readFile(path);
}
