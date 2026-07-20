import { ToolLoopAgent, createAgentUIStreamResponse, stepCountIs } from "ai";
import { createBashTool } from "bash-tool";
import { Bash, OverlayFs } from "just-bash";
import { timingSafeEqual } from "node:crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DATA_DIR = join(__dirname, "./_agent-data");
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_TEXT_BYTES = 48 * 1024;
const MAX_BODY_READ_MS = 15_000;
const MAX_CONCURRENT_REQUESTS = 8;
const MAX_REQUESTS_PER_MINUTE = 120;
let activeRequests = 0;
const recentAdmissions: number[] = [];

function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function authenticate(req: Request): Response | undefined {
  const configuredToken = process.env.JUST_BASH_AGENT_API_TOKEN;
  if (!configuredToken) {
    // The paid-model demo is convenient during local development, but a
    // production deployment must opt in with an authentication boundary.
    return process.env.NODE_ENV === "production"
      ? Response.json(
          { error: "Agent endpoint is disabled" },
          { status: 503 },
        )
      : undefined;
  }

  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return unauthorized();
  const supplied = authorization.slice("Bearer ".length);
  const suppliedBytes = Buffer.from(supplied);
  const configuredBytes = Buffer.from(configuredToken);
  if (
    suppliedBytes.byteLength !== configuredBytes.byteLength ||
    !timingSafeEqual(suppliedBytes, configuredBytes)
  ) {
    return unauthorized();
  }
  return undefined;
}

function admitRequest(): (() => void) | Response {
  const now = Date.now();
  while (recentAdmissions[0] !== undefined && recentAdmissions[0] <= now - 60_000) {
    recentAdmissions.shift();
  }
  if (
    activeRequests >= MAX_CONCURRENT_REQUESTS ||
    recentAdmissions.length >= MAX_REQUESTS_PER_MINUTE
  ) {
    return Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  activeRequests++;
  recentAdmissions.push(now);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeRequests--;
  };
}

function releaseWhenStreamCloses(
  response: Response,
  release: () => void,
): Response {
  if (!response.body) {
    release();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          release();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        release();
      }
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function readBoundedMessages(req: Request): Promise<unknown[]> {
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new RangeError("request body too large");
  }

  const reader = req.body?.getReader();
  if (!reader) throw new TypeError("request body is required");
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let json = "";
  let bodyReadTimedOut = false;
  const cancelRead = () => void reader.cancel("request cancelled");
  req.signal.addEventListener("abort", cancelRead, { once: true });
  const bodyTimer = setTimeout(() => {
    bodyReadTimedOut = true;
    void reader.cancel("request body deadline exceeded");
  }, MAX_BODY_READ_MS);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new RangeError("request body too large");
      }
      json += decoder.decode(value, { stream: true });
    }
  } finally {
    clearTimeout(bodyTimer);
    req.signal.removeEventListener("abort", cancelRead);
  }
  if (bodyReadTimedOut) throw new RangeError("request body deadline exceeded");
  json += decoder.decode();

  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("messages" in parsed) ||
    !Array.isArray(parsed.messages) ||
    parsed.messages.length === 0 ||
    parsed.messages.length > MAX_MESSAGES
  ) {
    throw new TypeError("invalid messages");
  }

  let textBytes = 0;
  let structuredNodes = 0;
  const chargeString = (value: string): void => {
    textBytes += new TextEncoder().encode(value).byteLength;
    if (textBytes > MAX_MESSAGE_TEXT_BYTES) {
      throw new RangeError("message text too large");
    }
  };
  const validateStructuredPart = (root: unknown): void => {
    const stack: Array<{ value: unknown; depth: number }> = [
      { value: root, depth: 0 },
    ];
    while (stack.length > 0) {
      const entry = stack.pop();
      if (!entry) break;
      structuredNodes++;
      if (structuredNodes > 1_000 || entry.depth > 8) {
        throw new RangeError("message structure too large");
      }
      if (typeof entry.value === "string") {
        chargeString(entry.value);
      } else if (Array.isArray(entry.value)) {
        for (const value of entry.value) {
          stack.push({ value, depth: entry.depth + 1 });
        }
      } else if (typeof entry.value === "object" && entry.value !== null) {
        for (const [key, value] of Object.entries(entry.value)) {
          if (
            key === "__proto__" ||
            key === "prototype" ||
            key === "constructor"
          ) {
            throw new TypeError("invalid message key");
          }
          chargeString(key);
          stack.push({ value, depth: entry.depth + 1 });
        }
      } else if (
        entry.value !== null &&
        typeof entry.value !== "boolean" &&
        typeof entry.value !== "number"
      ) {
        throw new TypeError("invalid message value");
      }
    }
  };
  for (const message of parsed.messages) {
    if (
      typeof message !== "object" ||
      message === null ||
      !("role" in message) ||
      (message.role !== "user" && message.role !== "assistant") ||
      !("parts" in message) ||
      !Array.isArray(message.parts) ||
      message.parts.length === 0 ||
      message.parts.length > 20
    ) {
      throw new TypeError("invalid message");
    }
    for (const part of message.parts) {
      if (
        typeof part !== "object" ||
        part === null ||
        !("type" in part) ||
        typeof part.type !== "string" ||
        part.type.length > 100
      ) {
        throw new TypeError("invalid message part");
      }
      if (part.type === "text" || part.type === "reasoning") {
        if (part.type === "reasoning" && message.role !== "assistant") {
          throw new TypeError("invalid reasoning part");
        }
        if (!("text" in part) || typeof part.text !== "string") {
          throw new TypeError("invalid text part");
        }
        chargeString(part.text);
        continue;
      }
      if (
        message.role !== "assistant" ||
        (part.type !== "dynamic-tool" &&
          part.type !== "step-start" &&
          !part.type.startsWith("tool-"))
      ) {
        throw new TypeError("unsupported message part");
      }
      validateStructuredPart(part);
    }
  }

  return parsed.messages;
}

