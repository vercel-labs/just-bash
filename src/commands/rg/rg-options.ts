/**
 * RgOptions interface and default values
 */

export interface RgOptions {
  // Pattern matching
  ignoreCase: boolean;
  caseSensitive: boolean;
  smartCase: boolean;
  fixedStrings: boolean;
  wordRegexp: boolean;
  lineRegexp: boolean;
  invertMatch: boolean;
  multiline: boolean;
  patterns: string[];
  patternFiles: string[];

  // Output control
  count: boolean;
  countMatches: boolean;
  filesWithMatches: boolean;
  filesWithoutMatch: boolean;
  onlyMatching: boolean;
  maxCount: number;
  lineNumber: boolean;
  noFilename: boolean;
  nullSeparator: boolean;
  byteOffset: boolean;
  column: boolean;
  vimgrep: boolean;
  replace: string | null;
  afterContext: number;
  beforeContext: number;
  contextSeparator: string;
  quiet: boolean;
  heading: boolean;
  passthru: boolean;
  includeZero: boolean;
  sort: "path" | "none";
  json: boolean;

  // File selection
  globs: string[];
  types: string[];
  typesNot: string[];
  hidden: boolean;
  noIgnore: boolean;
  maxDepth: number;
  followSymlinks: boolean;
  searchZip: boolean;
  searchBinary: boolean;
}

export function createDefaultOptions(): RgOptions {
  return {
    ignoreCase: false,
    caseSensitive: false,
    smartCase: true,
    fixedStrings: false,
    wordRegexp: false,
    lineRegexp: false,
    invertMatch: false,
    multiline: false,
    patterns: [],
    patternFiles: [],
    count: false,
    countMatches: false,
    filesWithMatches: false,
    filesWithoutMatch: false,
    onlyMatching: false,
    maxCount: 0,
    lineNumber: true,
    noFilename: false,
    nullSeparator: false,
    byteOffset: false,
    column: false,
    vimgrep: false,
    replace: null,
    afterContext: 0,
    beforeContext: 0,
    contextSeparator: "--",
    quiet: false,
    heading: false,
    passthru: false,
    includeZero: false,
    sort: "path",
    json: false,
    globs: [],
    types: [],
    typesNot: [],
    hidden: false,
    noIgnore: false,
    maxDepth: Infinity,
    followSymlinks: false,
    searchZip: false,
    searchBinary: false,
  };
}
