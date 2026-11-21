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
  // Array aliases for function parameter passing (parameter name → original name)
  arrayAliases: Map<string, string>;

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
   * ARGC assignment. The input loop caches the sorted list of present
   * ARGV indices and refreshes it only when this changes, so reading
   * N files costs one key scan instead of N — while a program that
   * adds or drops entries mid-file still has its changes picked up.
   * A hand-built context starts at 0, like a fresh runtime context.
   */
  argvVersion: number;
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
    arrayAliases: new Map(),

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
    strnumVars: new Set(),
    strnumArrayKeys: new Map(),
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
