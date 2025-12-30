/**
 * AWK Runtime Context
 *
 * Holds all state for AWK program execution.
 */

import type { AwkFunctionDef } from "../ast.js";
import type { AwkFileSystem, AwkValue } from "./types.js";

const DEFAULT_MAX_ITERATIONS = 10000;
const DEFAULT_MAX_RECURSION_DEPTH = 1000;

export interface AwkRuntimeContext {
  // Built-in variables
  FS: string;
  OFS: string;
  ORS: string;
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

  // ARGC/ARGV for command line arguments
  ARGC: number;
  ARGV: Record<string, string>;

  // User-defined functions (from AST)
  functions: Map<string, AwkFunctionDef>;

  // For getline support (current file)
  lines?: string[];
  lineIndex?: number;
  fieldSep: RegExp;

  // Execution limits
  maxIterations: number;
  maxRecursionDepth: number;
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

  // Output buffer (stdout)
  output: string;

  // Filesystem access for getline < file and print > file
  fs?: AwkFileSystem;
  cwd?: string;

  // Track which files have been opened with > (for overwrite-then-append behavior)
  openedFiles: Set<string>;

  // Random function override for testing
  random?: () => number;
}

export interface CreateContextOptions {
  fieldSep?: RegExp;
  maxIterations?: number;
  maxRecursionDepth?: number;
  fs?: AwkFileSystem;
  cwd?: string;
}

export function createRuntimeContext(
  options: CreateContextOptions = {},
): AwkRuntimeContext {
  const {
    fieldSep = /\s+/,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    maxRecursionDepth = DEFAULT_MAX_RECURSION_DEPTH,
    fs,
    cwd,
  } = options;

  return {
    FS: " ",
    OFS: " ",
    ORS: "\n",
    NR: 0,
    NF: 0,
    FNR: 0,
    FILENAME: "",
    RSTART: 0,
    RLENGTH: -1,
    SUBSEP: "\x1c",

    fields: [],
    line: "",

    vars: {},
    arrays: {},

    ARGC: 0,
    ARGV: {},

    functions: new Map(),

    fieldSep,
    maxIterations,
    maxRecursionDepth,
    currentRecursionDepth: 0,

    exitCode: 0,
    shouldExit: false,
    shouldNext: false,
    shouldNextFile: false,
    loopBreak: false,
    loopContinue: false,
    hasReturn: false,

    output: "",
    openedFiles: new Set(),

    fs,
    cwd,
  };
}
