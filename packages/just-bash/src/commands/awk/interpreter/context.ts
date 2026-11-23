/**
 * AWK Runtime Context
 *
 * Holds all state for AWK program execution.
 */

import type { CommandExecutionBudget } from "../../../execution-scope.js";
import { ConstantRegex, type RegexLike } from "../../../regex/index.js";
import type { FeatureCoverageWriter } from "../../../types.js";
import type { AwkFunctionDef } from "../ast.js";
import type { AwkFileSystem, AwkValue } from "./types.js";

const DEFAULT_MAX_ITERATIONS = 10000;
// Keep low to prevent JS stack overflow (each AWK call uses ~10-20 JS stack frames)
const DEFAULT_MAX_RECURSION_DEPTH = 100;
// Default field separator for AWK (whitespace)
const DEFAULT_FIELD_SEP = new ConstantRegex(/\s+/);

export interface AwkRuntimeContext {
  // Built-in variables
  FS: string;
  OFS: string;
  ORS: string;
  OFMT: string;
  CONVFMT: string;
  NR: number;
  NF: number;
  FNR: number;
  FILENAME: string;
  RSTART: number;
  RLENGTH: number;
  SUBSEP: string;

  // Current line data
  fields: string[];
  line: string;

  // User variables and arrays
  vars: Record<string, AwkValue>;
  arrays: Record<string, Record<string, AwkValue>>;
  // Per-call-frame array bindings (parameter name → resolved store
  // name), one frame per user-function call. A frame's bindings are
  // installed after the caller's frame has resolved the arguments,
  // so a binding always names the final store (or a synthetic
  // per-frame local store), never another parameter: two parameters
  // can never alias each other through a cycle, and array names
  // resolve in the innermost frame only, so a callee never sees a
  // caller's parameter bindings.
  arrayAliasFrames: Array<Map<string, string>>;
  /** Monotonic sequence for synthetic per-frame local store names. */
  nextLocalArrayId: number;

  // ARGC/ARGV for command line arguments
  ARGC: number;
  ARGV: Record<string, string>;

  // ENVIRON for environment variables
  ENVIRON: Record<string, string>;

  // User-defined functions (from AST)
  functions: Map<string, AwkFunctionDef>;

  // For getline support (current file)
  lines?: string[];
  lineIndex?: number;
  /** Internal getline streams, isolated from the AWK variable namespace. */
  getlineCommandStreams: Map<string, { lines: string[]; index: number }>;
  getlineFileStreams: Map<string, { lines: string[]; index: number }>;
  fieldSep: RegexLike;

