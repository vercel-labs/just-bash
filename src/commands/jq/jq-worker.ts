/**
 * Worker thread for executing jq-web with timeout protection.
 * This allows us to terminate long-running jq operations.
 */

import { parentPort } from "node:worker_threads";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface WorkerMessage {
  input: string;
  filter: string;
  flags: string[];
}

interface WorkerResult {
  success: true;
  output: string;
  exitCode: number;
}

interface WorkerError {
  success: false;
  error: string;
  exitCode: number;
  stderr?: string;
}

if (!parentPort) {
  throw new Error("This file must be run as a worker thread");
}

parentPort.on("message", async (message: WorkerMessage) => {
  try {
    const jqPromise: Promise<any> = require("jq-web");
    const jq = await jqPromise;

    try {
      const output = jq.raw(message.input, message.filter, message.flags);
      const result: WorkerResult = {
        success: true,
        output,
        exitCode: 0,
      };
      parentPort!.postMessage(result);
    } catch (e: any) {
      const error: WorkerError = {
        success: false,
        error: e.message,
        exitCode: e.exitCode || 3,
        stderr: e.stderr,
      };
      parentPort!.postMessage(error);
    }
  } catch (e: any) {
    const error: WorkerError = {
      success: false,
      error: e.message,
      exitCode: 1,
    };
    parentPort!.postMessage(error);
  }
});

// Made with Bob
