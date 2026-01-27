import { o as object, d as date, s as string, a as discriminatedUnion, b as any, l as literal, c as boolean, n as number, _ as _enum, e as array, f as lazy, u as union, g as _null, r as record, t as templateLiteral, h as _undefined } from "../../../_libs/zod.mjs";
const EventTypeSchema = _enum([
  "step_completed",
  "step_failed",
  "step_retrying",
  "step_started",
  "hook_created",
  "hook_received",
  "hook_disposed",
  "wait_created",
  "wait_completed",
  "workflow_completed",
  "workflow_failed",
  "workflow_started"
]);
const BaseEventSchema = object({
  eventType: EventTypeSchema,
  correlationId: string().optional()
});
const StepCompletedEventSchema = BaseEventSchema.extend({
  eventType: literal("step_completed"),
  correlationId: string(),
  eventData: object({
    result: any()
  })
});
const StepFailedEventSchema = BaseEventSchema.extend({
  eventType: literal("step_failed"),
  correlationId: string(),
  eventData: object({
    error: any(),
    stack: string().optional(),
    fatal: boolean().optional()
  })
});
const StepRetryingEventSchema = BaseEventSchema.extend({
  eventType: literal("step_retrying"),
  correlationId: string(),
  eventData: object({
    attempt: number().min(1)
  })
});
const StepStartedEventSchema = BaseEventSchema.extend({
  eventType: literal("step_started"),
  correlationId: string()
});
const HookCreatedEventSchema = BaseEventSchema.extend({
  eventType: literal("hook_created"),
  correlationId: string()
});
const HookReceivedEventSchema = BaseEventSchema.extend({
  eventType: literal("hook_received"),
  correlationId: string(),
  eventData: object({
    payload: any()
    // Serialized payload
  })
});
const HookDisposedEventSchema = BaseEventSchema.extend({
  eventType: literal("hook_disposed"),
  correlationId: string()
});
const WaitCreatedEventSchema = BaseEventSchema.extend({
  eventType: literal("wait_created"),
  correlationId: string(),
  eventData: object({
    resumeAt: date()
  })
});
const WaitCompletedEventSchema = BaseEventSchema.extend({
  eventType: literal("wait_completed"),
  correlationId: string()
});
const WorkflowCompletedEventSchema = BaseEventSchema.extend({
  eventType: literal("workflow_completed")
});
const WorkflowFailedEventSchema = BaseEventSchema.extend({
  eventType: literal("workflow_failed"),
  eventData: object({
    error: any()
  })
});
const WorkflowStartedEventSchema = BaseEventSchema.extend({
  eventType: literal("workflow_started")
});
const CreateEventSchema = discriminatedUnion("eventType", [
  StepCompletedEventSchema,
  StepFailedEventSchema,
  StepRetryingEventSchema,
  StepStartedEventSchema,
  HookCreatedEventSchema,
  HookReceivedEventSchema,
  HookDisposedEventSchema,
  WaitCreatedEventSchema,
  WaitCompletedEventSchema,
  WorkflowCompletedEventSchema,
  WorkflowFailedEventSchema,
  WorkflowStartedEventSchema
]);
const EventSchema = CreateEventSchema.and(object({
  runId: string(),
  eventId: string(),
  createdAt: date()
}));
const zodJsonSchema = lazy(() => {
  return union([
    string(),
    number(),
    boolean(),
    _null(),
    array(zodJsonSchema),
    record(string(), zodJsonSchema)
  ]);
});
const PaginatedResponseSchema = (dataSchema) => object({
  data: array(dataSchema),
  cursor: string().nullable(),
  hasMore: boolean()
});
const StructuredErrorSchema = object({
  message: string(),
  stack: string().optional(),
  code: string().optional()
  // TODO: currently unused. make this an enum maybe
});
const HookSchema = object({
  runId: string(),
  hookId: string(),
  token: string(),
  ownerId: string(),
  projectId: string(),
  environment: string(),
  metadata: zodJsonSchema.optional(),
  createdAt: date()
});
const QueuePrefix = union([
  literal("__wkf_step_"),
  literal("__wkf_workflow_")
]);
const ValidQueueName = templateLiteral([QueuePrefix, string()]);
const MessageId = string().brand().describe("A stored queue message ID");
const TraceCarrierSchema = record(string(), string());
const WorkflowInvokePayloadSchema = object({
  runId: string(),
  traceCarrier: TraceCarrierSchema.optional(),
  requestedAt: date().optional()
});
const StepInvokePayloadSchema = object({
  workflowName: string(),
  workflowRunId: string(),
  workflowStartedAt: number(),
  stepId: string(),
  traceCarrier: TraceCarrierSchema.optional(),
  requestedAt: date().optional()
});
const HealthCheckPayloadSchema = object({
  __healthCheck: literal(true),
  correlationId: string()
});
const QueuePayloadSchema = union([
  WorkflowInvokePayloadSchema,
  StepInvokePayloadSchema,
  HealthCheckPayloadSchema
]);
const WorkflowRunStatusSchema = _enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled"
]);
const WorkflowRunBaseSchema = object({
  runId: string(),
  status: WorkflowRunStatusSchema,
  deploymentId: string(),
  workflowName: string(),
  executionContext: record(string(), any()).optional(),
  input: array(any()),
  output: any().optional(),
  error: StructuredErrorSchema.optional(),
  expiredAt: date().optional(),
  startedAt: date().optional(),
  completedAt: date().optional(),
  createdAt: date(),
  updatedAt: date()
});
const WorkflowRunSchema = discriminatedUnion("status", [
  // Non-final states
  WorkflowRunBaseSchema.extend({
    status: _enum(["pending", "running"]),
    output: _undefined(),
    error: _undefined(),
    completedAt: _undefined()
  }),
  // Cancelled state
  WorkflowRunBaseSchema.extend({
    status: literal("cancelled"),
    output: _undefined(),
    error: _undefined(),
    completedAt: date()
  }),
  // Completed state
  WorkflowRunBaseSchema.extend({
    status: literal("completed"),
    output: any(),
    error: _undefined(),
    completedAt: date()
  }),
  // Failed state
  WorkflowRunBaseSchema.extend({
    status: literal("failed"),
    output: _undefined(),
    error: StructuredErrorSchema,
    completedAt: date()
  })
]);
const StepStatusSchema = _enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled"
]);
const StepSchema = object({
  runId: string(),
  stepId: string(),
  stepName: string(),
  status: StepStatusSchema,
  input: array(any()),
  output: any().optional(),
  error: StructuredErrorSchema.optional(),
  attempt: number(),
  startedAt: date().optional(),
  completedAt: date().optional(),
  createdAt: date(),
  updatedAt: date(),
  retryAfter: date().optional()
});
export {
  EventSchema as E,
  HealthCheckPayloadSchema as H,
  MessageId as M,
  PaginatedResponseSchema as P,
  QueuePayloadSchema as Q,
  StepInvokePayloadSchema as S,
  ValidQueueName as V,
  WorkflowInvokePayloadSchema as W,
  StepSchema as a,
  WorkflowRunSchema as b,
  HookSchema as c,
  StructuredErrorSchema as d,
  EventTypeSchema as e,
  WorkflowRunBaseSchema as f
};
