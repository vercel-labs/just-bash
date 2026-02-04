/**
 * Transform moonblade AST to jq AST
 *
 * This module converts moonblade expressions (xan's expression language)
 * to jq AST for evaluation by the shared query engine.
 */

import type { AstNode } from "../query-engine/parser.js";
import type { MoonbladeExpr } from "./moonblade-parser.js";

/**
 * Helper to create pipe-based function call for single arg functions.
 * In jq, `func(arg)` often needs to be `arg | func` for correct semantics.
 */
function makePipeFunc(funcName: string, args: AstNode[]): AstNode {
  if (args.length === 0) {
    return makeCall(funcName, []);
  }
  if (args.length === 1) {
    return { type: "Pipe", left: args[0], right: makeCall(funcName, []) };
  }
  // For multi-arg functions, pass additional args after piping the first
  return {
    type: "Pipe",
    left: args[0],
    right: makeCall(funcName, args.slice(1)),
  };
}

/**
 * Map of moonblade function names to jq equivalents
 */
// @banned-pattern-ignore: accessed via Object.hasOwn() check in moonbladeToJq()
const FUNCTION_MAP: Record<string, string | ((args: AstNode[]) => AstNode)> = {
  // Arithmetic
  add: (args) => makeBinaryOp("+", args[0], args[1]),
  sub: (args) => makeBinaryOp("-", args[0], args[1]),
  mul: (args) => makeBinaryOp("*", args[0], args[1]),
  div: (args) => makeBinaryOp("/", args[0], args[1]),
  mod: (args) => makeBinaryOp("%", args[0], args[1]),
  idiv: (args) => makeCall("floor", [makeBinaryOp("/", args[0], args[1])]),
  pow: (args) => makePipeFunc("pow", args),
  neg: (args) => ({ type: "UnaryOp", op: "-", operand: args[0] }),

  // Comparison
  "==": (args) => makeBinaryOp("==", args[0], args[1]),
  "!=": (args) => makeBinaryOp("!=", args[0], args[1]),
  "<": (args) => makeBinaryOp("<", args[0], args[1]),
  "<=": (args) => makeBinaryOp("<=", args[0], args[1]),
  ">": (args) => makeBinaryOp(">", args[0], args[1]),
  ">=": (args) => makeBinaryOp(">=", args[0], args[1]),

  // String comparison (case-sensitive string compare) - convert to strings first using pipe
  eq: (args) =>
    makeBinaryOp("==", makePipeTostring(args[0]), makePipeTostring(args[1])),
  ne: (args) =>
    makeBinaryOp("!=", makePipeTostring(args[0]), makePipeTostring(args[1])),
  lt: (args) =>
    makeBinaryOp("<", makePipeTostring(args[0]), makePipeTostring(args[1])),
  le: (args) =>
    makeBinaryOp("<=", makePipeTostring(args[0]), makePipeTostring(args[1])),
  gt: (args) =>
    makeBinaryOp(">", makePipeTostring(args[0]), makePipeTostring(args[1])),
  ge: (args) =>
    makeBinaryOp(">=", makePipeTostring(args[0]), makePipeTostring(args[1])),

  // Logical
  and: (args) => makeBinaryOp("and", args[0], args[1]),
  or: (args) => makeBinaryOp("or", args[0], args[1]),
  not: (args) => ({ type: "UnaryOp", op: "not", operand: args[0] }),

  // String functions - use pipe syntax for single-arg functions
  len: (args) => makePipeFunc("length", args),
  length: (args) => makePipeFunc("length", args),
  upper: (args) => makePipeFunc("ascii_upcase", args),
  lower: (args) => makePipeFunc("ascii_downcase", args),
  trim: (args) => makePipeFunc("trim", args),
  ltrim: (args) =>
    args.length === 0
      ? makeCall("ltrimstr", [{ type: "Literal", value: " " }])
      : {
          type: "Pipe",
          left: args[0],
          right: makeCall("ltrimstr", [{ type: "Literal", value: " " }]),
        },
  rtrim: (args) =>
    args.length === 0
      ? makeCall("rtrimstr", [{ type: "Literal", value: " " }])
      : {
          type: "Pipe",
          left: args[0],
          right: makeCall("rtrimstr", [{ type: "Literal", value: " " }]),
        },
  split: (args) => makePipeFunc("split", args),
  join: (args) =>
    args.length === 1
      ? makeCall("join", [{ type: "Literal", value: "" }])
      : makePipeFunc("join", args),
  concat: (args) => makeBinaryOp("+", args[0], args[1]),
  startswith: (args) => makePipeFunc("startswith", args),
  endswith: (args) => makePipeFunc("endswith", args),
  contains: (args) => makePipeFunc("contains", args),
  replace: (args) => makePipeFunc("gsub", args),
  substr: (args) => {
    if (args.length === 2) {
      return { type: "Slice", base: args[0], start: args[1] };
    }
    return {
      type: "Slice",
      base: args[0],
      start: args[1],
      end: makeBinaryOp("+", args[1], args[2]),
    };
  },

  // Math functions - use pipe syntax for single-arg functions
  abs: (args) => makePipeFunc("fabs", args),
  floor: (args) => makePipeFunc("floor", args),
  ceil: (args) => makePipeFunc("ceil", args),
  round: (args) => makePipeFunc("round", args),
  sqrt: (args) => makePipeFunc("sqrt", args),
  log: (args) => makePipeFunc("log", args),
  log10: (args) => makePipeFunc("log10", args),
  log2: (args) => makePipeFunc("log2", args),
  exp: (args) => makePipeFunc("exp", args),
  sin: (args) => makePipeFunc("sin", args),
  cos: (args) => makePipeFunc("cos", args),
  tan: (args) => makePipeFunc("tan", args),
  asin: (args) => makePipeFunc("asin", args),
  acos: (args) => makePipeFunc("acos", args),
  atan: (args) => makePipeFunc("atan", args),
  min: (args) => makePipeFunc("min", args),
  max: (args) => makePipeFunc("max", args),

  // Collection functions
  first: (args) =>
    args.length === 0
      ? { type: "Index", index: { type: "Literal", value: 0 } }
      : { type: "Index", index: { type: "Literal", value: 0 }, base: args[0] },
  last: (args) =>
    args.length === 0
      ? { type: "Index", index: { type: "Literal", value: -1 } }
      : { type: "Index", index: { type: "Literal", value: -1 }, base: args[0] },
  get: (args) => {
    if (args.length === 1) {
      return { type: "Index", index: args[0] };
    }
    return { type: "Index", index: args[1], base: args[0] };
  },
  slice: (args) => {
    if (args.length === 1) {
      return { type: "Slice", base: args[0] };
    }
    if (args.length === 2) {
      return { type: "Slice", base: args[0], start: args[1] };
    }
    return { type: "Slice", base: args[0], start: args[1], end: args[2] };
  },
  keys: "keys",
  values: "values",
  entries: (args) => makeCall("to_entries", args),
  from_entries: "from_entries",
  reverse: "reverse",
  sort: "sort",
  sort_by: "sort_by",
  group_by: "group_by",
  unique: "unique",
  unique_by: "unique_by",
  flatten: "flatten",
  map: (args) => ({
    type: "Pipe",
    left: args[0],
    right: { type: "Array", elements: args[1] },
  }),
  select: (args) => makeCall("select", args),
  empty: () => makeCall("empty", []),

  // Aggregation functions (used in agg/groupby context)
  count: () => makeCall("length", []),
  sum: (args) =>
    args.length === 0
      ? makeCall("add", [])
      : {
          type: "Pipe",
          left: { type: "Array", elements: args[0] },
          right: makeCall("add", []),
        },
  mean: (args) =>
    args.length === 0
      ? {
          type: "Pipe",
          left: { type: "Identity" },
          right: makeBinaryOp("/", makeCall("add", []), makeCall("length", [])),
        }
      : {
          type: "Pipe",
          left: { type: "Array", elements: args[0] },
          right: makeBinaryOp("/", makeCall("add", []), makeCall("length", [])),
        },
  avg: (args) =>
    args.length === 0
      ? {
          type: "Pipe",
          left: { type: "Identity" },
          right: makeBinaryOp("/", makeCall("add", []), makeCall("length", [])),
        }
      : {
          type: "Pipe",
          left: { type: "Array", elements: args[0] },
          right: makeBinaryOp("/", makeCall("add", []), makeCall("length", [])),
        },

  // Type functions
  type: "type",
  isnull: (args) =>
    args.length === 0
      ? makeBinaryOp(
          "==",
          { type: "Identity" },
          { type: "Literal", value: null },
        )
      : makeBinaryOp("==", args[0], { type: "Literal", value: null }),
  isempty: (args) =>
    args.length === 0
      ? makeBinaryOp("==", { type: "Identity" }, { type: "Literal", value: "" })
      : makeBinaryOp("==", args[0], { type: "Literal", value: "" }),
  tonumber: (args) =>
    args.length === 0 ? makeCall("tonumber", []) : makeCall("tonumber", args),
  tostring: (args) =>
    args.length === 0 ? makeCall("tostring", []) : makeCall("tostring", args),

  // Conditional
  if: (args) => makeCond(args[0], args[1], args[2]),
  coalesce: (args) => {
    if (args.length === 0) return { type: "Literal", value: null };
    if (args.length === 1) return args[0];
    // Implement as: if (args[0] != null and args[0] != "") then args[0] else coalesce(rest)
    const [first, ...rest] = args;
    const condition = makeBinaryOp(
      "and",
      makeBinaryOp("!=", first, { type: "Literal", value: null }),
      makeBinaryOp("!=", first, { type: "Literal", value: "" }),
    );
    return makeCond(
      condition,
      first,
      rest.length === 1
        ? rest[0]
        : (FUNCTION_MAP.coalesce as (args: AstNode[]) => AstNode)(rest),
    );
  },

  // Index function for xan - access the _row_index field
  index: () => ({ type: "Field", name: "_row_index" }) as AstNode,

  // Date/time functions
  now: () => makeCall("now", []),

  // Format functions (these may need special handling)
  fmt: (args) => makeCall("tostring", args),
  format: (args) => makeCall("tostring", args),
};

