import { parentPort } from "node:worker_threads";
import { runWasm } from "./worker-runtime.js";
import type { WorkerInput } from "./worker-types.js";

const port = parentPort;
if (!port) throw new Error("WASI runner requires a worker");
port.once("message", (input: WorkerInput) => {
  void runWasm(input, (message) => port.postMessage(message));
});
