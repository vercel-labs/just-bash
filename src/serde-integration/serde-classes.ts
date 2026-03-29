/**
 * Serde class registration for the workflow builder.
 *
 * Detected by the builder via regex on `@workflow/serde` import and
 * `[WORKFLOW_SERIALIZE]`/`[WORKFLOW_DESERIALIZE]` patterns.
 *
 * Registers proxy classes for the workflow sandbox, and overwrites them with
 * real classes in the step bundle. The `loadRealClasses` promise is awaited
 * by step functions before they execute, ensuring the registry has the real
 * classes before any serialization/deserialization occurs.
 */
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";

const REGISTRY_KEY = Symbol.for("workflow-class-registry");

function getRegistry(): Map<string, unknown> {
  const g = globalThis as Record<symbol, unknown>;
  let registry = g[REGISTRY_KEY] as Map<string, unknown> | undefined;
  if (!registry) {
    registry = new Map();
    g[REGISTRY_KEY] = registry;
  }
  return registry;
}

// --- Proxy classes for the workflow sandbox ---

class BashProxy {
  static classId = "just-bash/Bash";
  constructor(public _serdeData: Record<string, unknown>) {}
  // biome-ignore lint/suspicious/noExplicitAny: serde interface requires any
  static [WORKFLOW_SERIALIZE](instance: any): unknown {
    if (instance instanceof BashProxy) return instance._serdeData;
    if (typeof instance.toJSON === "function") return instance.toJSON();
    return instance;
  }
  static [WORKFLOW_DESERIALIZE](data: unknown): BashProxy {
    return new BashProxy(data as Record<string, unknown>);
  }
}

class InMemoryFsProxy {
  static classId = "just-bash/InMemoryFs";
  constructor(public _serdeData: Record<string, unknown>) {}
  // biome-ignore lint/suspicious/noExplicitAny: serde interface requires any
  static [WORKFLOW_SERIALIZE](instance: any): unknown {
    if (instance instanceof InMemoryFsProxy) return instance._serdeData;
    if (typeof instance.toJSON === "function") return instance.toJSON();
    return instance;
  }
  static [WORKFLOW_DESERIALIZE](data: unknown): InMemoryFsProxy {
    return new InMemoryFsProxy(data as Record<string, unknown>);
  }
}

// Register proxies first.
getRegistry().set("just-bash/Bash", BashProxy);
getRegistry().set("just-bash/InMemoryFs", InMemoryFsProxy);

// In the step bundle, load real classes via import() (same mechanism step
// functions use, ensuring same module identity). Export the promise so step
// functions can await it before executing.
const PKG = "just-bash";

// In the step bundle, load real classes via async import() and overwrite proxies.
// This uses the same import() mechanism as step functions, ensuring same module
// identity. The IIFE completes before any step deserializes arguments because
// the step bundle loads before the runtime processes step invocations.
(async () => {
  try {
    // @banned-pattern-ignore: PKG is a constant string "just-bash", not user input
    const mod = await import(/* @vite-ignore */ PKG);
    if (mod.Bash) getRegistry().set("just-bash/Bash", mod.Bash);
    if (mod.InMemoryFs)
      getRegistry().set("just-bash/InMemoryFs", mod.InMemoryFs);
  } catch {
    // In the workflow bundle, import fails — proxies stay registered.
  }
})();