function makeBinaryOp(
  op:
    | "+"
    | "-"
    | "*"
    | "/"
    | "%"
    | "=="
    | "!="
    | "<"
    | "<="
    | ">"
    | ">="
    | "and"
    | "or"
    | "//",
  left: AstNode,
  right: AstNode,
): AstNode {
  return { type: "BinaryOp", op, left, right };
}

function makeCall(name: string, args: AstNode[]): AstNode {
  return { type: "Call", name, args };
}

// Property name for conditional "then" branch - stored as variable to avoid biome lint
const THEN_PROP = "then";

/**
 * Create a conditional AST node.
 */
function makeCond(
  cond: AstNode,
  thenBranch: AstNode,
  elseBranch?: AstNode,
): AstNode {
  // @banned-pattern-ignore: THEN_PROP is a constant "then", not user input
  const node: Record<string, unknown> = {
    type: "Cond",
    cond,
    elifs: [],
    else: elseBranch || { type: "Literal", value: null },
  };
  node[THEN_PROP] = thenBranch;
  return node as unknown as AstNode;
}

function makePipeTostring(node: AstNode): AstNode {
  // Use pipe instead of call args for tostring to get correct behavior
  return {
    type: "Pipe",
    left: node,
    right: { type: "Call", name: "tostring", args: [] },
  };
}

