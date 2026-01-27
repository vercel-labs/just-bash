import { c as defineEventHandler } from "../../_libs/h3.mjs";
import { b as start, R as Run } from "../../_chunks/_libs/@workflow/core.mjs";
import "../../_libs/rou3.mjs";
import "../../_libs/srvx.mjs";
import "node:http";
import "node:stream";
import "node:https";
import "node:http2";
import "../../_chunks/_libs/@vercel/functions.mjs";
import "../../_chunks/_libs/@workflow/errors.mjs";
import "../../_chunks/_libs/@workflow/utils.mjs";
import "../../_chunks/_libs/ms.mjs";
import "node:fs/promises";
import "node:util";
import "node:child_process";
import "../../_chunks/_libs/@workflow/world.mjs";
import "../../_libs/zod.mjs";
import "../../_chunks/_libs/debug.mjs";
import "tty";
import "util";
import "../../_chunks/_libs/supports-color.mjs";
import "os";
import "../../_libs/has-flag.mjs";
import "../../_libs/ulid.mjs";
import "node:crypto";
import "node:module";
import "node:path";
import "../../_chunks/_libs/@workflow/world-local.mjs";
import "node:fs";
import "node:timers/promises";
import "../../_chunks/_libs/@vercel/queue.mjs";
import "../../_libs/mixpart.mjs";
import "../../_chunks/_libs/@vercel/oidc.mjs";
import "path";
import "fs";
import "../../_chunks/_libs/async-sema.mjs";
import "events";
import "../../_chunks/_libs/undici.mjs";
import "node:assert";
import "node:net";
import "node:buffer";
import "node:querystring";
import "node:events";
import "node:diagnostics_channel";
import "node:tls";
import "node:zlib";
import "node:perf_hooks";
import "node:util/types";
import "node:worker_threads";
import "node:url";
import "node:async_hooks";
import "node:console";
import "node:dns";
import "string_decoder";
import "../../_chunks/_libs/@workflow/world-vercel.mjs";
import "node:os";
import "../../_chunks/_libs/@workflow/serde.mjs";
import "../../_libs/devalue.mjs";
import "../../_chunks/_libs/@jridgewell/trace-mapping.mjs";
import "../../_chunks/_libs/@jridgewell/sourcemap-codec.mjs";
import "../../_chunks/_libs/@jridgewell/resolve-uri.mjs";
import "node:vm";
import "../../_libs/nanoid.mjs";
import "../../_libs/seedrandom.mjs";
async function serialBashWorkflow() {
  throw new Error("You attempted to execute workflow serialBashWorkflow function directly. To start a workflow, use start(serialBashWorkflow) from workflow/api");
}
serialBashWorkflow.workflowId = "workflow//workflows/bash-workflow.ts//serialBashWorkflow";
const bash_post = defineEventHandler(async () => {
  const { runId } = await start(serialBashWorkflow, []);
  const run = new Run(runId);
  const result = await run.returnValue;
  return {
    message: "Bash workflow completed",
    result
  };
});
export {
  bash_post as default
};
