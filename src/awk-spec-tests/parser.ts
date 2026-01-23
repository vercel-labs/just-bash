/**
 * Parser for onetrueawk test format (T.* shell scripts)
 *
 * The onetrueawk test suite uses shell scripts with patterns like:
 * - $awk 'program' [input] >foo1
 * - echo 'expected' >foo2
 * - diff foo1 foo2 || echo 'BAD: testname'
 *
 * This parser extracts individual test cases from these scripts.
 */

export interface AwkTestCase {
  name: string;
  /** The awk program to run */
  program: string;
  /** Input data (stdin or file content) */
  input: string;
  /** Expected stdout */
  expectedOutput: string;
  /** Expected exit status (default 0) */
  expectedStatus?: number;
  /** Line number in source file */
  lineNumber: number;
  /** If set, test is expected to fail (value is reason) */
  skip?: string;
  /** Original shell command for reference */
  originalCommand?: string;
}

/**
 * Strip control characters from test names (except common whitespace)
 */
function cleanTestName(name: string): string {
  // Remove control characters (0x00-0x1F except tab, newline, carriage return)
  // Also remove 0x7F (DEL)
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
}

export interface ParsedAwkTestFile {
  fileName: string;
  filePath: string;
  testCases: AwkTestCase[];
  /** Tests that couldn't be parsed */
  unparsedTests: string[];
}

/**
 * Parse a T.* shell test file
 */
export function parseAwkTestFile(
  content: string,
  filePath: string,
): ParsedAwkTestFile {
  const fileName = filePath.split("/").pop() || filePath;
  const lines = content.split("\n");
  const testCases: AwkTestCase[] = [];
  const unparsedTests: string[] = [];

  // Track state for multi-line parsing
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Look for $awk commands that write to foo1 or foo2
    if (line.includes("$awk") && line.includes(">foo")) {
      const result = tryParseBuiltinStyleTest(lines, i);
      if (result) {
        testCases.push(result.testCase);
        i = result.nextLine;
        continue;
      }
    }

    // Look for heredoc-style tests (T.expr format)
    if (line.includes("<<") && line.includes("!!!!")) {
      const result = tryParseHeredocTests(lines, i);
      if (result) {
        testCases.push(...result.testCases);
        i = result.nextLine;
        continue;
      }
    }

    i++;
  }

  return { fileName, filePath, testCases, unparsedTests };
}

interface ParseResult {
  testCase: AwkTestCase;
  nextLine: number;
}

interface HeredocParseResult {
  testCases: AwkTestCase[];
  nextLine: number;
}

/**
 * Try to parse a T.builtin style test:
 * $awk 'program' [input] >foo1
 * echo 'expected' >foo2
 * diff foo1 foo2 || echo 'BAD: testname'
 */
