import { p as parseMultipartStream } from "../../../_libs/mixpart.mjs";
import { d as distExports } from "./oidc.mjs";
async function streamToBuffer(stream) {
  let totalLength = 0;
  const reader = stream.getReader();
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalLength);
}
var JsonTransport = class {
  contentType = "application/json";
  replacer;
  reviver;
  constructor(options = {}) {
    this.replacer = options.replacer;
    this.reviver = options.reviver;
  }
  serialize(value) {
    return Buffer.from(JSON.stringify(value, this.replacer), "utf8");
  }
  async deserialize(stream) {
    const buffer = await streamToBuffer(stream);
    return JSON.parse(buffer.toString("utf8"), this.reviver);
  }
};
var MessageNotFoundError = class extends Error {
  constructor(messageId) {
    super(`Message ${messageId} not found`);
    this.name = "MessageNotFoundError";
  }
};
var MessageNotAvailableError = class extends Error {
  constructor(messageId, reason) {
    super(
      `Message ${messageId} not available for processing${reason ? `: ${reason}` : ""}`
    );
    this.name = "MessageNotAvailableError";
  }
};
var MessageCorruptedError = class extends Error {
  constructor(messageId, reason) {
    super(`Message ${messageId} is corrupted: ${reason}`);
    this.name = "MessageCorruptedError";
  }
};
var QueueEmptyError = class extends Error {
  constructor(queueName, consumerGroup) {
    super(
      `No messages available in queue "${queueName}" for consumer group "${consumerGroup}"`
    );
    this.name = "QueueEmptyError";
  }
};
var MessageLockedError = class extends Error {
  retryAfter;
  constructor(messageId, retryAfter) {
    const retryMessage = retryAfter ? ` Retry after ${retryAfter} seconds.` : " Try again later.";
    super(`Message ${messageId} is temporarily locked.${retryMessage}`);
    this.name = "MessageLockedError";
    this.retryAfter = retryAfter;
  }
};
var UnauthorizedError = class extends Error {
  constructor(message = "Missing or invalid authentication token") {
    super(message);
    this.name = "UnauthorizedError";
  }
};
var ForbiddenError = class extends Error {
  constructor(message = "Queue environment doesn't match token environment") {
    super(message);
    this.name = "ForbiddenError";
  }
};
var BadRequestError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "BadRequestError";
  }
};
var InternalServerError = class extends Error {
  constructor(message = "Unexpected server error") {
    super(message);
    this.name = "InternalServerError";
  }
};
var InvalidLimitError = class extends Error {
  constructor(limit, min = 1, max = 10) {
    super(`Invalid limit: ${limit}. Limit must be between ${min} and ${max}.`);
    this.name = "InvalidLimitError";
  }
};
function isDebugEnabled() {
  return process.env.VERCEL_QUEUE_DEBUG === "1" || process.env.VERCEL_QUEUE_DEBUG === "true";
}
async function consumeStream(stream) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
function parseRetryAfter(headers) {
  const retryAfterHeader = headers.get("Retry-After");
  if (retryAfterHeader) {
    const parsed = parseInt(retryAfterHeader, 10);
    return Number.isNaN(parsed) ? void 0 : parsed;
  }
  return void 0;
}
function throwCommonHttpError(status, statusText, errorText, operation, badRequestDefault = "Invalid parameters") {
  if (status === 400) {
    throw new BadRequestError(errorText || badRequestDefault);
  }
  if (status === 401) {
    throw new UnauthorizedError(errorText || void 0);
  }
  if (status === 403) {
    throw new ForbiddenError(errorText || void 0);
  }
  if (status >= 500) {
    throw new InternalServerError(
      errorText || `Server error: ${status} ${statusText}`
    );
  }
  throw new Error(`Failed to ${operation}: ${status} ${statusText}`);
}
function parseQueueHeaders(headers) {
  const messageId = headers.get("Vqs-Message-Id");
  const deliveryCountStr = headers.get("Vqs-Delivery-Count") || "0";
  const timestamp = headers.get("Vqs-Timestamp");
  const contentType = headers.get("Content-Type") || "application/octet-stream";
  const ticket = headers.get("Vqs-Ticket");
  if (!messageId || !timestamp || !ticket) {
    return null;
  }
  const deliveryCount = parseInt(deliveryCountStr, 10);
  if (Number.isNaN(deliveryCount)) {
    return null;
  }
  return {
    messageId,
    deliveryCount,
    createdAt: new Date(timestamp),
    contentType,
    ticket
  };
}
var QueueClient = class {
  baseUrl;
  basePath;
  customHeaders;
  providedToken;
  /**
   * Create a new Vercel Queue Service client
   * @param options QueueClient configuration options
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.VERCEL_QUEUE_BASE_URL || "https://vercel-queue.com";
    this.basePath = options.basePath || process.env.VERCEL_QUEUE_BASE_PATH || "/api/v2/messages";
    this.customHeaders = options.headers || {};
    this.providedToken = options.token;
  }
  async getToken() {
    if (this.providedToken) {
      return this.providedToken;
    }
    const token = await distExports.getVercelOidcToken();
    if (!token) {
      throw new Error(
        "Failed to get OIDC token from Vercel Functions. Make sure you are running in a Vercel Function environment, or provide a token explicitly.\n\nTo set up your environment:\n1. Link your project: 'vercel link'\n2. Pull environment variables: 'vercel env pull'\n3. Run with environment: 'dotenv -e .env.local -- your-command'"
      );
    }
    return token;
  }
  /**
   * Internal fetch wrapper that automatically handles debug logging
   * when VERCEL_QUEUE_DEBUG is enabled
   */
  async fetch(url, init) {
    const method = init.method || "GET";
    if (isDebugEnabled()) {
      const logData = {
        method,
        url,
        headers: init.headers
      };
      const body = init.body;
      if (body !== void 0 && body !== null) {
        if (body instanceof ArrayBuffer) {
          logData.bodySize = body.byteLength;
        } else if (body instanceof Uint8Array) {
          logData.bodySize = body.byteLength;
        } else if (typeof body === "string") {
          logData.bodySize = body.length;
        } else {
          logData.bodyType = typeof body;
        }
      }
      console.debug("[VQS Debug] Request:", JSON.stringify(logData, null, 2));
    }
    const response = await fetch(url, init);
    if (isDebugEnabled()) {
      const logData = {
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      };
      console.debug("[VQS Debug] Response:", JSON.stringify(logData, null, 2));
    }
    return response;
  }
  /**
   * Send a message to a queue
   * @param options Send message options
   * @param transport Serializer/deserializer for the payload
   * @returns Promise with the message ID
   * @throws {BadRequestError} When request parameters are invalid
   * @throws {UnauthorizedError} When authentication fails
   * @throws {ForbiddenError} When access is denied (environment mismatch)
   * @throws {InternalServerError} When server encounters an error
   */
  async sendMessage(options, transport) {
    const { queueName, payload, idempotencyKey, retentionSeconds } = options;
    const headers = new Headers({
      Authorization: `Bearer ${await this.getToken()}`,
      "Vqs-Queue-Name": queueName,
      "Content-Type": transport.contentType,
      ...this.customHeaders
    });
    const deploymentId = options.deploymentId || process.env.VERCEL_DEPLOYMENT_ID;
    if (deploymentId) {
      headers.set("Vqs-Deployment-Id", deploymentId);
    }
    if (idempotencyKey) {
      headers.set("Vqs-Idempotency-Key", idempotencyKey);
    }
    if (retentionSeconds !== void 0) {
      headers.set("Vqs-Retention-Seconds", retentionSeconds.toString());
    }
    const body = transport.serialize(payload);
    const response = await this.fetch(`${this.baseUrl}${this.basePath}`, {
      method: "POST",
      body,
      headers
    });
    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 409) {
        throw new Error("Duplicate idempotency key detected");
      }
      throwCommonHttpError(
        response.status,
        response.statusText,
        errorText,
        "send message"
      );
    }
    const responseData = await response.json();
    return responseData;
  }
  /**
   * Receive messages from a queue
   * @param options Receive messages options
   * @param transport Serializer/deserializer for the payload
   * @returns AsyncGenerator that yields messages as they arrive
   * @throws {InvalidLimitError} When limit parameter is not between 1 and 10
   * @throws {QueueEmptyError} When no messages are available (204)
   * @throws {MessageLockedError} When messages are temporarily locked (423)
   * @throws {BadRequestError} When request parameters are invalid
   * @throws {UnauthorizedError} When authentication fails
   * @throws {ForbiddenError} When access is denied (environment mismatch)
   * @throws {InternalServerError} When server encounters an error
   */
  async *receiveMessages(options, transport) {
    const { queueName, consumerGroup, visibilityTimeoutSeconds, limit } = options;
    if (limit !== void 0 && (limit < 1 || limit > 10)) {
      throw new InvalidLimitError(limit);
    }
    const headers = new Headers({
      Authorization: `Bearer ${await this.getToken()}`,
      "Vqs-Queue-Name": queueName,
      "Vqs-Consumer-Group": consumerGroup,
      Accept: "multipart/mixed",
      ...this.customHeaders
    });
    if (visibilityTimeoutSeconds !== void 0) {
      headers.set(
        "Vqs-Visibility-Timeout",
        visibilityTimeoutSeconds.toString()
      );
    }
    if (limit !== void 0) {
      headers.set("Vqs-Limit", limit.toString());
    }
    const response = await this.fetch(`${this.baseUrl}${this.basePath}`, {
      method: "GET",
      headers
    });
    if (response.status === 204) {
      throw new QueueEmptyError(queueName, consumerGroup);
    }
    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 423) {
        throw new MessageLockedError(
          "next message",
          parseRetryAfter(response.headers)
        );
      }
      throwCommonHttpError(
        response.status,
        response.statusText,
        errorText,
        "receive messages"
      );
    }
    for await (const multipartMessage of parseMultipartStream(response)) {
      try {
        const parsedHeaders = parseQueueHeaders(multipartMessage.headers);
        if (!parsedHeaders) {
          console.warn("Missing required queue headers in multipart part");
          await consumeStream(multipartMessage.payload);
          continue;
        }
        const deserializedPayload = await transport.deserialize(
          multipartMessage.payload
        );
        const message = {
          ...parsedHeaders,
          payload: deserializedPayload
        };
        yield message;
      } catch (error) {
        console.warn("Failed to process multipart message:", error);
        await consumeStream(multipartMessage.payload);
      }
    }
  }
  async receiveMessageById(options, transport) {
    const {
      queueName,
      consumerGroup,
      messageId,
      visibilityTimeoutSeconds,
      skipPayload
    } = options;
    const headers = new Headers({
      Authorization: `Bearer ${await this.getToken()}`,
      "Vqs-Queue-Name": queueName,
      "Vqs-Consumer-Group": consumerGroup,
      Accept: "multipart/mixed",
      ...this.customHeaders
    });
    if (visibilityTimeoutSeconds !== void 0) {
      headers.set(
        "Vqs-Visibility-Timeout",
        visibilityTimeoutSeconds.toString()
      );
    }
    if (skipPayload) {
      headers.set("Vqs-Skip-Payload", "1");
    }
    const response = await this.fetch(
      `${this.baseUrl}${this.basePath}/${encodeURIComponent(messageId)}`,
      {
        method: "GET",
        headers
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 404) {
        throw new MessageNotFoundError(messageId);
      }
      if (response.status === 409) {
        throw new MessageNotAvailableError(messageId);
      }
      if (response.status === 423) {
        throw new MessageLockedError(
          messageId,
          parseRetryAfter(response.headers)
        );
      }
      throwCommonHttpError(
        response.status,
        response.statusText,
        errorText,
        "receive message by ID"
      );
    }
    if (skipPayload && response.status === 204) {
      const parsedHeaders = parseQueueHeaders(response.headers);
      if (!parsedHeaders) {
        throw new MessageCorruptedError(
          messageId,
          "Missing required queue headers in 204 response"
        );
      }
      const message = {
        ...parsedHeaders,
        payload: void 0
      };
      return { message };
    }
    if (!transport) {
      throw new Error("Transport is required when skipPayload is not true");
    }
    try {
      for await (const multipartMessage of parseMultipartStream(response)) {
        try {
          const parsedHeaders = parseQueueHeaders(multipartMessage.headers);
          if (!parsedHeaders) {
            console.warn("Missing required queue headers in multipart part");
            await consumeStream(multipartMessage.payload);
            continue;
          }
          const deserializedPayload = await transport.deserialize(
            multipartMessage.payload
          );
          const message = {
            ...parsedHeaders,
            payload: deserializedPayload
          };
          return { message };
        } catch (error) {
          console.warn("Failed to deserialize message by ID:", error);
          await consumeStream(multipartMessage.payload);
          throw new MessageCorruptedError(
            messageId,
            `Failed to deserialize payload: ${error}`
          );
        }
      }
    } catch (error) {
      if (error instanceof MessageCorruptedError) {
        throw error;
      }
      throw new MessageCorruptedError(
        messageId,
        `Failed to parse multipart response: ${error}`
      );
    }
    throw new MessageNotFoundError(messageId);
  }
  /**
   * Delete a message (acknowledge processing)
   * @param options Delete message options
   * @returns Promise with delete status
   * @throws {MessageNotFoundError} When the message doesn't exist (404)
   * @throws {MessageNotAvailableError} When message can't be deleted (409)
   * @throws {BadRequestError} When ticket is missing or invalid (400)
   * @throws {UnauthorizedError} When authentication fails
   * @throws {ForbiddenError} When access is denied (environment mismatch)
   * @throws {InternalServerError} When server encounters an error
   */
  async deleteMessage(options) {
    const { queueName, consumerGroup, messageId, ticket } = options;
    const response = await this.fetch(
      `${this.baseUrl}${this.basePath}/${encodeURIComponent(messageId)}`,
      {
        method: "DELETE",
        headers: new Headers({
          Authorization: `Bearer ${await this.getToken()}`,
          "Vqs-Queue-Name": queueName,
          "Vqs-Consumer-Group": consumerGroup,
          "Vqs-Ticket": ticket,
          ...this.customHeaders
        })
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 404) {
        throw new MessageNotFoundError(messageId);
      }
      if (response.status === 409) {
        throw new MessageNotAvailableError(
          messageId,
          errorText || "Invalid ticket, message not in correct state, or already processed"
        );
      }
      throwCommonHttpError(
        response.status,
        response.statusText,
        errorText,
        "delete message",
        "Missing or invalid ticket"
      );
    }
    return { deleted: true };
  }
  /**
   * Change the visibility timeout of a message
   * @param options Change visibility options
   * @returns Promise with update status
   * @throws {MessageNotFoundError} When the message doesn't exist (404)
   * @throws {MessageNotAvailableError} When message can't be updated (409)
   * @throws {BadRequestError} When ticket is missing or visibility timeout invalid (400)
   * @throws {UnauthorizedError} When authentication fails
   * @throws {ForbiddenError} When access is denied (environment mismatch)
   * @throws {InternalServerError} When server encounters an error
   */
  async changeVisibility(options) {
    const {
      queueName,
      consumerGroup,
      messageId,
      ticket,
      visibilityTimeoutSeconds
    } = options;
    const response = await this.fetch(
      `${this.baseUrl}${this.basePath}/${encodeURIComponent(messageId)}`,
      {
        method: "PATCH",
        headers: new Headers({
          Authorization: `Bearer ${await this.getToken()}`,
          "Vqs-Queue-Name": queueName,
          "Vqs-Consumer-Group": consumerGroup,
          "Vqs-Ticket": ticket,
          "Vqs-Visibility-Timeout": visibilityTimeoutSeconds.toString(),
          ...this.customHeaders
        })
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 404) {
        throw new MessageNotFoundError(messageId);
      }
      if (response.status === 409) {
        throw new MessageNotAvailableError(
          messageId,
          errorText || "Invalid ticket, message not in correct state, or already processed"
        );
      }
      throwCommonHttpError(
        response.status,
        response.statusText,
        errorText,
        "change visibility",
        "Missing ticket or invalid visibility timeout"
      );
    }
    return { updated: true };
  }
};
var GLOBAL_KEY = /* @__PURE__ */ Symbol.for("@vercel/queue.devHandlers");
function getDevHandlerState() {
  const g = globalThis;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      devRouteHandlers: /* @__PURE__ */ new Map(),
      wildcardRouteHandlers: /* @__PURE__ */ new Map()
    };
  }
  return g[GLOBAL_KEY];
}
var { devRouteHandlers, wildcardRouteHandlers } = getDevHandlerState();
function cleanupDeadRefs(key, refs) {
  const aliveRefs = refs.filter((ref) => ref.deref() !== void 0);
  if (aliveRefs.length === 0) {
    wildcardRouteHandlers.delete(key);
  } else if (aliveRefs.length < refs.length) {
    wildcardRouteHandlers.set(key, aliveRefs);
  }
}
function isDevMode() {
  return false;
}
function findRouteHandlersForTopic(topicName) {
  const handlersMap = /* @__PURE__ */ new Map();
  for (const [
    key,
    { routeHandler, topicPattern }
  ] of devRouteHandlers.entries()) {
    const [_, consumerGroup] = key.split(":");
    if (topicPattern === topicName) {
      if (!handlersMap.has(routeHandler)) {
        handlersMap.set(routeHandler, /* @__PURE__ */ new Set());
      }
      handlersMap.get(routeHandler).add(consumerGroup);
    }
  }
  for (const [key, refs] of wildcardRouteHandlers.entries()) {
    const [pattern, consumerGroup] = key.split(":");
    if (matchesWildcardPattern(topicName, pattern)) {
      cleanupDeadRefs(key, refs);
      const cleanedRefs = wildcardRouteHandlers.get(key) || [];
      for (const ref of cleanedRefs) {
        const routeHandler = ref.deref();
        if (routeHandler) {
          if (!handlersMap.has(routeHandler)) {
            handlersMap.set(routeHandler, /* @__PURE__ */ new Set());
          }
          handlersMap.get(routeHandler).add(consumerGroup);
        }
      }
    }
  }
  return handlersMap;
}
function createMockCloudEventRequest(topicName, consumerGroup, messageId) {
  const cloudEvent = {
    type: "com.vercel.queue.v1beta",
    source: `/topic/${topicName}/consumer/${consumerGroup}`,
    id: messageId,
    datacontenttype: "application/json",
    data: {
      messageId,
      queueName: topicName,
      consumerGroup
    },
    time: (/* @__PURE__ */ new Date()).toISOString(),
    specversion: "1.0"
  };
  return new Request("https://localhost/api/queue/callback", {
    method: "POST",
    headers: {
      "Content-Type": "application/cloudevents+json"
    },
    body: JSON.stringify(cloudEvent)
  });
}
var DEV_CALLBACK_DELAY = 1e3;
function scheduleDevTimeout(topicName, messageId, timeoutSeconds) {
  console.log(
    `[Dev Mode] Message ${messageId} timed out for ${timeoutSeconds}s, will re-trigger`
  );
  setTimeout(
    () => {
      console.log(
        `[Dev Mode] Re-triggering callback for timed-out message ${messageId}`
      );
      triggerDevCallbacks(topicName, messageId);
    },
    timeoutSeconds * 1e3 + DEV_CALLBACK_DELAY
  );
}
function triggerDevCallbacks(topicName, messageId) {
  const handlersMap = findRouteHandlersForTopic(topicName);
  if (handlersMap.size === 0) {
    return;
  }
  const consumerGroups = Array.from(
    new Set(
      Array.from(handlersMap.values()).flatMap((groups) => Array.from(groups))
    )
  );
  console.log(
    `[Dev Mode] Triggering local callbacks for topic "${topicName}" → consumers: ${consumerGroups.join(", ")}`
  );
  setTimeout(async () => {
    for (const [routeHandler, consumerGroups2] of handlersMap.entries()) {
      for (const consumerGroup of consumerGroups2) {
        try {
          const request = createMockCloudEventRequest(
            topicName,
            consumerGroup,
            messageId
          );
          const response = await routeHandler(request);
          if (response.ok) {
            try {
              const responseData = await response.json();
              if (responseData.status === "success") {
                console.log(
                  `[Dev Mode] Message processed for ${topicName}/${consumerGroup}`
                );
              }
            } catch (jsonError) {
              console.error(
                `[Dev Mode] Failed to parse success response for ${topicName}/${consumerGroup}:`,
                jsonError
              );
            }
          } else {
            try {
              const errorData = await response.json();
              console.error(
                `[Dev Mode] Failed to process message for ${topicName}/${consumerGroup}:`,
                errorData.error || response.statusText
              );
            } catch (jsonError) {
              console.error(
                `[Dev Mode] Failed to process message for ${topicName}/${consumerGroup}:`,
                response.statusText
              );
            }
          }
        } catch (error) {
          console.error(
            `[Dev Mode] Error triggering callback for ${topicName}/${consumerGroup}:`,
            error
          );
        }
      }
    }
  }, DEV_CALLBACK_DELAY);
}
function clearDevHandlers() {
  devRouteHandlers.clear();
  wildcardRouteHandlers.clear();
}
if (process.env.VITEST) {
  globalThis.__clearDevHandlers = clearDevHandlers;
}
var ConsumerGroup = class {
  client;
  topicName;
  consumerGroupName;
  visibilityTimeout;
  refreshInterval;
  transport;
  /**
   * Create a new ConsumerGroup instance
   * @param client QueueClient instance to use for API calls
   * @param topicName Name of the topic to consume from
   * @param consumerGroupName Name of the consumer group
   * @param options Optional configuration
   */
  constructor(client, topicName, consumerGroupName, options = {}) {
    this.client = client;
    this.topicName = topicName;
    this.consumerGroupName = consumerGroupName;
    this.visibilityTimeout = options.visibilityTimeoutSeconds || 30;
    this.refreshInterval = options.refreshInterval || 10;
    this.transport = options.transport || new JsonTransport();
  }
  /**
   * Starts a background loop that periodically extends the visibility timeout for a message.
   * This prevents the message from becoming visible to other consumers while it's being processed.
   *
   * The extension loop runs every `refreshInterval` seconds and updates the message's
   * visibility timeout to `visibilityTimeout` seconds from the current time.
   *
   * @param messageId - The unique identifier of the message to extend visibility for
   * @param ticket - The receipt ticket that proves ownership of the message
   * @returns A function that when called will stop the extension loop
   *
   * @remarks
   * - The first extension attempt occurs after `refreshInterval` seconds, not immediately
   * - If an extension fails, the loop terminates with an error logged to console
   * - The returned stop function is idempotent - calling it multiple times is safe
   * - By default, the stop function returns immediately without waiting for in-flight
   * - Pass `true` to the stop function to wait for any in-flight extension to complete
   */
  startVisibilityExtension(messageId, ticket) {
    let isRunning = true;
    let resolveLifecycle;
    let timeoutId = null;
    const lifecyclePromise = new Promise((resolve) => {
      resolveLifecycle = resolve;
    });
    const extend = async () => {
      if (!isRunning) {
        resolveLifecycle();
        return;
      }
      try {
        await this.client.changeVisibility({
          queueName: this.topicName,
          consumerGroup: this.consumerGroupName,
          messageId,
          ticket,
          visibilityTimeoutSeconds: this.visibilityTimeout
        });
        if (isRunning) {
          timeoutId = setTimeout(() => extend(), this.refreshInterval * 1e3);
        } else {
          resolveLifecycle();
        }
      } catch (error) {
        console.error(
          `Failed to extend visibility for message ${messageId}:`,
          error
        );
        resolveLifecycle();
      }
    };
    timeoutId = setTimeout(() => extend(), this.refreshInterval * 1e3);
    return async (waitForCompletion = false) => {
      isRunning = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (waitForCompletion) {
        await lifecyclePromise;
      } else {
        resolveLifecycle();
      }
    };
  }
  /**
   * Process a single message with the given handler
   * @param message The message to process
   * @param handler Function to process the message
   */
  async processMessage(message, handler) {
    const stopExtension = this.startVisibilityExtension(
      message.messageId,
      message.ticket
    );
    try {
      const result = await handler(message.payload, {
        messageId: message.messageId,
        deliveryCount: message.deliveryCount,
        createdAt: message.createdAt,
        topicName: this.topicName,
        consumerGroup: this.consumerGroupName
      });
      await stopExtension();
      if (result && "timeoutSeconds" in result) {
        await this.client.changeVisibility({
          queueName: this.topicName,
          consumerGroup: this.consumerGroupName,
          messageId: message.messageId,
          ticket: message.ticket,
          visibilityTimeoutSeconds: result.timeoutSeconds
        });
        if (isDevMode()) ;
      } else {
        await this.client.deleteMessage({
          queueName: this.topicName,
          consumerGroup: this.consumerGroupName,
          messageId: message.messageId,
          ticket: message.ticket
        });
      }
    } catch (error) {
      await stopExtension();
      if (this.transport.finalize && message.payload !== void 0 && message.payload !== null) {
        try {
          await this.transport.finalize(message.payload);
        } catch (finalizeError) {
          console.warn("Failed to finalize message payload:", finalizeError);
        }
      }
      throw error;
    }
  }
  async consume(handler, options) {
    if (options?.messageId) {
      if (options.skipPayload) {
        const response = await this.client.receiveMessageById(
          {
            queueName: this.topicName,
            consumerGroup: this.consumerGroupName,
            messageId: options.messageId,
            visibilityTimeoutSeconds: this.visibilityTimeout,
            skipPayload: true
          },
          this.transport
        );
        await this.processMessage(
          response.message,
          handler
        );
      } else {
        const response = await this.client.receiveMessageById(
          {
            queueName: this.topicName,
            consumerGroup: this.consumerGroupName,
            messageId: options.messageId,
            visibilityTimeoutSeconds: this.visibilityTimeout
          },
          this.transport
        );
        await this.processMessage(
          response.message,
          handler
        );
      }
    } else {
      let messageFound = false;
      for await (const message of this.client.receiveMessages(
        {
          queueName: this.topicName,
          consumerGroup: this.consumerGroupName,
          visibilityTimeoutSeconds: this.visibilityTimeout,
          limit: 1
        },
        this.transport
      )) {
        messageFound = true;
        await this.processMessage(message, handler);
        break;
      }
      if (!messageFound) {
        throw new Error("No messages available");
      }
    }
  }
  /**
   * Get the consumer group name
   */
  get name() {
    return this.consumerGroupName;
  }
  /**
   * Get the topic name this consumer group is subscribed to
   */
  get topic() {
    return this.topicName;
  }
};
var Topic = class {
  client;
  topicName;
  transport;
  /**
   * Create a new Topic instance
   * @param client QueueClient instance to use for API calls
   * @param topicName Name of the topic to work with
   * @param transport Optional serializer/deserializer for the payload (defaults to JSON)
   */
  constructor(client, topicName, transport) {
    this.client = client;
    this.topicName = topicName;
    this.transport = transport || new JsonTransport();
  }
  /**
   * Publish a message to the topic
   * @param payload The data to publish
   * @param options Optional publish options
   * @returns An object containing the message ID
   * @throws {BadRequestError} When request parameters are invalid
   * @throws {UnauthorizedError} When authentication fails
   * @throws {ForbiddenError} When access is denied (environment mismatch)
   * @throws {InternalServerError} When server encounters an error
   */
  async publish(payload, options) {
    const result = await this.client.sendMessage(
      {
        queueName: this.topicName,
        payload,
        idempotencyKey: options?.idempotencyKey,
        retentionSeconds: options?.retentionSeconds,
        deploymentId: options?.deploymentId
      },
      this.transport
    );
    return { messageId: result.messageId };
  }
  /**
   * Create a consumer group for this topic
   * @param consumerGroupName Name of the consumer group
   * @param options Optional configuration for the consumer group
   * @returns A ConsumerGroup instance
   */
  consumerGroup(consumerGroupName, options) {
    const consumerOptions = {
      ...options,
      transport: options?.transport || this.transport
    };
    return new ConsumerGroup(
      this.client,
      this.topicName,
      consumerGroupName,
      consumerOptions
    );
  }
  /**
   * Get the topic name
   */
  get name() {
    return this.topicName;
  }
  /**
   * Get the transport used by this topic
   */
  get serializer() {
    return this.transport;
  }
};
function validateWildcardPattern(pattern) {
  const firstIndex = pattern.indexOf("*");
  const lastIndex = pattern.lastIndexOf("*");
  if (firstIndex !== lastIndex) {
    return false;
  }
  if (firstIndex === -1) {
    return false;
  }
  if (firstIndex !== pattern.length - 1) {
    return false;
  }
  return true;
}
function matchesWildcardPattern(topicName, pattern) {
  const prefix = pattern.slice(0, -1);
  return topicName.startsWith(prefix);
}
function findTopicHandler(queueName, handlers) {
  const exactHandler = handlers[queueName];
  if (exactHandler) {
    return exactHandler;
  }
  for (const pattern in handlers) {
    if (pattern.includes("*") && matchesWildcardPattern(queueName, pattern)) {
      return handlers[pattern];
    }
  }
  return null;
}
async function parseCallback(request) {
  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.includes("application/cloudevents+json")) {
    throw new Error(
      "Invalid content type: expected 'application/cloudevents+json'"
    );
  }
  let cloudEvent;
  try {
    cloudEvent = await request.json();
  } catch (error) {
    throw new Error("Failed to parse CloudEvent from request body");
  }
  if (!cloudEvent.type || !cloudEvent.source || !cloudEvent.id || typeof cloudEvent.data !== "object" || cloudEvent.data == null) {
    throw new Error("Invalid CloudEvent: missing required fields");
  }
  if (cloudEvent.type !== "com.vercel.queue.v1beta") {
    throw new Error(
      `Invalid CloudEvent type: expected 'com.vercel.queue.v1beta', got '${cloudEvent.type}'`
    );
  }
  const missingFields = [];
  if (!("queueName" in cloudEvent.data)) missingFields.push("queueName");
  if (!("consumerGroup" in cloudEvent.data))
    missingFields.push("consumerGroup");
  if (!("messageId" in cloudEvent.data)) missingFields.push("messageId");
  if (missingFields.length > 0) {
    throw new Error(
      `Missing required CloudEvent data fields: ${missingFields.join(", ")}`
    );
  }
  const { messageId, queueName, consumerGroup } = cloudEvent.data;
  return {
    queueName,
    consumerGroup,
    messageId
  };
}
function createCallbackHandler(handlers, client) {
  for (const topicPattern in handlers) {
    if (topicPattern.includes("*")) {
      if (!validateWildcardPattern(topicPattern)) {
        throw new Error(
          `Invalid wildcard pattern "${topicPattern}": * may only appear once and must be at the end of the topic name`
        );
      }
    }
  }
  const routeHandler = async (request) => {
    try {
      const { queueName, consumerGroup, messageId } = await parseCallback(request);
      const topicHandler = findTopicHandler(queueName, handlers);
      if (!topicHandler) {
        const availableTopics = Object.keys(handlers).join(", ");
        return Response.json(
          {
            error: `No handler found for topic: ${queueName}`,
            availableTopics
          },
          { status: 404 }
        );
      }
      const consumerGroupHandler = topicHandler[consumerGroup];
      if (!consumerGroupHandler) {
        const availableGroups = Object.keys(topicHandler).join(", ");
        return Response.json(
          {
            error: `No handler found for consumer group "${consumerGroup}" in topic "${queueName}".`,
            availableGroups
          },
          { status: 404 }
        );
      }
      const topic = new Topic(client, queueName);
      const cg = topic.consumerGroup(consumerGroup);
      await cg.consume(consumerGroupHandler, { messageId });
      return Response.json({ status: "success" });
    } catch (error) {
      console.error("Queue callback error:", error);
      if (error instanceof Error && (error.message.includes("Missing required CloudEvent data fields") || error.message.includes("Invalid CloudEvent") || error.message.includes("Invalid CloudEvent type") || error.message.includes("Invalid content type") || error.message.includes("Failed to parse CloudEvent"))) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      return Response.json(
        { error: "Failed to process queue message" },
        { status: 500 }
      );
    }
  };
  return routeHandler;
}
function handleCallback(handlers, client) {
  return createCallbackHandler(handlers, client || new QueueClient());
}
async function send(topicName, payload, options) {
  const transport = options?.transport || new JsonTransport();
  const client = options?.client || new QueueClient();
  const result = await client.sendMessage(
    {
      queueName: topicName,
      payload,
      idempotencyKey: options?.idempotencyKey,
      retentionSeconds: options?.retentionSeconds,
      deploymentId: options?.deploymentId
    },
    transport
  );
  return { messageId: result.messageId };
}
var Client = class {
  client;
  /**
   * Create a new Client
   * @param options QueueClient configuration options
   */
  constructor(options = {}) {
    this.client = new QueueClient(options);
  }
  /**
   * Send a message to a topic
   * @param topicName Name of the topic to send to
   * @param payload The data to send
   * @param options Optional publish options and transport
   * @returns Promise with the message ID
   * @throws {BadRequestError} When request parameters are invalid
   * @throws {UnauthorizedError} When authentication fails
   * @throws {ForbiddenError} When access is denied (environment mismatch)
   * @throws {InternalServerError} When server encounters an error
   */
  async send(topicName, payload, options) {
    return send(topicName, payload, {
      ...options,
      client: this.client
    });
  }
  /**
   * Create a callback handler for processing queue messages
   * Returns a Next.js route handler function that routes messages to appropriate handlers
   * @param handlers Object with topic-specific handlers organized by consumer groups
   * @returns A Next.js route handler function
   *
   * @example
   * ```typescript
   * export const POST = client.handleCallback({
   *   "user-events": {
   *     "welcome": (user, metadata) => console.log("Welcoming user", user),
   *     "analytics": (user, metadata) => console.log("Tracking user", user),
   *   },
   * });
   * ```
   */
  handleCallback(handlers) {
    return handleCallback(handlers, this.client);
  }
};
export {
  Client as C,
  JsonTransport as J
};
