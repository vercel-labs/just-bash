import { C as Client } from "../@vercel/queue.mjs";
import os__default from "node:os";
import { a as distExports } from "../@vercel/oidc.mjs";
import { a as WorkflowAPIError, e as WorkflowRunNotFoundError } from "./errors.mjs";
import { d as StructuredErrorSchema, M as MessageId, V as ValidQueueName, Q as QueuePayloadSchema, P as PaginatedResponseSchema, e as EventTypeSchema, E as EventSchema, c as HookSchema, f as WorkflowRunBaseSchema, a as StepSchema } from "./world.mjs";
import { o as object, s as string, z, n as number, b as any, e as array } from "../../../_libs/zod.mjs";
const version = "4.0.1-beta.28";
const DEFAULT_RESOLVE_DATA_OPTION = "all";
function dateToStringReplacer(_key, value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}
function serializeError(data) {
  const { error, ...rest } = data;
  if (error !== void 0) {
    return {
      ...rest,
      error: JSON.stringify({
        message: error.message,
        stack: error.stack,
        code: error.code
      })
    };
  }
  return data;
}
function deserializeError(obj) {
  const { error, ...rest } = obj;
  if (!error) {
    return obj;
  }
  try {
    const parsed = StructuredErrorSchema.parse(JSON.parse(error));
    return {
      ...rest,
      error: {
        message: parsed.message,
        stack: parsed.stack,
        code: parsed.code
      }
    };
  } catch {
    return {
      ...rest,
      error: {
        message: error
      }
    };
  }
}
const getUserAgent = () => {
  return `@workflow/world-vercel/${version} node-${process.version} ${os__default.platform()} (${os__default.arch()})`;
};
const getHttpUrl = (config) => {
  const projectConfig = config?.projectConfig;
  const defaultUrl = "https://vercel-workflow.com/api";
  const defaultProxyUrl = "https://api.vercel.com/v1/workflow";
  const usingProxy = (
    // Skipping proxy is specifically used for e2e testing. Normally, we assume calls from
    // CLI and web UI are not running inside the Vercel runtime environment, and so need to
    // use the proxy for authentication. However, during e2e tests, this is not the case,
    // so we allow skipping the proxy.
    !config?.skipProxy && Boolean(config?.baseUrl || projectConfig?.projectId && projectConfig?.teamId)
  );
  const baseUrl = config?.baseUrl || (usingProxy ? defaultProxyUrl : defaultUrl);
  return { baseUrl, usingProxy };
};
const getHeaders = (config) => {
  const projectConfig = config?.projectConfig;
  const headers = new Headers(config?.headers);
  headers.set("User-Agent", getUserAgent());
  if (projectConfig) {
    headers.set("x-vercel-environment", projectConfig.environment || "production");
    if (projectConfig.projectId) {
      headers.set("x-vercel-project-id", projectConfig.projectId);
    }
    if (projectConfig.teamId) {
      headers.set("x-vercel-team-id", projectConfig.teamId);
    }
  }
  return headers;
};
async function getHttpConfig(config) {
  const headers = getHeaders(config);
  const token = config?.token ?? await distExports.getVercelOidcToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const { baseUrl, usingProxy } = getHttpUrl(config);
  return { baseUrl, headers, usingProxy };
}
async function makeRequest({ endpoint, options = {}, config = {}, schema }) {
  const { baseUrl, headers } = await getHttpConfig(config);
  headers.set("Content-Type", "application/json");
  headers.set("X-Request-Time", Date.now().toString());
  const url = `${baseUrl}${endpoint}`;
  const request = new Request(url, {
    ...options,
    headers
  });
  const response = await fetch(request);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (process.env.DEBUG === "1") {
      const stringifiedHeaders = Array.from(headers.entries()).map(([key, value]) => `-H "${key}: ${value}"`).join(" ");
      console.error(`Failed to fetch, reproduce with:
curl -X ${request.method} ${stringifiedHeaders} "${url}"`);
    }
    throw new WorkflowAPIError(errorData.message || `${request.method} ${endpoint} -> HTTP ${response.status}: ${response.statusText}`, { url, status: response.status, code: errorData.code });
  }
  const text = await response.text();
  try {
    return schema.parse(JSON.parse(text));
  } catch (error) {
    throw new WorkflowAPIError(`Failed to parse server response for ${request.method} ${endpoint}:

${error}

Response body: ${text}`, { url, cause: error });
  }
}
const MessageWrapper = object({
  payload: QueuePayloadSchema,
  queueName: ValidQueueName,
  /**
   * The deployment ID to use when re-enqueueing the message.
   * This ensures the message is processed by the same deployment.
   */
  deploymentId: string().optional()
});
const VERCEL_QUEUE_MESSAGE_LIFETIME = Number(
  process.env.VERCEL_QUEUE_MESSAGE_LIFETIME || 86400
  // 24 hours in seconds
);
const MESSAGE_LIFETIME_BUFFER = Number(
  process.env.VERCEL_QUEUE_MESSAGE_LIFETIME_BUFFER || 3600
  // 1 hour buffer before lifetime expires
);
function createQueue(config) {
  const { baseUrl, usingProxy } = getHttpUrl(config);
  const headers = getHeaders(config);
  const queueClient = new Client({
    baseUrl: usingProxy ? baseUrl : void 0,
    basePath: usingProxy ? "/queues/v2/messages" : void 0,
    token: usingProxy ? config?.token : void 0,
    headers: Object.fromEntries(headers.entries())
  });
  const queue = async (queueName, payload, opts) => {
    const deploymentId = opts?.deploymentId ?? process.env.VERCEL_DEPLOYMENT_ID;
    if (!deploymentId) {
      throw new Error("No deploymentId provided and VERCEL_DEPLOYMENT_ID environment variable is not set. Queue messages require a deployment ID to route correctly. Either set VERCEL_DEPLOYMENT_ID or provide deploymentId in options.");
    }
    const hasEncoder = typeof MessageWrapper.encode === "function";
    if (!hasEncoder) {
      console.warn("Using zod v3 compatibility mode for queue() calls - this may not work as expected");
    }
    const encoder = hasEncoder ? MessageWrapper.encode : (data) => data;
    const encoded = encoder({
      payload,
      queueName,
      // Store deploymentId in the message so it can be preserved when re-enqueueing
      deploymentId: opts?.deploymentId
    });
    const sanitizedQueueName = queueName.replace(/[^A-Za-z0-9-_]/g, "-");
    const { messageId } = await queueClient.send(sanitizedQueueName, encoded, opts);
    return { messageId: MessageId.parse(messageId) };
  };
  const createQueueHandler = (prefix, handler) => {
    return queueClient.handleCallback({
      [`${prefix}*`]: {
        default: async (body, meta) => {
          const { payload, queueName, deploymentId } = MessageWrapper.parse(body);
          const result = await handler(payload, {
            queueName,
            messageId: MessageId.parse(meta.messageId),
            attempt: meta.deliveryCount
          });
          if (typeof result?.timeoutSeconds === "number") {
            const now = Date.now();
            const messageAge = (now - meta.createdAt.getTime()) / 1e3;
            const maxAllowedTimeout = VERCEL_QUEUE_MESSAGE_LIFETIME - MESSAGE_LIFETIME_BUFFER - messageAge;
            if (maxAllowedTimeout <= 0) {
              await queue(queueName, payload, { deploymentId });
              return void 0;
            } else if (result.timeoutSeconds > maxAllowedTimeout) {
              result.timeoutSeconds = maxAllowedTimeout;
            }
          }
          return result;
        }
      }
    });
  };
  const getDeploymentId = async () => {
    const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;
    if (!deploymentId) {
      throw new Error("VERCEL_DEPLOYMENT_ID environment variable is not set");
    }
    return deploymentId;
  };
  return { queue, createQueueHandler, getDeploymentId };
}
function filterEventData(event, resolveData) {
  if (resolveData === "none") {
    const { eventData: _eventData, ...rest } = event;
    return rest;
  }
  return event;
}
const EventWithRefsSchema = z.object({
  eventId: z.string(),
  runId: z.string(),
  eventType: EventTypeSchema,
  correlationId: z.string().optional(),
  eventDataRef: z.any().optional(),
  createdAt: z.coerce.date()
});
async function getWorkflowRunEvents(params, config) {
  const searchParams = new URLSearchParams();
  const { pagination, resolveData = DEFAULT_RESOLVE_DATA_OPTION } = params;
  let runId;
  let correlationId;
  if ("runId" in params) {
    runId = params.runId;
  } else {
    correlationId = params.correlationId;
  }
  if (!runId && !correlationId) {
    throw new Error("Either runId or correlationId must be provided");
  }
  if (pagination?.limit)
    searchParams.set("limit", pagination.limit.toString());
  if (pagination?.cursor)
    searchParams.set("cursor", pagination.cursor);
  if (pagination?.sortOrder)
    searchParams.set("sortOrder", pagination.sortOrder);
  if (correlationId)
    searchParams.set("correlationId", correlationId);
  const remoteRefBehavior = resolveData === "none" ? "lazy" : "resolve";
  searchParams.set("remoteRefBehavior", remoteRefBehavior);
  const queryString = searchParams.toString();
  const query = queryString ? `?${queryString}` : "";
  const endpoint = correlationId ? `/v1/events${query}` : `/v1/runs/${runId}/events${query}`;
  const response = await makeRequest({
    endpoint,
    options: { method: "GET" },
    config,
    schema: PaginatedResponseSchema(remoteRefBehavior === "lazy" ? EventWithRefsSchema : EventSchema)
  });
  return {
    ...response,
    data: response.data.map((event) => filterEventData(event, resolveData))
  };
}
async function createWorkflowRunEvent(id, data, params, config) {
  const resolveData = params?.resolveData ?? DEFAULT_RESOLVE_DATA_OPTION;
  const event = await makeRequest({
    endpoint: `/v1/runs/${id}/events`,
    options: {
      method: "POST",
      body: JSON.stringify(data, dateToStringReplacer)
    },
    config,
    schema: EventSchema
  });
  return filterEventData(event, resolveData);
}
function filterHookData(hook, resolveData) {
  if (resolveData === "none") {
    const { metadataRef: _metadataRef, ...rest } = hook;
    return rest;
  }
  return hook;
}
const HookWithRefsSchema = HookSchema.omit({
  metadata: true
}).extend({
  metadataRef: z.any().optional()
});
async function listHooks(params, config) {
  const { runId, pagination, resolveData = DEFAULT_RESOLVE_DATA_OPTION } = params;
  const searchParams = new URLSearchParams();
  if (pagination?.limit)
    searchParams.set("limit", pagination.limit.toString());
  if (pagination?.cursor)
    searchParams.set("cursor", pagination.cursor);
  if (pagination?.sortOrder)
    searchParams.set("sortOrder", pagination.sortOrder);
  const remoteRefBehavior = resolveData === "none" ? "lazy" : "resolve";
  searchParams.set("remoteRefBehavior", remoteRefBehavior);
  if (runId)
    searchParams.set("runId", runId);
  const queryString = searchParams.toString();
  const endpoint = `/v1/hooks${queryString ? `?${queryString}` : ""}`;
  const response = await makeRequest({
    endpoint,
    options: { method: "GET" },
    config,
    schema: PaginatedResponseSchema(remoteRefBehavior === "lazy" ? HookWithRefsSchema : HookSchema)
  });
  return {
    ...response,
    data: response.data.map((hook) => filterHookData(hook, resolveData))
  };
}
async function getHook(hookId, params, config) {
  const resolveData = params?.resolveData || "all";
  const endpoint = `/v1/hooks/${hookId}`;
  const hook = await makeRequest({
    endpoint,
    options: { method: "GET" },
    config,
    schema: HookSchema
  });
  return filterHookData(hook, resolveData);
}
async function createHook(runId, data, config) {
  return makeRequest({
    endpoint: `/v1/hooks/create`,
    options: {
      method: "POST",
      body: JSON.stringify({
        runId,
        ...data
      }, dateToStringReplacer)
    },
    config,
    schema: HookSchema
  });
}
async function getHookByToken(token, config) {
  return makeRequest({
    endpoint: `/v1/hooks/by-token?token=${encodeURIComponent(token)}`,
    options: {
      method: "GET"
    },
    config,
    schema: HookSchema
  });
}
async function disposeHook(hookId, config) {
  return makeRequest({
    endpoint: `/v1/hooks/${hookId}`,
    options: { method: "DELETE" },
    config,
    schema: HookSchema
  });
}
const WorkflowRunWireBaseSchema = WorkflowRunBaseSchema.omit({
  error: true
}).extend({
  // Backend returns error as a JSON string, not an object
  error: string().optional()
});
const WorkflowRunWireSchema = WorkflowRunWireBaseSchema;
const WorkflowRunWireWithRefsSchema = WorkflowRunWireBaseSchema.omit({
  input: true,
  output: true
}).extend({
  // We discard the results of the refs, so we don't care about the type here
  inputRef: any().optional(),
  outputRef: any().optional(),
  input: array(any()).optional(),
  output: any().optional(),
  blobStorageBytes: number().optional(),
  streamStorageBytes: number().optional()
});
function filterRunData(run, resolveData) {
  if (resolveData === "none") {
    const { inputRef: _inputRef, outputRef: _outputRef, ...rest } = run;
    const deserialized = deserializeError(rest);
    return {
      ...deserialized,
      input: [],
      output: void 0
    };
  }
  return deserializeError(run);
}
async function listWorkflowRuns(params = {}, config) {
  const { workflowName, status, pagination, resolveData = DEFAULT_RESOLVE_DATA_OPTION } = params;
  const searchParams = new URLSearchParams();
  if (workflowName)
    searchParams.set("workflowName", workflowName);
  if (status)
    searchParams.set("status", status);
  if (pagination?.limit)
    searchParams.set("limit", pagination.limit.toString());
  if (pagination?.cursor)
    searchParams.set("cursor", pagination.cursor);
  if (pagination?.sortOrder)
    searchParams.set("sortOrder", pagination.sortOrder);
  const remoteRefBehavior = resolveData === "none" ? "lazy" : "resolve";
  searchParams.set("remoteRefBehavior", remoteRefBehavior);
  const queryString = searchParams.toString();
  const endpoint = `/v1/runs${queryString ? `?${queryString}` : ""}`;
  const response = await makeRequest({
    endpoint,
    options: { method: "GET" },
    config,
    schema: PaginatedResponseSchema(remoteRefBehavior === "lazy" ? WorkflowRunWireWithRefsSchema : WorkflowRunWireSchema)
  });
  return {
    ...response,
    data: response.data.map((run) => filterRunData(run, resolveData))
  };
}
async function createWorkflowRun(data, config) {
  const run = await makeRequest({
    endpoint: "/v1/runs/create",
    options: {
      method: "POST",
      body: JSON.stringify(data, dateToStringReplacer)
    },
    config,
    schema: WorkflowRunWireSchema
  });
  return deserializeError(run);
}
async function getWorkflowRun(id, params, config) {
  const resolveData = params?.resolveData ?? DEFAULT_RESOLVE_DATA_OPTION;
  const remoteRefBehavior = resolveData === "none" ? "lazy" : "resolve";
  const searchParams = new URLSearchParams();
  searchParams.set("remoteRefBehavior", remoteRefBehavior);
  const queryString = searchParams.toString();
  const endpoint = `/v1/runs/${id}${queryString ? `?${queryString}` : ""}`;
  try {
    const run = await makeRequest({
      endpoint,
      options: { method: "GET" },
      config,
      schema: remoteRefBehavior === "lazy" ? WorkflowRunWireWithRefsSchema : WorkflowRunWireSchema
    });
    return filterRunData(run, resolveData);
  } catch (error) {
    if (error instanceof WorkflowAPIError && error.status === 404) {
      throw new WorkflowRunNotFoundError(id);
    }
    throw error;
  }
}
async function updateWorkflowRun(id, data, config) {
  try {
    const serialized = serializeError(data);
    const run = await makeRequest({
      endpoint: `/v1/runs/${id}`,
      options: {
        method: "PUT",
        body: JSON.stringify(serialized, dateToStringReplacer)
      },
      config,
      schema: WorkflowRunWireSchema
    });
    return deserializeError(run);
  } catch (error) {
    if (error instanceof WorkflowAPIError && error.status === 404) {
      throw new WorkflowRunNotFoundError(id);
    }
    throw error;
  }
}
async function cancelWorkflowRun(id, params, config) {
  const resolveData = params?.resolveData ?? DEFAULT_RESOLVE_DATA_OPTION;
  const remoteRefBehavior = resolveData === "none" ? "lazy" : "resolve";
  const searchParams = new URLSearchParams();
  searchParams.set("remoteRefBehavior", remoteRefBehavior);
  const queryString = searchParams.toString();
  const endpoint = `/v1/runs/${id}/cancel${queryString ? `?${queryString}` : ""}`;
  try {
    const run = await makeRequest({
      endpoint,
      options: { method: "PUT" },
      config,
      schema: remoteRefBehavior === "lazy" ? WorkflowRunWireWithRefsSchema : WorkflowRunWireSchema
    });
    return filterRunData(run, resolveData);
  } catch (error) {
    if (error instanceof WorkflowAPIError && error.status === 404) {
      throw new WorkflowRunNotFoundError(id);
    }
    throw error;
  }
}
const StepWireSchema = StepSchema.omit({
  error: true
}).extend({
  // Backend returns error as a JSON string, not an object
  error: string().optional()
});
const StepWireWithRefsSchema = StepWireSchema.omit({
  input: true,
  output: true
}).extend({
  // We discard the results of the refs, so we don't care about the type here
  inputRef: any().optional(),
  outputRef: any().optional(),
  input: array(any()).optional(),
  output: any().optional()
});
function filterStepData(step, resolveData) {
  if (resolveData === "none") {
    const { inputRef: _inputRef, outputRef: _outputRef, ...rest } = step;
    const deserialized = deserializeError(rest);
    return {
      ...deserialized,
      input: [],
      output: void 0
    };
  }
  return deserializeError(step);
}
async function listWorkflowRunSteps(params, config) {
  const { runId, pagination, resolveData = DEFAULT_RESOLVE_DATA_OPTION } = params;
  const searchParams = new URLSearchParams();
  if (pagination?.cursor)
    searchParams.set("cursor", pagination.cursor);
  if (pagination?.limit)
    searchParams.set("limit", pagination.limit.toString());
  if (pagination?.sortOrder)
    searchParams.set("sortOrder", pagination.sortOrder);
  const remoteRefBehavior = resolveData === "none" ? "lazy" : "resolve";
  searchParams.set("remoteRefBehavior", remoteRefBehavior);
  const queryString = searchParams.toString();
  const endpoint = `/v1/runs/${runId}/steps${queryString ? `?${queryString}` : ""}`;
  const response = await makeRequest({
    endpoint,
    options: { method: "GET" },
    config,
    schema: PaginatedResponseSchema(remoteRefBehavior === "lazy" ? StepWireWithRefsSchema : StepWireSchema)
  });
  return {
    ...response,
    data: response.data.map((step) => filterStepData(step, resolveData))
  };
}
async function createStep(runId, data, config) {
  const step = await makeRequest({
    endpoint: `/v1/runs/${runId}/steps`,
    options: {
      method: "POST",
      body: JSON.stringify(data, dateToStringReplacer)
    },
    config,
    schema: StepWireSchema
  });
  return deserializeError(step);
}
async function updateStep(runId, stepId, data, config) {
  const serialized = serializeError(data);
  const step = await makeRequest({
    endpoint: `/v1/runs/${runId}/steps/${stepId}`,
    options: {
      method: "PUT",
      body: JSON.stringify(serialized, dateToStringReplacer)
    },
    config,
    schema: StepWireSchema
  });
  return deserializeError(step);
}
async function getStep(runId, stepId, params, config) {
  const resolveData = params?.resolveData ?? DEFAULT_RESOLVE_DATA_OPTION;
  const remoteRefBehavior = resolveData === "none" ? "lazy" : "resolve";
  const searchParams = new URLSearchParams();
  searchParams.set("remoteRefBehavior", remoteRefBehavior);
  const queryString = searchParams.toString();
  const endpoint = runId ? `/v1/runs/${runId}/steps/${stepId}${queryString ? `?${queryString}` : ""}` : `/v1/steps/${stepId}${queryString ? `?${queryString}` : ""}`;
  const step = await makeRequest({
    endpoint,
    options: { method: "GET" },
    config,
    schema: remoteRefBehavior === "lazy" ? StepWireWithRefsSchema : StepWireSchema
  });
  return filterStepData(step, resolveData);
}
function createStorage(config) {
  return {
    // Storage interface with namespaced methods
    runs: {
      create: (data) => createWorkflowRun(data, config),
      get: (id, params) => getWorkflowRun(id, params, config),
      update: (id, data) => updateWorkflowRun(id, data, config),
      list: (params) => listWorkflowRuns(params, config),
      cancel: (id, params) => cancelWorkflowRun(id, params, config)
    },
    steps: {
      create: (runId, data) => createStep(runId, data, config),
      get: (runId, stepId, params) => getStep(runId, stepId, params, config),
      update: (runId, stepId, data) => updateStep(runId, stepId, data, config),
      list: (params) => listWorkflowRunSteps(params, config)
    },
    events: {
      create: (runId, data, params) => createWorkflowRunEvent(runId, data, params, config),
      list: (params) => getWorkflowRunEvents(params, config),
      listByCorrelationId: (params) => getWorkflowRunEvents(params, config)
    },
    hooks: {
      create: (runId, data) => createHook(runId, data, config),
      get: (hookId, params) => getHook(hookId, params, config),
      getByToken: (token) => getHookByToken(token, config),
      list: (params) => listHooks(params, config),
      dispose: (hookId) => disposeHook(hookId, config)
    }
  };
}
function getStreamUrl(name, runId, httpConfig) {
  if (runId) {
    return new URL(`${httpConfig.baseUrl}/v1/runs/${runId}/stream/${encodeURIComponent(name)}`);
  }
  return new URL(`${httpConfig.baseUrl}/v1/stream/${encodeURIComponent(name)}`);
}
function createStreamer(config) {
  return {
    async writeToStream(name, runId, chunk) {
      const resolvedRunId = await runId;
      const httpConfig = await getHttpConfig(config);
      await fetch(getStreamUrl(name, resolvedRunId, httpConfig), {
        method: "PUT",
        body: chunk,
        headers: httpConfig.headers,
        duplex: "half"
      });
    },
    async closeStream(name, runId) {
      const resolvedRunId = await runId;
      const httpConfig = await getHttpConfig(config);
      httpConfig.headers.set("X-Stream-Done", "true");
      await fetch(getStreamUrl(name, resolvedRunId, httpConfig), {
        method: "PUT",
        headers: httpConfig.headers
      });
    },
    async readFromStream(name, startIndex) {
      const httpConfig = await getHttpConfig(config);
      const url = getStreamUrl(name, void 0, httpConfig);
      if (typeof startIndex === "number") {
        url.searchParams.set("startIndex", String(startIndex));
      }
      const res = await fetch(url, { headers: httpConfig.headers });
      if (!res.ok)
        throw new Error(`Failed to fetch stream: ${res.status}`);
      return res.body;
    },
    async listStreamsByRunId(runId) {
      const httpConfig = await getHttpConfig(config);
      const url = new URL(`${httpConfig.baseUrl}/v1/runs/${runId}/streams`);
      const res = await fetch(url, { headers: httpConfig.headers });
      if (!res.ok)
        throw new Error(`Failed to list streams: ${res.status}`);
      return await res.json();
    }
  };
}
function createVercelWorld(config) {
  return {
    ...createQueue(config),
    ...createStorage(config),
    ...createStreamer(config)
  };
}
export {
  createVercelWorld as c
};