function tryParseBuiltinStyleTest(
  lines: string[],
  startLine: number,
): ParseResult | null {
  const awkLine = lines[startLine];

  // Extract the awk program from $awk '...' or $awk "..."
  const awkMatch = awkLine.match(
    /\$awk\s+(?:-[^\s]+\s+)?(['"])([\s\S]*?)\1(?:\s+([^\s>]+))?\s*>\s*foo([12])/,
  );
  if (!awkMatch) {
    // Try multi-line awk program
    return tryParseMultiLineAwkTest(lines, startLine);
  }

  const program = awkMatch[2];
  const inputFile = awkMatch[3];
  const fooNum = awkMatch[4];

  // Determine which is output and which is expected
  // Usually: awk output goes to foo1 or foo2, expected goes to the other
  let expectedOutput = "";
  let testName = "";
  let inputData = "";
  let nextLine = startLine + 1;

  // Check for piped input: echo 'data' | $awk
  const pipeMatch = awkLine.match(/echo\s+(['"])(.*?)\1\s*\|\s*\$awk/);
  if (pipeMatch) {
    inputData = pipeMatch[2];
  }

  // Look for the expected output and diff/cmp line
  for (let j = startLine + 1; j < Math.min(startLine + 10, lines.length); j++) {
    const line = lines[j];

    // echo 'expected' >foo1/foo2
    const echoMatch = line.match(/echo\s+(['"])(.*?)\1\s*>\s*foo([12])/);
    if (echoMatch && echoMatch[3] !== fooNum) {
      expectedOutput = echoMatch[2].replace(/\\n/g, "\n").replace(/\\t/g, "\t");
      nextLine = j + 1;
    }

    // diff/cmp line with test name
    const diffMatch = line.match(
      /(?:diff|cmp)\s+(?:-s\s+)?foo1\s+foo2\s*\|\|\s*echo\s+(['"])?(?:BAD:\s*)?([^'"]+)\1?/,
    );
    if (diffMatch) {
      testName = cleanTestName(diffMatch[2]);
      nextLine = j + 1;
      break;
    }
  }

  if (!testName) {
    testName = `test at line ${startLine + 1}`;
  }

  // Handle input file
  if (inputFile && inputFile !== "/dev/null") {
    // Input from a file - we'd need to track file contents
    // For now, mark as needing the file
    inputData = `[file: ${inputFile}]`;
  }

  return {
    testCase: {
      name: testName,
      program,
      input: inputData,
      expectedOutput,
      lineNumber: startLine + 1,
      originalCommand: awkLine.trim(),
    },
    nextLine,
  };
}

/**
 * Try to parse a multi-line awk program test
 */
function tryParseMultiLineAwkTest(
  lines: string[],
  startLine: number,
): ParseResult | null {
  const firstLine = lines[startLine];

  // Check for $awk ' pattern that continues on next lines
  if (!firstLine.match(/\$awk\s+'/)) {
    return null;
  }

  // Find the closing quote
  let program = "";
  let endLine = startLine;
  let quoteCount = 0;

  for (let j = startLine; j < lines.length; j++) {
    const line = lines[j];
    // Count single quotes (very basic - doesn't handle escapes properly)
    for (const char of line) {
      if (char === "'") quoteCount++;
    }
    program += (j === startLine ? "" : "\n") + line;
    if (quoteCount >= 2 && quoteCount % 2 === 0) {
      endLine = j;
      break;
    }
  }

  // Extract the program from between quotes
  const programMatch = program.match(/\$awk\s+(?:-[^\s]+\s+)?'([\s\S]*?)'/);
  if (!programMatch) {
    return null;
  }

  // Look for expected output and test name
  let expectedOutput = "";
  let testName = "";
  let nextLine = endLine + 1;

  for (let j = endLine + 1; j < Math.min(endLine + 10, lines.length); j++) {
    const line = lines[j];

    const echoMatch = line.match(/echo\s+(['"])(.*?)\1\s*>\s*foo([12])/);
    if (echoMatch) {
      expectedOutput = echoMatch[2].replace(/\\n/g, "\n").replace(/\\t/g, "\t");
      nextLine = j + 1;
    }

    const diffMatch = line.match(
      /(?:diff|cmp)\s+(?:-s\s+)?foo1\s+foo2\s*\|\|\s*echo\s+(['"])?(?:BAD:\s*)?([^'"]+)\1?/,
    );
    if (diffMatch) {
      testName = cleanTestName(diffMatch[2]);
      nextLine = j + 1;
      break;
    }
  }

  if (!testName) {
    testName = `test at line ${startLine + 1}`;
  }

  return {
    testCase: {
      name: testName,
      program: programMatch[1],
      input: "",
      expectedOutput,
      lineNumber: startLine + 1,
      originalCommand: program.split("\n")[0].trim(),
    },
    nextLine,
  };
}

/**
 * Parse T.expr style heredoc tests
 * Format:
 * try { awk program }
 * input1\texpected1
 * input2\texpected2
 * (blank line ends test)
 */
function tryParseHeredocTests(
  lines: string[],
  startLine: number,
): HeredocParseResult | null {
  // Find the heredoc content
  let heredocStart = -1;
  let heredocEnd = -1;

  for (let j = startLine; j < lines.length; j++) {
    if (lines[j].includes("<<") && lines[j].includes("!!!!")) {
      heredocStart = j + 1;
    }
    if (heredocStart > 0 && lines[j] === "!!!!") {
      heredocEnd = j;
      break;
    }
  }

  if (heredocStart < 0 || heredocEnd < 0) {
    return null;
  }

  const testCases: AwkTestCase[] = [];
  let currentProgram = "";
  let testInputs: Array<{ input: string; expected: string }> = [];
  let testLineNumber = heredocStart;

  for (let j = heredocStart; j < heredocEnd; j++) {
    const line = lines[j];

    // Skip comments and empty lines at start
    if (line.startsWith("#") || line.trim() === "") {
      if (currentProgram && testInputs.length > 0) {
        // End of current test, save it
        for (let k = 0; k < testInputs.length; k++) {
          testCases.push({
            name: `${currentProgram.slice(0, 40)}... case ${k + 1}`,
            program: currentProgram,
            input: testInputs[k].input,
            expectedOutput: testInputs[k].expected,
            lineNumber: testLineNumber,
          });
        }
        currentProgram = "";
        testInputs = [];
      }
      continue;
    }

    // New test program
    if (line.startsWith("try ")) {
      if (currentProgram && testInputs.length > 0) {
        // Save previous test
        for (let k = 0; k < testInputs.length; k++) {
          testCases.push({
            name: `${currentProgram.slice(0, 40)}... case ${k + 1}`,
            program: currentProgram,
            input: testInputs[k].input,
            expectedOutput: testInputs[k].expected,
            lineNumber: testLineNumber,
          });
        }
      }
      currentProgram = line.slice(4).trim();
      testInputs = [];
      testLineNumber = j + 1;
      continue;
    }

    // Input/expected line (tab-separated)
    if (currentProgram && line.includes("\t")) {
      const parts = line.split("\t");
      const expected = parts[parts.length - 1];
      const input = parts.slice(0, -1).join("\t");
      testInputs.push({
        input,
        expected: expected === '""' ? "" : expected,
      });
    }
  }

  // Don't forget last test
  if (currentProgram && testInputs.length > 0) {
    for (let k = 0; k < testInputs.length; k++) {
      testCases.push({
        name: `${currentProgram.slice(0, 40)}... case ${k + 1}`,
        program: currentProgram,
        input: testInputs[k].input,
        expectedOutput: testInputs[k].expected,
        lineNumber: testLineNumber,
      });
    }
  }

  return {
    testCases,
    nextLine: heredocEnd + 1,
  };
}
