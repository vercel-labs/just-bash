// Automa modifications: invocation-local jq input metadata and eager-evaluation guard.
import type { EvalContext } from "./evaluator.js";
import type { AstNode } from "./parser.js";
import type { QueryValue } from "./value-operations.js";

export interface InputMetadata {
  filename: string | null;
  line: number;
}
export type InputPolicy = string | { reason: string; reads: number };
export interface InputState {
  fileErrors: string[];
  readCount: number;
  pushRecord(array: QueryValue[]): void;
  beforeEach(array: readonly QueryValue[], index: number): void;
  stamp(array: QueryValue[]): QueryValue[];
  append(
    target: QueryValue[],
    source: readonly QueryValue[],
    offset: number,
  ): void;
  concat(
    result: QueryValue[],
    left: QueryValue[],
    right: QueryValue[],
  ): QueryValue[];
  context(context: EvalContext, node: AstNode): EvalContext;
  read(context: EvalContext): QueryValue[];
}
export class InputEOFError extends Error {
  constructor(
    readonly metadata: InputMetadata,
    readonly fileErrors: string[],
  ) {
    super("break");
  }
}

export function hasInputCall(ast: AstNode): boolean {
  const pending: unknown[] = [ast];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (
      "type" in node &&
      node.type === "Call" &&
      "name" in node &&
      node.name === "input"
    )
      return true;
    pending.push(
      ...Object.values(node).filter(
        (value) => value && typeof value === "object",
      ),
    );
  }
  return false;
}

export function createInputContextPolicy(): InputState["context"] {
  const scopes = new WeakMap<object, WeakMap<AstNode, boolean>>();
  const fallback = Object.create(null);
  return (context, node) => {
    if (typeof context.inputPolicy === "string") return context;
    const restrict = (reason: string): EvalContext => ({
      ...context,
      inputPolicy: reason,
    });
    const scope = context.funcs ?? fallback;
    let memo = scopes.get(scope);
    if (!memo) {
      memo = new WeakMap();
      scopes.set(scope, memo);
    }
    const multiple = (value?: AstNode): boolean => {
      if (!value) return false;
      const cached = memo.get(value);
      if (cached !== undefined) return cached;
      let single = false;
      switch (value.type) {
        case "Literal":
        case "Identity":
        case "VarRef":
        case "Array":
          single = true;
          break;
        case "Paren":
          single = !multiple(value.expr);
          break;
        case "Field":
          single = !multiple(value.base);
          break;
        case "Index":
          single = !multiple(value.base) && !multiple(value.index);
          break;
        case "Slice":
          single =
            !multiple(value.base) &&
            !multiple(value.start) &&
            !multiple(value.end);
          break;
        case "UnaryOp":
          single = !multiple(value.operand);
          break;
        case "Pipe":
        case "BinaryOp":
          single = !multiple(value.left) && !multiple(value.right);
          break;
        case "Object":
          single = value.entries.every(
            (entry) =>
              (typeof entry.key === "string" || !multiple(entry.key)) &&
              !multiple(entry.value),
          );
          break;
        case "Cond":
          single =
            !multiple(value.cond) &&
            !multiple(value.then) &&
            !multiple(value.else) &&
            (value.elifs ?? []).every(
              (branch) => !multiple(branch.cond) && !multiple(branch.then),
            );
          break;
        case "Call": {
          if (context.funcs?.has(`${value.name}/${value.args.length}`)) break;
          const argc = value.args.length;
          if (
            argc === 0 &&
            [
              "input",
              "length",
              "tostring",
              "tonumber",
              "type",
              "keys",
              "keys_unsorted",
              "to_entries",
              "from_entries",
              "first",
              "last",
            ].includes(value.name)
          )
            single = true;
          else if (argc === 1 && ["contains", "has"].includes(value.name))
            single = !multiple(value.args[0]);
          else if (
            argc === 1 &&
            ["map", "map_values", "first", "last", "isempty"].includes(
              value.name,
            )
          )
            single = true;
          else if ((argc === 1 || argc === 2) && value.name === "nth")
            single = !multiple(value.args[0]);
          break;
        }
      }
      memo.set(value, !single);
      return !single;
    };
    if (
      node.type === "Call" &&
      ["first", "limit", "nth", "any", "all", "isempty", "isvalid"].includes(
        node.name,
      )
    ) {
      const args = node.args;
      const direct = (value?: AstNode) =>
        value?.type === "Call" &&
        value.name === "input" &&
        value.args.length === 0;
      const single =
        (node.name === "first" && args.length === 1 && direct(args[0])) ||
        (node.name === "limit" &&
          args.length === 2 &&
          args[0].type === "Literal" &&
          typeof args[0].value === "number" &&
          args[0].value >= 1 &&
          direct(args[1])) ||
        (node.name === "nth" &&
          args.length === 2 &&
          args[0].type === "Literal" &&
          args[0].value === 0 &&
          direct(args[1]));
      if (!single) return restrict(`short-circuit filter ${node.name}`);
    }
    if (["Label", "Reduce", "Foreach"].includes(node.type))
      return restrict(node.type);
    if (["Try", "Optional"].includes(node.type))
      return {
        ...context,
        inputPolicy: context.inputPolicy || { reason: node.type, reads: 0 },
      };
    if (node.type === "BinaryOp" && ["//", "and", "or"].includes(node.op))
      return restrict(`short-circuit operator ${node.op}`);
    if (node.type === "VarBind" && multiple(node.value))
      return restrict("multi-result variable binding");
    if (node.type === "Cond" && multiple(node.cond))
      return restrict("multi-result condition");
    if (
      node.type === "Object" &&
      node.entries.length > 1 &&
      node.entries.some(
        (entry) =>
          multiple(entry.value) ||
          (typeof entry.key === "object" && multiple(entry.key)),
      )
    )
      return restrict("multi-result object field");
    return context;
  };
}
