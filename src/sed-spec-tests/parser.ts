/**
 * Parser for sed test formats
 *
 * Supports two formats:
 * 1. BusyBox format: testing "description" "commands" "result" "infile" "stdin"
 * 2. PythonSed .suite format:
 *    ---
 *    description
 *    ---
 *    sed script
 *    ---
 *    input
 *    ---
 *    expected output
 *    ---
 */

export interface SedTestCase {
  name: string;
  /** The shell command to run */
  command: string;
  /** Expected stdout */
  expectedOutput: string;
  /** Content for input file (if any) */
  infile: string;
  /** Content for stdin (if any) */
  stdin: string;
  /** Line number in source file */
  lineNumber: number;
  /** If set, test is expected to fail (value is reason) */
  skip?: string;
}

export interface ParsedSedTestFile {
  fileName: string;
  filePath: string;
  testCases: SedTestCase[];
}

/**
 * Parse a sed test file (auto-detects format)
 */
export function parseSedTestFile(
  content: string,
  filePath: string,
): ParsedSedTestFile {
  const fileName = filePath.split("/").pop() || filePath;

  // Detect format based on file extension or content
  if (fileName.endsWith(".suite")) {
    return parsePythonSedSuite(content, filePath);
  }

  return parseBusyBoxTests(content, filePath);
}

/**
 * Parse BusyBox sed test format
 */
function parseBusyBoxTests(
  content: string,
  filePath: string,
): ParsedSedTestFile {
  const fileName = filePath.split("/").pop() || filePath;
  const lines = content.split("\n");
  const testCases: SedTestCase[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments and empty lines
    if (line.trim().startsWith("#") || line.trim() === "") {
      continue;
    }

    // Look for testing "..." "..." "..." "..." "..."
    // Handle multi-line tests by joining continuation lines
    let fullLine = line;
    while (fullLine.endsWith("\\") && i + 1 < lines.length) {
      i++;
      fullLine = fullLine.slice(0, -1) + lines[i];
    }

    const testMatch = fullLine.match(/^testing\s+"([^"]*)"\s+(.+)$/);

    if (!testMatch) {
      continue;
    }

    const description = testMatch[1];
    const rest = testMatch[2];

    // Parse the remaining arguments - they're quoted strings
    const args = parseQuotedArgs(rest);

    if (args.length < 4) {
      continue;
    }

    const [command, result, infile, stdin] = args;

    testCases.push({
      name: description,
      command: unescapeString(command),
      expectedOutput: unescapeString(result),
      infile: unescapeString(infile),
      stdin: unescapeString(stdin),
      lineNumber: i + 1,
    });
  }

  return { fileName, filePath, testCases };
}

/**
 * Parse PythonSed .suite format
 *
 * Format:
 * ---
 * description
 * ---
 * sed script
 * ---
 * input
 * ---
 * expected output
 * ---
 */
function parsePythonSedSuite(
  content: string,
  filePath: string,
): ParsedSedTestFile {
  const fileName = filePath.split("/").pop() || filePath;
  const lines = content.split("\n");
  const testCases: SedTestCase[] = [];

  let i = 0;

  while (i < lines.length) {
    // Skip lines until we find a --- delimiter
    while (i < lines.length && lines[i].trim() !== "---") {
      i++;
    }

    if (i >= lines.length) break;

    // Found ---
    const startLine = i;
    i++;

    // Read description (may be multi-line)
    const descriptionLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "---") {
      descriptionLines.push(lines[i]);
      i++;
    }

    if (i >= lines.length) break;

    // Skip ---
    i++;

    // Read sed script (may be multi-line)
    const scriptLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "---") {
      scriptLines.push(lines[i]);
      i++;
    }

    if (i >= lines.length) break;

    // Skip ---
    i++;

    // Read input (may be multi-line)
    const inputLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "---") {
      inputLines.push(lines[i]);
      i++;
    }

    if (i >= lines.length) break;

    // Skip ---
    i++;

    // Read expected output (may be multi-line)
    const outputLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "---") {
      outputLines.push(lines[i]);
      i++;
    }

    // Skip final ---
    if (i < lines.length && lines[i].trim() === "---") {
      i++;
    }

    // Build the test case
    const description = descriptionLines.join("\n").trim();
    const script = scriptLines.join("\n").trim();
    const input = inputLines.join("\n");
    const expectedOutput = outputLines.join("\n");

    // Skip empty tests or comments (lines starting with **)
    if (!script || description.startsWith("**")) {
      continue;
    }

    // Build sed command from script
    // The script may be multi-line, so we need to use -e for each line or escape newlines
    const command = buildSedCommand(script);

    testCases.push({
      name: description || `test at line ${startLine + 1}`,
      command,
      expectedOutput,
      infile: "",
      stdin: input,
      lineNumber: startLine + 1,
    });
  }

  return { fileName, filePath, testCases };
}

/**
 * Build a sed command from a script
 */
function buildSedCommand(script: string): string {
  // If script has multiple lines, use multiple -e arguments
  const lines = script.split("\n").filter((l) => l.trim() !== "");

  if (lines.length === 0) {
    return "sed ''";
  }

  if (lines.length === 1) {
    const escapedScript = lines[0].replace(/'/g, "'\\''");
    return `sed '${escapedScript}'`;
  }

  // Multiple lines - use multiple -e arguments
  const args = lines.map((l) => `-e '${l.replace(/'/g, "'\\''")}'`).join(" ");
  return `sed ${args}`;
}

/**
 * Parse quoted arguments from a string
 * Handles both single and double quoted strings
 */
function parseQuotedArgs(str: string): string[] {
  const args: string[] = [];
  let i = 0;

  while (i < str.length) {
    // Skip whitespace
    while (i < str.length && /\s/.test(str[i])) {
      i++;
    }

    if (i >= str.length) break;

    const quote = str[i];
    if (quote !== '"' && quote !== "'") {
      // Unquoted argument - read until whitespace
      let arg = "";
      while (i < str.length && !/\s/.test(str[i])) {
        arg += str[i];
        i++;
      }
      args.push(arg);
      continue;
    }

    // Quoted argument
    i++; // skip opening quote
    let arg = "";
    while (i < str.length && str[i] !== quote) {
      if (str[i] === "\\" && i + 1 < str.length) {
        // Handle escape sequences
        arg += str[i] + str[i + 1];
        i += 2;
      } else {
        arg += str[i];
        i++;
      }
    }
    i++; // skip closing quote
    args.push(arg);
  }

  return args;
}

/**
 * Unescape shell string escapes
 */
function unescapeString(str: string): string {
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
}
