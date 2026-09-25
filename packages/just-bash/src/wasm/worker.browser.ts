import { runWasm } from "./worker-runtime.js";
import type { WorkerInput, WorkerMessage } from "./worker-types.js";

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerInput>) => void) | null;
  postMessage(message: WorkerMessage): void;
};
scope.onmessage = (event) => {
  scope.onmessage = null;
  void runWasm(event.data, (message) => scope.postMessage(message));
};
