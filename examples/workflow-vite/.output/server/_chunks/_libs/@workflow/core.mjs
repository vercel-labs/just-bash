import { f as functionsExports } from "../@vercel/functions.mjs";
import { W as WorkflowRuntimeError, a as WorkflowAPIError, F as FatalError, E as ERROR_SLUGS, R as RetryableError, b as WorkflowRunCancelledError, c as WorkflowRunFailedError, d as WorkflowRunNotCompletedError } from "./errors.mjs";
import { H as HealthCheckPayloadSchema, S as StepInvokePayloadSchema, W as WorkflowInvokePayloadSchema } from "./world.mjs";
import { a as pluralize, o as once, w as withResolvers, p as parseDurationToDate, g as getPort } from "./utils.mjs";
import { d as debug } from "../debug.mjs";
import { m as monotonicFactory } from "../../../_libs/ulid.mjs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { c as createLocalWorld } from "./world-local.mjs";
import { c as createVercelWorld } from "./world-vercel.mjs";
import { W as WORKFLOW_DESERIALIZE, a as WORKFLOW_SERIALIZE } from "./serde.mjs";
import { AsyncLocalStorage } from "node:async_hooks";
import { u as unflatten, s as stringify, p as parse, D as DevalueError } from "../../../_libs/devalue.mjs";
import { T as TraceMap, o as originalPositionFor } from "../@jridgewell/trace-mapping.mjs";
import { types } from "node:util";
import { createContext as createContext$1, runInContext } from "node:vm";
import { c as customRandom, u as urlAlphabet } from "../../../_libs/nanoid.mjs";
import { s as seedrandom } from "../../../_libs/seedrandom.mjs";
class WorkflowSuspension extends Error {
  steps;
  globalThis;
  stepCount;
  hookCount;
  waitCount;
  constructor(stepsInput, global) {
    const steps = [...stepsInput.values()];
    let stepCount = 0;
    let hookCount = 0;
    let waitCount = 0;
    for (const item of steps) {
      if (item.type === "step")
        stepCount++;
      else if (item.type === "hook")
        hookCount++;
      else if (item.type === "wait")
        waitCount++;
    }
    const parts = [];
    if (stepCount > 0) {
      parts.push(`${stepCount} ${pluralize("step", "steps", stepCount)}`);
    }
    if (hookCount > 0) {
      parts.push(`${hookCount} ${pluralize("hook", "hooks", hookCount)}`);
    }
    if (waitCount > 0) {
      parts.push(`${waitCount} ${pluralize("wait", "waits", waitCount)}`);
    }
    const totalCount = stepCount + hookCount + waitCount;
    const hasOrHave = pluralize("has", "have", totalCount);
    let action;
    if (stepCount > 0) {
      action = "run";
    } else if (hookCount > 0) {
      action = "created";
    } else if (waitCount > 0) {
      action = "created";
    } else {
      action = "received";
    }
    const description = parts.length > 0 ? `${parts.join(" and ")} ${hasOrHave} not been ${action} yet` : "0 steps have not been run yet";
    super(description);
    this.name = "WorkflowSuspension";
    this.steps = steps;
    this.globalThis = global;
    this.stepCount = stepCount;
    this.hookCount = hookCount;
    this.waitCount = waitCount;
  }
  static is(value) {
    return value instanceof WorkflowSuspension;
  }
}
function ENOTSUP() {
  throw new Error("Not supported in workflow functions");
}
function SemanticConvention(...names) {
  return (value) => Object.fromEntries(names.map((name) => [name, value]));
}
const WorkflowName = SemanticConvention("workflow.name");
const WorkflowOperation = SemanticConvention("workflow.operation");
const WorkflowRunId = SemanticConvention("workflow.run.id");
const WorkflowRunStatus = SemanticConvention("workflow.run.status");
const WorkflowStartedAt = SemanticConvention("workflow.started_at");
const WorkflowEventsCount = SemanticConvention("workflow.events.count");
const WorkflowArgumentsCount = SemanticConvention("workflow.arguments.count");
const WorkflowResultType = SemanticConvention("workflow.result.type");
const WorkflowTracePropagated = SemanticConvention("workflow.trace.propagated");
const WorkflowErrorName = SemanticConvention("workflow.error.name");
const WorkflowErrorMessage = SemanticConvention("workflow.error.message");
const WorkflowStepsCreated = SemanticConvention("workflow.steps.created");
const WorkflowHooksCreated = SemanticConvention("workflow.hooks.created");
const WorkflowWaitsCreated = SemanticConvention("workflow.waits.created");
const StepName = SemanticConvention("step.name");
const StepId = SemanticConvention("step.id");
const StepAttempt = SemanticConvention("step.attempt");
const StepStatus = SemanticConvention("step.status");
const StepMaxRetries = SemanticConvention("step.max_retries");
const StepTracePropagated = SemanticConvention("step.trace.propagated");
const StepSkipped = SemanticConvention("step.skipped");
const StepSkipReason = SemanticConvention("step.skip_reason");
const StepArgumentsCount = SemanticConvention("step.arguments.count");
const StepResultType = SemanticConvention("step.result.type");
const StepErrorName = SemanticConvention("step.error.name");
const StepErrorMessage = SemanticConvention("step.error.message");
const StepFatalError = SemanticConvention("step.fatal_error");
const StepRetryExhausted = SemanticConvention("step.retry.exhausted");
const StepRetryTimeoutSeconds = SemanticConvention("step.retry.timeout_seconds");
const StepRetryWillRetry = SemanticConvention("step.retry.will_retry");
const QueueName = SemanticConvention("queue.name");
const QueueMessageId = SemanticConvention("messaging.message.id", "queue.message.id");
const QueueOverheadMs = SemanticConvention("queue.overhead_ms");
const DeploymentId = SemanticConvention("deployment.id");
const HookToken = SemanticConvention("workflow.hook.token");
const HookId = SemanticConvention("workflow.hook.id");
const HookFound = SemanticConvention("workflow.hook.found");
const WorkflowSuspensionState = SemanticConvention("workflow.suspension.state");
const WorkflowSuspensionHookCount = SemanticConvention("workflow.suspension.hook_count");
const WorkflowSuspensionStepCount = SemanticConvention("workflow.suspension.step_count");
const WorkflowSuspensionWaitCount = SemanticConvention("workflow.suspension.wait_count");
async function serializeTraceCarrier() {
  const otel = await OtelApi.value;
  if (!otel)
    return {};
  const carrier = {};
  otel.propagation.inject(otel.context.active(), carrier);
  return carrier;
}
async function deserializeTraceCarrier(traceCarrier) {
  const otel = await OtelApi.value;
  if (!otel)
    return;
  return otel.propagation.extract(otel.context.active(), traceCarrier);
}
async function withTraceContext(traceCarrier, fn) {
  if (!traceCarrier) {
    return fn();
  }
  const otel = await OtelApi.value;
  if (!otel)
    return fn();
  const extractedContext = await deserializeTraceCarrier(traceCarrier);
  if (!extractedContext) {
    return fn();
  }
  return otel.context.with(extractedContext, async () => await fn());
}
const OtelApi = once(async () => {
  try {
    return await import("../../core_false.mjs");
  } catch {
    console.warn("OpenTelemetry not available, tracing will be disabled");
    return null;
  }
});
const Tracer = once(async () => {
  const api = await OtelApi.value;
  if (!api)
    return null;
  return api.trace.getTracer("workflow");
});
async function trace(spanName, ...args) {
  const [tracer, otel] = await Promise.all([Tracer.value, OtelApi.value]);
  const { fn, opts } = typeof args[0] === "function" ? { fn: args[0], opts: {} } : { fn: args[1], opts: args[0] };
  if (!fn)
    throw new Error("Function to trace must be provided");
  if (!tracer || !otel) {
    return await fn();
  }
  return tracer.startActiveSpan(spanName, opts, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: otel.SpanStatusCode.OK });
      return result;
    } catch (e) {
      span.setStatus({
        code: otel.SpanStatusCode.ERROR,
        message: e.message
      });
      applyWorkflowSuspensionToSpan(e, otel, span);
      throw e;
    } finally {
      span.end();
    }
  });
}
function applyWorkflowSuspensionToSpan(error, otel, span) {
  if (!error || !WorkflowSuspension.is(error)) {
    return;
  }
  span.setStatus({ code: otel.SpanStatusCode.OK });
  span.setAttributes({
    ...WorkflowSuspensionState("suspended"),
    ...WorkflowSuspensionStepCount(error.stepCount),
    ...WorkflowSuspensionHookCount(error.hookCount),
    ...WorkflowSuspensionWaitCount(error.waitCount)
  });
}
async function getSpanContextForTraceCarrier(carrier) {
  const [deserialized, otel] = await Promise.all([
    deserializeTraceCarrier(carrier),
    OtelApi.value
  ]);
  if (!deserialized || !otel)
    return;
  return otel.trace.getSpanContext(deserialized);
}
async function getActiveSpan() {
  return await withOtel((otel) => otel.trace.getActiveSpan());
}
async function getSpanKind(field) {
  return withOtel((x) => x.SpanKind[field]);
}
async function withOtel(fn) {
  const otel = await OtelApi.value;
  if (!otel)
    return void 0;
  return await fn(otel);
}
function linkToCurrentContext() {
  return withOtel((otel) => {
    const context = otel.trace.getActiveSpan()?.spanContext();
    if (!context)
      return;
    return [{ context }];
  });
}
function createLogger(namespace) {
  const baseDebug = debug(`workflow:${namespace}`);
  const logger = (level) => {
    const levelDebug = baseDebug.extend(level);
    return (message, metadata) => {
      levelDebug(message, metadata);
      if (levelDebug.enabled) {
        getActiveSpan().then((span) => {
          span?.addEvent(`${level}.${namespace}`, { message, ...metadata });
        }).catch(() => {
        });
      }
    };
  };
  return {
    debug: logger("debug"),
    info: logger("info"),
    warn: logger("warn"),
    error: logger("error")
  };
}
const stepLogger = createLogger("step");
const runtimeLogger = createLogger("runtime");
const webhookLogger = createLogger("webhook");
const eventsLogger = createLogger("events");
createLogger("adapter");
function parseName(tag, name) {
  if (typeof name !== "string") {
    return null;
  }
  const [prefix, path, ...functionNameParts] = name.split("//");
  if (prefix !== tag || !path || functionNameParts.length === 0) {
    return null;
  }
  let shortName = functionNameParts.at(-1) ?? "";
  const functionName = functionNameParts.join("//");
  const filename = path.split("/").at(-1) ?? "";
  const fileNameWithoutExtension = filename.split(".").at(0) ?? "";
  if (["default", "__default"].includes(shortName) && fileNameWithoutExtension) {
    shortName = fileNameWithoutExtension;
  }
  return {
    shortName,
    path,
    functionName
  };
}
function parseWorkflowName(name) {
  return parseName("workflow", name);
}
const require$1 = createRequire(join(process.cwd(), "index.js"));
const WorldCache = /* @__PURE__ */ Symbol.for("@workflow/world//cache");
const StubbedWorldCache = /* @__PURE__ */ Symbol.for("@workflow/world//stubbedCache");
const globalSymbols = globalThis;
function defaultWorld() {
  if (process.env.VERCEL_DEPLOYMENT_ID) {
    return "vercel";
  }
  return "local";
}
const createWorld = () => {
  const targetWorld = process.env.WORKFLOW_TARGET_WORLD || defaultWorld();
  if (targetWorld === "vercel") {
    return createVercelWorld({
      baseUrl: process.env.WORKFLOW_VERCEL_BACKEND_URL,
      skipProxy: process.env.WORKFLOW_VERCEL_SKIP_PROXY === "true",
      token: process.env.WORKFLOW_VERCEL_AUTH_TOKEN,
      projectConfig: {
        environment: process.env.WORKFLOW_VERCEL_ENV,
        projectId: process.env.WORKFLOW_VERCEL_PROJECT,
        teamId: process.env.WORKFLOW_VERCEL_TEAM
      }
    });
  }
  if (targetWorld === "local") {
    return createLocalWorld({
      dataDir: process.env.WORKFLOW_LOCAL_DATA_DIR
    });
  }
  const mod = require$1(targetWorld);
  if (typeof mod === "function") {
    return mod();
  } else if (typeof mod.default === "function") {
    return mod.default();
  } else if (typeof mod.createWorld === "function") {
    return mod.createWorld();
  }
  throw new Error(`Invalid target world module: ${targetWorld}, must export a default function or createWorld function that returns a World instance.`);
};
const getWorldHandlers = () => {
  if (globalSymbols[StubbedWorldCache]) {
    return globalSymbols[StubbedWorldCache];
  }
  const _world = createWorld();
  globalSymbols[StubbedWorldCache] = _world;
  return {
    createQueueHandler: _world.createQueueHandler
  };
};
const getWorld = () => {
  if (globalSymbols[WorldCache]) {
    return globalSymbols[WorldCache];
  }
  globalSymbols[WorldCache] = createWorld();
  return globalSymbols[WorldCache];
};
const generateId = monotonicFactory();
function getHealthCheckStreamName(correlationId) {
  return `__health_check__${correlationId}`;
}
function parseHealthCheckPayload(message) {
  const result = HealthCheckPayloadSchema.safeParse(message);
  if (result.success) {
    return result.data;
  }
  return void 0;
}
function generateHealthCheckRunId() {
  return `wrun_${generateId()}`;
}
async function handleHealthCheckMessage(healthCheck, endpoint) {
  const world = getWorld();
  const streamName = getHealthCheckStreamName(healthCheck.correlationId);
  const response = JSON.stringify({
    healthy: true,
    endpoint,
    correlationId: healthCheck.correlationId,
    timestamp: Date.now()
  });
  const fakeRunId = generateHealthCheckRunId();
  await world.writeToStream(streamName, fakeRunId, response);
  await world.closeStream(streamName, fakeRunId);
}
async function getAllWorkflowRunEvents(runId) {
  const allEvents = [];
  let cursor = null;
  let hasMore = true;
  const world = getWorld();
  while (hasMore) {
    const response = await world.events.list({
      runId,
      pagination: {
        sortOrder: "asc",
        // Required: events must be in chronological order for replay
        cursor: cursor ?? void 0
      }
    });
    allEvents.push(...response.data);
    hasMore = response.hasMore;
    cursor = response.cursor;
  }
  return allEvents;
}
const HEALTH_CHECK_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET, HEAD",
  "Access-Control-Allow-Headers": "Content-Type"
};
function withHealthCheck(handler) {
  return async (req) => {
    const url = new URL(req.url);
    const isHealthCheck = url.searchParams.has("__health");
    if (isHealthCheck) {
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: HEALTH_CHECK_CORS_HEADERS
        });
      }
      return new Response(`Workflow DevKit "${url.pathname}" endpoint is healthy`, {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
          ...HEALTH_CHECK_CORS_HEADERS
        }
      });
    }
    return await handler(req);
  };
}
async function queueMessage(world, ...args) {
  const queueName = args[0];
  await trace("queueMessage", {
    attributes: QueueName(queueName),
    kind: await getSpanKind("PRODUCER")
  }, async (span) => {
    const { messageId } = await world.queue(...args);
    span?.setAttributes(QueueMessageId(messageId));
  });
}
function getQueueOverhead(message) {
  if (!message.requestedAt)
    return;
  try {
    return QueueOverheadMs(Date.now() - message.requestedAt.getTime());
  } catch {
    return;
  }
}
const WORKFLOW_USE_STEP = /* @__PURE__ */ Symbol.for("WORKFLOW_USE_STEP");
const WORKFLOW_CREATE_HOOK = /* @__PURE__ */ Symbol.for("WORKFLOW_CREATE_HOOK");
const WORKFLOW_SLEEP = /* @__PURE__ */ Symbol.for("WORKFLOW_SLEEP");
const WORKFLOW_GET_STREAM_ID = /* @__PURE__ */ Symbol.for("WORKFLOW_GET_STREAM_ID");
const STABLE_ULID = /* @__PURE__ */ Symbol.for("WORKFLOW_STABLE_ULID");
const STREAM_NAME_SYMBOL = /* @__PURE__ */ Symbol.for("WORKFLOW_STREAM_NAME");
const STREAM_TYPE_SYMBOL = /* @__PURE__ */ Symbol.for("WORKFLOW_STREAM_TYPE");
const BODY_INIT_SYMBOL = /* @__PURE__ */ Symbol.for("BODY_INIT");
const WEBHOOK_RESPONSE_WRITABLE = /* @__PURE__ */ Symbol.for("WEBHOOK_RESPONSE_WRITABLE");
const WORKFLOW_CLASS_REGISTRY = /* @__PURE__ */ Symbol.for("workflow-class-registry");
function getRegistry(global = globalThis) {
  const g = global;
  let registry = g[WORKFLOW_CLASS_REGISTRY];
  if (!registry) {
    registry = /* @__PURE__ */ new Map();
    g[WORKFLOW_CLASS_REGISTRY] = registry;
  }
  return registry;
}
function getSerializationClass(classId, global = globalThis) {
  const cls = getRegistry(global).get(classId);
  if (cls)
    return cls;
  if (global !== globalThis) {
    return getRegistry(globalThis).get(classId);
  }
  return void 0;
}
const LOCK_POLL_INTERVAL_MS = 100;
function createFlushableState() {
  return {
    ...withResolvers(),
    pendingOps: 0,
    doneResolved: false,
    streamEnded: false
  };
}
function isWritableUnlockedNotClosed(writable) {
  if (writable.locked)
    return false;
  let writer;
  try {
    writer = writable.getWriter();
  } catch {
    return false;
  }
  try {
    writer.releaseLock();
  } catch {
    return false;
  }
  return true;
}
function isReadableUnlockedNotClosed(readable) {
  if (readable.locked)
    return false;
  let reader;
  try {
    reader = readable.getReader();
  } catch {
    return false;
  }
  try {
    reader.releaseLock();
  } catch {
    return false;
  }
  return true;
}
function pollWritableLock(writable, state) {
  if (state.writablePollingInterval !== void 0) {
    return;
  }
  const intervalId = setInterval(() => {
    if (state.doneResolved || state.streamEnded) {
      clearInterval(intervalId);
      state.writablePollingInterval = void 0;
      return;
    }
    if (isWritableUnlockedNotClosed(writable) && state.pendingOps === 0) {
      state.doneResolved = true;
      state.resolve();
      clearInterval(intervalId);
      state.writablePollingInterval = void 0;
    }
  }, LOCK_POLL_INTERVAL_MS);
  state.writablePollingInterval = intervalId;
}
function pollReadableLock(readable, state) {
  if (state.readablePollingInterval !== void 0) {
    return;
  }
  const intervalId = setInterval(() => {
    if (state.doneResolved || state.streamEnded) {
      clearInterval(intervalId);
      state.readablePollingInterval = void 0;
      return;
    }
    if (isReadableUnlockedNotClosed(readable) && state.pendingOps === 0) {
      state.doneResolved = true;
      state.resolve();
      clearInterval(intervalId);
      state.readablePollingInterval = void 0;
    }
  }, LOCK_POLL_INTERVAL_MS);
  state.readablePollingInterval = intervalId;
}
async function flushablePipe(source, sink, state) {
  const reader = source.getReader();
  const writer = sink.getWriter();
  try {
    while (true) {
      if (state.streamEnded) {
        return;
      }
      const readResult = await reader.read();
      if (state.streamEnded) {
        return;
      }
      if (readResult.done) {
        state.streamEnded = true;
        await writer.close();
        if (!state.doneResolved) {
          state.doneResolved = true;
          state.resolve();
        }
        return;
      }
      state.pendingOps++;
      try {
        await writer.write(readResult.value);
      } finally {
        state.pendingOps--;
      }
    }
  } catch (err) {
    state.streamEnded = true;
    if (!state.doneResolved) {
      state.doneResolved = true;
      state.reject(err);
    }
    throw err;
  } finally {
    reader.releaseLock();
    writer.releaseLock();
  }
}
const contextStorage = /* @__PURE__ */ new AsyncLocalStorage();
const registeredSteps = /* @__PURE__ */ new Map();
function registerStepFunction(stepId, stepFn) {
  registeredSteps.set(stepId, stepFn);
}
function getStepFunction(stepId) {
  return registeredSteps.get(stepId);
}
const defaultUlid = monotonicFactory();
function formatSerializationError(context, error) {
  const verb = context.includes("return value") ? "returning" : "passing";
  let message = `Failed to serialize ${context}`;
  if (error instanceof DevalueError && error.path) {
    message += ` at path "${error.path}"`;
  }
  message += `. Ensure you're ${verb} serializable types (plain objects, arrays, primitives, Date, RegExp, Map, Set).`;
  if (error instanceof DevalueError && error.value !== void 0) {
    console.error(`[Workflows] Serialization failed for ${context}. Problematic value:`);
    console.error(error.value);
  }
  return message;
}
function getStreamType(stream) {
  try {
    const reader = stream.getReader({ mode: "byob" });
    reader.releaseLock();
    return "bytes";
  } catch {
  }
}
function getSerializeStream(reducers) {
  const encoder = new TextEncoder();
  const stream = new TransformStream({
    transform(chunk, controller) {
      try {
        const serialized = stringify(chunk, reducers);
        controller.enqueue(encoder.encode(`${serialized}
`));
      } catch (error) {
        controller.error(new WorkflowRuntimeError(formatSerializationError("stream chunk", error), { slug: "serialization-failed", cause: error }));
      }
    }
  });
  return stream;
}
function getDeserializeStream(revivers) {
  const decoder = new TextDecoder();
  let buffer = "";
  const stream = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1)
          break;
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          const obj = parse(line, revivers);
          controller.enqueue(obj);
        }
      }
    },
    flush(controller) {
      if (buffer && buffer.length > 0) {
        const obj = parse(buffer, revivers);
        controller.enqueue(obj);
      }
    }
  });
  return stream;
}
class WorkflowServerReadableStream extends ReadableStream {
  #reader;
  constructor(name, startIndex) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`"name" is required, got "${name}"`);
    }
    super({
      // @ts-expect-error Not sure why TypeScript is complaining about this
      type: "bytes",
      pull: async (controller) => {
        let reader = this.#reader;
        if (!reader) {
          const world = getWorld();
          const stream = await world.readFromStream(name, startIndex);
          reader = this.#reader = stream.getReader();
        }
        if (!reader) {
          controller.error(new Error("Failed to get reader"));
          return;
        }
        const result = await reader.read();
        if (result.done) {
          this.#reader = void 0;
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      }
    });
  }
}
class WorkflowServerWritableStream extends WritableStream {
  constructor(name, runId) {
    if (typeof runId !== "string" && !(runId instanceof Promise)) {
      throw new Error(`"runId" must be a string or a promise that resolves to a string, got "${typeof runId}"`);
    }
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`"name" is required, got "${name}"`);
    }
    const world = getWorld();
    super({
      async write(chunk) {
        const _runId = await runId;
        await world.writeToStream(name, _runId, chunk);
      },
      async close() {
        const _runId = await runId;
        await world.closeStream(name, _runId);
      }
    });
  }
}
function revive(str) {
  return (0, eval)(`(${str})`);
}
function getCommonReducers(global = globalThis) {
  const abToBase64 = (value, offset, length) => {
    if (length === 0)
      return ".";
    const uint8 = new Uint8Array(value, offset, length);
    return Buffer.from(uint8).toString("base64");
  };
  const viewToBase64 = (value) => abToBase64(value.buffer, value.byteOffset, value.byteLength);
  return {
    ArrayBuffer: (value) => value instanceof global.ArrayBuffer && abToBase64(value, 0, value.byteLength),
    BigInt: (value) => typeof value === "bigint" && value.toString(),
    BigInt64Array: (value) => value instanceof global.BigInt64Array && viewToBase64(value),
    BigUint64Array: (value) => value instanceof global.BigUint64Array && viewToBase64(value),
    Date: (value) => {
      if (!(value instanceof global.Date))
        return false;
      const valid = !Number.isNaN(value.getDate());
      return valid ? value.toISOString() : ".";
    },
    Error: (value) => {
      if (!(value instanceof global.Error))
        return false;
      return {
        name: value.name,
        message: value.message,
        stack: value.stack
      };
    },
    Float32Array: (value) => value instanceof global.Float32Array && viewToBase64(value),
    Float64Array: (value) => value instanceof global.Float64Array && viewToBase64(value),
    Headers: (value) => value instanceof global.Headers && Array.from(value),
    Int8Array: (value) => value instanceof global.Int8Array && viewToBase64(value),
    Int16Array: (value) => value instanceof global.Int16Array && viewToBase64(value),
    Int32Array: (value) => value instanceof global.Int32Array && viewToBase64(value),
    Map: (value) => value instanceof global.Map && Array.from(value),
    RegExp: (value) => value instanceof global.RegExp && {
      source: value.source,
      flags: value.flags
    },
    Request: (value) => {
      if (!(value instanceof global.Request))
        return false;
      const data = {
        method: value.method,
        url: value.url,
        headers: value.headers,
        body: value.body,
        duplex: value.duplex
      };
      const responseWritable = value[WEBHOOK_RESPONSE_WRITABLE];
      if (responseWritable) {
        data.responseWritable = responseWritable;
      }
      return data;
    },
    Response: (value) => {
      if (!(value instanceof global.Response))
        return false;
      return {
        type: value.type,
        url: value.url,
        status: value.status,
        statusText: value.statusText,
        headers: value.headers,
        body: value.body,
        redirected: value.redirected
      };
    },
    Class: (value) => {
      if (typeof value !== "function")
        return false;
      const classId = value.classId;
      if (typeof classId !== "string")
        return false;
      return { classId };
    },
    Instance: (value) => {
      if (value === null || typeof value !== "object")
        return false;
      const ctor = value.constructor;
      if (!ctor || typeof ctor !== "function")
        return false;
      const serialize = ctor[WORKFLOW_SERIALIZE];
      if (typeof serialize !== "function") {
        return false;
      }
      const classId = ctor.classId;
      if (typeof classId !== "string") {
        throw new Error(`Class "${ctor.name}" with ${String(WORKFLOW_SERIALIZE)} must have a static "classId" property.`);
      }
      const data = serialize(value);
      return { classId, data };
    },
    Set: (value) => value instanceof global.Set && Array.from(value),
    StepFunction: (value) => {
      if (typeof value !== "function")
        return false;
      const stepId = value.stepId;
      if (typeof stepId !== "string")
        return false;
      const closureVarsFn = value.__closureVarsFn;
      if (closureVarsFn && typeof closureVarsFn === "function") {
        const closureVars = closureVarsFn();
        return { stepId, closureVars };
      }
      return { stepId };
    },
    URL: (value) => value instanceof global.URL && value.href,
    URLSearchParams: (value) => {
      if (!(value instanceof global.URLSearchParams))
        return false;
      if (value.size === 0)
        return ".";
      return String(value);
    },
    Uint8Array: (value) => value instanceof global.Uint8Array && viewToBase64(value),
    Uint8ClampedArray: (value) => value instanceof global.Uint8ClampedArray && viewToBase64(value),
    Uint16Array: (value) => value instanceof global.Uint16Array && viewToBase64(value),
    Uint32Array: (value) => value instanceof global.Uint32Array && viewToBase64(value)
  };
}
function getExternalReducers(global = globalThis, ops, runId) {
  return {
    ...getCommonReducers(global),
    ReadableStream: (value) => {
      if (!(value instanceof global.ReadableStream))
        return false;
      if (value.locked) {
        throw new Error("ReadableStream is locked");
      }
      const streamId = (global[STABLE_ULID] || defaultUlid)();
      const name = `strm_${streamId}`;
      const type = getStreamType(value);
      const writable = new WorkflowServerWritableStream(name, runId);
      if (type === "bytes") {
        ops.push(value.pipeTo(writable));
      } else {
        ops.push(value.pipeThrough(getSerializeStream(getExternalReducers(global, ops, runId))).pipeTo(writable));
      }
      const s = { name };
      if (type)
        s.type = type;
      return s;
    },
    WritableStream: (value) => {
      if (!(value instanceof global.WritableStream))
        return false;
      const streamId = (global[STABLE_ULID] || defaultUlid)();
      const name = `strm_${streamId}`;
      const readable = new WorkflowServerReadableStream(name);
      ops.push(readable.pipeTo(value));
      return { name };
    }
  };
}
function getWorkflowReducers(global = globalThis) {
  return {
    ...getCommonReducers(global),
    // Readable/Writable streams from within the workflow execution environment
    // are simply "handles" that can be passed around to other steps.
    ReadableStream: (value) => {
      if (!(value instanceof global.ReadableStream))
        return false;
      const bodyInit = value[BODY_INIT_SYMBOL];
      if (bodyInit !== void 0) {
        return { bodyInit };
      }
      const name = value[STREAM_NAME_SYMBOL];
      if (!name) {
        throw new Error("ReadableStream `name` is not set");
      }
      const s = { name };
      const type = value[STREAM_TYPE_SYMBOL];
      if (type)
        s.type = type;
      return s;
    },
    WritableStream: (value) => {
      if (!(value instanceof global.WritableStream))
        return false;
      const name = value[STREAM_NAME_SYMBOL];
      if (!name) {
        throw new Error("WritableStream `name` is not set");
      }
      return { name };
    }
  };
}
function getStepReducers(global = globalThis, ops, runId) {
  return {
    ...getCommonReducers(global),
    ReadableStream: (value) => {
      if (!(value instanceof global.ReadableStream))
        return false;
      if (value.locked) {
        throw new Error("ReadableStream is locked");
      }
      let name = value[STREAM_NAME_SYMBOL];
      let type = value[STREAM_TYPE_SYMBOL];
      if (!name) {
        if (!runId) {
          throw new Error("ReadableStream cannot be serialized without a valid runId");
        }
        const streamId = (global[STABLE_ULID] || defaultUlid)();
        name = `strm_${streamId}`;
        type = getStreamType(value);
        const writable = new WorkflowServerWritableStream(name, runId);
        if (type === "bytes") {
          ops.push(value.pipeTo(writable));
        } else {
          ops.push(value.pipeThrough(getSerializeStream(getStepReducers(global, ops, runId))).pipeTo(writable));
        }
      }
      const s = { name };
      if (type)
        s.type = type;
      return s;
    },
    WritableStream: (value) => {
      if (!(value instanceof global.WritableStream))
        return false;
      let name = value[STREAM_NAME_SYMBOL];
      if (!name) {
        if (!runId) {
          throw new Error("WritableStream cannot be serialized without a valid runId");
        }
        const streamId = (global[STABLE_ULID] || defaultUlid)();
        name = `strm_${streamId}`;
        ops.push(new WorkflowServerReadableStream(name).pipeThrough(getDeserializeStream(getStepRevivers(global, ops, runId))).pipeTo(value));
      }
      return { name };
    }
  };
}
function getCommonRevivers(global = globalThis) {
  function reviveArrayBuffer(value) {
    const base64 = value === "." ? "" : value;
    const buffer = Buffer.from(base64, "base64");
    const arrayBuffer = new global.ArrayBuffer(buffer.length);
    const uint8Array = new global.Uint8Array(arrayBuffer);
    uint8Array.set(buffer);
    return arrayBuffer;
  }
  return {
    ArrayBuffer: reviveArrayBuffer,
    BigInt: (value) => global.BigInt(value),
    BigInt64Array: (value) => {
      const ab = reviveArrayBuffer(value);
      return new global.BigInt64Array(ab);
    },
    BigUint64Array: (value) => {
      const ab = reviveArrayBuffer(value);
      return new global.BigUint64Array(ab);
    },
    Date: (value) => new global.Date(value),
    Error: (value) => {
      const error = new global.Error(value.message);
      error.name = value.name;
      error.stack = value.stack;
      return error;
    },
    Float32Array: (value) => {
      const ab = reviveArrayBuffer(value);
      return new global.Float32Array(ab);
    },
    Float64Array: (value) => {
      const ab = reviveArrayBuffer(value);
      return new global.Float64Array(ab);
    },
    Headers: (value) => new global.Headers(value),
    Int8Array: (value) => {
      const ab = reviveArrayBuffer(value);
      return new global.Int8Array(ab);
    },
    Int16Array: (value) => {
      const ab = reviveArrayBuffer(value);
      return new global.Int16Array(ab);
    },
    Int32Array: (value) => {
      const ab = reviveArrayBuffer(value);
      return new global.Int32Array(ab);
    },
    Map: (value) => new global.Map(value),
    RegExp: (value) => new global.RegExp(value.source, value.flags),
    Class: (value) => {
      const classId = value.classId;
      const cls = getSerializationClass(classId);
      if (!cls) {
        throw new Error(`Class "${classId}" not found. Make sure the class is registered with registerSerializationClass.`);
      }
      return cls;
    },
    Instance: (value) => {
      const classId = value.classId;
      const data = value.data;
      const cls = getSerializationClass(classId, global);
      if (!cls) {
        throw new Error(`Class "${classId}" not found. Make sure the class is registered with registerSerializationClass.`);
      }
      const deserialize = cls[WORKFLOW_DESERIALIZE];
      if (typeof deserialize !== "function") {
        throw new Error(`Class "${classId}" does not have a static ${String(WORKFLOW_DESERIALIZE)} method.`);
      }
      return deserialize(data);
    },
    Set: (value) => new global.Set(value),
    StepFunction: (value) => {
      const stepId = value.stepId;
      const closureVars = value.closureVars;
      const stepFn = getStepFunction(stepId);
      if (!stepFn) {
        throw new Error(`Step function "${stepId}" not found. Make sure the step function is registered.`);
      }
      if (closureVars) {
        const wrappedStepFn = ((...args) => {
          const currentContext = contextStorage.getStore();
          if (!currentContext) {
            throw new Error("Cannot call step function with closure variables outside step context");
          }
          const newContext = {
            ...currentContext,
            closureVars
          };
          return contextStorage.run(newContext, () => stepFn(...args));
        });
        Object.defineProperty(wrappedStepFn, "name", {
          value: stepFn.name
        });
        Object.defineProperty(wrappedStepFn, "stepId", {
          value: stepId,
          writable: false,
          enumerable: false,
          configurable: false
        });
        if (stepFn.maxRetries !== void 0) {
          wrappedStepFn.maxRetries = stepFn.maxRetries;
        }
        return wrappedStepFn;
      }
      return stepFn;
    },
    URL: (value) => new global.URL(value),
    URLSearchParams: (value) => new global.URLSearchParams(value === "." ? "" : value),
    Uint8Array: (value) => {
      const ab = reviveArrayBuffer(value);
      return new global.Uint8Array(ab);
    },
    Uint8ClampedArray: (value) => {
      const ab = reviveArrayBuffer(value);
      return new global.Uint8ClampedArray(ab);
    },
    Uint16Array: (value) => {
      const ab = reviveArrayBuffer(value);
      return new global.Uint16Array(ab);
    },
    Uint32Array: (value) => {
      const ab = reviveArrayBuffer(value);
      return new global.Uint32Array(ab);
    }
  };
}
function getExternalRevivers(global = globalThis, ops, runId) {
  return {
    ...getCommonRevivers(global),
    Request: (value) => {
      return new global.Request(value.url, {
        method: value.method,
        headers: new global.Headers(value.headers),
        body: value.body,
        duplex: value.duplex
      });
    },
    Response: (value) => {
      return new global.Response(value.body, {
        status: value.status,
        statusText: value.statusText,
        headers: new global.Headers(value.headers)
      });
    },
    ReadableStream: (value) => {
      if ("bodyInit" in value) {
        const bodyInit = value.bodyInit;
        const response = new global.Response(bodyInit);
        return response.body;
      }
      const readable = new WorkflowServerReadableStream(value.name, value.startIndex);
      if (value.type === "bytes") {
        const state = createFlushableState();
        ops.push(state.promise);
        const { readable: userReadable, writable } = new global.TransformStream();
        flushablePipe(readable, writable, state).catch(() => {
        });
        pollReadableLock(userReadable, state);
        return userReadable;
      } else {
        const transform = getDeserializeStream(getExternalRevivers(global, ops, runId));
        const state = createFlushableState();
        ops.push(state.promise);
        flushablePipe(readable, transform.writable, state).catch(() => {
        });
        pollReadableLock(transform.readable, state);
        return transform.readable;
      }
    },
    WritableStream: (value) => {
      const serialize = getSerializeStream(getExternalReducers(global, ops, runId));
      const serverWritable = new WorkflowServerWritableStream(value.name, runId);
      const state = createFlushableState();
      ops.push(state.promise);
      flushablePipe(serialize.readable, serverWritable, state).catch(() => {
      });
      pollWritableLock(serialize.writable, state);
      return serialize.writable;
    }
  };
}
function getWorkflowRevivers(global = globalThis) {
  return {
    ...getCommonRevivers(global),
    Request: (value) => {
      Object.setPrototypeOf(value, global.Request.prototype);
      const responseWritable = value.responseWritable;
      if (responseWritable) {
        value[WEBHOOK_RESPONSE_WRITABLE] = responseWritable;
        delete value.responseWritable;
        value.respondWith = () => {
          throw new Error("`respondWith()` must be called from within a step function");
        };
      }
      return value;
    },
    Response: (value) => {
      Object.setPrototypeOf(value, global.Response.prototype);
      return value;
    },
    ReadableStream: (value) => {
      if ("bodyInit" in value) {
        return Object.create(global.ReadableStream.prototype, {
          [BODY_INIT_SYMBOL]: {
            value: value.bodyInit,
            writable: false
          }
        });
      }
      return Object.create(global.ReadableStream.prototype, {
        [STREAM_NAME_SYMBOL]: {
          value: value.name,
          writable: false
        },
        [STREAM_TYPE_SYMBOL]: {
          value: value.type,
          writable: false
        }
      });
    },
    WritableStream: (value) => {
      return Object.create(global.WritableStream.prototype, {
        [STREAM_NAME_SYMBOL]: {
          value: value.name,
          writable: false
        }
      });
    }
  };
}
function getStepRevivers(global = globalThis, ops, runId) {
  return {
    ...getCommonRevivers(global),
    Request: (value) => {
      const responseWritable = value.responseWritable;
      const request = new global.Request(value.url, {
        method: value.method,
        headers: new global.Headers(value.headers),
        body: value.body,
        duplex: value.duplex
      });
      if (responseWritable) {
        request.respondWith = async (response) => {
          const writer = responseWritable.getWriter();
          await writer.write(response);
          await writer.close();
        };
      }
      return request;
    },
    Response: (value) => {
      return new global.Response(value.body, {
        status: value.status,
        statusText: value.statusText,
        headers: new global.Headers(value.headers)
      });
    },
    ReadableStream: (value) => {
      if ("bodyInit" in value) {
        const bodyInit = value.bodyInit;
        const response = new global.Response(bodyInit);
        return response.body;
      }
      const readable = new WorkflowServerReadableStream(value.name);
      if (value.type === "bytes") {
        const state = createFlushableState();
        ops.push(state.promise);
        const { readable: userReadable, writable } = new global.TransformStream();
        flushablePipe(readable, writable, state).catch(() => {
        });
        pollReadableLock(userReadable, state);
        return userReadable;
      } else {
        const transform = getDeserializeStream(getStepRevivers(global, ops, runId));
        const state = createFlushableState();
        ops.push(state.promise);
        flushablePipe(readable, transform.writable, state).catch(() => {
        });
        pollReadableLock(transform.readable, state);
        return transform.readable;
      }
    },
    WritableStream: (value) => {
      if (!runId) {
        throw new Error("WritableStream cannot be revived without a valid runId");
      }
      const serialize = getSerializeStream(getStepReducers(global, ops, runId));
      const serverWritable = new WorkflowServerWritableStream(value.name, runId);
      const state = createFlushableState();
      ops.push(state.promise);
      flushablePipe(serialize.readable, serverWritable, state).catch(() => {
      });
      pollWritableLock(serialize.writable, state);
      return serialize.writable;
    }
  };
}
function dehydrateWorkflowArguments(value, ops, runId, global = globalThis) {
  try {
    const str = stringify(value, getExternalReducers(global, ops, runId));
    return revive(str);
  } catch (error) {
    throw new WorkflowRuntimeError(formatSerializationError("workflow arguments", error), { slug: "serialization-failed", cause: error });
  }
}
function hydrateWorkflowArguments(value, global = globalThis, extraRevivers = {}) {
  const obj = unflatten(value, {
    ...getWorkflowRevivers(global),
    ...extraRevivers
  });
  return obj;
}
function dehydrateWorkflowReturnValue(value, global = globalThis) {
  try {
    const str = stringify(value, getWorkflowReducers(global));
    return revive(str);
  } catch (error) {
    throw new WorkflowRuntimeError(formatSerializationError("workflow return value", error), { slug: "serialization-failed", cause: error });
  }
}
function hydrateWorkflowReturnValue(value, ops, runId, global = globalThis, extraRevivers = {}) {
  const obj = unflatten(value, {
    ...getExternalRevivers(global, ops, runId),
    ...extraRevivers
  });
  return obj;
}
function dehydrateStepArguments(value, global) {
  try {
    const str = stringify(value, getWorkflowReducers(global));
    return revive(str);
  } catch (error) {
    throw new WorkflowRuntimeError(formatSerializationError("step arguments", error), { slug: "serialization-failed", cause: error });
  }
}
function hydrateStepArguments(value, ops, runId, global = globalThis, extraRevivers = {}) {
  const obj = unflatten(value, {
    ...getStepRevivers(global, ops, runId),
    ...extraRevivers
  });
  return obj;
}
function dehydrateStepReturnValue(value, ops, runId, global = globalThis) {
  try {
    const str = stringify(value, getStepReducers(global, ops, runId));
    return revive(str);
  } catch (error) {
    throw new WorkflowRuntimeError(formatSerializationError("step return value", error), { slug: "serialization-failed", cause: error });
  }
}
function hydrateStepReturnValue(value, global = globalThis, extraRevivers = {}) {
  const obj = unflatten(value, {
    ...getWorkflowRevivers(global),
    ...extraRevivers
  });
  return obj;
}
async function processHook({ queueItem, world, runId, global }) {
  try {
    const hookMetadata = typeof queueItem.metadata === "undefined" ? void 0 : dehydrateStepArguments(queueItem.metadata, global);
    await world.hooks.create(runId, {
      hookId: queueItem.correlationId,
      token: queueItem.token,
      metadata: hookMetadata
    });
    await world.events.create(runId, {
      eventType: "hook_created",
      correlationId: queueItem.correlationId
    });
  } catch (err) {
    if (WorkflowAPIError.is(err)) {
      if (err.status === 409) {
        console.warn(`Hook with correlation ID "${queueItem.correlationId}" already exists, skipping: ${err.message}`);
        return;
      } else if (err.status === 410) {
        console.warn(`Workflow run "${runId}" has already completed, skipping hook "${queueItem.correlationId}": ${err.message}`);
        return;
      }
    }
    throw err;
  }
}
async function processStep({ queueItem, world, runId, workflowName, workflowStartedAt, global }) {
  const dehydratedInput = dehydrateStepArguments({
    args: queueItem.args,
    closureVars: queueItem.closureVars,
    thisVal: queueItem.thisVal
  }, global);
  const stepId = queueItem.correlationId;
  try {
    await world.steps.create(runId, {
      stepId: queueItem.correlationId,
      stepName: queueItem.stepName,
      input: dehydratedInput
    });
  } catch (err) {
    if (WorkflowAPIError.is(err) && err.status === 409) {
      console.warn(`Step "${queueItem.stepName}" with correlation ID "${queueItem.correlationId}" already exists, proceeding with queue write`);
    } else {
      throw err;
    }
  }
  await queueMessage(world, `__wkf_step_${queueItem.stepName}`, {
    workflowName,
    workflowRunId: runId,
    workflowStartedAt,
    stepId,
    traceCarrier: await serializeTraceCarrier(),
    requestedAt: /* @__PURE__ */ new Date()
  }, {
    idempotencyKey: queueItem.correlationId
  });
}
async function processWait({ queueItem, world, runId }) {
  try {
    if (!queueItem.hasCreatedEvent) {
      await world.events.create(runId, {
        eventType: "wait_created",
        correlationId: queueItem.correlationId,
        eventData: {
          resumeAt: queueItem.resumeAt
        }
      });
    }
    const now = Date.now();
    const resumeAtMs = queueItem.resumeAt.getTime();
    const delayMs = Math.max(1e3, resumeAtMs - now);
    return Math.ceil(delayMs / 1e3);
  } catch (err) {
    if (WorkflowAPIError.is(err) && err.status === 409) {
      console.warn(`Wait with correlation ID "${queueItem.correlationId}" already exists, skipping: ${err.message}`);
      return null;
    }
    throw err;
  }
}
async function handleSuspension({ suspension, world, runId, workflowName, workflowStartedAt, span }) {
  const stepItems = suspension.steps.filter((item) => item.type === "step");
  const hookItems = suspension.steps.filter((item) => item.type === "hook");
  const waitItems = suspension.steps.filter((item) => item.type === "wait");
  await Promise.all(hookItems.map((queueItem) => processHook({
    queueItem,
    world,
    runId,
    global: suspension.globalThis
  })));
  const [, waitTimeouts] = await Promise.all([
    Promise.all(stepItems.map((queueItem) => processStep({
      queueItem,
      world,
      runId,
      workflowName,
      workflowStartedAt,
      global: suspension.globalThis
    }))),
    Promise.all(waitItems.map((queueItem) => processWait({
      queueItem,
      world,
      runId
    })))
  ]);
  const minTimeoutSeconds = waitTimeouts.reduce((min, timeout) => {
    if (timeout === null)
      return min;
    if (min === null)
      return timeout;
    return Math.min(min, timeout);
  }, null);
  span?.setAttributes({
    ...WorkflowRunStatus("workflow_suspended"),
    ...WorkflowStepsCreated(stepItems.length),
    ...WorkflowHooksCreated(hookItems.length),
    ...WorkflowWaitsCreated(waitItems.length)
  });
  if (minTimeoutSeconds !== null) {
    return { timeoutSeconds: minTimeoutSeconds };
  }
  return {};
}
function remapErrorStack(stack, filename, workflowCode) {
  const sourceMapMatch = workflowCode.match(/\/\/# sourceMappingURL=data:application\/json;base64,(.+)/);
  if (!sourceMapMatch) {
    return stack;
  }
  try {
    const base64 = sourceMapMatch[1];
    const sourceMapJson = Buffer.from(base64, "base64").toString("utf-8");
    const sourceMapData = JSON.parse(sourceMapJson);
    const tracer = new TraceMap(sourceMapData);
    const lines = stack.split("\n");
    const remappedLines = lines.map((line) => {
      const frameMatch = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
      if (!frameMatch) {
        return line;
      }
      const [, functionName, file, lineStr, colStr] = frameMatch;
      if (!file.includes(filename)) {
        return line;
      }
      const lineNumber = parseInt(lineStr, 10);
      const columnNumber = parseInt(colStr, 10);
      const original = originalPositionFor(tracer, {
        line: lineNumber,
        column: columnNumber
      });
      if (original.source && original.line !== null) {
        const func = functionName || original.name || "anonymous";
        const col = original.column !== null ? original.column : columnNumber;
        return `    at ${func} (${original.source}:${original.line}:${col})`;
      }
      return line;
    });
    return remappedLines.join("\n");
  } catch (e) {
    return stack;
  }
}
function getErrorName(v) {
  if (types.isNativeError(v)) {
    return v.name;
  }
  return "Error";
}
function getErrorStack(v) {
  if (types.isNativeError(v)) {
    return v.stack ?? "";
  }
  return "";
}
function buildWorkflowSuspensionMessage(runId, stepCount, hookCount, waitCount) {
  if (stepCount === 0 && hookCount === 0 && waitCount === 0) {
    return null;
  }
  const parts = [];
  if (stepCount > 0) {
    parts.push(`${stepCount} ${pluralize("step", "steps", stepCount)}`);
  }
  if (hookCount > 0) {
    parts.push(`${hookCount} ${pluralize("hook", "hooks", hookCount)}`);
  }
  if (waitCount > 0) {
    parts.push(`${waitCount} ${pluralize("timer", "timers", waitCount)}`);
  }
  const resumeMsgParts = [];
  if (stepCount > 0) {
    resumeMsgParts.push("steps are completed");
  }
  if (hookCount > 0) {
    resumeMsgParts.push("hooks are received");
  }
  if (waitCount > 0) {
    resumeMsgParts.push("timers have elapsed");
  }
  const resumeMsg = resumeMsgParts.join(" and ");
  return `[Workflows] "${runId}" - ${parts.join(" and ")} to be enqueued
  Workflow will suspend and resume when ${resumeMsg}`;
}
function getWorkflowRunStreamId(runId, namespace) {
  const streamId = `${runId.replace("wrun_", "strm_")}_user`;
  if (!namespace) {
    return streamId;
  }
  const encodedNamespace = Buffer.from(namespace, "utf-8").toString("base64url");
  return `${streamId}_${encodedNamespace}`;
}
async function waitedUntil(fn) {
  const result = fn();
  functionsExports.waitUntil(result.catch(() => {
  }));
  return result;
}
var EventConsumerResult;
(function(EventConsumerResult2) {
  EventConsumerResult2[EventConsumerResult2["Consumed"] = 0] = "Consumed";
  EventConsumerResult2[EventConsumerResult2["NotConsumed"] = 1] = "NotConsumed";
  EventConsumerResult2[EventConsumerResult2["Finished"] = 2] = "Finished";
})(EventConsumerResult || (EventConsumerResult = {}));
class EventsConsumer {
  eventIndex;
  events = [];
  callbacks = [];
  constructor(events) {
    this.events = events;
    this.eventIndex = 0;
    eventsLogger.debug("EventsConsumer initialized", { events });
  }
  /**
   * Registers a callback function to be called after an event has been consumed
   * by a different callback. The callback can return:
   *  - `EventConsumerResult.Consumed` the event is considered consumed and will not be passed to any other callback, but the callback will remain in the callbacks list
   *  - `EventConsumerResult.NotConsumed` the event is passed to the next callback
   *  - `EventConsumerResult.Finished` the event is considered consumed and the callback is removed from the callbacks list
   *
   * @param fn - The callback function to register.
   */
  subscribe(fn) {
    this.callbacks.push(fn);
    process.nextTick(this.consume);
  }
  consume = () => {
    const currentEvent = this.events[this.eventIndex] ?? null;
    for (let i = 0; i < this.callbacks.length; i++) {
      const callback = this.callbacks[i];
      let handled = EventConsumerResult.NotConsumed;
      try {
        handled = callback(currentEvent);
      } catch (error) {
        eventsLogger.error("EventConsumer callback threw an error", { error });
        console.error("EventConsumer callback threw an error", error);
      }
      eventsLogger.debug("EventConsumer callback result", {
        handled: EventConsumerResult[handled],
        eventIndex: this.eventIndex,
        eventId: currentEvent?.eventId
      });
      if (handled === EventConsumerResult.Consumed || handled === EventConsumerResult.Finished) {
        this.eventIndex++;
        if (handled === EventConsumerResult.Finished) {
          this.callbacks.splice(i, 1);
        }
        process.nextTick(this.consume);
        return;
      }
    }
  };
}
function createUseStep(ctx) {
  return function useStep(stepName, closureVarsFn) {
    const stepFunction = function(...args) {
      const { promise, resolve, reject } = withResolvers();
      const correlationId = `step_${ctx.generateUlid()}`;
      const queueItem = {
        type: "step",
        correlationId,
        stepName,
        args
      };
      if (this !== void 0 && this !== null && this !== globalThis) {
        queueItem.thisVal = this;
      }
      const closureVars = closureVarsFn?.();
      if (closureVars) {
        queueItem.closureVars = closureVars;
      }
      ctx.invocationsQueue.set(correlationId, queueItem);
      let hasSeenStepStarted = false;
      stepLogger.debug("Step consumer setup", {
        correlationId,
        stepName,
        args
      });
      ctx.eventsConsumer.subscribe((event) => {
        if (!event) {
          setTimeout(() => {
            ctx.onWorkflowError(new WorkflowSuspension(ctx.invocationsQueue, ctx.globalThis));
          }, 0);
          return EventConsumerResult.NotConsumed;
        }
        stepLogger.debug("Step consumer event processing", {
          correlationId,
          stepName,
          args: args.join(", "),
          incomingCorrelationId: event.correlationId,
          isMatch: correlationId === event.correlationId,
          eventType: event.eventType
        });
        if (event.correlationId !== correlationId) {
          return EventConsumerResult.NotConsumed;
        }
        if (event.eventType === "step_started") {
          if (!hasSeenStepStarted) {
            if (ctx.invocationsQueue.has(correlationId)) {
              ctx.invocationsQueue.delete(correlationId);
            } else {
              setTimeout(() => {
                reject(new WorkflowRuntimeError(`Corrupted event log: step ${correlationId} (${stepName}) started but not found in invocation queue`));
              }, 0);
              return EventConsumerResult.Finished;
            }
            hasSeenStepStarted = true;
          }
          return EventConsumerResult.Consumed;
        }
        if (event.eventType === "step_failed") {
          if (event.eventData.fatal) {
            setTimeout(() => {
              const error = new FatalError(event.eventData.error);
              if (event.eventData.stack) {
                error.stack = event.eventData.stack;
              }
              reject(error);
            }, 0);
            return EventConsumerResult.Finished;
          } else {
            return EventConsumerResult.Consumed;
          }
        } else if (event.eventType === "step_completed") {
          const hydratedResult = hydrateStepReturnValue(event.eventData.result, ctx.globalThis);
          setTimeout(() => {
            resolve(hydratedResult);
          }, 0);
          return EventConsumerResult.Finished;
        } else {
          setTimeout(() => {
            reject(new WorkflowRuntimeError(`Unexpected event type: "${event.eventType}"`));
          }, 0);
          return EventConsumerResult.Finished;
        }
      });
      return promise;
    };
    const functionName = stepName.split("//").pop();
    Object.defineProperty(stepFunction, "name", {
      value: functionName
    });
    Object.defineProperty(stepFunction, "stepId", {
      value: stepName,
      writable: false,
      enumerable: false,
      configurable: false
    });
    if (closureVarsFn) {
      Object.defineProperty(stepFunction, "__closureVarsFn", {
        value: closureVarsFn,
        writable: false,
        enumerable: false,
        configurable: false
      });
    }
    return stepFunction;
  };
}
function createRandomUUID(rng) {
  return function randomUUID() {
    const chars = "0123456789abcdef";
    let uuid = "";
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) {
        uuid += "-";
      } else if (i === 14) {
        uuid += "4";
      } else if (i === 19) {
        uuid += chars[Math.floor(rng() * 4) + 8];
      } else {
        uuid += chars[Math.floor(rng() * 16)];
      }
    }
    return uuid;
  };
}
function createContext(options) {
  let { fixedTimestamp } = options;
  const { seed } = options;
  const rng = seedrandom(seed);
  const context = createContext$1();
  const g = runInContext("globalThis", context);
  g.Math.random = rng;
  const Date_ = g.Date;
  g.Date = function Date2(...args) {
    if (args.length === 0) {
      return new Date_(fixedTimestamp);
    }
    return new Date_(...args);
  };
  g.Date.prototype = Date_.prototype;
  Object.setPrototypeOf(g.Date, Date_);
  g.Date.now = () => fixedTimestamp;
  const originalCrypto = globalThis.crypto;
  const originalSubtle = originalCrypto.subtle;
  function getRandomValues(array) {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(rng() * 256);
    }
    return array;
  }
  const randomUUID = createRandomUUID(rng);
  const boundDigest = originalSubtle.digest.bind(originalSubtle);
  g.crypto = new Proxy(originalCrypto, {
    get(target, prop) {
      if (prop === "getRandomValues") {
        return getRandomValues;
      }
      if (prop === "randomUUID") {
        return randomUUID;
      }
      if (prop === "subtle") {
        return new Proxy(originalSubtle, {
          get(target2, prop2) {
            if (prop2 === "generateKey") {
              return () => {
                throw new Error("Not implemented");
              };
            } else if (prop2 === "digest") {
              return boundDigest;
            }
            return target2[prop2];
          }
        });
      }
      return target[prop];
    }
  });
  g.process = {
    env: Object.freeze({ ...process.env })
  };
  g.Headers = globalThis.Headers;
  g.TextEncoder = globalThis.TextEncoder;
  g.TextDecoder = globalThis.TextDecoder;
  g.console = globalThis.console;
  g.URL = globalThis.URL;
  g.URLSearchParams = globalThis.URLSearchParams;
  g.structuredClone = globalThis.structuredClone;
  g.exports = {};
  g.module = { exports: g.exports };
  return {
    context,
    globalThis: g,
    updateTimestamp: (timestamp) => {
      fixedTimestamp = timestamp;
    }
  };
}
const WORKFLOW_CONTEXT_SYMBOL = /* @__PURE__ */ Symbol.for("WORKFLOW_CONTEXT");
function createCreateHook(ctx) {
  return function createHookImpl(options = {}) {
    const correlationId = `hook_${ctx.generateUlid()}`;
    const token = options.token ?? ctx.generateNanoid();
    ctx.invocationsQueue.set(correlationId, {
      type: "hook",
      correlationId,
      token,
      metadata: options.metadata
    });
    const payloadsQueue = [];
    const promises = [];
    let eventLogEmpty = false;
    webhookLogger.debug("Hook consumer setup", { correlationId, token });
    ctx.eventsConsumer.subscribe((event) => {
      if (!event) {
        eventLogEmpty = true;
        if (promises.length > 0) {
          setTimeout(() => {
            ctx.onWorkflowError(new WorkflowSuspension(ctx.invocationsQueue, ctx.globalThis));
          }, 0);
          return EventConsumerResult.Finished;
        }
      }
      if (event?.eventType === "hook_created" && event.correlationId === correlationId) {
        ctx.invocationsQueue.delete(correlationId);
        return EventConsumerResult.Consumed;
      }
      if (event?.eventType === "hook_received" && event.correlationId === correlationId) {
        if (promises.length > 0) {
          const next = promises.shift();
          if (next) {
            const payload = hydrateStepReturnValue(event.eventData.payload, ctx.globalThis);
            next.resolve(payload);
          }
        } else {
          payloadsQueue.push(event);
        }
        return EventConsumerResult.Consumed;
      }
      return EventConsumerResult.NotConsumed;
    });
    function createHookPromise() {
      const resolvers = withResolvers();
      if (payloadsQueue.length > 0) {
        const nextPayload = payloadsQueue.shift();
        if (nextPayload) {
          const payload = hydrateStepReturnValue(nextPayload.eventData.payload, ctx.globalThis);
          resolvers.resolve(payload);
          return resolvers.promise;
        }
      }
      if (eventLogEmpty) {
        setTimeout(() => {
          ctx.onWorkflowError(new WorkflowSuspension(ctx.invocationsQueue, ctx.globalThis));
        }, 0);
      }
      promises.push(resolvers);
      return resolvers.promise;
    }
    const hook = {
      token,
      // biome-ignore lint/suspicious/noThenProperty: Intentionally thenable
      then(onfulfilled, onrejected) {
        return createHookPromise().then(onfulfilled, onrejected);
      },
      // Support `for await (const payload of hook) { … }` syntax
      async *[Symbol.asyncIterator]() {
        while (true) {
          yield await this;
        }
      }
    };
    return hook;
  };
}
function createSleep(ctx) {
  return async function sleepImpl(param) {
    const { promise, resolve } = withResolvers();
    const correlationId = `wait_${ctx.generateUlid()}`;
    const resumeAt = parseDurationToDate(param);
    const waitItem = {
      type: "wait",
      correlationId,
      resumeAt
    };
    ctx.invocationsQueue.set(correlationId, waitItem);
    ctx.eventsConsumer.subscribe((event) => {
      if (!event) {
        setTimeout(() => {
          ctx.onWorkflowError(new WorkflowSuspension(ctx.invocationsQueue, ctx.globalThis));
        }, 0);
        return EventConsumerResult.NotConsumed;
      }
      if (event?.eventType === "wait_created" && event.correlationId === correlationId) {
        const queueItem = ctx.invocationsQueue.get(correlationId);
        if (queueItem && queueItem.type === "wait") {
          queueItem.hasCreatedEvent = true;
          queueItem.resumeAt = event.eventData.resumeAt;
        }
        return EventConsumerResult.Consumed;
      }
      if (event?.eventType === "wait_completed" && event.correlationId === correlationId) {
        ctx.invocationsQueue.delete(correlationId);
        setTimeout(() => {
          resolve();
        }, 0);
        return EventConsumerResult.Finished;
      }
      return EventConsumerResult.NotConsumed;
    });
    return promise;
  };
}
async function runWorkflow(workflowCode, workflowRun, events) {
  return trace(`WORKFLOW.run ${workflowRun.workflowName}`, async (span) => {
    span?.setAttributes({
      ...WorkflowName(workflowRun.workflowName),
      ...WorkflowRunId(workflowRun.runId),
      ...WorkflowRunStatus(workflowRun.status),
      ...WorkflowEventsCount(events.length)
    });
    const startedAt = workflowRun.startedAt;
    if (!startedAt) {
      throw new Error(`Workflow run "${workflowRun.runId}" has no "startedAt" timestamp (should not happen)`);
    }
    const port = await getPort();
    const { context, globalThis: vmGlobalThis, updateTimestamp } = createContext({
      seed: workflowRun.runId,
      fixedTimestamp: +startedAt
    });
    const workflowDiscontinuation = withResolvers();
    const ulid = monotonicFactory(() => vmGlobalThis.Math.random());
    const generateNanoid = customRandom(urlAlphabet, 21, (size) => new Uint8Array(size).map(() => 256 * vmGlobalThis.Math.random()));
    const workflowContext = {
      globalThis: vmGlobalThis,
      onWorkflowError: workflowDiscontinuation.reject,
      eventsConsumer: new EventsConsumer(events),
      generateUlid: () => ulid(+startedAt),
      generateNanoid,
      invocationsQueue: /* @__PURE__ */ new Map()
    };
    workflowContext.eventsConsumer.subscribe((event) => {
      const createdAt = event?.createdAt;
      if (createdAt) {
        updateTimestamp(+createdAt);
      }
      return EventConsumerResult.NotConsumed;
    });
    const useStep = createUseStep(workflowContext);
    const createHook = createCreateHook(workflowContext);
    const sleep = createSleep(workflowContext);
    vmGlobalThis[WORKFLOW_USE_STEP] = useStep;
    vmGlobalThis[WORKFLOW_CREATE_HOOK] = createHook;
    vmGlobalThis[WORKFLOW_SLEEP] = sleep;
    vmGlobalThis[WORKFLOW_GET_STREAM_ID] = (namespace) => getWorkflowRunStreamId(workflowRun.runId, namespace);
    const url = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${port ?? 3e3}`;
    const ctx = {
      workflowRunId: workflowRun.runId,
      workflowStartedAt: new vmGlobalThis.Date(+startedAt),
      url
    };
    vmGlobalThis[WORKFLOW_CONTEXT_SYMBOL] = ctx;
    vmGlobalThis[STABLE_ULID] = ulid;
    vmGlobalThis.fetch = () => {
      throw new vmGlobalThis.Error(`Global "fetch" is unavailable in workflow functions. Use the "fetch" step function from "workflow" to make HTTP requests.

Learn more: https://useworkflow.dev/err/${ERROR_SLUGS.FETCH_IN_WORKFLOW_FUNCTION}`);
    };
    const timeoutErrorMessage = 'Timeout functions like "setTimeout" and "setInterval" are not supported in workflow functions. Use the "sleep" function from "workflow" for time-based delays.';
    vmGlobalThis.setTimeout = () => {
      throw new WorkflowRuntimeError(timeoutErrorMessage, {
        slug: ERROR_SLUGS.TIMEOUT_FUNCTIONS_IN_WORKFLOW
      });
    };
    vmGlobalThis.setInterval = () => {
      throw new WorkflowRuntimeError(timeoutErrorMessage, {
        slug: ERROR_SLUGS.TIMEOUT_FUNCTIONS_IN_WORKFLOW
      });
    };
    vmGlobalThis.clearTimeout = () => {
      throw new WorkflowRuntimeError(timeoutErrorMessage, {
        slug: ERROR_SLUGS.TIMEOUT_FUNCTIONS_IN_WORKFLOW
      });
    };
    vmGlobalThis.clearInterval = () => {
      throw new WorkflowRuntimeError(timeoutErrorMessage, {
        slug: ERROR_SLUGS.TIMEOUT_FUNCTIONS_IN_WORKFLOW
      });
    };
    vmGlobalThis.setImmediate = () => {
      throw new WorkflowRuntimeError(timeoutErrorMessage, {
        slug: ERROR_SLUGS.TIMEOUT_FUNCTIONS_IN_WORKFLOW
      });
    };
    vmGlobalThis.clearImmediate = () => {
      throw new WorkflowRuntimeError(timeoutErrorMessage, {
        slug: ERROR_SLUGS.TIMEOUT_FUNCTIONS_IN_WORKFLOW
      });
    };
    class Request {
      cache;
      credentials;
      destination;
      headers;
      integrity;
      method;
      mode;
      redirect;
      referrer;
      referrerPolicy;
      url;
      keepalive;
      signal;
      duplex;
      body;
      constructor(input, init) {
        if (typeof input === "string" || input instanceof vmGlobalThis.URL) {
          const urlString = String(input);
          try {
            new vmGlobalThis.URL(urlString);
            this.url = urlString;
          } catch (cause) {
            throw new TypeError(`Failed to parse URL from ${urlString}`, {
              cause
            });
          }
        } else {
          this.url = input.url;
          if (!init) {
            this.method = input.method;
            this.headers = new vmGlobalThis.Headers(input.headers);
            this.body = input.body;
            this.mode = input.mode;
            this.credentials = input.credentials;
            this.cache = input.cache;
            this.redirect = input.redirect;
            this.referrer = input.referrer;
            this.referrerPolicy = input.referrerPolicy;
            this.integrity = input.integrity;
            this.keepalive = input.keepalive;
            this.signal = input.signal;
            this.duplex = input.duplex;
            this.destination = input.destination;
            return;
          }
          this.method = input.method;
          this.headers = new vmGlobalThis.Headers(input.headers);
          this.body = input.body;
          this.mode = input.mode;
          this.credentials = input.credentials;
          this.cache = input.cache;
          this.redirect = input.redirect;
          this.referrer = input.referrer;
          this.referrerPolicy = input.referrerPolicy;
          this.integrity = input.integrity;
          this.keepalive = input.keepalive;
          this.signal = input.signal;
          this.duplex = input.duplex;
          this.destination = input.destination;
        }
        if (init?.method) {
          this.method = init.method.toUpperCase();
        } else if (typeof this.method !== "string") {
          this.method = "GET";
        }
        if (init?.headers) {
          this.headers = new vmGlobalThis.Headers(init.headers);
        } else if (typeof input === "string" || input instanceof vmGlobalThis.URL) {
          this.headers = new vmGlobalThis.Headers();
        }
        if (init?.mode !== void 0) {
          this.mode = init.mode;
        } else if (typeof this.mode !== "string") {
          this.mode = "cors";
        }
        if (init?.credentials !== void 0) {
          this.credentials = init.credentials;
        } else if (typeof this.credentials !== "string") {
          this.credentials = "same-origin";
        }
        if (init?.cache !== void 0) {
          this.cache = init.cache;
        } else if (typeof this.cache !== "string") {
          this.cache = "default";
        }
        if (init?.redirect !== void 0) {
          this.redirect = init.redirect;
        } else if (typeof this.redirect !== "string") {
          this.redirect = "follow";
        }
        if (init?.referrer !== void 0) {
          this.referrer = init.referrer;
        } else if (typeof this.referrer !== "string") {
          this.referrer = "about:client";
        }
        if (init?.referrerPolicy !== void 0) {
          this.referrerPolicy = init.referrerPolicy;
        } else if (typeof this.referrerPolicy !== "string") {
          this.referrerPolicy = "";
        }
        if (init?.integrity !== void 0) {
          this.integrity = init.integrity;
        } else if (typeof this.integrity !== "string") {
          this.integrity = "";
        }
        if (init?.keepalive !== void 0) {
          this.keepalive = init.keepalive;
        } else if (typeof this.keepalive !== "boolean") {
          this.keepalive = false;
        }
        if (init?.signal !== void 0) {
          this.signal = init.signal;
        } else if (!this.signal) {
          this.signal = { aborted: false };
        }
        if (!this.duplex) {
          this.duplex = "half";
        }
        if (!this.destination) {
          this.destination = "document";
        }
        const body = init?.body;
        if (body !== null && body !== void 0 && (this.method === "GET" || this.method === "HEAD")) {
          throw new TypeError(`Request with GET/HEAD method cannot have body.`);
        }
        if (body !== null && body !== void 0) {
          this.body = Object.create(vmGlobalThis.ReadableStream.prototype, {
            [BODY_INIT_SYMBOL]: {
              value: body,
              writable: false
            }
          });
        } else {
          this.body = null;
        }
      }
      clone() {
        ENOTSUP();
      }
      get bodyUsed() {
        return false;
      }
      // TODO: implement these
      blob;
      formData;
      async arrayBuffer() {
        return resArrayBuffer(this);
      }
      async bytes() {
        return new Uint8Array(await resArrayBuffer(this));
      }
      async json() {
        return resJson(this);
      }
      async text() {
        return resText(this);
      }
    }
    vmGlobalThis.Request = Request;
    const resJson = useStep("__builtin_response_json");
    const resText = useStep("__builtin_response_text");
    const resArrayBuffer = useStep("__builtin_response_array_buffer");
    class Response2 {
      type;
      url;
      status;
      statusText;
      body;
      headers;
      redirected;
      constructor(body, init) {
        this.status = init?.status ?? 200;
        this.statusText = init?.statusText ?? "";
        this.headers = new vmGlobalThis.Headers(init?.headers);
        this.type = "default";
        this.url = "";
        this.redirected = false;
        if (body !== null && body !== void 0 && (this.status === 204 || this.status === 205 || this.status === 304)) {
          throw new TypeError(`Response constructor: Invalid response status code ${this.status}`);
        }
        if (body !== null && body !== void 0) {
          this.body = Object.create(vmGlobalThis.ReadableStream.prototype, {
            [BODY_INIT_SYMBOL]: {
              value: body,
              writable: false
            }
          });
        } else {
          this.body = null;
        }
      }
      // TODO: implement these
      clone;
      blob;
      formData;
      get ok() {
        return this.status >= 200 && this.status < 300;
      }
      get bodyUsed() {
        return false;
      }
      async arrayBuffer() {
        return resArrayBuffer(this);
      }
      async bytes() {
        return new Uint8Array(await resArrayBuffer(this));
      }
      async json() {
        return resJson(this);
      }
      static json(data, init) {
        const body = JSON.stringify(data);
        const headers = new vmGlobalThis.Headers(init?.headers);
        if (!headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }
        return new Response2(body, { ...init, headers });
      }
      async text() {
        return resText(this);
      }
      static error() {
        ENOTSUP();
      }
      static redirect(url2, status = 302) {
        if (![301, 302, 303, 307, 308].includes(status)) {
          throw new RangeError(`Invalid redirect status code: ${status}. Must be one of: 301, 302, 303, 307, 308`);
        }
        const headers = new vmGlobalThis.Headers();
        headers.set("Location", String(url2));
        const response = Object.create(Response2.prototype);
        response.status = status;
        response.statusText = "";
        response.headers = headers;
        response.body = null;
        response.type = "default";
        response.url = "";
        response.redirected = false;
        return response;
      }
    }
    vmGlobalThis.Response = Response2;
    class ReadableStream2 {
      constructor() {
        ENOTSUP();
      }
      get locked() {
        return false;
      }
      cancel() {
        ENOTSUP();
      }
      getReader() {
        ENOTSUP();
      }
      pipeThrough() {
        ENOTSUP();
      }
      pipeTo() {
        ENOTSUP();
      }
      tee() {
        ENOTSUP();
      }
      values() {
        ENOTSUP();
      }
      static from() {
        ENOTSUP();
      }
      [Symbol.asyncIterator]() {
        ENOTSUP();
      }
    }
    vmGlobalThis.ReadableStream = ReadableStream2;
    class WritableStream2 {
      constructor() {
        ENOTSUP();
      }
      get locked() {
        return false;
      }
      abort() {
        ENOTSUP();
      }
      close() {
        ENOTSUP();
      }
      getWriter() {
        ENOTSUP();
      }
    }
    vmGlobalThis.WritableStream = WritableStream2;
    class TransformStream2 {
      readable;
      writable;
      constructor() {
        ENOTSUP();
      }
    }
    vmGlobalThis.TransformStream = TransformStream2;
    vmGlobalThis.console = globalThis.console;
    const SYMBOL_FOR_REQ_CONTEXT = /* @__PURE__ */ Symbol.for("@vercel/request-context");
    vmGlobalThis[SYMBOL_FOR_REQ_CONTEXT] = globalThis[SYMBOL_FOR_REQ_CONTEXT];
    const parsedName = parseWorkflowName(workflowRun.workflowName);
    const filename = parsedName?.path || workflowRun.workflowName;
    const workflowFn = runInContext(`${workflowCode}; globalThis.__private_workflows?.get(${JSON.stringify(workflowRun.workflowName)})`, context, { filename });
    if (typeof workflowFn !== "function") {
      throw new ReferenceError(`Workflow ${JSON.stringify(workflowRun.workflowName)} must be a function, but got "${typeof workflowFn}" instead`);
    }
    const args = hydrateWorkflowArguments(workflowRun.input, vmGlobalThis);
    span?.setAttributes({
      ...WorkflowArgumentsCount(args.length)
    });
    const result = await Promise.race([
      workflowFn(...args),
      workflowDiscontinuation.promise
    ]);
    const dehydrated = dehydrateWorkflowReturnValue(result, vmGlobalThis);
    span?.setAttributes({
      ...WorkflowResultType(typeof result)
    });
    return dehydrated;
  });
}
async function getHookByToken(token) {
  const world = getWorld();
  const hook = await world.hooks.getByToken(token);
  if (typeof hook.metadata !== "undefined") {
    hook.metadata = hydrateStepArguments(hook.metadata, [], hook.runId);
  }
  return hook;
}
async function resumeHook(tokenOrHook, payload) {
  return await waitedUntil(() => {
    return trace("HOOK.resume", async (span) => {
      const world = getWorld();
      try {
        const hook = typeof tokenOrHook === "string" ? await getHookByToken(tokenOrHook) : tokenOrHook;
        span?.setAttributes({
          ...HookToken(hook.token),
          ...HookId(hook.hookId),
          ...WorkflowRunId(hook.runId)
        });
        const ops = [];
        const dehydratedPayload = dehydrateStepReturnValue(payload, ops, hook.runId);
        functionsExports.waitUntil(Promise.all(ops).catch((err) => {
          if (err !== void 0)
            throw err;
        }));
        await world.events.create(hook.runId, {
          eventType: "hook_received",
          correlationId: hook.hookId,
          eventData: {
            payload: dehydratedPayload
          }
        });
        const workflowRun = await world.runs.get(hook.runId);
        span?.setAttributes({
          ...WorkflowName(workflowRun.workflowName)
        });
        const traceCarrier = workflowRun.executionContext?.traceCarrier;
        if (traceCarrier) {
          const context = await getSpanContextForTraceCarrier(traceCarrier);
          if (context) {
            span?.addLink?.({ context });
          }
        }
        await world.queue(`__wkf_workflow_${workflowRun.workflowName}`, {
          runId: hook.runId,
          // attach the trace carrier from the workflow run
          traceCarrier: workflowRun.executionContext?.traceCarrier ?? void 0
        }, {
          deploymentId: workflowRun.deploymentId
        });
        return hook;
      } catch (err) {
        span?.setAttributes({
          ...HookToken(typeof tokenOrHook === "string" ? tokenOrHook : tokenOrHook.token),
          ...HookFound(false)
        });
        throw err;
      }
    });
  });
}
async function resumeWebhook(token, request) {
  const hook = await getHookByToken(token);
  let response;
  let responseReadable;
  if (hook.metadata && typeof hook.metadata === "object" && "respondWith" in hook.metadata) {
    if (hook.metadata.respondWith === "manual") {
      const { readable, writable } = new TransformStream();
      responseReadable = readable;
      request[WEBHOOK_RESPONSE_WRITABLE] = writable;
    } else if (hook.metadata.respondWith instanceof Response) {
      response = hook.metadata.respondWith;
    } else {
      throw new WorkflowRuntimeError(`Invalid \`respondWith\` value: ${hook.metadata.respondWith}`, { slug: ERROR_SLUGS.WEBHOOK_INVALID_RESPOND_WITH_VALUE });
    }
  } else {
    response = new Response(null, { status: 202 });
  }
  await resumeHook(hook, request);
  if (responseReadable) {
    const reader = responseReadable.getReader();
    const chunk = await reader.read();
    if (chunk.value) {
      response = chunk.value;
    }
    reader.cancel();
  }
  if (!response) {
    throw new WorkflowRuntimeError("Workflow run did not send a response", {
      slug: ERROR_SLUGS.WEBHOOK_RESPONSE_NOT_SENT
    });
  }
  return response;
}
async function start(workflow, argsOrOptions, options) {
  return await waitedUntil(() => {
    const workflowName = workflow?.workflowId;
    if (!workflowName) {
      throw new WorkflowRuntimeError(`'start' received an invalid workflow function. Ensure the Workflow Development Kit is configured correctly and the function includes a 'use workflow' directive.`, {
        slug: "start-invalid-workflow-function"
      });
    }
    return trace(`WORKFLOW.start ${workflowName}`, async (span) => {
      span?.setAttributes({
        ...WorkflowName(workflowName),
        ...WorkflowOperation("start")
      });
      let args = [];
      let opts = {};
      if (Array.isArray(argsOrOptions)) {
        args = argsOrOptions;
      } else if (typeof argsOrOptions === "object") {
        opts = argsOrOptions;
      }
      span?.setAttributes({
        ...WorkflowArgumentsCount(args.length)
      });
      const world = opts?.world ?? getWorld();
      const deploymentId = opts.deploymentId ?? await world.getDeploymentId();
      const ops = [];
      const { promise: runIdPromise, resolve: resolveRunId } = withResolvers();
      const workflowArguments = dehydrateWorkflowArguments(args, ops, runIdPromise);
      const traceCarrier = await serializeTraceCarrier();
      const runResponse = await world.runs.create({
        deploymentId,
        workflowName,
        input: workflowArguments,
        executionContext: {
          traceCarrier
        }
      });
      resolveRunId(runResponse.runId);
      functionsExports.waitUntil(Promise.all(ops).catch((err) => {
        const isAbortError = err?.name === "AbortError" || err?.name === "ResponseAborted";
        if (!isAbortError) throw err;
      }));
      span?.setAttributes({
        ...WorkflowRunId(runResponse.runId),
        ...WorkflowRunStatus(runResponse.status),
        ...DeploymentId(deploymentId)
      });
      await world.queue(`__wkf_workflow_${workflowName}`, {
        runId: runResponse.runId,
        traceCarrier
      }, {
        deploymentId
      });
      return new Run(runResponse.runId);
    });
  });
}
const DEFAULT_STEP_MAX_RETRIES = 3;
const stepHandler = getWorldHandlers().createQueueHandler("__wkf_step_", async (message_, metadata) => {
  const healthCheck = parseHealthCheckPayload(message_);
  if (healthCheck) {
    await handleHealthCheckMessage(healthCheck, "step");
    return;
  }
  const { workflowName, workflowRunId, workflowStartedAt, stepId, traceCarrier: traceContext, requestedAt } = StepInvokePayloadSchema.parse(message_);
  const spanLinks = await linkToCurrentContext();
  return await withTraceContext(traceContext, async () => {
    const stepName = metadata.queueName.slice("__wkf_step_".length);
    const world = getWorld();
    const port = await getPort();
    return trace(`STEP ${stepName}`, { kind: await getSpanKind("CONSUMER"), links: spanLinks }, async (span) => {
      span?.setAttributes({
        ...StepName(stepName),
        ...StepAttempt(metadata.attempt),
        ...QueueName(metadata.queueName),
        ...QueueMessageId(metadata.messageId),
        ...getQueueOverhead({ requestedAt })
      });
      const stepFn = getStepFunction(stepName);
      if (!stepFn) {
        throw new Error(`Step "${stepName}" not found`);
      }
      if (typeof stepFn !== "function") {
        throw new Error(`Step "${stepName}" is not a function (got ${typeof stepFn})`);
      }
      const maxRetries = stepFn.maxRetries ?? DEFAULT_STEP_MAX_RETRIES;
      span?.setAttributes({
        ...WorkflowName(workflowName),
        ...WorkflowRunId(workflowRunId),
        ...StepId(stepId),
        ...StepMaxRetries(maxRetries),
        ...StepTracePropagated(!!traceContext)
      });
      let step = await world.steps.get(workflowRunId, stepId);
      runtimeLogger.debug("Step execution details", {
        stepName,
        stepId: step.stepId,
        status: step.status,
        attempt: step.attempt
      });
      span?.setAttributes({
        ...StepStatus(step.status)
      });
      const now = Date.now();
      if (step.retryAfter && step.retryAfter.getTime() > now) {
        const timeoutSeconds = Math.ceil((step.retryAfter.getTime() - now) / 1e3);
        span?.setAttributes({
          ...StepRetryTimeoutSeconds(timeoutSeconds)
        });
        runtimeLogger.debug("Step retryAfter timestamp not yet reached", {
          stepName,
          stepId: step.stepId,
          retryAfter: step.retryAfter,
          timeoutSeconds
        });
        return { timeoutSeconds };
      }
      let result;
      const attempt = step.attempt + 1;
      if (attempt > maxRetries + 1) {
        const retryCount = attempt - 1;
        const errorMessage = `Step "${stepName}" exceeded max retries (${retryCount} ${pluralize("retry", "retries", retryCount)})`;
        console.error(`[Workflows] "${workflowRunId}" - ${errorMessage}`);
        await world.steps.update(workflowRunId, stepId, {
          status: "failed",
          error: {
            message: errorMessage,
            stack: void 0
          }
        });
        await world.events.create(workflowRunId, {
          eventType: "step_failed",
          correlationId: stepId,
          eventData: {
            error: errorMessage,
            stack: step.error?.stack,
            fatal: true
          }
        });
        span?.setAttributes({
          ...StepStatus("failed"),
          ...StepRetryExhausted(true)
        });
        await queueMessage(world, `__wkf_workflow_${workflowName}`, {
          runId: workflowRunId,
          traceCarrier: await serializeTraceCarrier(),
          requestedAt: /* @__PURE__ */ new Date()
        });
        return;
      }
      try {
        if (!["pending", "running"].includes(step.status)) {
          console.error(`[Workflows] "${workflowRunId}" - Step invoked erroneously, expected status "pending" or "running", got "${step.status}" instead, skipping execution`);
          span?.setAttributes({
            ...StepSkipped(true),
            ...StepSkipReason(step.status)
          });
          const isTerminalStep = [
            "completed",
            "failed",
            "cancelled"
          ].includes(step.status);
          if (isTerminalStep) {
            await queueMessage(world, `__wkf_workflow_${workflowName}`, {
              runId: workflowRunId,
              traceCarrier: await serializeTraceCarrier(),
              requestedAt: /* @__PURE__ */ new Date()
            });
          }
          return;
        }
        await world.events.create(workflowRunId, {
          eventType: "step_started",
          // TODO: Replace with 'step_retrying'
          correlationId: stepId
        });
        step = await world.steps.update(workflowRunId, stepId, {
          attempt,
          status: "running"
        });
        if (!step.startedAt) {
          throw new WorkflowRuntimeError(`Step "${stepId}" has no "startedAt" timestamp`);
        }
        const ops = [];
        const hydratedInput = hydrateStepArguments(step.input, ops, workflowRunId);
        const args = hydratedInput.args;
        const thisVal = hydratedInput.thisVal ?? null;
        span?.setAttributes({
          ...StepArgumentsCount(args.length)
        });
        result = await contextStorage.run({
          stepMetadata: {
            stepId,
            stepStartedAt: /* @__PURE__ */ new Date(+step.startedAt),
            attempt
          },
          workflowMetadata: {
            workflowRunId,
            workflowStartedAt: /* @__PURE__ */ new Date(+workflowStartedAt),
            // TODO: there should be a getUrl method on the world interface itself. This
            // solution only works for vercel + local worlds.
            url: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${port ?? 3e3}`
          },
          ops,
          closureVars: hydratedInput.closureVars
        }, () => stepFn.apply(thisVal, args));
        result = dehydrateStepReturnValue(result, ops, workflowRunId);
        functionsExports.waitUntil(Promise.all(ops).catch((err) => {
          const isAbortError = err?.name === "AbortError" || err?.name === "ResponseAborted";
          if (!isAbortError)
            throw err;
        }));
        await world.steps.update(workflowRunId, stepId, {
          status: "completed",
          output: result
        });
        await world.events.create(workflowRunId, {
          eventType: "step_completed",
          correlationId: stepId,
          eventData: {
            result
          }
        });
        span?.setAttributes({
          ...StepStatus("completed"),
          ...StepResultType(typeof result)
        });
      } catch (err) {
        span?.setAttributes({
          ...StepErrorName(getErrorName(err)),
          ...StepErrorMessage(String(err))
        });
        if (WorkflowAPIError.is(err)) {
          if (err.status === 410) {
            console.warn(`Workflow run "${workflowRunId}" has already completed, skipping step "${stepId}": ${err.message}`);
            return;
          }
        }
        if (FatalError.is(err)) {
          const errorStack = getErrorStack(err);
          const stackLines = errorStack.split("\n").slice(0, 4);
          console.error(`[Workflows] "${workflowRunId}" - Encountered \`FatalError\` while executing step "${stepName}":
  > ${stackLines.join("\n    > ")}

Bubbling up error to parent workflow`);
          await world.events.create(workflowRunId, {
            eventType: "step_failed",
            correlationId: stepId,
            eventData: {
              error: String(err),
              stack: errorStack,
              fatal: true
            }
          });
          await world.steps.update(workflowRunId, stepId, {
            status: "failed",
            error: {
              message: err.message || String(err),
              stack: errorStack
              // TODO: include error codes when we define them
            }
          });
          span?.setAttributes({
            ...StepStatus("failed"),
            ...StepFatalError(true)
          });
        } else {
          const maxRetries2 = stepFn.maxRetries ?? DEFAULT_STEP_MAX_RETRIES;
          span?.setAttributes({
            ...StepAttempt(attempt),
            ...StepMaxRetries(maxRetries2)
          });
          if (attempt >= maxRetries2 + 1) {
            const errorStack = getErrorStack(err);
            const stackLines = errorStack.split("\n").slice(0, 4);
            const retryCount = attempt - 1;
            console.error(`[Workflows] "${workflowRunId}" - Encountered \`Error\` while executing step "${stepName}" (attempt ${attempt}, ${retryCount} ${pluralize("retry", "retries", retryCount)}):
  > ${stackLines.join("\n    > ")}

  Max retries reached
  Bubbling error to parent workflow`);
            const errorMessage = `Step "${stepName}" failed after ${maxRetries2} ${pluralize("retry", "retries", maxRetries2)}: ${String(err)}`;
            await world.events.create(workflowRunId, {
              eventType: "step_failed",
              correlationId: stepId,
              eventData: {
                error: errorMessage,
                stack: errorStack,
                fatal: true
              }
            });
            await world.steps.update(workflowRunId, stepId, {
              status: "failed",
              error: {
                message: errorMessage,
                stack: errorStack
              }
            });
            span?.setAttributes({
              ...StepStatus("failed"),
              ...StepRetryExhausted(true)
            });
          } else {
            if (RetryableError.is(err)) {
              console.warn(`[Workflows] "${workflowRunId}" - Encountered \`RetryableError\` while executing step "${stepName}" (attempt ${attempt}):
  > ${String(err.message)}

  This step has failed but will be retried`);
            } else {
              const stackLines = getErrorStack(err).split("\n").slice(0, 4);
              console.error(`[Workflows] "${workflowRunId}" - Encountered \`Error\` while executing step "${stepName}" (attempt ${attempt}):
  > ${stackLines.join("\n    > ")}

  This step has failed but will be retried`);
            }
            await world.events.create(workflowRunId, {
              eventType: "step_failed",
              correlationId: stepId,
              eventData: {
                error: String(err),
                stack: getErrorStack(err)
              }
            });
            await world.steps.update(workflowRunId, stepId, {
              status: "pending",
              // TODO: Should be "retrying" once we have that status
              ...RetryableError.is(err) && {
                retryAfter: err.retryAfter
              }
            });
            const timeoutSeconds = Math.max(1, RetryableError.is(err) ? Math.ceil((+err.retryAfter.getTime() - Date.now()) / 1e3) : 1);
            span?.setAttributes({
              ...StepRetryTimeoutSeconds(timeoutSeconds),
              ...StepRetryWillRetry(true)
            });
            return { timeoutSeconds };
          }
        }
      }
      await queueMessage(world, `__wkf_workflow_${workflowName}`, {
        runId: workflowRunId,
        traceCarrier: await serializeTraceCarrier(),
        requestedAt: /* @__PURE__ */ new Date()
      });
    });
  });
});
const stepEntrypoint = /* @__PURE__ */ withHealthCheck(stepHandler);
class Run {
  /**
   * The ID of the workflow run.
   */
  runId;
  /**
   * The world object.
   * @internal
   */
  world;
  constructor(runId) {
    this.runId = runId;
    this.world = getWorld();
  }
  /**
   * Cancels the workflow run.
   */
  async cancel() {
    await this.world.runs.cancel(this.runId);
  }
  /**
   * The status of the workflow run.
   */
  get status() {
    return this.world.runs.get(this.runId).then((run) => run.status);
  }
  /**
   * The return value of the workflow run.
   * Polls the workflow return value until it is completed.
   */
  get returnValue() {
    return this.pollReturnValue();
  }
  /**
   * The name of the workflow.
   */
  get workflowName() {
    return this.world.runs.get(this.runId).then((run) => run.workflowName);
  }
  /**
   * The timestamp when the workflow run was created.
   */
  get createdAt() {
    return this.world.runs.get(this.runId).then((run) => run.createdAt);
  }
  /**
   * The timestamp when the workflow run started execution.
   * Returns undefined if the workflow has not started yet.
   */
  get startedAt() {
    return this.world.runs.get(this.runId).then((run) => run.startedAt);
  }
  /**
   * The timestamp when the workflow run completed.
   * Returns undefined if the workflow has not completed yet.
   */
  get completedAt() {
    return this.world.runs.get(this.runId).then((run) => run.completedAt);
  }
  /**
   * The readable stream of the workflow run.
   */
  get readable() {
    return this.getReadable();
  }
  /**
   * Retrieves the workflow run's default readable stream, which reads chunks
   * written to the corresponding writable stream {@link getWritable}.
   *
   * @param options - The options for the readable stream.
   * @returns The `ReadableStream` for the workflow run.
   */
  getReadable(options = {}) {
    const { ops = [], global = globalThis, startIndex, namespace } = options;
    const name = getWorkflowRunStreamId(this.runId, namespace);
    return getExternalRevivers(global, ops, this.runId).ReadableStream({
      name,
      startIndex
    });
  }
  /**
   * Polls the workflow return value every 1 second until it is completed.
   * @internal
   * @returns The workflow return value.
   */
  async pollReturnValue() {
    while (true) {
      try {
        const run = await this.world.runs.get(this.runId);
        if (run.status === "completed") {
          return hydrateWorkflowReturnValue(run.output, [], this.runId);
        }
        if (run.status === "cancelled") {
          throw new WorkflowRunCancelledError(this.runId);
        }
        if (run.status === "failed") {
          throw new WorkflowRunFailedError(this.runId, run.error);
        }
        throw new WorkflowRunNotCompletedError(this.runId, run.status);
      } catch (error) {
        if (WorkflowRunNotCompletedError.is(error)) {
          await new Promise((resolve) => setTimeout(resolve, 1e3));
          continue;
        }
        throw error;
      }
    }
  }
}
function workflowEntrypoint(workflowCode) {
  const handler = getWorldHandlers().createQueueHandler("__wkf_workflow_", async (message_, metadata) => {
    const healthCheck = parseHealthCheckPayload(message_);
    if (healthCheck) {
      await handleHealthCheckMessage(healthCheck, "workflow");
      return;
    }
    const { runId, traceCarrier: traceContext, requestedAt } = WorkflowInvokePayloadSchema.parse(message_);
    const workflowName = metadata.queueName.slice("__wkf_workflow_".length);
    const spanLinks = await linkToCurrentContext();
    return await withTraceContext(traceContext, async () => {
      const world = getWorld();
      return trace(`WORKFLOW ${workflowName}`, { links: spanLinks }, async (span) => {
        span?.setAttributes({
          ...WorkflowName(workflowName),
          ...WorkflowOperation("execute"),
          ...QueueName(metadata.queueName),
          ...QueueMessageId(metadata.messageId),
          ...getQueueOverhead({ requestedAt })
        });
        span?.setAttributes({
          ...WorkflowRunId(runId),
          ...WorkflowTracePropagated(!!traceContext)
        });
        let workflowStartedAt = -1;
        try {
          let workflowRun = await world.runs.get(runId);
          if (workflowRun.status === "pending") {
            workflowRun = await world.runs.update(runId, {
              // This sets the `startedAt` timestamp at the database level
              status: "running"
            });
          }
          if (!workflowRun.startedAt) {
            throw new Error(`Workflow run "${runId}" has no "startedAt" timestamp`);
          }
          workflowStartedAt = +workflowRun.startedAt;
          span?.setAttributes({
            ...WorkflowRunStatus(workflowRun.status),
            ...WorkflowStartedAt(workflowStartedAt)
          });
          if (workflowRun.status !== "running") {
            console.warn(`Workflow "${runId}" has status "${workflowRun.status}", skipping`);
            return;
          }
          const events = await getAllWorkflowRunEvents(workflowRun.runId);
          const now = Date.now();
          for (const event of events) {
            if (event.eventType === "wait_created") {
              const resumeAt = event.eventData.resumeAt;
              const hasCompleted = events.some((e) => e.eventType === "wait_completed" && e.correlationId === event.correlationId);
              if (!hasCompleted && now >= resumeAt.getTime()) {
                const completedEvent = await world.events.create(runId, {
                  eventType: "wait_completed",
                  correlationId: event.correlationId
                });
                events.push(completedEvent);
              }
            }
          }
          const result = await runWorkflow(workflowCode, workflowRun, events);
          await world.runs.update(runId, {
            status: "completed",
            output: result
          });
          span?.setAttributes({
            ...WorkflowRunStatus("completed"),
            ...WorkflowEventsCount(events.length)
          });
        } catch (err) {
          if (WorkflowSuspension.is(err)) {
            const suspensionMessage = buildWorkflowSuspensionMessage(runId, err.stepCount, err.hookCount, err.waitCount);
            if (suspensionMessage) {
              runtimeLogger.debug(suspensionMessage);
            }
            const result = await handleSuspension({
              suspension: err,
              world,
              runId,
              workflowName,
              workflowStartedAt,
              span
            });
            if (result.timeoutSeconds !== void 0) {
              return { timeoutSeconds: result.timeoutSeconds };
            }
          } else {
            const errorName = getErrorName(err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            let errorStack = getErrorStack(err);
            if (errorStack) {
              const parsedName = parseWorkflowName(workflowName);
              const filename = parsedName?.path || workflowName;
              errorStack = remapErrorStack(errorStack, filename, workflowCode);
            }
            console.error(`${errorName} while running "${runId}" workflow:

${errorStack}`);
            await world.runs.update(runId, {
              status: "failed",
              error: {
                message: errorMessage,
                stack: errorStack
                // TODO: include error codes when we define them
              }
            });
            span?.setAttributes({
              ...WorkflowRunStatus("failed"),
              ...WorkflowErrorName(errorName),
              ...WorkflowErrorMessage(String(err))
            });
          }
        }
      });
    });
  });
  return withHealthCheck(handler);
}
export {
  Run as R,
  registerStepFunction as a,
  start as b,
  resumeWebhook as r,
  stepEntrypoint as s,
  workflowEntrypoint as w
};
