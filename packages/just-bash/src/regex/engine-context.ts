// Which RegexEngine the current execution uses. `Bash.exec` runs the script
// inside `runWithRegexEngine`, and every UserRegex created underneath — from
// grep down to awk's field splitter — resolves the engine from here, so no
// call site has to thread it. Outside any execution, and in the browser build
// (which has no AsyncLocalStorage), the default engine applies.

import * as nodeAsyncHooks from "node:async_hooks";
import type { RegexEngine } from "./engine.js";
import { re2jsEngine } from "./re2js-engine.js";

declare const __BROWSER__: boolean | undefined;
const IS_BROWSER = typeof __BROWSER__ !== "undefined" && __BROWSER__;

type EngineStorage = {
  run<R>(store: RegexEngine, callback: () => R): R;
  getStore(): RegexEngine | undefined;
};

let engineStorage: EngineStorage | null = null;
if (!IS_BROWSER) {
  try {
    engineStorage = new nodeAsyncHooks.AsyncLocalStorage<RegexEngine>();
  } catch {
    // Not available (edge runtimes, restricted environments)
  }
}

export function supportsRegexEngineOption(): boolean {
  return engineStorage !== null;
}

export function currentRegexEngine(): RegexEngine {
  return engineStorage?.getStore() ?? re2jsEngine;
}

export function runWithRegexEngine<R>(
  engine: RegexEngine | undefined,
  fn: () => R,
): R {
  if (!engine) {
    return fn();
  }
  if (!engineStorage) {
    throw new Error(
      "regexEngine requires AsyncLocalStorage, which this runtime does not provide",
    );
  }
  return engineStorage.run(engine, fn);
}