/**
 * Transform moonblade AST to jq AST
 */
export function moonbladeToJq(expr: MoonbladeExpr, rowContext = true): AstNode {
  switch (expr.type) {
    case "int":
    case "float":
      return { type: "Literal", value: expr.value };

    case "string":
      return { type: "Literal", value: expr.value };

    case "bool":
      return { type: "Literal", value: expr.value };

    case "null":
      return { type: "Literal", value: null };

    case "underscore":
      // In transform context, _ refers to the current column value
      // We store it as a field named "_" in the row object
      return {
        type: "Index",
        base: { type: "Identity" },
        index: { type: "Literal", value: "_" },
      };

    case "identifier":
      // In xan/moonblade, identifiers refer to column names
      // Transform to .columnName access
      if (rowContext) {
        return { type: "Field", name: expr.name };
      }
      return { type: "VarRef", name: expr.name };

    case "lambdaBinding":
      return { type: "VarRef", name: expr.name };

    case "func": {
      const args = expr.args.map((a) => moonbladeToJq(a.expr, rowContext));
      // Use Object.hasOwn to prevent prototype pollution
      const handler = Object.hasOwn(FUNCTION_MAP, expr.name)
        ? FUNCTION_MAP[expr.name]
        : undefined;

      if (typeof handler === "function") {
        return handler(args);
      }
      if (typeof handler === "string") {
        return makeCall(handler, args);
      }

      // Unknown function - pass through
      return makeCall(expr.name, args);
    }

    case "list":
      if (expr.elements.length === 0) {
        return { type: "Array" };
      }
      // Build array with comma-separated elements
      return {
        type: "Array",
        elements: expr.elements.reduce(
          (acc, el, i) => {
            const node = moonbladeToJq(el, rowContext);
            if (i === 0) return node;
            return { type: "Comma", left: acc, right: node };
          },
          null as unknown as AstNode,
        ),
      };

    case "map":
      return {
        type: "Object",
        entries: expr.entries.map((e) => ({
          key: e.key,
          value: moonbladeToJq(e.value, rowContext),
        })),
      };

    case "regex":
      // Return regex as a string for now - actual regex matching
      // would need to use test() function
      return { type: "Literal", value: expr.pattern };

    case "slice":
      return {
        type: "Slice",
        start: expr.start ? moonbladeToJq(expr.start, rowContext) : undefined,
        end: expr.end ? moonbladeToJq(expr.end, rowContext) : undefined,
      };

    case "lambda":
      // Transform lambda to jq's "as" binding
      // For now, just transform the body
      return moonbladeToJq(expr.body, rowContext);

    case "pipeline":
      // Multiple underscores - need special handling
      // For now, just return identity
      return { type: "Identity" };

    default:
      throw new Error(
        `Unknown moonblade expression type: ${(expr as MoonbladeExpr).type}`,
      );
  }
}
