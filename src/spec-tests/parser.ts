/**
 * Parser for Oils spec test format (.test.sh files)
 *
 * Format:
 * - File headers: `## key: value`
 * - Test cases start with: `#### Test Name`
 * - Assertions: `## stdout:`, `## status:`, `## STDOUT: ... ## END`
 * - Shell-specific: `## OK shell`, `## N-I shell`, `## BUG shell`
 */

export interface FileHeader {
  oilsFailuresAllowed?: number;
  compareShells?: string[];
  tags?: string[];
}

export interface Assertion {
  type: "stdout" | "stderr" | "status" | "stdout-json" | "stderr-json";
  value: string | number;
  shells?: string[]; // If specified, only applies to these shells
  variant?: "OK" | "N-I" | "BUG"; // Shell-specific variant type
}

export interface TestCase {
  name: string;
  script: string;
  assertions: Assertion[];
  lineNumber: number;
  skip?: string; // If set, test should be skipped (value is reason)
}

export interface ParsedSpecFile {
  header: FileHeader;
  testCases: TestCase[];
  filePath: string;
}

/**
 * Parse a spec test file content
 */
export function parseSpecFile(
  content: string,
  filePath: string,
): ParsedSpecFile {
  const lines = content.split("\n");
  const header: FileHeader = {};
  const testCases: TestCase[] = [];

  let currentTest: TestCase | null = null;
  let scriptLines: string[] = [];
  let inMultiLineBlock = false;
  let multiLineType:
    | "stdout"
    | "stderr"
    | "stdout-json"
    | "stderr-json"
    | null = null;
  let multiLineContent: string[] = [];
  let multiLineShells: string[] | undefined;
  let multiLineVariant: "OK" | "N-I" | "BUG" | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Inside a multi-line block
    if (inMultiLineBlock) {
      if (line === "## END") {
        // End of multi-line block
        if (currentTest && multiLineType) {
          currentTest.assertions.push({
            type: multiLineType,
            value: multiLineContent.join("\n"),
            shells: multiLineShells,
            variant: multiLineVariant,
          });
        }
        inMultiLineBlock = false;
        multiLineType = null;
        multiLineContent = [];
        multiLineShells = undefined;
        multiLineVariant = undefined;
        continue;
      }
      // Check if another assertion is starting (ends current block without ## END)
      if (line.startsWith("## ") && isAssertionLine(line.slice(3))) {
        // End current block first
        if (currentTest && multiLineType) {
          currentTest.assertions.push({
            type: multiLineType,
            value: multiLineContent.join("\n"),
            shells: multiLineShells,
            variant: multiLineVariant,
          });
        }
        inMultiLineBlock = false;
        multiLineType = null;
        multiLineContent = [];
        multiLineShells = undefined;
        multiLineVariant = undefined;
        // Don't continue - fall through to process this line as an assertion
      } else {
        multiLineContent.push(line);
        continue;
      }
    }

    // Test case header
    if (line.startsWith("#### ")) {
      // Save previous test case
      if (currentTest) {
        currentTest.script = scriptLines.join("\n").trim();
        if (currentTest.script || currentTest.assertions.length > 0) {
          testCases.push(currentTest);
        }
      }

      // Start new test case
      const name = line.slice(5).trim();
      currentTest = {
        name,
        script: "",
        assertions: [],
        lineNumber,
      };
      scriptLines = [];
      continue;
    }

    // Assertion line (starts with ##)
    if (line.startsWith("## ")) {
      const assertionLine = line.slice(3);

      // File headers (before first test case)
      if (!currentTest) {
        parseHeaderLine(assertionLine, header);
        continue;
      }

      // Check for shell-specific variant prefix (BUG, BUG-2, OK, N-I, etc.)
      const variantMatch = assertionLine.match(
        /^(OK|N-I|BUG(?:-\d+)?)\s+([a-z0-9/.-]+)\s+(.+)$/i,
      );
      if (variantMatch) {
        const variant = variantMatch[1] as "OK" | "N-I" | "BUG";
        const shells = variantMatch[2].split("/");
        const rest = variantMatch[3];

        // Check if it's a multi-line start (allow trailing whitespace)
        const multiLineMatch = rest.match(/^(STDOUT|STDERR):\s*$/);
        if (multiLineMatch) {
          inMultiLineBlock = true;
          multiLineType = multiLineMatch[1].toLowerCase() as
            | "stdout"
            | "stderr";
          multiLineContent = [];
          multiLineShells = shells;
          multiLineVariant = variant;
          continue;
        }

        // Single-line shell-specific assertion
        const assertion = parseSingleLineAssertion(rest);
        if (assertion) {
          assertion.shells = shells;
          assertion.variant = variant;
          currentTest.assertions.push(assertion);
        }
        continue;
      }

      // Check for multi-line block start (allow trailing whitespace)
      const multiLineStart = assertionLine.match(/^(STDOUT|STDERR):\s*$/);
      if (multiLineStart) {
        inMultiLineBlock = true;
        multiLineType = multiLineStart[1].toLowerCase() as "stdout" | "stderr";
        multiLineContent = [];
        continue;
      }

      // Check for SKIP directive
      const skipMatch = assertionLine.match(/^SKIP(?::\s*(.*))?$/i);
      if (skipMatch) {
        currentTest.skip = skipMatch[1] || "skipped";
        continue;
      }

      // Single-line assertion
      const assertion = parseSingleLineAssertion(assertionLine);
      if (assertion) {
        currentTest.assertions.push(assertion);
      }
      continue;
    }

    // Regular script line (only add if we're in a test case)
    if (currentTest) {
      scriptLines.push(line);
    }
  }

  // Save last test case
  if (currentTest) {
    currentTest.script = scriptLines.join("\n").trim();
    if (currentTest.script || currentTest.assertions.length > 0) {
      testCases.push(currentTest);
    }
  }

  return { header, testCases, filePath };
}

