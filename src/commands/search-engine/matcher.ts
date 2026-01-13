/**
 * Core content matching logic for search commands
 */

export interface SearchOptions {
  /** Select non-matching lines */
  invertMatch?: boolean;
  /** Print line number with output lines */
  showLineNumbers?: boolean;
  /** Print only a count of matching lines */
  countOnly?: boolean;
  /** Filename prefix for output (empty string for no prefix) */
  filename?: string;
  /** Show only the matching parts of lines */
  onlyMatching?: boolean;
  /** Print NUM lines of leading context */
  beforeContext?: number;
  /** Print NUM lines of trailing context */
  afterContext?: number;
  /** Stop after NUM matches (0 = unlimited) */
  maxCount?: number;
}

export interface SearchResult {
  /** The formatted output string */
  output: string;
  /** Whether any matches were found */
  matched: boolean;
  /** Number of matches found */
  matchCount: number;
}

/**
 * Search content for regex matches and format output
 *
 * Handles:
 * - Count only mode (-c)
 * - Line numbers (-n)
 * - Invert match (-v)
 * - Only matching (-o)
 * - Context lines (-A, -B, -C)
 * - Max count (-m)
 */
export function searchContent(
  content: string,
  regex: RegExp,
  options: SearchOptions = {},
): SearchResult {
  const {
    invertMatch = false,
    showLineNumbers = false,
    countOnly = false,
    filename = "",
    onlyMatching = false,
    beforeContext = 0,
    afterContext = 0,
    maxCount = 0,
  } = options;

  const lines = content.split("\n");
  const lineCount = lines.length;
  // Handle trailing empty line from split if content ended with newline
  const lastIdx =
    lineCount > 0 && lines[lineCount - 1] === "" ? lineCount - 1 : lineCount;

  // Fast path: count only mode
  if (countOnly) {
    let matchCount = 0;
    for (let i = 0; i < lastIdx; i++) {
      regex.lastIndex = 0;
      if (regex.test(lines[i]) !== invertMatch) {
        matchCount++;
      }
    }
    const countStr = filename
      ? `${filename}:${matchCount}`
      : String(matchCount);
    return { output: `${countStr}\n`, matched: matchCount > 0, matchCount };
  }

  // Fast path: no context needed (most common case)
  if (beforeContext === 0 && afterContext === 0) {
    const outputLines: string[] = [];
    let hasMatch = false;
    let matchCount = 0;

    for (let i = 0; i < lastIdx; i++) {
      // Check if we've reached maxCount
      if (maxCount > 0 && matchCount >= maxCount) break;

      const line = lines[i];
      regex.lastIndex = 0;
      const matches = regex.test(line);

      if (matches !== invertMatch) {
        hasMatch = true;
        matchCount++;
        if (onlyMatching) {
          regex.lastIndex = 0;
          for (
            let match = regex.exec(line);
            match !== null;
            match = regex.exec(line)
          ) {
            outputLines.push(filename ? `${filename}:${match[0]}` : match[0]);
            if (match[0].length === 0) regex.lastIndex++;
          }
        } else if (showLineNumbers) {
          outputLines.push(
            filename ? `${filename}:${i + 1}:${line}` : `${i + 1}:${line}`,
          );
        } else {
          outputLines.push(filename ? `${filename}:${line}` : line);
        }
      }
    }

    return {
      output: outputLines.length > 0 ? `${outputLines.join("\n")}\n` : "",
      matched: hasMatch,
      matchCount,
    };
  }

  // Slow path: context lines needed
  const outputLines: string[] = [];
  let matchCount = 0;
  const printedLines = new Set<number>();

  // First pass: find all matching lines (respecting maxCount)
  const matchingLineNumbers: number[] = [];
  for (let i = 0; i < lastIdx; i++) {
    // Check if we've reached maxCount
    if (maxCount > 0 && matchCount >= maxCount) break;
    regex.lastIndex = 0;
    if (regex.test(lines[i]) !== invertMatch) {
      matchingLineNumbers.push(i);
      matchCount++;
    }
  }

  // Second pass: output with context
  for (const lineNum of matchingLineNumbers) {
    // Before context
    for (let i = Math.max(0, lineNum - beforeContext); i < lineNum; i++) {
      if (!printedLines.has(i)) {
        printedLines.add(i);
        let outputLine = lines[i];
        if (showLineNumbers) outputLine = `${i + 1}-${outputLine}`;
        if (filename) outputLine = `${filename}-${outputLine}`;
        outputLines.push(outputLine);
      }
    }

    // The matching line
    if (!printedLines.has(lineNum)) {
      printedLines.add(lineNum);
      const line = lines[lineNum];

      if (onlyMatching) {
        regex.lastIndex = 0;
        for (
          let match = regex.exec(line);
          match !== null;
          match = regex.exec(line)
        ) {
          outputLines.push(filename ? `${filename}:${match[0]}` : match[0]);
          if (match[0].length === 0) regex.lastIndex++;
        }
      } else {
        let outputLine = line;
        if (showLineNumbers) outputLine = `${lineNum + 1}:${outputLine}`;
        if (filename) outputLine = `${filename}:${outputLine}`;
        outputLines.push(outputLine);
      }
    }

    // After context
    const maxAfter = Math.min(lastIdx - 1, lineNum + afterContext);
    for (let i = lineNum + 1; i <= maxAfter; i++) {
      if (!printedLines.has(i)) {
        printedLines.add(i);
        let outputLine = lines[i];
        if (showLineNumbers) outputLine = `${i + 1}-${outputLine}`;
        if (filename) outputLine = `${filename}-${outputLine}`;
        outputLines.push(outputLine);
      }
    }
  }

  return {
    output: outputLines.length > 0 ? `${outputLines.join("\n")}\n` : "",
    matched: matchCount > 0,
    matchCount,
  };
}