  // Execution limits
  maxIterations: number;
  maxRecursionDepth: number;
  maxOutputSize: number;
  maxArrayElements: number;
  /**
   * Elements the program holds beyond the prepopulated ARGV/ENVIRON
   * contents; this is what maxArrayElements limits. The accounting is
   * free-slot based, not per-entry: each of ARGV/ENVIRON may hold up
   * to its initial size (see arrayElementBaselines) without charge,
   * and the charge is max(0, current size - initial size). Deleting a
   * prepopulated entry therefore frees no extra room beyond that
   * count — the baseline does not identify which entries were
   * prepopulated, only how many free slots the store has.
   */
  arrayElementCount: number;
  /**
   * Initial element counts of the prepopulated arrays, by resolved name
   * ("ARGV"/"ENVIRON"). They are free-slot allowances, not a record of
   * the original entries: the setters charge only the part of a store
   * beyond its baseline count (see arrayElementCount).
   */
  arrayElementBaselines: Map<string, number>;
  /**
   * Live element counts of the prepopulated ARGV/ENVIRON stores, by
   * resolved name. Updated incrementally on every insert/delete/
   * replacement so growing either array stays constant-time per
   * element instead of rescanning its keys.
   */
  specialStoreSizes: Map<string, number>;
  /**
   * Mutation counter for ARGV (and ARGC, which bounds it): bumped on
   * every insert/delete/replacement of an ARGV element and on every
   * ARGC assignment. It records that ARGV changed, but the input
   * loop does NOT key off it: the loop caches the sorted list of
   * present ARGV indices and refreshes it only when argvIndexVersion
   * changes, so reading N files costs one key scan instead of N —
   * while a program that adds or drops entries mid-file still has its
   * changes picked up. A hand-built context starts at 0, like a fresh
   * runtime context.
   */
  argvVersion: number;
  /**
   * Key-set version of ARGV: bumped only when the SET of present
   * indices changes (insert, delete, whole-store replace, ARGC
   * assignment) — never when an existing entry's value is replaced.
   * The input loop's cached index list keys off this, not
   * argvVersion, so replacing a value does not force a full key
   * scan and sort after every file (review 6010326757): a
   * replacement cannot change which files are read, and the loop
   * reads each entry fresh when its turn comes.
   */
  argvIndexVersion: number;
  /**
   * Resolved array names ever used as an array: subscript access,
   * asort, split, delete, `in`, or a for-in loop. A name keeps its
   * array type even when its store is currently empty or was deleted
   * — a later scalar assignment is the fatal type error gawk
   * reports — so `a[1]=1; delete a; a=5` and an omitted parameter
   * after `asort(a)` both reject (review 6010326757), instead of
   * silently untyping when the store disappears. A name never used
   * as an array (an uninitialized variable, a fresh omitted
   * parameter) stays convertible to a scalar by a first assignment.
   */
  arrayTypedNames: Set<string>;
  /**
   * Scalar variable names whose current value is an AWK numeric
   * string (strnum): a numeric-looking string that came from input
   * fields or split(), as opposed to a string literal. Only the
   * assignment paths that can see the value's origin maintain this;
   * any other scalar write clears the entry.
   */
  strnumVars: Set<string>;
  /**
   * Array element keys holding numeric strings (strnums), by resolved
   * array name. Like strnumVars, maintained only by the paths that
   * know a value's origin (field/variable assignment, split, asort).
   */
  strnumArrayKeys: Map<string, Set<string>>;
  /**
   * Field indices (1-based; 0 is $0) whose current value is an AWK
   * numeric string (strnum). Fields are stored as plain strings, so
   * this set is the only record of whether a numeric-looking field
   * came from input (a strnum) or from a plain-string assignment.
   * Rebuilt by splitFields whenever $0 is re-split; a field
   * assignment re-marks its own index. A field assigned a number is
   * NOT in this set — it is a number, recorded in numberFields below
   * (review 6011335623). $0's own flag lives in
   * lineIsStrnum below, because $0 is a single value, not an element.
   */
  strnumFields: Set<number>;
  /**
   * Field indices (1-based) whose current value is a JS number, from
   * a numeric assignment (`$1 = 1.234`), a compound assignment, or an
   * increment. Fields store strings, so without this record the
   * number-ness would be lost: a numeric field must sort by its
   * CONVFMT form in string mode and as a number (including +inf)
   * elsewhere, as in gawk — a strnum flag alone cannot express that,
   * because it keys off the string spelling. Cleared wholesale
   * whenever the fields are re-split, and per index whenever the
   * field is assigned a string or rewritten by sub/gsub.
   */
  numberFields: Map<number, number>;
  /**
   * Whether $0 itself is currently a numeric string: true for a record
   * read from input whose line looks numeric, and for a $0 assigned a
   * number or a strnum; false once $0 is rebuilt from fields or
   * rewritten by sub/gsub (a computed string, never a strnum).
   */
  lineIsStrnum: boolean;
  /**
   * Provenance of the value most recently read from a field, an array
   * element, or a user-function return: whether it is a numeric string
   * (strnum). Recorded by the read itself and consumed immediately
   * after evaluating a right-hand side (assignment) or return
   * expression, so each flag always describes that value.
   */
  lastFieldIsStrnum: boolean;
  lastArrayAccessIsStrnum: boolean;
  lastCallReturnIsStrnum: boolean;
  /**
   * Provenance of the value most recently produced by a ternary
   * (conditional) expression, and by an assignment expression used
   * as a value: whether it is a numeric string (strnum). Recorded
   * by the expression itself, right after it evaluates its selected
   * branch / right-hand side — gawk preserves a strnum through both
   * shapes (review 6010326757), while every other unlisted shape
   * (literal, arithmetic, concatenation, ...) is a plain string.
   */
  lastTernaryIsStrnum: boolean;
  lastAssignmentIsStrnum: boolean;
  recordsProcessed: number;
  currentRecursionDepth: number;