/**
 * Check if a line (without the ## prefix) is an assertion line
 */
function isAssertionLine(line: string): boolean {
  // Shell-specific variant (BUG, BUG-2, OK, N-I, etc.)
  if (/^(OK|N-I|BUG(?:-\d+)?)\s+[a-z0-9/.-]+\s+/i.test(line)) {
    return true;
  }
  // Multi-line block start (allow trailing whitespace)
  if (/^(STDOUT|STDERR):\s*$/.test(line)) {
    return true;
  }
  // Single-line assertions
  if (/^(stdout|stderr|status|stdout-json|stderr-json):/.test(line)) {
    return true;
  }
  return false;
}

function parseHeaderLine(line: string, header: FileHeader): void {
  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) return;

  const key = line.slice(0, colonIndex).trim();
  const value = line.slice(colonIndex + 1).trim();

  switch (key) {
    case "oils_failures_allowed":
      header.oilsFailuresAllowed = parseInt(value, 10);
      break;
    case "compare_shells":
      header.compareShells = value.split(/\s+/);
      break;
    case "tags":
      header.tags = value.split(/\s+/);
      break;
  }
}

function parseSingleLineAssertion(line: string): Assertion | null {
  // stdout: value
  const stdoutMatch = line.match(/^stdout:\s*(.*)$/);
  if (stdoutMatch) {
    return { type: "stdout", value: stdoutMatch[1] };
  }

  // stderr: value
  const stderrMatch = line.match(/^stderr:\s*(.*)$/);
  if (stderrMatch) {
    return { type: "stderr", value: stderrMatch[1] };
  }

  // status: number
  const statusMatch = line.match(/^status:\s*(\d+)$/);
  if (statusMatch) {
    return { type: "status", value: parseInt(statusMatch[1], 10) };
  }

  // stdout-json: "value"
  const stdoutJsonMatch = line.match(/^stdout-json:\s*(.+)$/);
  if (stdoutJsonMatch) {
    try {
      const parsed = JSON.parse(stdoutJsonMatch[1]);
      return { type: "stdout-json", value: parsed };
    } catch {
      // If JSON parse fails, use raw value
      return { type: "stdout-json", value: stdoutJsonMatch[1] };
    }
  }

  // stderr-json: "value"
  const stderrJsonMatch = line.match(/^stderr-json:\s*(.+)$/);
  if (stderrJsonMatch) {
    try {
      const parsed = JSON.parse(stderrJsonMatch[1]);
      return { type: "stderr-json", value: parsed };
    } catch {
      return { type: "stderr-json", value: stderrJsonMatch[1] };
    }
  }

  return null;
}

