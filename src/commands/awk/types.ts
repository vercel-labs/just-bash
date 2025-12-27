export interface AwkContext {
  FS: string;
  OFS: string;
  NR: number;
  NF: number;
  fields: string[];
  line: string;
  vars: Record<string, string | number>;
  arrays: Record<string, Record<string, string | number>>;
  random?: () => number; // Optional custom random for testing
  // For getline support
  lines?: string[];
  lineIndex?: number;
  fieldSep?: RegExp;
  // Execution limits
  maxIterations?: number; // Max loop iterations (default: 10000)
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
}
