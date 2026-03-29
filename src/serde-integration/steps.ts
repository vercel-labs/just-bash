/**
 * Step functions for serde integration tests.
 *
 * Steps accept and return Bash/InMemoryFs instances directly. The workflow
 * runtime automatically calls WORKFLOW_SERIALIZE/WORKFLOW_DESERIALIZE at step
 * boundaries — no manual toJSON()/fromJSON() needed.
 *
 * Bash/InMemoryFs are loaded via @vite-ignore dynamic imports to prevent
 * esbuild from pulling Node.js deps into the workflow bundle.
 */

const PKG = "just-bash";

/**
 * Register a class in the workflow serialization registry so the deserializer
 * can reconstruct instances by classId. Uses the same Symbol.for key as
 * @workflow/core's registerSerializationClass.
 */
function ensureSerdeRegistered(cls: { classId?: string }): void {
  if (!cls.classId) return;
  const registry: Map<string, unknown> =
    ((globalThis as Record<symbol, unknown>)[
      Symbol.for("workflow-class-registry")
    ] as Map<string, unknown>) ??
    (() => {
      const m = new Map<string, unknown>();
      (globalThis as Record<symbol, unknown>)[
        Symbol.for("workflow-class-registry")
      ] = m;
      return m;
    })();
  if (!registry.has(cls.classId)) {
    registry.set(cls.classId, cls);
  }
}

async function loadBash() {
  // @banned-pattern-ignore: PKG is a constant string "just-bash", not user input
  const Bash = (await import(/* @vite-ignore */ PKG)).Bash;
  ensureSerdeRegistered(Bash);
  return Bash;
}
async function loadInMemoryFs() {
  // @banned-pattern-ignore: PKG is a constant string "just-bash", not user input
  const InMemoryFs = (await import(/* @vite-ignore */ PKG)).InMemoryFs;
  ensureSerdeRegistered(InMemoryFs);
  return InMemoryFs;
}

// ---------------------------------------------------------------------------
// Bash creation steps
// ---------------------------------------------------------------------------

export async function createBasicBash() {
  "use step";
  const Bash = await loadBash();
  return new Bash({
    files: { "/home/user/test.txt": "hello from workflow" },
    env: { WF_VAR: "workflow-value" },
    cwd: "/home/user",
  });
}

export async function createBashWithCwd(cwd: string) {
  "use step";
  const Bash = await loadBash();
  return new Bash({ cwd });
}

export async function createBashWithEnv(env: Record<string, string>) {
  "use step";
  const Bash = await loadBash();
  return new Bash({ env });
}

export async function createBashWithLimits(maxCommandCount: number) {
  "use step";
  const Bash = await loadBash();
  return new Bash({ executionLimits: { maxCommandCount } });
}

export async function createBashWithProcessInfo(info: {
  pid: number;
  ppid: number;
  uid: number;
  gid: number;
}) {
  "use step";
  const Bash = await loadBash();
  return new Bash({ processInfo: info });
}

export async function createDefaultBash() {
  "use step";
  const Bash = await loadBash();
  return new Bash();
}

export async function createInMemoryFs(files: Record<string, string>) {
  "use step";
  const InMemoryFs = await loadInMemoryFs();
  return new InMemoryFs(files);
}

export async function createInMemoryFsWithBinary(
  path: string,
  data: Uint8Array,
) {
  "use step";
  const InMemoryFs = await loadInMemoryFs();
  const fs = new InMemoryFs();
  await fs.writeFile(path, data);
  return fs;
}

// ---------------------------------------------------------------------------
// Bash operation steps — Bash instance arrives via implicit serde
// ---------------------------------------------------------------------------

/**
 * Hydrate a Bash-like object received from the workflow. It may be a real
 * Bash instance (if serde resolved correctly) or a BashProxy with _serdeData
 * (if the workflow sandbox deserialized it as a proxy). In either case, return
 * a real Bash instance.
 */
async function hydrateBash(bash: unknown) {
  const Bash = await loadBash();
  // Already a real Bash — return as-is
  if (bash instanceof Bash) return bash;
  // BashProxy from the workflow sandbox — reconstruct from serialized data
  const proxy = bash as { _serdeData?: Record<string, unknown> };
  if (proxy._serdeData) return Bash.fromJSON(proxy._serdeData);
  // Unknown shape — try fromJSON on the raw data
  return Bash.fromJSON(bash);
}

async function hydrateInMemoryFs(fs: unknown) {
  const InMemoryFs = await loadInMemoryFs();
  if (fs instanceof InMemoryFs) return fs;
  const proxy = fs as { _serdeData?: Record<string, unknown> };
  if (proxy._serdeData) return InMemoryFs.fromJSON(proxy._serdeData);
  return InMemoryFs.fromJSON(fs);
}

export async function execInBash(bash: unknown, script: string) {
  "use step";
  const b = await hydrateBash(bash);
  const result = await b.exec(script);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

export async function execAndReturnBash(bash: unknown, script: string) {
  "use step";
  const b = await hydrateBash(bash);
  const result = await b.exec(script);
  return {
    bash: b,
    result: {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    },
  };
}

// ---------------------------------------------------------------------------
// InMemoryFs operation steps
// ---------------------------------------------------------------------------

export async function readFsContent(fs: unknown, path: string) {
  "use step";
  const f = await hydrateInMemoryFs(fs);
  return f.readFile(path);
}
