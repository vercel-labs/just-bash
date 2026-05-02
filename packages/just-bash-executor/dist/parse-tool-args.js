/**
 * Parse JSON tool arguments. Empty/missing string yields undefined;
 * malformed JSON throws so callers get a clear error.
 */
export function parseToolArgs(argsJson) {
    if (!argsJson)
        return undefined;
    return JSON.parse(argsJson);
}
