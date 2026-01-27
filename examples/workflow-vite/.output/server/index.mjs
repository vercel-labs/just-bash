globalThis.__nitro_main__ = import.meta.url;
import { N as NodeResponse, s as serve } from "./_libs/srvx.mjs";
import { d as defineHandler, H as HTTPError, t as toEventHandler, a as defineLazyEventHandler, b as H3Core } from "./_libs/h3.mjs";
import { r as resumeWebhook, a as registerStepFunction, s as stepEntrypoint, w as workflowEntrypoint } from "./_chunks/_libs/@workflow/core.mjs";
import { P as Pe } from "./_libs/just-bash.mjs";
import { d as decodePath, w as withLeadingSlash, a as withoutTrailingSlash, j as joinURL } from "./_libs/ufo.mjs";
import { promises } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import "node:http";
import "node:stream";
import "node:https";
import "node:http2";
import "./_libs/rou3.mjs";
import "./_chunks/_libs/@vercel/functions.mjs";
import "./_chunks/_libs/@workflow/errors.mjs";
import "./_chunks/_libs/@workflow/utils.mjs";
import "./_chunks/_libs/ms.mjs";
import "node:fs/promises";
import "node:util";
import "node:child_process";
import "./_chunks/_libs/@workflow/world.mjs";
import "./_libs/zod.mjs";
import "./_chunks/_libs/debug.mjs";
import "tty";
import "util";
import "./_chunks/_libs/supports-color.mjs";
import "os";
import "./_libs/has-flag.mjs";
import "./_libs/ulid.mjs";
import "node:crypto";
import "node:module";
import "./_chunks/_libs/@workflow/world-local.mjs";
import "node:timers/promises";
import "./_chunks/_libs/@vercel/queue.mjs";
import "./_libs/mixpart.mjs";
import "./_chunks/_libs/@vercel/oidc.mjs";
import "path";
import "fs";
import "./_chunks/_libs/async-sema.mjs";
import "events";
import "./_chunks/_libs/undici.mjs";
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
import "node:async_hooks";
import "node:console";
import "node:dns";
import "string_decoder";
import "./_chunks/_libs/@workflow/world-vercel.mjs";
import "node:os";
import "./_chunks/_libs/@workflow/serde.mjs";
import "./_libs/devalue.mjs";
import "./_chunks/_libs/@jridgewell/trace-mapping.mjs";
import "./_chunks/_libs/@jridgewell/sourcemap-codec.mjs";
import "./_chunks/_libs/@jridgewell/resolve-uri.mjs";
import "node:vm";
import "./_libs/nanoid.mjs";
import "./_libs/seedrandom.mjs";
import "./_libs/sprintf-js.mjs";
import "./_libs/minimatch.mjs";
import "./_chunks/_libs/@isaacs/brace-expansion.mjs";
import "./_chunks/_libs/@isaacs/balanced-match.mjs";
import "./_libs/diff.mjs";
import "./_libs/turndown.mjs";
import "./_chunks/_libs/@mongodb-js/zstd.mjs";
import "util/types";
import "./_libs/compressjs.mjs";
import "./_libs/amdefine.mjs";
import "./_chunks/_libs/sql.js.mjs";
import "crypto";
const services = {};
globalThis.__nitro_vite_envs__ = services;
const errorHandler$1 = (error, event) => {
  const res = defaultHandler(error, event);
  return new NodeResponse(typeof res.body === "string" ? res.body : JSON.stringify(res.body, null, 2), res);
};
function defaultHandler(error, event, opts) {
  const isSensitive = error.unhandled;
  const status = error.status || 500;
  const url = event.url || new URL(event.req.url);
  if (status === 404) {
    const baseURL = "/";
    if (/^\/[^/]/.test(baseURL) && !url.pathname.startsWith(baseURL)) {
      const redirectTo = `${baseURL}${url.pathname.slice(1)}${url.search}`;
      return {
        status: 302,
        statusText: "Found",
        headers: { location: redirectTo },
        body: `Redirecting...`
      };
    }
  }
  if (isSensitive && !opts?.silent) {
    const tags = [error.unhandled && "[unhandled]"].filter(Boolean).join(" ");
    console.error(`[request error] ${tags} [${event.req.method}] ${url}
`, error);
  }
  const headers = {
    "content-type": "application/json",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "script-src 'none'; frame-ancestors 'none';"
  };
  if (status === 404 || !event.res.headers.has("cache-control")) {
    headers["cache-control"] = "no-cache";
  }
  const body = {
    error: true,
    url: url.href,
    status,
    statusText: error.statusText,
    message: isSensitive ? "Server Error" : error.message,
    data: isSensitive ? void 0 : error.data
  };
  return {
    status,
    statusText: error.statusText,
    headers,
    body
  };
}
const errorHandlers = [errorHandler$1];
async function errorHandler(error, event) {
  for (const handler2 of errorHandlers) {
    try {
      const response = await handler2(error, event, { defaultHandler });
      if (response) {
        return response;
      }
    } catch (error2) {
      console.error(error2);
    }
  }
}
async function handler(request) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/");
  const token = decodeURIComponent(pathParts[pathParts.length - 1]);
  if (!token) {
    return new Response("Missing token", { status: 400 });
  }
  try {
    const response = await resumeWebhook(token, request);
    return response;
  } catch (error) {
    console.error("Error during resumeWebhook", error);
    return new Response(null, { status: 404 });
  }
}
const POST$1 = handler;
const _n9RDGO = async ({ req }) => {
  try {
    return await POST$1(req);
  } catch (error) {
    console.error("Handler error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
async function __builtin_response_array_buffer(res) {
  return res.arrayBuffer();
}
__name(__builtin_response_array_buffer, "__builtin_response_array_buffer");
async function __builtin_response_json(res) {
  return res.json();
}
__name(__builtin_response_json, "__builtin_response_json");
async function __builtin_response_text(res) {
  return res.text();
}
__name(__builtin_response_text, "__builtin_response_text");
registerStepFunction("__builtin_response_array_buffer", __builtin_response_array_buffer);
registerStepFunction("__builtin_response_json", __builtin_response_json);
registerStepFunction("__builtin_response_text", __builtin_response_text);
async function serialBashWorkflow() {
  throw new Error("You attempted to execute workflow serialBashWorkflow function directly. To start a workflow, use start(serialBashWorkflow) from workflow/api");
}
__name(serialBashWorkflow, "serialBashWorkflow");
serialBashWorkflow.workflowId = "workflow//workflows/bash-workflow.ts//serialBashWorkflow";
async function createBash() {
  const bash = new Pe();
  await bash.exec("mkdir -p /data");
  await bash.exec('echo "created" > /data/log.txt');
  console.log("Created Bash instance with /data/log.txt");
  return bash;
}
__name(createBash, "createBash");
async function appendToLog(bash, label) {
  await bash.exec(`echo "${label}: modified" >> /data/log.txt`);
  console.log(`Appended ${label} to log`);
  return bash;
}
__name(appendToLog, "appendToLog");
async function getResults(bash) {
  const result = await bash.exec("cat /data/log.txt");
  console.log("Read final results");
  return {
    log: result.stdout
  };
}
__name(getResults, "getResults");
registerStepFunction("step//workflows/bash-workflow.ts//createBash", createBash);
registerStepFunction("step//workflows/bash-workflow.ts//appendToLog", appendToLog);
registerStepFunction("step//workflows/bash-workflow.ts//getResults", getResults);
const _g3m8Xw = async ({ req }) => {
  try {
    return await stepEntrypoint(req);
  } catch (error) {
    console.error("Handler error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};
const workflowCode = `globalThis.__private_workflows = new Map();
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// workflows/bash-workflow.ts
async function serialBashWorkflow() {
  let bash = await createBash();
  bash = await appendToLog(bash, "step2");
  bash = await appendToLog(bash, "step3");
  bash = await appendToLog(bash, "step4");
  return await getResults(bash);
}
__name(serialBashWorkflow, "serialBashWorkflow");
serialBashWorkflow.workflowId = "workflow//workflows/bash-workflow.ts//serialBashWorkflow";
globalThis.__private_workflows.set("workflow//workflows/bash-workflow.ts//serialBashWorkflow", serialBashWorkflow);
var createBash = globalThis[Symbol.for("WORKFLOW_USE_STEP")]("step//workflows/bash-workflow.ts//createBash");
var appendToLog = globalThis[Symbol.for("WORKFLOW_USE_STEP")]("step//workflows/bash-workflow.ts//appendToLog");
var getResults = globalThis[Symbol.for("WORKFLOW_USE_STEP")]("step//workflows/bash-workflow.ts//getResults");
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsid29ya2Zsb3dzL2Jhc2gtd29ya2Zsb3cudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8qKlxuICogQmFzaCBXb3JrZmxvdyBFeGFtcGxlXG4gKlxuICogRGVtb25zdHJhdGVzIHVzaW5nIGp1c3QtYmFzaCB3aXRoIFdvcmtmbG93IERldktpdCdzIHNlcmlhbGl6YXRpb24uXG4gKiBUaGUgQmFzaCBpbnN0YW5jZSBpcyBzZXJpYWxpemVkIGJldHdlZW4gc3RlcHMsIHByZXNlcnZpbmcgZmlsZXN5c3RlbSBzdGF0ZS5cbiAqLyAvKipfX2ludGVybmFsX3dvcmtmbG93c3tcIndvcmtmbG93c1wiOntcIndvcmtmbG93cy9iYXNoLXdvcmtmbG93LnRzXCI6e1wic2VyaWFsQmFzaFdvcmtmbG93XCI6e1wid29ya2Zsb3dJZFwiOlwid29ya2Zsb3cvL3dvcmtmbG93cy9iYXNoLXdvcmtmbG93LnRzLy9zZXJpYWxCYXNoV29ya2Zsb3dcIn19fSxcInN0ZXBzXCI6e1wid29ya2Zsb3dzL2Jhc2gtd29ya2Zsb3cudHNcIjp7XCJhcHBlbmRUb0xvZ1wiOntcInN0ZXBJZFwiOlwic3RlcC8vd29ya2Zsb3dzL2Jhc2gtd29ya2Zsb3cudHMvL2FwcGVuZFRvTG9nXCJ9LFwiY3JlYXRlQmFzaFwiOntcInN0ZXBJZFwiOlwic3RlcC8vd29ya2Zsb3dzL2Jhc2gtd29ya2Zsb3cudHMvL2NyZWF0ZUJhc2hcIn0sXCJnZXRSZXN1bHRzXCI6e1wic3RlcElkXCI6XCJzdGVwLy93b3JrZmxvd3MvYmFzaC13b3JrZmxvdy50cy8vZ2V0UmVzdWx0c1wifX19fSovO1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNlcmlhbEJhc2hXb3JrZmxvdygpIHtcbiAgICAvLyBTdGVwIDE6IENyZWF0ZSBiYXNoIGluc3RhbmNlIGFuZCBpbml0aWFsaXplXG4gICAgbGV0IGJhc2ggPSBhd2FpdCBjcmVhdGVCYXNoKCk7XG4gICAgLy8gU3RlcHMgMi00OiBTZXJpYWwgc3RlcHMgdGhhdCBtb2RpZnkgZmlsZXN5c3RlbVxuICAgIGJhc2ggPSBhd2FpdCBhcHBlbmRUb0xvZyhiYXNoLCBcInN0ZXAyXCIpO1xuICAgIGJhc2ggPSBhd2FpdCBhcHBlbmRUb0xvZyhiYXNoLCBcInN0ZXAzXCIpO1xuICAgIGJhc2ggPSBhd2FpdCBhcHBlbmRUb0xvZyhiYXNoLCBcInN0ZXA0XCIpO1xuICAgIC8vIFN0ZXAgNTogR2V0IGZpbmFsIHJlc3VsdHNcbiAgICByZXR1cm4gYXdhaXQgZ2V0UmVzdWx0cyhiYXNoKTtcbn1cbnNlcmlhbEJhc2hXb3JrZmxvdy53b3JrZmxvd0lkID0gXCJ3b3JrZmxvdy8vd29ya2Zsb3dzL2Jhc2gtd29ya2Zsb3cudHMvL3NlcmlhbEJhc2hXb3JrZmxvd1wiO1xuZ2xvYmFsVGhpcy5fX3ByaXZhdGVfd29ya2Zsb3dzLnNldChcIndvcmtmbG93Ly93b3JrZmxvd3MvYmFzaC13b3JrZmxvdy50cy8vc2VyaWFsQmFzaFdvcmtmbG93XCIsIHNlcmlhbEJhc2hXb3JrZmxvdyk7XG52YXIgY3JlYXRlQmFzaCA9IGdsb2JhbFRoaXNbU3ltYm9sLmZvcihcIldPUktGTE9XX1VTRV9TVEVQXCIpXShcInN0ZXAvL3dvcmtmbG93cy9iYXNoLXdvcmtmbG93LnRzLy9jcmVhdGVCYXNoXCIpO1xudmFyIGFwcGVuZFRvTG9nID0gZ2xvYmFsVGhpc1tTeW1ib2wuZm9yKFwiV09SS0ZMT1dfVVNFX1NURVBcIildKFwic3RlcC8vd29ya2Zsb3dzL2Jhc2gtd29ya2Zsb3cudHMvL2FwcGVuZFRvTG9nXCIpO1xudmFyIGdldFJlc3VsdHMgPSBnbG9iYWxUaGlzW1N5bWJvbC5mb3IoXCJXT1JLRkxPV19VU0VfU1RFUFwiKV0oXCJzdGVwLy93b3JrZmxvd3MvYmFzaC13b3JrZmxvdy50cy8vZ2V0UmVzdWx0c1wiKTtcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7O0FBTUEsZUFBc0IscUJBQXFCO0FBRXZDLE1BQUksT0FBTyxNQUFNLFdBQVc7QUFFNUIsU0FBTyxNQUFNLFlBQVksTUFBTSxPQUFPO0FBQ3RDLFNBQU8sTUFBTSxZQUFZLE1BQU0sT0FBTztBQUN0QyxTQUFPLE1BQU0sWUFBWSxNQUFNLE9BQU87QUFFdEMsU0FBTyxNQUFNLFdBQVcsSUFBSTtBQUNoQztBQVRzQjtBQVV0QixtQkFBbUIsYUFBYTtBQUNoQyxXQUFXLG9CQUFvQixJQUFJLDREQUE0RCxrQkFBa0I7QUFDakgsSUFBSSxhQUFhLFdBQVcsT0FBTyxJQUFJLG1CQUFtQixDQUFDLEVBQUUsOENBQThDO0FBQzNHLElBQUksY0FBYyxXQUFXLE9BQU8sSUFBSSxtQkFBbUIsQ0FBQyxFQUFFLCtDQUErQztBQUM3RyxJQUFJLGFBQWEsV0FBVyxPQUFPLElBQUksbUJBQW1CLENBQUMsRUFBRSw4Q0FBOEM7IiwKICAibmFtZXMiOiBbXQp9Cg==
`;
const POST = workflowEntrypoint(workflowCode);
const _psdlYg = async ({ req }) => {
  try {
    return await POST(req);
  } catch (error) {
    console.error("Handler error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};
const assets = {};
function readAsset(id) {
  const serverDir = dirname(fileURLToPath(globalThis.__nitro_main__));
  return promises.readFile(resolve(serverDir, assets[id].path));
}
const publicAssetBases = {};
function isPublicAssetURL(id = "") {
  if (assets[id]) {
    return true;
  }
  for (const base in publicAssetBases) {
    if (id.startsWith(base)) {
      return true;
    }
  }
  return false;
}
function getAsset(id) {
  return assets[id];
}
const METHODS = /* @__PURE__ */ new Set(["HEAD", "GET"]);
const EncodingMap = {
  gzip: ".gz",
  br: ".br"
};
const _Dv2tpY = defineHandler((event) => {
  if (event.req.method && !METHODS.has(event.req.method)) {
    return;
  }
  let id = decodePath(withLeadingSlash(withoutTrailingSlash(event.url.pathname)));
  let asset;
  const encodingHeader = event.req.headers.get("accept-encoding") || "";
  const encodings = [...encodingHeader.split(",").map((e) => EncodingMap[e.trim()]).filter(Boolean).sort(), ""];
  if (encodings.length > 1) {
    event.res.headers.append("Vary", "Accept-Encoding");
  }
  for (const encoding of encodings) {
    for (const _id of [id + encoding, joinURL(id, "index.html" + encoding)]) {
      const _asset = getAsset(_id);
      if (_asset) {
        asset = _asset;
        id = _id;
        break;
      }
    }
  }
  if (!asset) {
    if (isPublicAssetURL(id)) {
      event.res.headers.delete("Cache-Control");
      throw new HTTPError({ status: 404 });
    }
    return;
  }
  const ifNotMatch = event.req.headers.get("if-none-match") === asset.etag;
  if (ifNotMatch) {
    event.res.status = 304;
    event.res.statusText = "Not Modified";
    return "";
  }
  const ifModifiedSinceH = event.req.headers.get("if-modified-since");
  const mtimeDate = new Date(asset.mtime);
  if (ifModifiedSinceH && asset.mtime && new Date(ifModifiedSinceH) >= mtimeDate) {
    event.res.status = 304;
    event.res.statusText = "Not Modified";
    return "";
  }
  if (asset.type) {
    event.res.headers.set("Content-Type", asset.type);
  }
  if (asset.etag && !event.res.headers.has("ETag")) {
    event.res.headers.set("ETag", asset.etag);
  }
  if (asset.mtime && !event.res.headers.has("Last-Modified")) {
    event.res.headers.set("Last-Modified", mtimeDate.toUTCString());
  }
  if (asset.encoding && !event.res.headers.has("Content-Encoding")) {
    event.res.headers.set("Content-Encoding", asset.encoding);
  }
  if (asset.size > 0 && !event.res.headers.has("Content-Length")) {
    event.res.headers.set("Content-Length", asset.size.toString());
  }
  return readAsset(id);
});
const _lazy_LhJIcc = defineLazyEventHandler(() => import("./_routes/api/bash.mjs"));
const findRoute = /* @__PURE__ */ (() => {
  const $0 = { route: "/.well-known/workflow/v1/step", handler: toEventHandler(_g3m8Xw) }, $1 = { route: "/.well-known/workflow/v1/flow", handler: toEventHandler(_psdlYg) }, $2 = { route: "/api/bash", method: "post", handler: _lazy_LhJIcc }, $3 = { route: "/.well-known/workflow/v1/webhook/:token", handler: toEventHandler(_n9RDGO) };
  return (m, p) => {
    if (p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1) || "/";
    if (p === "/.well-known/workflow/v1/step") {
      return { data: $0 };
    }
    if (p === "/.well-known/workflow/v1/flow") {
      return { data: $1 };
    }
    if (p === "/api/bash") {
      if (m === "POST") return { data: $2 };
    }
    let s = p.split("/"), l = s.length - 1;
    if (s[1] === ".well-known") {
      if (s[2] === "workflow") {
        if (s[3] === "v1") {
          if (s[4] === "webhook") {
            if (l === 5 || l === 4) {
              if (l >= 5) return { data: $3, params: { "token": s[5] } };
            }
          }
        }
      }
    }
  };
})();
const globalMiddleware = [
  toEventHandler(_Dv2tpY)
].filter(Boolean);
const APP_ID = "default";
function useNitroApp() {
  let instance = useNitroApp._instance;
  if (instance) {
    return instance;
  }
  instance = useNitroApp._instance = createNitroApp();
  globalThis.__nitro__ = globalThis.__nitro__ || {};
  globalThis.__nitro__[APP_ID] = instance;
  return instance;
}
function createNitroApp() {
  const hooks = void 0;
  const captureError = (error, errorCtx) => {
    if (errorCtx?.event) {
      const errors = errorCtx.event.req.context?.nitro?.errors;
      if (errors) {
        errors.push({
          error,
          context: errorCtx
        });
      }
    }
  };
  const h3App = createH3App({ onError(error, event) {
    return errorHandler(error, event);
  } });
  let appHandler = (req) => {
    req.context ||= {};
    req.context.nitro = req.context.nitro || { errors: [] };
    return h3App.fetch(req);
  };
  const app = {
    fetch: appHandler,
    h3: h3App,
    hooks,
    captureError
  };
  return app;
}
function createH3App(config) {
  const h3App = new H3Core(config);
  h3App["~findRoute"] = (event) => findRoute(event.req.method, event.url.pathname);
  h3App["~middleware"].push(...globalMiddleware);
  return h3App;
}
function _captureError(error, type) {
  console.error(`[${type}]`, error);
  useNitroApp().captureError?.(error, { tags: [type] });
}
function trapUnhandledErrors() {
  process.on("unhandledRejection", (error) => _captureError(error, "unhandledRejection"));
  process.on("uncaughtException", (error) => _captureError(error, "uncaughtException"));
}
const port = Number.parseInt(process.env.NITRO_PORT || process.env.PORT || "") || 3e3;
const host = process.env.NITRO_HOST || process.env.HOST;
const cert = process.env.NITRO_SSL_CERT;
const key = process.env.NITRO_SSL_KEY;
const nitroApp = useNitroApp();
serve({
  port,
  hostname: host,
  tls: cert && key ? {
    cert,
    key
  } : void 0,
  fetch: nitroApp.fetch
});
trapUnhandledErrors();
const nodeServer = {};
export {
  nodeServer as default
};
