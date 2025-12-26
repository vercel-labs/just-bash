// Types for sort command implementation

export interface KeySpec {
  // Start position
  startField: number; // 1-indexed field number
  startChar?: number; // 1-indexed character position within field

  // End position (optional)
  endField?: number; // 1-indexed field number
  endChar?: number; // 1-indexed character position within field

  // Per-key modifiers
  numeric?: boolean; // n - numeric sort
  reverse?: boolean; // r - reverse sort
  ignoreCase?: boolean; // f - fold case
  ignoreLeading?: boolean; // b - ignore leading blanks
}

export interface SortOptions {
  reverse: boolean;
  numeric: boolean;
  unique: boolean;
  ignoreCase: boolean;
  keys: KeySpec[];
  fieldDelimiter: string | null;
}
