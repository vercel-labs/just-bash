import { b as getWorkflowPort } from "./utils.mjs";
import { mkdirSync, accessSync, constants, writeFileSync, unlinkSync, readFileSync, promises } from "node:fs";
import path__default from "node:path";
import { setTimeout as setTimeout$1 } from "node:timers/promises";
import { J as JsonTransport } from "../@vercel/queue.mjs";
import { l as libExports } from "../async-sema.mjs";
import { m as monotonicFactory, d as decodeTime } from "../../../_libs/ulid.mjs";
import { u as undiciExports } from "../undici.mjs";
import { z, Z as ZodError, s as string, o as object, e as array } from "../../../_libs/zod.mjs";
import { M as MessageId, V as ValidQueueName, E as EventSchema, a as StepSchema, b as WorkflowRunSchema, c as HookSchema } from "./world.mjs";
import { a as WorkflowAPIError, e as WorkflowRunNotFoundError } from "./errors.mjs";
import { EventEmitter } from "node:events";
function once(fn) {
  const result = {
    get value() {
      const value = fn();
      Object.defineProperty(result, "value", { value });
      return value;
    }
  };
  return result;
}
const getDataDirFromEnv = () => {
  return process.env.WORKFLOW_LOCAL_DATA_DIR || ".workflow-data";
};
const DEFAULT_RESOLVE_DATA_OPTION = "all";
const getBaseUrlFromEnv = () => {
  return process.env.WORKFLOW_LOCAL_BASE_URL;
};
const config = once(() => {
  const dataDir = getDataDirFromEnv();
  const baseUrl = getBaseUrlFromEnv();
  return { dataDir, baseUrl };
});
async function resolveBaseUrl(config2) {
  if (config2.baseUrl) {
    return config2.baseUrl;
  }
  if (process.env.WORKFLOW_LOCAL_BASE_URL) {
    return process.env.WORKFLOW_LOCAL_BASE_URL;
  }
  if (typeof config2.port === "number") {
    return `http://localhost:${config2.port}`;
  }
  if (process.env.PORT) {
    return `http://localhost:${process.env.PORT}`;
  }
  const detectedPort = await getWorkflowPort();
  if (detectedPort) {
    return `http://localhost:${detectedPort}`;
  }
  throw new Error("Unable to resolve base URL for workflow queue.");
}
const PACKAGE_NAME = "@workflow/world-local";
const PACKAGE_VERSION = "4.0.1-beta.20";
const VERSION_FILENAME = "version.txt";
class DataDirAccessError extends Error {
  dataDir;
  code;
  constructor(message, dataDir, code) {
    super(message);
    this.name = "DataDirAccessError";
    this.dataDir = dataDir;
    this.code = code;
  }
}
class DataDirVersionError extends Error {
  oldVersion;
  newVersion;
  suggestedVersion;
  constructor(message, oldVersion, newVersion, suggestedVersion) {
    super(message);
    this.name = "DataDirVersionError";
    this.oldVersion = oldVersion;
    this.newVersion = newVersion;
    this.suggestedVersion = suggestedVersion;
  }
}
function parseVersion(versionString) {
  const match = versionString.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) {
    throw new Error(`Invalid version string: "${versionString}"`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
    raw: versionString
  };
}
function formatVersion(version) {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.prerelease ? `${base}-${version.prerelease}` : base;
}
function parseVersionFile(content) {
  const trimmed = content.trim();
  const lastAtIndex = trimmed.lastIndexOf("@");
  if (lastAtIndex <= 0) {
    throw new Error(`Invalid version file content: "${content}"`);
  }
  const packageName = trimmed.substring(0, lastAtIndex);
  const versionString = trimmed.substring(lastAtIndex + 1);
  return {
    packageName,
    version: parseVersion(versionString)
  };
}
function formatVersionFile(packageName, version) {
  return `${packageName}@${formatVersion(version)}`;
}
function upgradeVersion(oldVersion, newVersion) {
  console.log(`[world-local] Upgrading from version ${formatVersion(oldVersion)} to ${formatVersion(newVersion)}`);
}
function ensureDataDir(dataDir) {
  const absolutePath = path__default.resolve(dataDir);
  try {
    mkdirSync(absolutePath, { recursive: true });
  } catch (error) {
    const nodeError = error;
    if (nodeError.code !== "EEXIST") {
      throw new DataDirAccessError(`Failed to create data directory "${absolutePath}": ${nodeError.message}`, absolutePath, nodeError.code);
    }
  }
  try {
    accessSync(absolutePath, constants.R_OK);
  } catch (error) {
    const nodeError = error;
    throw new DataDirAccessError(`Data directory "${absolutePath}" is not readable: ${nodeError.message}`, absolutePath, nodeError.code);
  }
  const testFile = path__default.join(absolutePath, `.workflow-write-test-${Date.now()}`);
  try {
    writeFileSync(testFile, "");
    unlinkSync(testFile);
  } catch (error) {
    const nodeError = error;
    throw new DataDirAccessError(`Data directory "${absolutePath}" is not writable: ${nodeError.message}`, absolutePath, nodeError.code);
  }
}
function readVersionFile(dataDir) {
  const versionFilePath = path__default.join(path__default.resolve(dataDir), VERSION_FILENAME);
  try {
    const content = readFileSync(versionFilePath, "utf-8");
    return parseVersionFile(content);
  } catch (error) {
    const nodeError = error;
    if (nodeError.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
function writeVersionFile(dataDir, version) {
  const versionFilePath = path__default.join(path__default.resolve(dataDir), VERSION_FILENAME);
  const content = formatVersionFile(PACKAGE_NAME, version);
  writeFileSync(versionFilePath, content);
}
function getSuggestedDowngradeVersion(oldVersion, suggestedVersion) {
  if (suggestedVersion) {
    return suggestedVersion;
  }
  return formatVersion(oldVersion);
}
function initDataDir(dataDir) {
  ensureDataDir(dataDir);
  const currentVersion = parseVersion(PACKAGE_VERSION);
  const existingVersionInfo = readVersionFile(dataDir);
  if (existingVersionInfo === null) {
    writeVersionFile(dataDir, currentVersion);
    return;
  }
  const { version: oldVersion } = existingVersionInfo;
  if (formatVersion(oldVersion) === formatVersion(currentVersion)) {
    return;
  }
  try {
    upgradeVersion(oldVersion, currentVersion);
    writeVersionFile(dataDir, currentVersion);
  } catch (error) {
    const suggestedVersion = error instanceof DataDirVersionError ? error.suggestedVersion : void 0;
    const downgradeTarget = getSuggestedDowngradeVersion(oldVersion, suggestedVersion);
    console.error(`[world-local] Failed to upgrade data directory from version ${formatVersion(oldVersion)} to ${formatVersion(currentVersion)}:`, error instanceof Error ? error.message : error);
    console.error(`[world-local] Data is not compatible with the current version. Please downgrade to ${PACKAGE_NAME}@${downgradeTarget}`);
    throw error;
  }
}
const LOCAL_QUEUE_MAX_VISIBILITY = parseInt(process.env.WORKFLOW_LOCAL_QUEUE_MAX_VISIBILITY ?? "0", 10) || Infinity;
const MAX_SAFE_TIMEOUT_MS = 2147483647;
const DEFAULT_CONCURRENCY_LIMIT = 100;
const WORKFLOW_LOCAL_QUEUE_CONCURRENCY = parseInt(process.env.WORKFLOW_LOCAL_QUEUE_CONCURRENCY ?? "0", 10) || DEFAULT_CONCURRENCY_LIMIT;
const httpAgent = new undiciExports.Agent({
  headersTimeout: 0,
  connections: 100,
  keepAliveTimeout: 3e4
});
function createQueue(config2) {
  const transport = new JsonTransport();
  const generateId = monotonicFactory();
  const semaphore = new libExports.Sema(WORKFLOW_LOCAL_QUEUE_CONCURRENCY);
  const inflightMessages = /* @__PURE__ */ new Map();
  const queue = async (queueName, message, opts) => {
    const cleanup = [];
    if (opts?.idempotencyKey) {
      const existing = inflightMessages.get(opts.idempotencyKey);
      if (existing) {
        return { messageId: existing };
      }
    }
    const body = transport.serialize(message);
    let pathname;
    if (queueName.startsWith("__wkf_step_")) {
      pathname = `step`;
    } else if (queueName.startsWith("__wkf_workflow_")) {
      pathname = `flow`;
    } else {
      throw new Error("Unknown queue name prefix");
    }
    const messageId = MessageId.parse(`msg_${generateId()}`);
    if (opts?.idempotencyKey) {
      const key = opts.idempotencyKey;
      inflightMessages.set(key, messageId);
      cleanup.push(() => {
        inflightMessages.delete(key);
      });
    }
    (async () => {
      const token = semaphore.tryAcquire();
      if (!token) {
        console.warn(`[world-local]: concurrency limit (${WORKFLOW_LOCAL_QUEUE_CONCURRENCY}) reached, waiting for queue to free up`);
        await semaphore.acquire();
      }
      try {
        let defaultRetriesLeft = 3;
        const baseUrl = await resolveBaseUrl(config2);
        for (let attempt = 0; defaultRetriesLeft > 0; attempt++) {
          defaultRetriesLeft--;
          const response = await fetch(`${baseUrl}/.well-known/workflow/v1/${pathname}`, {
            method: "POST",
            duplex: "half",
            dispatcher: httpAgent,
            headers: {
              "content-type": "application/json",
              "x-vqs-queue-name": queueName,
              "x-vqs-message-id": messageId,
              "x-vqs-message-attempt": String(attempt + 1)
            },
            body
          });
          if (response.ok) {
            return;
          }
          const text = await response.text();
          if (response.status === 503) {
            try {
              const timeoutSeconds = Number(JSON.parse(text).timeoutSeconds);
              const timeoutMs = Math.min(timeoutSeconds * 1e3, MAX_SAFE_TIMEOUT_MS);
              await setTimeout$1(timeoutMs);
              defaultRetriesLeft++;
              continue;
            } catch {
            }
          }
          console.error(`[local world] Failed to queue message`, {
            queueName,
            text,
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            body: body.toString()
          });
        }
        console.error(`[local world] Reached max retries of local world queue implementation`);
      } finally {
        semaphore.release();
      }
    })().catch((err) => {
      const isAbortError = err?.name === "AbortError" || err?.name === "ResponseAborted";
      if (!isAbortError) {
        console.error("[local world] Queue operation failed:", err);
      }
    }).finally(() => {
      for (const fn of cleanup) {
        fn();
      }
    });
    return { messageId };
  };
  const HeaderParser = z.object({
    "x-vqs-queue-name": ValidQueueName,
    "x-vqs-message-id": MessageId,
    "x-vqs-message-attempt": z.coerce.number()
  });
  const createQueueHandler = (prefix, handler) => {
    return async (req) => {
      const headers = HeaderParser.safeParse(Object.fromEntries(req.headers));
      if (!headers.success || !req.body) {
        return Response.json({
          error: !req.body ? "Missing request body" : "Missing required headers"
        }, { status: 400 });
      }
      const queueName = headers.data["x-vqs-queue-name"];
      const messageId = headers.data["x-vqs-message-id"];
      const attempt = headers.data["x-vqs-message-attempt"];
      if (!queueName.startsWith(prefix)) {
        return Response.json({ error: "Unhandled queue" }, { status: 400 });
      }
      const body = await new JsonTransport().deserialize(req.body);
      try {
        const result = await handler(body, { attempt, queueName, messageId });
        let timeoutSeconds = null;
        if (typeof result?.timeoutSeconds === "number") {
          timeoutSeconds = Math.min(result.timeoutSeconds, LOCAL_QUEUE_MAX_VISIBILITY);
        }
        if (timeoutSeconds) {
          return Response.json({ timeoutSeconds }, { status: 503 });
        }
        return Response.json({ ok: true });
      } catch (error) {
        return Response.json(String(error), { status: 500 });
      }
    };
  };
  const getDeploymentId = async () => {
    return `dpl_local@${PACKAGE_VERSION}`;
  };
  return { queue, createQueueHandler, getDeploymentId };
}
const ulid = monotonicFactory(() => Math.random());
const Ulid = string().ulid();
const isWindows = process.platform === "win32";
async function withWindowsRetry(fn, maxRetries = 5) {
  if (!isWindows)
    return fn();
  const retryableErrors = ["EPERM", "EBUSY", "EACCES"];
  const baseDelayMs = 10;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRetryable = attempt < maxRetries && retryableErrors.includes(error.code);
      if (!isRetryable)
        throw error;
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * baseDelayMs;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Retry loop exited unexpectedly");
}
const createdFilesCache = /* @__PURE__ */ new Set();
function ulidToDate(maybeUlid) {
  const ulid2 = Ulid.safeParse(maybeUlid);
  if (!ulid2.success) {
    return null;
  }
  return new Date(decodeTime(ulid2.data));
}
async function ensureDir(dirPath) {
  try {
    await promises.mkdir(dirPath, { recursive: true });
  } catch (_error) {
  }
}
async function writeJSON(filePath, data, opts) {
  return write(filePath, JSON.stringify(data, null, 2), opts);
}
async function write(filePath, data, opts) {
  if (!opts?.overwrite) {
    if (createdFilesCache.has(filePath)) {
      throw new WorkflowAPIError(`File ${filePath} already exists and 'overwrite' is false`, { status: 409 });
    }
    try {
      await promises.access(filePath);
      createdFilesCache.add(filePath);
      throw new WorkflowAPIError(`File ${filePath} already exists and 'overwrite' is false`, { status: 409 });
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  const tempPath = `${filePath}.tmp.${ulid()}`;
  let tempFileCreated = false;
  try {
    await ensureDir(path__default.dirname(filePath));
    await promises.writeFile(tempPath, data);
    tempFileCreated = true;
    await withWindowsRetry(() => promises.rename(tempPath, filePath));
    createdFilesCache.add(filePath);
  } catch (error) {
    if (tempFileCreated) {
      await withWindowsRetry(() => promises.unlink(tempPath), 3).catch(() => {
      });
    }
    throw error;
  }
}
async function readJSON(filePath, decoder) {
  try {
    const content = await promises.readFile(filePath, "utf-8");
    return decoder.parse(JSON.parse(content));
  } catch (error) {
    if (error.code === "ENOENT")
      return null;
    throw error;
  }
}
async function readBuffer(filePath) {
  const content = await promises.readFile(filePath);
  return content;
}
async function deleteJSON(filePath) {
  try {
    await promises.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT")
      throw error;
  }
}
async function listJSONFiles(dirPath) {
  try {
    const files = await promises.readdir(dirPath);
    return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
  } catch (error) {
    if (error.code === "ENOENT")
      return [];
    throw error;
  }
}
function parseCursor(cursor) {
  if (!cursor)
    return null;
  const parts = cursor.split("|");
  return {
    timestamp: new Date(parts[0]),
    id: parts[1] || null
  };
}
function createCursor(timestamp, id) {
  return id ? `${timestamp.toISOString()}|${id}` : timestamp.toISOString();
}
async function paginatedFileSystemQuery(config2) {
  const { directory, schema, filePrefix, filter, sortOrder = "desc", limit = 20, cursor, getCreatedAt, getId } = config2;
  const fileIds = await listJSONFiles(directory);
  const relevantFileIds = filePrefix ? fileIds.filter((fileId) => fileId.startsWith(filePrefix)) : fileIds;
  const parsedCursor = parseCursor(cursor);
  let candidateFileIds = relevantFileIds;
  if (parsedCursor) {
    candidateFileIds = relevantFileIds.filter((fileId) => {
      const filenameDate = getCreatedAt(`${fileId}.json`);
      if (filenameDate) {
        const cursorTime = parsedCursor.timestamp.getTime();
        const fileTime = filenameDate.getTime();
        if (parsedCursor.id) {
          return sortOrder === "desc" ? fileTime <= cursorTime : fileTime >= cursorTime;
        } else {
          return sortOrder === "desc" ? fileTime < cursorTime : fileTime > cursorTime;
        }
      }
      return true;
    });
  }
  const validItems = [];
  for (const fileId of candidateFileIds) {
    const filePath = path__default.join(directory, `${fileId}.json`);
    let item = null;
    try {
      item = await readJSON(filePath, schema);
    } catch (error) {
      if (error instanceof ZodError) {
        console.warn(`Skipping item ${fileId} due to malformed JSON: ${error.message}`);
        continue;
      }
      throw error;
    }
    if (item) {
      if (filter && !filter(item))
        continue;
      if (parsedCursor) {
        const itemTime = item.createdAt.getTime();
        const cursorTime = parsedCursor.timestamp.getTime();
        if (sortOrder === "desc") {
          if (itemTime > cursorTime)
            continue;
          if (itemTime === cursorTime && parsedCursor.id && getId) {
            const itemId = getId(item);
            if (itemId >= parsedCursor.id)
              continue;
          }
        } else {
          if (itemTime < cursorTime)
            continue;
          if (itemTime === cursorTime && parsedCursor.id && getId) {
            const itemId = getId(item);
            if (itemId <= parsedCursor.id)
              continue;
          }
        }
      }
      validItems.push(item);
    }
  }
  validItems.sort((a, b) => {
    const aTime = a.createdAt.getTime();
    const bTime = b.createdAt.getTime();
    const timeComparison = sortOrder === "asc" ? aTime - bTime : bTime - aTime;
    if (timeComparison === 0 && getId) {
      const aId = getId(a);
      const bId = getId(b);
      return sortOrder === "asc" ? aId.localeCompare(bId) : bId.localeCompare(aId);
    }
    return timeComparison;
  });
  const hasMore = validItems.length > limit;
  const items = hasMore ? validItems.slice(0, limit) : validItems;
  const nextCursor = items.length > 0 ? createCursor(items[items.length - 1].createdAt, getId?.(items[items.length - 1])) : null;
  return {
    data: items,
    cursor: nextCursor,
    hasMore
  };
}
const monotonicUlid$1 = monotonicFactory(() => Math.random());
function filterRunData(run, resolveData) {
  if (resolveData === "none") {
    return {
      ...run,
      input: [],
      output: void 0
    };
  }
  return run;
}
function filterStepData(step, resolveData) {
  if (resolveData === "none") {
    return {
      ...step,
      input: [],
      output: void 0
    };
  }
  return step;
}
function filterEventData(event, resolveData) {
  if (resolveData === "none") {
    const { eventData: _eventData, ...rest } = event;
    return rest;
  }
  return event;
}
function filterHookData(hook, resolveData) {
  if (resolveData === "none") {
    const { metadata: _metadata, ...rest } = hook;
    return rest;
  }
  return hook;
}
const getObjectCreatedAt = (idPrefix) => (filename) => {
  const replaceRegex = new RegExp(`^${idPrefix}_`, "g");
  const dashIndex = filename.indexOf("-");
  if (dashIndex === -1) {
    const ulid3 = filename.replace(/\.json$/, "").replace(replaceRegex, "");
    return ulidToDate(ulid3);
  }
  if (idPrefix === "step") {
    return null;
  }
  const id = filename.substring(dashIndex + 1).replace(/\.json$/, "");
  const ulid2 = id.replace(replaceRegex, "");
  return ulidToDate(ulid2);
};
function createHooksStorage(basedir) {
  async function findHookByToken(token) {
    const hooksDir = path__default.join(basedir, "hooks");
    const files = await listJSONFiles(hooksDir);
    for (const file of files) {
      const hookPath = path__default.join(hooksDir, `${file}.json`);
      const hook = await readJSON(hookPath, HookSchema);
      if (hook && hook.token === token) {
        return hook;
      }
    }
    return null;
  }
  async function create(runId, data) {
    const existingHook = await findHookByToken(data.token);
    if (existingHook) {
      throw new Error(`Hook with token ${data.token} already exists for this project`);
    }
    const now = /* @__PURE__ */ new Date();
    const result = {
      runId,
      hookId: data.hookId,
      token: data.token,
      metadata: data.metadata,
      ownerId: "local-owner",
      projectId: "local-project",
      environment: "local",
      createdAt: now
    };
    const hookPath = path__default.join(basedir, "hooks", `${data.hookId}.json`);
    HookSchema.parse(result);
    await writeJSON(hookPath, result);
    return result;
  }
  async function get(hookId, params) {
    const hookPath = path__default.join(basedir, "hooks", `${hookId}.json`);
    const hook = await readJSON(hookPath, HookSchema);
    if (!hook) {
      throw new Error(`Hook ${hookId} not found`);
    }
    const resolveData = params?.resolveData || DEFAULT_RESOLVE_DATA_OPTION;
    return filterHookData(hook, resolveData);
  }
  async function getByToken(token) {
    const hook = await findHookByToken(token);
    if (!hook) {
      throw new Error(`Hook with token ${token} not found`);
    }
    return hook;
  }
  async function list(params) {
    const hooksDir = path__default.join(basedir, "hooks");
    const resolveData = params.resolveData || DEFAULT_RESOLVE_DATA_OPTION;
    const result = await paginatedFileSystemQuery({
      directory: hooksDir,
      schema: HookSchema,
      sortOrder: params.pagination?.sortOrder,
      limit: params.pagination?.limit,
      cursor: params.pagination?.cursor,
      filePrefix: void 0,
      // Hooks don't have ULIDs, so we can't optimize by filename
      filter: (hook) => {
        if (params.runId && hook.runId !== params.runId) {
          return false;
        }
        return true;
      },
      getCreatedAt: () => {
        return /* @__PURE__ */ new Date(0);
      },
      getId: (hook) => hook.hookId
    });
    return {
      ...result,
      data: result.data.map((hook) => filterHookData(hook, resolveData))
    };
  }
  async function dispose(hookId) {
    const hookPath = path__default.join(basedir, "hooks", `${hookId}.json`);
    const hook = await readJSON(hookPath, HookSchema);
    if (!hook) {
      throw new Error(`Hook ${hookId} not found`);
    }
    await deleteJSON(hookPath);
    return hook;
  }
  return { create, get, getByToken, list, dispose };
}
async function deleteAllHooksForRun(basedir, runId) {
  const hooksDir = path__default.join(basedir, "hooks");
  const files = await listJSONFiles(hooksDir);
  for (const file of files) {
    const hookPath = path__default.join(hooksDir, `${file}.json`);
    const hook = await readJSON(hookPath, HookSchema);
    if (hook && hook.runId === runId) {
      await deleteJSON(hookPath);
    }
  }
}
function createStorage(basedir) {
  return {
    runs: {
      async create(data) {
        const runId = `wrun_${monotonicUlid$1()}`;
        const now = /* @__PURE__ */ new Date();
        const result = {
          runId,
          deploymentId: data.deploymentId,
          status: "pending",
          workflowName: data.workflowName,
          executionContext: data.executionContext,
          input: data.input || [],
          output: void 0,
          error: void 0,
          startedAt: void 0,
          completedAt: void 0,
          createdAt: now,
          updatedAt: now
        };
        const runPath = path__default.join(basedir, "runs", `${runId}.json`);
        WorkflowRunSchema.parse(result);
        await writeJSON(runPath, result);
        return result;
      },
      async get(id, params) {
        const runPath = path__default.join(basedir, "runs", `${id}.json`);
        const run = await readJSON(runPath, WorkflowRunSchema);
        if (!run) {
          throw new WorkflowRunNotFoundError(id);
        }
        const resolveData = params?.resolveData ?? DEFAULT_RESOLVE_DATA_OPTION;
        return filterRunData(run, resolveData);
      },
      /**
       * Updates a workflow run.
       *
       * Note: This operation is not atomic. Concurrent updates from multiple
       * processes may result in lost updates (last writer wins). This is an
       * inherent limitation of filesystem-based storage without locking.
       * For the local world, this is acceptable as it's typically
       * used in single-process scenarios.
       */
      async update(id, data) {
        const runPath = path__default.join(basedir, "runs", `${id}.json`);
        const run = await readJSON(runPath, WorkflowRunSchema);
        if (!run) {
          throw new WorkflowRunNotFoundError(id);
        }
        const now = /* @__PURE__ */ new Date();
        const updatedRun = {
          ...run,
          ...data,
          updatedAt: now
        };
        if (data.status === "running" && !updatedRun.startedAt) {
          updatedRun.startedAt = now;
        }
        const isBecomingTerminal = data.status === "completed" || data.status === "failed" || data.status === "cancelled";
        if (isBecomingTerminal) {
          updatedRun.completedAt = now;
        }
        WorkflowRunSchema.parse(updatedRun);
        await writeJSON(runPath, updatedRun, { overwrite: true });
        if (isBecomingTerminal) {
          await deleteAllHooksForRun(basedir, id);
        }
        return updatedRun;
      },
      async list(params) {
        const resolveData = params?.resolveData ?? DEFAULT_RESOLVE_DATA_OPTION;
        const result = await paginatedFileSystemQuery({
          directory: path__default.join(basedir, "runs"),
          schema: WorkflowRunSchema,
          filter: (run) => {
            if (params?.workflowName && run.workflowName !== params.workflowName) {
              return false;
            }
            if (params?.status && run.status !== params.status) {
              return false;
            }
            return true;
          },
          sortOrder: params?.pagination?.sortOrder ?? "desc",
          limit: params?.pagination?.limit,
          cursor: params?.pagination?.cursor,
          getCreatedAt: getObjectCreatedAt("wrun"),
          getId: (run) => run.runId
        });
        if (resolveData === "none") {
          return {
            ...result,
            data: result.data.map((run) => ({
              ...run,
              input: [],
              output: void 0
            }))
          };
        }
        return result;
      },
      async cancel(id, params) {
        const run = await this.update(id, { status: "cancelled" });
        const resolveData = params?.resolveData ?? DEFAULT_RESOLVE_DATA_OPTION;
        return filterRunData(run, resolveData);
      }
    },
    steps: {
      async create(runId, data) {
        const now = /* @__PURE__ */ new Date();
        const result = {
          runId,
          stepId: data.stepId,
          stepName: data.stepName,
          status: "pending",
          input: data.input,
          output: void 0,
          error: void 0,
          attempt: 0,
          startedAt: void 0,
          completedAt: void 0,
          createdAt: now,
          updatedAt: now
        };
        const compositeKey = `${runId}-${data.stepId}`;
        const stepPath = path__default.join(basedir, "steps", `${compositeKey}.json`);
        StepSchema.parse(result);
        await writeJSON(stepPath, result);
        return result;
      },
      async get(runId, stepId, params) {
        if (!runId) {
          const fileIds = await listJSONFiles(path__default.join(basedir, "steps"));
          const fileId = fileIds.find((fileId2) => fileId2.endsWith(`-${stepId}`));
          if (!fileId) {
            throw new Error(`Step ${stepId} not found`);
          }
          runId = fileId.split("-")[0];
        }
        const compositeKey = `${runId}-${stepId}`;
        const stepPath = path__default.join(basedir, "steps", `${compositeKey}.json`);
        const step = await readJSON(stepPath, StepSchema);
        if (!step) {
          throw new Error(`Step ${stepId} in run ${runId} not found`);
        }
        const resolveData = params?.resolveData ?? DEFAULT_RESOLVE_DATA_OPTION;
        return filterStepData(step, resolveData);
      },
      /**
       * Updates a step.
       *
       * Note: This operation is not atomic. Concurrent updates from multiple
       * processes may result in lost updates (last writer wins). This is an
       * inherent limitation of filesystem-based storage without locking.
       */
      async update(runId, stepId, data) {
        const compositeKey = `${runId}-${stepId}`;
        const stepPath = path__default.join(basedir, "steps", `${compositeKey}.json`);
        const step = await readJSON(stepPath, StepSchema);
        if (!step) {
          throw new Error(`Step ${stepId} in run ${runId} not found`);
        }
        const now = /* @__PURE__ */ new Date();
        const updatedStep = {
          ...step,
          ...data,
          updatedAt: now
        };
        if (data.status === "running" && !updatedStep.startedAt) {
          updatedStep.startedAt = now;
        }
        if (data.status === "completed" || data.status === "failed") {
          updatedStep.completedAt = now;
        }
        StepSchema.parse(updatedStep);
        await writeJSON(stepPath, updatedStep, { overwrite: true });
        return updatedStep;
      },
      async list(params) {
        const resolveData = params.resolveData ?? DEFAULT_RESOLVE_DATA_OPTION;
        const result = await paginatedFileSystemQuery({
          directory: path__default.join(basedir, "steps"),
          schema: StepSchema,
          filePrefix: `${params.runId}-`,
          sortOrder: params.pagination?.sortOrder ?? "desc",
          limit: params.pagination?.limit,
          cursor: params.pagination?.cursor,
          getCreatedAt: getObjectCreatedAt("step"),
          getId: (step) => step.stepId
        });
        if (resolveData === "none") {
          return {
            ...result,
            data: result.data.map((step) => ({
              ...step,
              input: [],
              output: void 0
            }))
          };
        }
        return result;
      }
    },
    // Events - filesystem-backed storage
    events: {
      async create(runId, data, params) {
        const eventId = `evnt_${monotonicUlid$1()}`;
        const now = /* @__PURE__ */ new Date();
        const result = {
          ...data,
          runId,
          eventId,
          createdAt: now
        };
        const compositeKey = `${runId}-${eventId}`;
        const eventPath = path__default.join(basedir, "events", `${compositeKey}.json`);
        EventSchema.parse(result);
        await writeJSON(eventPath, result);
        const resolveData = params?.resolveData ?? DEFAULT_RESOLVE_DATA_OPTION;
        return filterEventData(result, resolveData);
      },
      async list(params) {
        const { runId } = params;
        const resolveData = params.resolveData ?? DEFAULT_RESOLVE_DATA_OPTION;
        const result = await paginatedFileSystemQuery({
          directory: path__default.join(basedir, "events"),
          schema: EventSchema,
          filePrefix: `${runId}-`,
          // Events in chronological order (oldest first) by default,
          // different from the default for other list calls.
          sortOrder: params.pagination?.sortOrder ?? "asc",
          limit: params.pagination?.limit,
          cursor: params.pagination?.cursor,
          getCreatedAt: getObjectCreatedAt("evnt"),
          getId: (event) => event.eventId
        });
        if (resolveData === "none") {
          return {
            ...result,
            data: result.data.map((event) => {
              const { eventData: _eventData, ...rest } = event;
              return rest;
            })
          };
        }
        return result;
      },
      async listByCorrelationId(params) {
        const correlationId = params.correlationId;
        const resolveData = params.resolveData ?? DEFAULT_RESOLVE_DATA_OPTION;
        const result = await paginatedFileSystemQuery({
          directory: path__default.join(basedir, "events"),
          schema: EventSchema,
          // No filePrefix - search all events
          filter: (event) => event.correlationId === correlationId,
          // Events in chronological order (oldest first) by default,
          // different from the default for other list calls.
          sortOrder: params.pagination?.sortOrder ?? "asc",
          limit: params.pagination?.limit,
          cursor: params.pagination?.cursor,
          getCreatedAt: getObjectCreatedAt("evnt"),
          getId: (event) => event.eventId
        });
        if (resolveData === "none") {
          return {
            ...result,
            data: result.data.map((event) => {
              const { eventData: _eventData, ...rest } = event;
              return rest;
            })
          };
        }
        return result;
      }
    },
    // Hooks
    hooks: createHooksStorage(basedir)
  };
}
const monotonicUlid = monotonicFactory(() => Math.random());
const RunStreamsSchema = object({
  streams: array(string())
});
function serializeChunk(chunk) {
  const eofByte = Buffer.from([chunk.eof ? 1 : 0]);
  return Buffer.concat([eofByte, chunk.chunk]);
}
function deserializeChunk(serialized) {
  const eof = serialized[0] === 1;
  const chunk = Buffer.from(serialized.subarray(1));
  return { eof, chunk };
}
function createStreamer(basedir) {
  const streamEmitter = new EventEmitter();
  const registeredStreams = /* @__PURE__ */ new Set();
  async function registerStreamForRun(runId, streamName) {
    const cacheKey = `${runId}:${streamName}`;
    if (registeredStreams.has(cacheKey)) {
      return;
    }
    const runStreamsPath = path__default.join(basedir, "streams", "runs", `${runId}.json`);
    const existing = await readJSON(runStreamsPath, RunStreamsSchema);
    const streams = existing?.streams ?? [];
    if (!streams.includes(streamName)) {
      streams.push(streamName);
      await writeJSON(runStreamsPath, { streams }, { overwrite: true });
    }
    registeredStreams.add(cacheKey);
  }
  return {
    async writeToStream(name, _runId, chunk) {
      const chunkId = `chnk_${monotonicUlid()}`;
      const runId = await _runId;
      await registerStreamForRun(runId, name);
      let chunkBuffer;
      if (typeof chunk === "string") {
        chunkBuffer = Buffer.from(new TextEncoder().encode(chunk));
      } else if (chunk instanceof Buffer) {
        chunkBuffer = chunk;
      } else {
        chunkBuffer = Buffer.from(chunk);
      }
      const serialized = serializeChunk({
        chunk: chunkBuffer,
        eof: false
      });
      const chunkPath = path__default.join(basedir, "streams", "chunks", `${name}-${chunkId}.json`);
      await write(chunkPath, serialized);
      const chunkData = Uint8Array.from(chunkBuffer);
      streamEmitter.emit(`chunk:${name}`, {
        streamName: name,
        chunkData,
        chunkId
      });
    },
    async closeStream(name, _runId) {
      const chunkId = `chnk_${monotonicUlid()}`;
      const runId = await _runId;
      await registerStreamForRun(runId, name);
      const chunkPath = path__default.join(basedir, "streams", "chunks", `${name}-${chunkId}.json`);
      await write(chunkPath, serializeChunk({ chunk: Buffer.from([]), eof: true }));
      streamEmitter.emit(`close:${name}`, { streamName: name });
    },
    async listStreamsByRunId(runId) {
      const runStreamsPath = path__default.join(basedir, "streams", "runs", `${runId}.json`);
      const data = await readJSON(runStreamsPath, RunStreamsSchema);
      return data?.streams ?? [];
    },
    async readFromStream(name, startIndex = 0) {
      const chunksDir = path__default.join(basedir, "streams", "chunks");
      let removeListeners = () => {
      };
      return new ReadableStream({
        async start(controller) {
          const deliveredChunkIds = /* @__PURE__ */ new Set();
          const bufferedEventChunks = [];
          let isReadingFromDisk = true;
          let pendingClose = false;
          const chunkListener = (event) => {
            deliveredChunkIds.add(event.chunkId);
            if (event.chunkData.byteLength === 0) {
              return;
            }
            if (isReadingFromDisk) {
              bufferedEventChunks.push({
                chunkId: event.chunkId,
                chunkData: Uint8Array.from(event.chunkData)
              });
            } else {
              controller.enqueue(Uint8Array.from(event.chunkData));
            }
          };
          const closeListener = () => {
            if (isReadingFromDisk) {
              pendingClose = true;
              return;
            }
            streamEmitter.off(`chunk:${name}`, chunkListener);
            streamEmitter.off(`close:${name}`, closeListener);
            try {
              controller.close();
            } catch {
            }
          };
          removeListeners = closeListener;
          streamEmitter.on(`chunk:${name}`, chunkListener);
          streamEmitter.on(`close:${name}`, closeListener);
          const files = await listJSONFiles(chunksDir);
          const chunkFiles = files.filter((file) => file.startsWith(`${name}-`)).sort();
          let isComplete = false;
          for (let i = startIndex; i < chunkFiles.length; i++) {
            const file = chunkFiles[i];
            const chunkId = file.substring(name.length + 1);
            if (deliveredChunkIds.has(chunkId)) {
              continue;
            }
            const chunk = deserializeChunk(await readBuffer(path__default.join(chunksDir, `${file}.json`)));
            if (chunk?.eof === true) {
              isComplete = true;
              break;
            }
            if (chunk.chunk.byteLength) {
              controller.enqueue(Uint8Array.from(chunk.chunk));
            }
          }
          isReadingFromDisk = false;
          bufferedEventChunks.sort((a, b) => a.chunkId.localeCompare(b.chunkId));
          for (const buffered of bufferedEventChunks) {
            controller.enqueue(Uint8Array.from(buffered.chunkData));
          }
          if (isComplete) {
            removeListeners();
            try {
              controller.close();
            } catch {
            }
            return;
          }
          if (pendingClose) {
            streamEmitter.off(`chunk:${name}`, chunkListener);
            streamEmitter.off(`close:${name}`, closeListener);
            try {
              controller.close();
            } catch {
            }
          }
        },
        cancel() {
          removeListeners();
        }
      });
    }
  };
}
function createLocalWorld(args) {
  const definedArgs = args ? Object.fromEntries(Object.entries(args).filter(([, value]) => value !== void 0)) : {};
  const mergedConfig = { ...config.value, ...definedArgs };
  return {
    ...createQueue(mergedConfig),
    ...createStorage(mergedConfig.dataDir),
    ...createStreamer(mergedConfig.dataDir),
    async start() {
      await initDataDir(mergedConfig.dataDir);
    }
  };
}
export {
  createLocalWorld as c
};
