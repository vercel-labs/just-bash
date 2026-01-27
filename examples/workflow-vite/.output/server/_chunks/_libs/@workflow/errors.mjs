import { p as parseDurationToDate } from "./utils.mjs";
const BASE_URL = "https://useworkflow.dev/err";
function isError(value) {
  return typeof value === "object" && value !== null && "name" in value && "message" in value;
}
const ERROR_SLUGS = {
  WEBHOOK_INVALID_RESPOND_WITH_VALUE: "webhook-invalid-respond-with-value",
  WEBHOOK_RESPONSE_NOT_SENT: "webhook-response-not-sent",
  FETCH_IN_WORKFLOW_FUNCTION: "fetch-in-workflow",
  TIMEOUT_FUNCTIONS_IN_WORKFLOW: "timeout-in-workflow"
};
class WorkflowError extends Error {
  cause;
  constructor(message, options) {
    const msgDocs = options?.slug ? `${message}

Learn more: ${BASE_URL}/${options.slug}` : message;
    super(msgDocs, { cause: options?.cause });
    this.cause = options?.cause;
    if (options?.cause instanceof Error) {
      this.stack = `${this.stack}
Caused by: ${options.cause.stack}`;
    }
  }
  static is(value) {
    return isError(value) && value.name === "WorkflowError";
  }
}
class WorkflowAPIError extends WorkflowError {
  status;
  code;
  url;
  constructor(message, options) {
    super(message, {
      cause: options?.cause
    });
    this.name = "WorkflowAPIError";
    this.status = options?.status;
    this.code = options?.code;
    this.url = options?.url;
  }
  static is(value) {
    return isError(value) && value.name === "WorkflowAPIError";
  }
}
class WorkflowRunFailedError extends WorkflowError {
  runId;
  constructor(runId, error) {
    const causeError = new Error(error.message);
    if (error.stack) {
      causeError.stack = error.stack;
    }
    if (error.code) {
      causeError.code = error.code;
    }
    super(`Workflow run "${runId}" failed: ${error.message}`, {
      cause: causeError
    });
    this.name = "WorkflowRunFailedError";
    this.runId = runId;
  }
  static is(value) {
    return isError(value) && value.name === "WorkflowRunFailedError";
  }
}
class WorkflowRunNotCompletedError extends WorkflowError {
  runId;
  status;
  constructor(runId, status) {
    super(`Workflow run "${runId}" has not completed`, {});
    this.name = "WorkflowRunNotCompletedError";
    this.runId = runId;
    this.status = status;
  }
  static is(value) {
    return isError(value) && value.name === "WorkflowRunNotCompletedError";
  }
}
class WorkflowRuntimeError extends WorkflowError {
  constructor(message, options) {
    super(message, {
      ...options
    });
    this.name = "WorkflowRuntimeError";
  }
  static is(value) {
    return isError(value) && value.name === "WorkflowRuntimeError";
  }
}
class WorkflowRunNotFoundError extends WorkflowError {
  runId;
  constructor(runId) {
    super(`Workflow run "${runId}" not found`, {});
    this.name = "WorkflowRunNotFoundError";
    this.runId = runId;
  }
  static is(value) {
    return isError(value) && value.name === "WorkflowRunNotFoundError";
  }
}
class WorkflowRunCancelledError extends WorkflowError {
  runId;
  constructor(runId) {
    super(`Workflow run "${runId}" cancelled`, {});
    this.name = "WorkflowRunCancelledError";
    this.runId = runId;
  }
  static is(value) {
    return isError(value) && value.name === "WorkflowRunCancelledError";
  }
}
class FatalError extends Error {
  fatal = true;
  constructor(message) {
    super(message);
    this.name = "FatalError";
  }
  static is(value) {
    return isError(value) && value.name === "FatalError";
  }
}
class RetryableError extends Error {
  /**
   * The Date when the step should be retried.
   */
  retryAfter;
  constructor(message, options = {}) {
    super(message);
    this.name = "RetryableError";
    if (options.retryAfter !== void 0) {
      this.retryAfter = parseDurationToDate(options.retryAfter);
    } else {
      this.retryAfter = new Date(Date.now() + 1e3);
    }
  }
  static is(value) {
    return isError(value) && value.name === "RetryableError";
  }
}
export {
  ERROR_SLUGS as E,
  FatalError as F,
  RetryableError as R,
  WorkflowRuntimeError as W,
  WorkflowAPIError as a,
  WorkflowRunCancelledError as b,
  WorkflowRunFailedError as c,
  WorkflowRunNotCompletedError as d,
  WorkflowRunNotFoundError as e
};
