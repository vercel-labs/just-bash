/**
 * Parse JSON tool arguments. Empty/missing string yields undefined;
 * malformed JSON throws so callers get a clear error.
 */
export declare function parseToolArgs(argsJson: string): unknown;
