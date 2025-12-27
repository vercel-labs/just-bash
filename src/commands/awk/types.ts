export interface AwkContext {
  FS: string;
  OFS: string;
  NR: number;
  NF: number;
  FNR: number; // Per-file record number
  FILENAME: string; // Current input filename
  RSTART: number; // Start of match() result (1-indexed, 0 if no match)
  RLENGTH: number; // Length of match() result (-1 if no match)
  fields: string[];
  line: string;
  vars: Record<string, string | number>;
  arrays: Record<string, Record<string, string | number>>;
  functions: Record<string, AwkFunction>; // User-defined functions
  random?: () => number; // Optional custom random for testing
  // For getline support
  lines?: string[];
  lineIndex?: number;
  fieldSep?: RegExp;
  // Execution limits
  maxIterations?: number; // Max loop iterations (default: 10000)
  // Control flow
  exitCode?: number; // Set by exit statement
  shouldExit?: boolean; // Flag to signal exit
  shouldNext?: boolean; // Flag to signal next (skip to next line)
  loopBreak?: boolean; // Flag for break statement
  loopContinue?: boolean; // Flag for continue statement
}

export interface AwkFunction {
  params: string[];
  body: string;
}

export interface PatternRange {
  start: string;
  end: string;
}

export interface AwkRule {
  pattern: string | null;
  range?: PatternRange; // For /start/,/end/ patterns
  action: string;
}

export interface ParsedProgram {
  begin: string | null;
  main: AwkRule[];
  end: string | null;
  functions: Record<string, AwkFunction>;
}
