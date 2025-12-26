// Comparator functions for sort command

import type { KeySpec, SortOptions } from "./types.js";

/**
 * Extract key value from a line based on key specification
 */
function extractKeyValue(
  line: string,
  key: KeySpec,
  delimiter: string | null,
): string {
  // Split line into fields
  const splitPattern = delimiter !== null ? delimiter : /\s+/;
  const fields = line.split(splitPattern);

  // Get start field (0-indexed internally)
  const startFieldIdx = key.startField - 1;
  if (startFieldIdx >= fields.length) {
    return "";
  }

  // If no end field specified, use just the start field
  if (key.endField === undefined) {
    let field = fields[startFieldIdx] || "";

    // Handle character position within field
    if (key.startChar !== undefined) {
      field = field.slice(key.startChar - 1);
    }

    // Handle ignore leading blanks
    if (key.ignoreLeading) {
      field = field.trimStart();
    }

    return field;
  }

  // Range of fields
  const endFieldIdx = Math.min(key.endField - 1, fields.length - 1);

  // Build the key value from multiple fields
  let result = "";

  for (let i = startFieldIdx; i <= endFieldIdx && i < fields.length; i++) {
    let field = fields[i] || "";

    if (i === startFieldIdx && key.startChar !== undefined) {
      // Start character position in first field
      field = field.slice(key.startChar - 1);
    }

    if (i === endFieldIdx && key.endChar !== undefined) {
      // End character position in last field
      const endIdx =
        i === startFieldIdx && key.startChar !== undefined
          ? key.endChar - key.startChar + 1
          : key.endChar;
      field = field.slice(0, endIdx);
    }

    if (i > startFieldIdx) {
      // Add delimiter between fields
      result += delimiter || " ";
    }
    result += field;
  }

  // Handle ignore leading blanks
  if (key.ignoreLeading) {
    result = result.trimStart();
  }

  return result;
}

/**
 * Compare two values, handling numeric and string comparison
 */
function compareValues(
  a: string,
  b: string,
  numeric: boolean,
  ignoreCase: boolean,
): number {
  if (numeric) {
    const numA = parseFloat(a) || 0;
    const numB = parseFloat(b) || 0;
    return numA - numB;
  }

  let valA = a;
  let valB = b;

  if (ignoreCase) {
    valA = valA.toLowerCase();
    valB = valB.toLowerCase();
  }

  return valA.localeCompare(valB);
}

/**
 * Create a comparison function for sorting
 */
export function createComparator(
  options: SortOptions,
): (a: string, b: string) => number {
  const {
    keys,
    fieldDelimiter,
    numeric: globalNumeric,
    ignoreCase: globalIgnoreCase,
    reverse: globalReverse,
  } = options;

  return (a: string, b: string): number => {
    // If no keys specified, compare whole lines
    if (keys.length === 0) {
      let valA = a;
      let valB = b;

      if (globalIgnoreCase) {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      }

      let result: number;
      if (globalNumeric) {
        const numA = parseFloat(valA) || 0;
        const numB = parseFloat(valB) || 0;
        result = numA - numB;
        // Add string tiebreaker when numeric values are equal
        if (result === 0) {
          const tiebreaker = valA.localeCompare(valB);
          return globalReverse ? -tiebreaker : tiebreaker;
        }
      } else {
        result = valA.localeCompare(valB);
      }

      return globalReverse ? -result : result;
    }

    // Compare by each key in order
    for (const key of keys) {
      const valA = extractKeyValue(a, key, fieldDelimiter);
      const valB = extractKeyValue(b, key, fieldDelimiter);

      // Use per-key modifiers or fall back to global options
      const useNumeric = key.numeric ?? globalNumeric;
      const useIgnoreCase = key.ignoreCase ?? globalIgnoreCase;
      const useReverse = key.reverse ?? globalReverse;

      const result = compareValues(valA, valB, useNumeric, useIgnoreCase);

      if (result !== 0) {
        return useReverse ? -result : result;
      }
    }

    // All keys equal, compare whole lines as tiebreaker
    // Apply global reverse to tiebreaker as well
    const tiebreaker = a.localeCompare(b);
    return globalReverse ? -tiebreaker : tiebreaker;
  };
}

/**
 * Filter unique lines based on key values or whole line
 */
export function filterUnique(lines: string[], options: SortOptions): string[] {
  if (options.keys.length === 0) {
    // No keys - use whole line for uniqueness
    if (options.ignoreCase) {
      const seen = new Set<string>();
      return lines.filter((line) => {
        const key = line.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    return [...new Set(lines)];
  }

  // Use first key for uniqueness comparison
  const key = options.keys[0];
  const seen = new Set<string>();

  return lines.filter((line) => {
    let keyVal = extractKeyValue(line, key, options.fieldDelimiter);
    if (key.ignoreCase ?? options.ignoreCase) {
      keyVal = keyVal.toLowerCase();
    }
    if (seen.has(keyVal)) return false;
    seen.add(keyVal);
    return true;
  });
}