const SYSTEM_INSTRUCTIONS = `You are an expert on just-bash, a TypeScript bash interpreter with an in-memory virtual filesystem.

You have access to a bash sandbox with the full source code of:
- just-bash/ - The main bash interpreter
- bash-tool/ - AI SDK tool for bash


Refer to the README.md of the projects to answer questions about just-bash and bash-tool 
themselves which is your main focus. Never talk about this demo implementation unless asked explicitly.

Use the sandbox to explore the source code, demonstrate commands, and help users understand:
- How to use just-bash and bash-tool
- Bash scripting in general
- The implementation details of just-bash

Key features of just-bash:
- Pure TypeScript implementation (no WASM dependencies)
- In-memory virtual filesystem
- Supports common bash commands: ls, cat, grep, awk, sed, jq, etc.
- Custom command support via defineCommand
- Network access control with URL allowlists

Use cat to read files. Use head, tail to read parts of large files.

Keep responses concise. You do not have access to pnpm, npm, or node.`;

export async function POST(req: Request) {
  const authError = authenticate(req);
  if (authError) return authError;
  const admission = admitRequest();
  if (admission instanceof Response) return admission;

  let messages: unknown[];
  try {
    messages = await readBoundedMessages(req);
  } catch (error) {
    admission();
    const status = error instanceof RangeError ? 413 : 400;
    return Response.json({ error: "Invalid request" }, { status });
  }
  try {
    const overlayFs = new OverlayFs({ root: AGENT_DATA_DIR, readOnly: true });
    const sandbox = new Bash({ fs: overlayFs, cwd: overlayFs.getMountPoint() });
    const bashToolkit = await createBashTool({
      sandbox,
      destination: overlayFs.getMountPoint(),
    });

    // Create a fresh agent per request for proper streaming
    const agent = new ToolLoopAgent({
      model: "claude-haiku-4-5",
      maxOutputTokens: 2048,
      maxRetries: 0,
      instructions: SYSTEM_INSTRUCTIONS,
      tools: {
        bash: bashToolkit.tools.bash,
      },
      stopWhen: stepCountIs(8),
    });

    const response = await createAgentUIStreamResponse({
      agent,
      uiMessages: messages,
      timeout: { totalMs: 30_000, stepMs: 10_000, chunkMs: 10_000 },
    });
    return releaseWhenStreamCloses(response, admission);
  } catch (error) {
    admission();
    throw error;
  }
}
