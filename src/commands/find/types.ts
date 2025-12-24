// Types for find command implementation

// Expression types for find predicates
export type Expression =
  | { type: "name"; pattern: string; ignoreCase?: boolean }
  | { type: "path"; pattern: string; ignoreCase?: boolean }
  | { type: "type"; fileType: "f" | "d" }
  | { type: "empty" }
  | { type: "mtime"; days: number; comparison: "exact" | "more" | "less" }
  | { type: "newer"; refPath: string }
  | {
      type: "size";
      value: number;
      unit: SizeUnit;
      comparison: "exact" | "more" | "less";
    }
  | {
      type: "perm";
      mode: number;
      matchType: "exact" | "all" | "any"; // exact, -mode (all), /mode (any)
    }
  | { type: "not"; expr: Expression }
  | { type: "and"; left: Expression; right: Expression }
  | { type: "or"; left: Expression; right: Expression };

export type SizeUnit = "c" | "k" | "M" | "G" | "b";

// Action types for find
export type FindAction =
  | { type: "exec"; command: string[]; batchMode: boolean }
  | { type: "print" }
  | { type: "print0" }
  | { type: "delete" };

// Known predicates that take arguments
export const PREDICATES_WITH_ARGS: Set<string> = new Set([
  "-name",
  "-iname",
  "-path",
  "-ipath",
  "-type",
  "-maxdepth",
  "-mindepth",
  "-mtime",
  "-newer",
  "-size",
  "-perm",
]);

// Evaluation context for file matching
export interface EvalContext {
  name: string;
  relativePath: string;
  isFile: boolean;
  isDirectory: boolean;
  isEmpty: boolean;
  mtime: number; // modification time as timestamp
  size: number; // file size in bytes
  mode: number; // file permission mode
  newerRefTimes: Map<string, number>; // reference file mtimes for -newer
}

// Parse result from expression parser
export interface ParseResult {
  expr: Expression | null;
  pathIndex: number;
  error?: string;
  actions: FindAction[];
}
