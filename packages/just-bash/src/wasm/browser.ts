import type { Command } from "../types.js";
import { createWasmCommand } from "./command.js";
import type { WasiCommandOptions, WasmCommandOptions } from "./types.js";
import type { WorkerMessage } from "./worker-types.js";

export type { WasiCommandOptions } from "./types.js";

/** Browser runner. Requires workers and SharedArrayBuffer (COOP/COEP). */
export function defineWasiCommand(
  name: string,
  options: WasiCommandOptions,
): Command {
  return defineWasmCommand(name, { ...options, adapter: "wasi" });
}

/** Browser WASM runner with optional trusted module adapters. */
export function defineWasmCommand(
  name: string,
  options: WasmCommandOptions,
): Command {
  return createWasmCommand(name, options, (settings) => {
    const worker = new Worker(
      settings.workerUrl ??
        new URL("./wasm-worker.browser.js", import.meta.url),
      { type: "module" },
    );
    return {
      postMessage(input) {
        worker.postMessage(input, [input.wasm.buffer]);
      },
      listen(message, error) {
        const receive = (event: MessageEvent<WorkerMessage>): void =>
          message(event.data);
        worker.addEventListener("message", receive);
        worker.addEventListener("error", error);
        worker.addEventListener("messageerror", error);
        return () => {
          worker.removeEventListener("message", receive);
          worker.removeEventListener("error", error);
          worker.removeEventListener("messageerror", error);
        };
      },
      async terminate() {
        worker.terminate();
      },
    };
  });
}