  // Control flow
  exitCode: number;
  shouldExit: boolean;
  shouldNext: boolean;
  shouldNextFile: boolean;
  loopBreak: boolean;
  loopContinue: boolean;
  returnValue?: AwkValue;
  hasReturn: boolean;
  inEndBlock: boolean; // Track if we're executing END blocks (for exit behavior)

  // Output buffer (stdout)
  output: string;

  // Filesystem access for getline < file and print > file
  fs?: AwkFileSystem;
  cwd?: string;

  // Track which files have been opened with > (for overwrite-then-append behavior)
  openedFiles: Set<string>;

  // Random function override for testing
  random?: () => number;

  // Exec function for command pipe getline ("cmd" | getline)
  exec?: (
    cmd: string,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

  // Feature coverage writer for fuzzing instrumentation
  coverage?: FeatureCoverageWriter;

  // Defense context invariant flag propagated from RuntimeCommandContext
  requireDefenseContext?: boolean;

  /**
   * Shared execution budget (work units + abort signal) from the enclosing
   * shell, when the AWK program runs as a command. Built-ins that do
   * unbounded synchronous work (e.g. asort) charge against it and poll it
   * so a large sort can be interrupted. Absent when the interpreter is
   * used directly, in which case those built-ins only apply their local
   * element limits.
   */
  executionScope?: CommandExecutionBudget;
}

export interface CreateContextOptions {
  fieldSep?: RegexLike;
  maxIterations?: number;
  maxRecursionDepth?: number;
  maxOutputSize?: number;
  maxArrayElements?: number;
  fs?: AwkFileSystem;
  cwd?: string;
  exec?: (
    cmd: string,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  coverage?: FeatureCoverageWriter;
  requireDefenseContext?: boolean;
  executionScope?: CommandExecutionBudget;
}

export function createRuntimeContext(
  options: CreateContextOptions = {},
): AwkRuntimeContext {
  const {
    fieldSep = DEFAULT_FIELD_SEP,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    maxRecursionDepth = DEFAULT_MAX_RECURSION_DEPTH,
    maxOutputSize = 0,
    maxArrayElements = 100_000,
    fs,
    cwd,
    exec,
    coverage,
    requireDefenseContext,
    executionScope,
  } = options;

  return {
    FS: " ",
    OFS: " ",
    ORS: "\n",
    OFMT: "%.6g",
    CONVFMT: "%.6g",
    NR: 0,
    NF: 0,
    FNR: 0,
    FILENAME: "",
    RSTART: 0,
    RLENGTH: -1,
    SUBSEP: "\x1c",

    fields: [],
    line: "",

    // Use null-prototype objects to prevent prototype pollution
    // when user-controlled keys like "__proto__" or "constructor" are used
    vars: Object.create(null) as Record<string, AwkValue>,
    arrays: Object.create(null) as Record<string, Record<string, AwkValue>>,
    arrayAliasFrames: [],
    nextLocalArrayId: 0,

    ARGC: 0,
    ARGV: Object.create(null) as Record<string, string>,
    ENVIRON: Object.create(null) as Record<string, string>,

    functions: new Map(),
    getlineCommandStreams: new Map(),
    getlineFileStreams: new Map(),

    fieldSep,
    maxIterations,
    maxRecursionDepth,
    maxOutputSize,
    maxArrayElements,
    arrayElementCount: 0,
    arrayElementBaselines: new Map(),
    specialStoreSizes: new Map(),
    argvVersion: 0,
    argvIndexVersion: 0,
    arrayTypedNames: new Set(),
    strnumVars: new Set(),
    strnumArrayKeys: new Map(),
    strnumFields: new Set(),
    numberFields: new Map(),
    lineIsStrnum: false,
    lastFieldIsStrnum: false,
    lastArrayAccessIsStrnum: false,
    lastCallReturnIsStrnum: false,
    lastTernaryIsStrnum: false,
    lastAssignmentIsStrnum: false,
    recordsProcessed: 0,
    currentRecursionDepth: 0,

    exitCode: 0,
    shouldExit: false,
    shouldNext: false,
    shouldNextFile: false,
    loopBreak: false,
    loopContinue: false,
    hasReturn: false,
    inEndBlock: false,

    output: "",
    openedFiles: new Set(),

    fs,
    cwd,
    exec,
    coverage,
    requireDefenseContext,
    executionScope,
  };
}