/**
 * Get the expected stdout for a test case (considering bash-specific variants)
 */
export function getExpectedStdout(testCase: TestCase): string | null {
  // First, look for bash-specific assertions (BUG or OK with shells)
  for (const assertion of testCase.assertions) {
    if (
      (assertion.type === "stdout" || assertion.type === "stdout-json") &&
      assertion.shells?.some((s) => s === "bash" || s.startsWith("bash-"))
    ) {
      return String(assertion.value);
    }
  }

  // Fall back to default stdout
  for (const assertion of testCase.assertions) {
    if (
      (assertion.type === "stdout" || assertion.type === "stdout-json") &&
      !assertion.shells
    ) {
      return String(assertion.value);
    }
  }

  return null;
}

/**
 * Get the expected stderr for a test case
 */
export function getExpectedStderr(testCase: TestCase): string | null {
  // First, look for bash-specific assertions
  for (const assertion of testCase.assertions) {
    if (
      (assertion.type === "stderr" || assertion.type === "stderr-json") &&
      assertion.shells?.some((s) => s === "bash" || s.startsWith("bash-"))
    ) {
      return String(assertion.value);
    }
  }

  // Fall back to default stderr
  for (const assertion of testCase.assertions) {
    if (
      (assertion.type === "stderr" || assertion.type === "stderr-json") &&
      !assertion.shells
    ) {
      return String(assertion.value);
    }
  }

  return null;
}

/**
 * Get the expected exit status for a test case
 * Returns the default expected status (ignoring OK variants which are alternates)
 */
export function getExpectedStatus(testCase: TestCase): number | null {
  // First, look for bash-specific BUG status (BUG means bash has this bug, we should match it)
  for (const assertion of testCase.assertions) {
    if (
      assertion.type === "status" &&
      assertion.variant === "BUG" &&
      assertion.shells?.some((s) => s === "bash" || s.startsWith("bash-"))
    ) {
      return assertion.value as number;
    }
  }

  // Fall back to default status (not shell-specific, not a variant)
  for (const assertion of testCase.assertions) {
    if (
      assertion.type === "status" &&
      !assertion.shells &&
      !assertion.variant
    ) {
      return assertion.value as number;
    }
  }

  return null;
}

/**
 * Get all acceptable exit statuses for a test case
 * This includes the default status and any OK variants for bash
 */
export function getAcceptableStatuses(testCase: TestCase): number[] {
  const statuses: number[] = [];

  // Add BUG bash status if present (this overrides the default for us)
  for (const assertion of testCase.assertions) {
    if (
      assertion.type === "status" &&
      assertion.variant === "BUG" &&
      assertion.shells?.some((s) => s === "bash" || s.startsWith("bash-"))
    ) {
      statuses.push(assertion.value as number);
      return statuses; // BUG overrides everything
    }
  }

  // Add default status
  for (const assertion of testCase.assertions) {
    if (
      assertion.type === "status" &&
      !assertion.shells &&
      !assertion.variant
    ) {
      statuses.push(assertion.value as number);
      break;
    }
  }

  // Add OK bash statuses (these are also acceptable)
  for (const assertion of testCase.assertions) {
    if (
      assertion.type === "status" &&
      assertion.variant === "OK" &&
      assertion.shells?.some((s) => s === "bash" || s.startsWith("bash-"))
    ) {
      const value = assertion.value as number;
      if (!statuses.includes(value)) {
        statuses.push(value);
      }
    }
  }

  return statuses;
}

/**
 * Check if a test case is marked as N-I (Not Implemented) for bash
 */
export function isNotImplementedForBash(testCase: TestCase): boolean {
  return testCase.assertions.some(
    (a) =>
      a.variant === "N-I" &&
      a.shells?.some((s) => s === "bash" || s.startsWith("bash-")),
  );
}
