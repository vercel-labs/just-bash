import { createAdapterIo } from "./adapter-io.js";
import { limitModule } from "./module.js";
import { Rpc } from "./rpc.js";
import type { WasmAdapterContext } from "./types.js";
import { createWasiRuntime, runWasi } from "./wasi/runtime.js";
import type { WorkerInput, WorkerMessage } from "./worker-types.js";

/** Link only explicit own properties supplied by a trusted adapter. */
function importObject(
  module: WebAssembly.Module,
  imports: WebAssembly.Imports,
): WebAssembly.Imports {
  const selected: WebAssembly.Imports = Object.create(null);
  for (const entry of WebAssembly.Module.imports(module)) {
    if (!Object.hasOwn(imports, entry.module))
      throw new Error(`Missing WASM import module: ${entry.module}`);
    const namespace = imports[entry.module];
    if (!namespace || !Object.hasOwn(namespace, entry.name))
      throw new Error(`Missing WASM import: ${entry.module}.${entry.name}`);
    selected[entry.module] ??= Object.create(null);
    selected[entry.module][entry.name] = namespace[entry.name];
  }
  return selected;
}

export async function runWasm(
  input: WorkerInput,
  send: (message: WorkerMessage) => void,
): Promise<void> {
  if (!input.adapter) return runWasi(input, send);
  try {
    const bounded = limitModule(
      input.wasm,
      input.limits.maxMemoryBytes,
      input.limits.maxTableElements,
      "library",
    );
    const module = await WebAssembly.compile(bounded);
    const rpc = new Rpc(input.buffer, send, input.limits.timeoutMs);
    const io = createAdapterIo(input, rpc);
    const env = new Map(
      input.env.map((value) => {
        const equals = value.indexOf("=");
        return [value.slice(0, equals), value.slice(equals + 1)];
      }),
    );
    let instantiated = false;
    const context: WasmAdapterContext = Object.freeze({
      ...io,
      name: input.args[0],
      args: Object.freeze(input.args.slice(1)),
      cwd: input.cwd,
      env,
      limits: Object.freeze({ ...input.limits }),
      module,
      wasi: createWasiRuntime(input, rpc),
      async instantiate(imports: WebAssembly.Imports = Object.create(null)) {
        if (instantiated)
          throw new Error(
            "A WASM adapter may instantiate its module only once",
          );
        instantiated = true;
        return WebAssembly.instantiate(module, importObject(module, imports));
      },
    });
    // @banned-pattern-ignore: URL comes only from host registration, never guest input; adapters are trusted worker modules.
    const adapter = await import(input.adapter);
    if (typeof adapter.default !== "function")
      throw new TypeError("WASM adapter module must default-export a function");
    const result: unknown = await adapter.default(context);
    const exitCode = result === undefined ? 0 : result;
    if (
      typeof exitCode !== "number" ||
      !Number.isSafeInteger(exitCode) ||
      exitCode < 0 ||
      exitCode > 0xffffffff
    )
      throw new TypeError(
        "WASM adapter must return an unsigned 32-bit exit code or void",
      );
    send({ type: "done", exitCode });
  } catch (error) {
    send({
      type: "error",
      message: error instanceof Error ? error.message : "WASM execution failed",
    });
  }
}
