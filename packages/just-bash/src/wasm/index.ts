import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { DefenseInDepthBox } from "../security/defense-in-depth-box.js";
import type { Command } from "../types.js";
import { createWasmCommand } from "./command.js";
import type { WasiCommandOptions, WasmCommandOptions } from "./types.js";

export type { WasiCommandOptions } from "./types.js";

/** Register a host-supplied WASI Preview 1 binary as a virtual shell command. */
export function defineWasiCommand(
  name: string,
  options: WasiCommandOptions,
): Command {
  return defineWasmCommand(name, { ...options, adapter: "wasi" });
}

/** Register a WASI command or a core WASM library with a trusted adapter. */
export function defineWasmCommand(
  name: string,
  options: WasmCommandOptions,
): Command {
  return createWasmCommand(name, options, (settings) => {
    if (
      settings.adapter &&
      new URL(String(settings.adapter)).protocol !== "file:"
    )
      throw new TypeError(
        "Node WASM adapters must use a local file: module URL",
      );
    const directory =
      typeof __dirname === "string"
        ? __dirname
        : dirname(fileURLToPath(import.meta.url));
    const worker = DefenseInDepthBox.runTrusted(
      () =>
        // This is a Node worker shipped beside the bundle. Construct it at
        // runtime so server bundlers do not mistake it for a browser worker asset.
        Reflect.construct(Worker, [
          join(directory, "wasm-worker.js"),
          {
            // Worker inherits no process environment or per-worker Node/loader options.
            env: Object.create(null),
            execArgv: [],
            resourceLimits: {
              maxOldGenerationSizeMb: 128,
              maxYoungGenerationSizeMb: 16,
              stackSizeMb: 4,
            },
          },
        ]) as Worker,
    );
    return {
      postMessage(input) {
        worker.postMessage(input, [input.wasm.buffer]);
      },
      listen(message, error) {
        worker.on("message", message);
        worker.on("error", error);
        worker.on("exit", error);
        return () => {
          worker.off("message", message);
          worker.off("error", error);
          worker.off("exit", error);
        };
      },
      async terminate() {
        await worker.terminate();
      },
    };
  });
}
