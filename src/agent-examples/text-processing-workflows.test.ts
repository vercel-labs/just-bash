import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Text Processing Workflows for Coding Agents
 *
 * These tests simulate real-world scenarios where AI coding agents use
 * awk, sed, grep, and other text processing tools to analyze and modify code.
 */

describe("Agent Workflow: Code Analysis with grep", () => {
  const createCodebaseEnv = () =>
    new Bash({
      files: {
        "/project/src/index.ts": `import { UserService } from './services/user';
import { AuthService } from './services/auth';
import { Logger } from './utils/logger';

// TODO: Add error handling
export async function main() {
  const logger = new Logger();
  const userService = new UserService();
  const authService = new AuthService();

  // FIXME: This should be configurable
  const port = 3000;

  logger.info('Starting application...');
  // TODO: Implement graceful shutdown
}
`,
        "/project/src/services/user.ts": `import { Database } from '../db';
import { Logger } from '../utils/logger';

// User service handles user CRUD operations
export class UserService {
  private db: Database;
  private logger: Logger;

  constructor() {
    this.db = new Database();
    this.logger = new Logger();
  }

  // TODO: Add caching
  async getUser(id: string) {
    this.logger.debug(\`Fetching user \${id}\`);
    return this.db.query('SELECT * FROM users WHERE id = ?', [id]);
  }

  async createUser(data: UserData) {
    // FIXME: Validate input
    return this.db.insert('users', data);
  }
}

interface UserData {
  name: string;
  email: string;
}
`,
        "/project/src/services/auth.ts": `import { UserService } from './user';
import { TokenService } from './token';

export class AuthService {
  // TODO: Implement refresh tokens
  async login(email: string, password: string) {
    // Authentication logic
    return { token: 'jwt-token' };
  }

  async logout(token: string) {
    // TODO: Invalidate token
    return true;
  }
}
`,
        "/project/src/utils/logger.ts": `export class Logger {
  info(msg: string) { console.log('[INFO]', msg); }
  debug(msg: string) { console.log('[DEBUG]', msg); }
  error(msg: string) { console.error('[ERROR]', msg); }
  warn(msg: string) { console.warn('[WARN]', msg); }
}
`,
        "/project/package.json": `{
  "name": "my-project",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.0",
    "typescript": "^5.0.0"
  }
}
`,
      },
      cwd: "/project",
    });

  describe("Finding TODOs and FIXMEs", () => {
    it("should find all TODO comments in codebase", async () => {
      const env = createCodebaseEnv();
      const result = await env.exec('grep -r "TODO" src/');
      expect(result.stdout).toContain("TODO: Add error handling");
      expect(result.stdout).toContain("TODO: Add caching");
      expect(result.stdout).toContain("TODO: Implement refresh tokens");
      expect(result.exitCode).toBe(0);
    });

    it("should count TODOs per file", async () => {
      const env = createCodebaseEnv();
      const result = await env.exec('grep -c "TODO" src/index.ts');
      expect(result.stdout).toBe("2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should find FIXMEs with line numbers", async () => {
      const env = createCodebaseEnv();
      const result = await env.exec('grep -rn "FIXME" src/');
      expect(result.stdout).toContain(":11:"); // Line number
      expect(result.stdout).toContain("FIXME");
      expect(result.exitCode).toBe(0);
    });

    it("should find both TODO and FIXME", async () => {
      const env = createCodebaseEnv();
      const result = await env.exec('grep -rE "TODO|FIXME" src/');
      expect(result.stdout).toContain("TODO");
      expect(result.stdout).toContain("FIXME");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Finding imports and dependencies", () => {
    it("should find all import statements", async () => {
      const env = createCodebaseEnv();
      const result = await env.exec('grep -r "^import" src/');
      expect(result.stdout).toContain("import { UserService }");
      expect(result.stdout).toContain("import { Database }");
      expect(result.exitCode).toBe(0);
    });

    it("should find files importing Logger", async () => {
      const env = createCodebaseEnv();
      const result = await env.exec('grep -rl "Logger" src');
      expect(result.stdout).toContain("index.ts");
      expect(result.stdout).toContain("user.ts");
      expect(result.exitCode).toBe(0);
    });

    it("should find class definitions", async () => {
      const env = createCodebaseEnv();
      const result = await env.exec('grep -r "^export class" src/');
      expect(result.stdout).toContain("export class UserService");
      expect(result.stdout).toContain("export class AuthService");
      expect(result.stdout).toContain("export class Logger");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Finding patterns with context", () => {
    it("should show context around matches", async () => {
      const env = createCodebaseEnv();
      const result = await env.exec(
        'grep -A2 "async getUser" src/services/user.ts',
      );
      expect(result.stdout).toContain("async getUser");
      expect(result.stdout).toContain("logger.debug");
      expect(result.exitCode).toBe(0);
    });

    it("should show context before matches", async () => {
      const env = createCodebaseEnv();
      const result = await env.exec(
        'grep -B1 "return this.db" src/services/user.ts',
      );
      expect(result.stdout).toContain("logger.debug");
      expect(result.stdout).toContain("return this.db");
      expect(result.exitCode).toBe(0);
    });
  });
});

describe("Agent Workflow: Code Refactoring with sed", () => {
  const createRefactoringEnv = () =>
    new Bash({
      files: {
        "/project/config.ts": `export const config = {
  apiUrl: 'http://localhost:3000',
  timeout: 5000,
  retries: 3,
  debug: true,
};
`,
        "/project/constants.ts": `export const API_VERSION = 'v1';
export const MAX_RETRIES = 3;
export const DEFAULT_TIMEOUT = 5000;
`,
        "/project/legacy.ts": `// Old naming convention
const userName = 'john';
const userEmail = 'john@example.com';
const userAge = 30;

function getUserName() {
  return userName;
}

function setUserName(name) {
  userName = name;
}
`,
      },
      cwd: "/project",
    });

  describe("Config value changes", () => {
    it("should change API URL in config", async () => {
      const env = createRefactoringEnv();
      await env.exec(
        "sed -i 's|http://localhost:3000|https://api.production.com|' config.ts",
      );
      const result = await env.exec("cat config.ts");
      expect(result.stdout).toContain("https://api.production.com");
      expect(result.stdout).not.toContain("localhost");
      expect(result.exitCode).toBe(0);
    });

    it("should change debug flag to false", async () => {
      const env = createRefactoringEnv();
      await env.exec("sed -i 's/debug: true/debug: false/' config.ts");
      const result = await env.exec("cat config.ts");
      expect(result.stdout).toContain("debug: false");
      expect(result.exitCode).toBe(0);
    });

    it("should update timeout value", async () => {
      const env = createRefactoringEnv();
      await env.exec("sed -i 's/timeout: 5000/timeout: 10000/' config.ts");
      const result = await env.exec("cat config.ts");
      expect(result.stdout).toContain("timeout: 10000");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Variable renaming", () => {
    it("should rename variable globally in file", async () => {
      const env = createRefactoringEnv();
      await env.exec("sed -i 's/userName/username/g' legacy.ts");
      const result = await env.exec("cat legacy.ts");
      expect(result.stdout).toContain("const username");
      expect(result.stdout).toContain("return username");
      expect(result.stdout).not.toContain("userName");
      expect(result.exitCode).toBe(0);
    });

    it("should rename function", async () => {
      const env = createRefactoringEnv();
      await env.exec("sed -i 's/getUserName/getUsername/g' legacy.ts");
      const result = await env.exec("cat legacy.ts");
      expect(result.stdout).toContain("function getUsername");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Comment manipulation", () => {
    it("should remove old comment", async () => {
      const env = createRefactoringEnv();
      await env.exec("sed -i '/Old naming convention/d' legacy.ts");
      const result = await env.exec("cat legacy.ts");
      expect(result.stdout).not.toContain("Old naming convention");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Multiple substitutions", () => {
    it("should chain multiple sed commands with pipe", async () => {
      const env = createRefactoringEnv();
      const result = await env.exec(
        "cat config.ts | sed 's/3000/8080/' | sed 's/5000/10000/'",
      );
      expect(result.stdout).toContain("8080");
      expect(result.stdout).toContain("10000");
      expect(result.exitCode).toBe(0);
    });
  });
});

describe("Agent Workflow: Data Extraction with awk", () => {
  const createDataEnv = () =>
    new Bash({
      files: {
        "/data/users.csv": `id,name,email,role,created_at
1,Alice,alice@example.com,admin,2024-01-15
2,Bob,bob@example.com,user,2024-01-16
3,Charlie,charlie@example.com,user,2024-01-17
4,Diana,diana@example.com,admin,2024-01-18
5,Eve,eve@example.com,user,2024-01-19
`,
        "/data/metrics.tsv": `timestamp\tservice\tlatency\tstatus
1705312800\tapi\t45\t200
1705312801\tapi\t120\t200
1705312802\tauth\t35\t200
1705312803\tapi\t250\t500
1705312804\tauth\t40\t200
1705312805\tapi\t55\t200
`,
        "/data/access.log": `192.168.1.100 - - [15/Jan/2024:10:00:00] "GET /api/users HTTP/1.1" 200 1234
192.168.1.101 - - [15/Jan/2024:10:00:01] "POST /api/login HTTP/1.1" 401 89
192.168.1.100 - - [15/Jan/2024:10:00:02] "GET /api/users/1 HTTP/1.1" 200 456
192.168.1.102 - - [15/Jan/2024:10:00:03] "GET /api/products HTTP/1.1" 200 2345
192.168.1.101 - - [15/Jan/2024:10:00:04] "POST /api/login HTTP/1.1" 200 234
`,
        "/data/package-lock.json": `{
  "name": "my-app",
  "version": "1.0.0",
  "packages": {
    "express": { "version": "4.18.2" },
    "lodash": { "version": "4.17.21" },
    "typescript": { "version": "5.3.3" }
  }
}
`,
      },
      cwd: "/data",
    });

  describe("CSV parsing", () => {
    it("should extract specific column from CSV", async () => {
      const env = createDataEnv();
      const result = await env.exec("awk -F, '{print $2}' users.csv");
      expect(result.stdout).toBe("name\nAlice\nBob\nCharlie\nDiana\nEve\n");
      expect(result.exitCode).toBe(0);
    });

    it("should extract email column (skip header)", async () => {
      const env = createDataEnv();
      const result = await env.exec("awk -F, 'NR>1 {print $3}' users.csv");
      expect(result.stdout).toBe(
        "alice@example.com\nbob@example.com\ncharlie@example.com\ndiana@example.com\neve@example.com\n",
      );
      expect(result.exitCode).toBe(0);
    });

    it("should filter rows by role", async () => {
      const env = createDataEnv();
      const result = await env.exec("awk -F, '$4==\"admin\"' users.csv");
      expect(result.stdout).toContain("Alice");
      expect(result.stdout).toContain("Diana");
      expect(result.stdout).not.toContain("Bob");
      expect(result.exitCode).toBe(0);
    });

    it("should count users by role", async () => {
      const env = createDataEnv();
      // Count admins
      const result = await env.exec(
        "awk -F, '$4==\"admin\"' users.csv | wc -l",
      );
      expect(result.stdout.trim()).toBe("2");
      expect(result.exitCode).toBe(0);
    });

    it("should reformat CSV output", async () => {
      const env = createDataEnv();
      const result = await env.exec(
        'awk -F, \'NR>1 {print $2 " <" $3 ">"}\' users.csv',
      );
      expect(result.stdout).toContain("Alice <alice@example.com>");
      expect(result.stdout).toContain("Bob <bob@example.com>");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("TSV parsing", () => {
    it("should parse tab-separated values", async () => {
      const env = createDataEnv();
      const result = await env.exec(
        "awk -F'\\t' 'NR>1 {print $2, $3}' metrics.tsv",
      );
      expect(result.stdout).toContain("api 45");
      expect(result.stdout).toContain("auth 35");
      expect(result.exitCode).toBe(0);
    });

    it("should filter by status code", async () => {
      const env = createDataEnv();
      const result = await env.exec("awk -F'\\t' '$4==500' metrics.tsv");
      expect(result.stdout).toContain("500");
      expect(result.stdout).toContain("250"); // High latency request
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Log parsing", () => {
    it("should extract unique IP addresses", async () => {
      const env = createDataEnv();
      const result = await env.exec(
        "awk '{print $1}' access.log | sort | uniq",
      );
      expect(result.stdout).toContain("192.168.1.100");
      expect(result.stdout).toContain("192.168.1.101");
      expect(result.stdout).toContain("192.168.1.102");
      expect(result.exitCode).toBe(0);
    });

    it("should count requests per IP", async () => {
      const env = createDataEnv();
      const result = await env.exec(
        "awk '{print $1}' access.log | sort | uniq -c | sort -rn",
      );
      expect(result.stdout).toContain("192.168.1.100");
      expect(result.exitCode).toBe(0);
    });

    it("should find failed requests (non-200)", async () => {
      const env = createDataEnv();
      const result = await env.exec("awk '$9!=200 {print $0}' access.log");
      expect(result.stdout).toContain("401");
      expect(result.exitCode).toBe(0);
    });

    it("should extract request paths", async () => {
      const env = createDataEnv();
      // Field 6 contains the request path in Apache combined log format
      const result = await env.exec(
        "awk '{print $6}' access.log | sort | uniq",
      );
      expect(result.stdout).toContain("/api/users");
      expect(result.stdout).toContain("/api/login");
      expect(result.stdout).toContain("/api/products");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Field calculations", () => {
    it("should calculate average latency", async () => {
      const env = createDataEnv();
      // Sum latencies and count, then divide
      const result = await env.exec(
        "awk -F'\\t' 'NR>1 {sum+=$3; count++} END{print sum/count}' metrics.tsv",
      );
      // (45+120+35+250+40+55)/6 = 90.83...
      expect(parseFloat(result.stdout)).toBeCloseTo(90.83, 1);
      expect(result.exitCode).toBe(0);
    });

    it("should find max latency", async () => {
      const env = createDataEnv();
      const result = await env.exec(
        "awk -F'\\t' 'NR>1 && $3>max {max=$3} END{print max}' metrics.tsv",
      );
      expect(result.stdout.trim()).toBe("250");
      expect(result.exitCode).toBe(0);
    });
  });
});

describe("Agent Workflow: Combined Pipeline Operations", () => {
  const createPipelineEnv = () =>
    new Bash({
      files: {
        "/project/src/components/Button.tsx": `import React from 'react';

interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ label, onClick, disabled }) => {
  return (
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
};
`,
        "/project/src/components/Input.tsx": `import React from 'react';

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export const Input: React.FC<InputProps> = ({ value, onChange, placeholder }) => {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
};
`,
        "/project/src/hooks/useAuth.ts": `import { useState, useEffect } from 'react';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check authentication status
    checkAuth().then(setUser).finally(() => setLoading(false));
  }, []);

  return { user, loading };
}

async function checkAuth() {
  // TODO: Implement real auth check
  return null;
}
`,
        "/project/src/hooks/useFetch.ts": `import { useState, useEffect } from 'react';

export function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(url)
      .then(res => res.json())
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [url]);

  return { data, error, loading };
}
`,
      },
      cwd: "/project",
    });

  describe("Find and analyze patterns", () => {
    it("should find all React components", async () => {
      const env = createPipelineEnv();
      const result = await env.exec('grep -r "React.FC" src/');
      expect(result.stdout).toContain("Button");
      expect(result.stdout).toContain("Input");
      expect(result.exitCode).toBe(0);
    });

    it("should list all custom hooks", async () => {
      const env = createPipelineEnv();
      // Use glob pattern to search multiple files (grep requires -r for directories)
      const result = await env.exec(
        'grep -l "^export function use" src/hooks/*.ts',
      );
      expect(result.stdout).toContain("useAuth.ts");
      expect(result.stdout).toContain("useFetch.ts");
      expect(result.exitCode).toBe(0);
    });

    it("should find useState usage and extract hook names", async () => {
      const env = createPipelineEnv();
      const result = await env.exec(
        "grep -h 'useState' src/hooks/*.ts | awk '{print $1, $2, $3}'",
      );
      expect(result.stdout).toContain("const");
      expect(result.exitCode).toBe(0);
    });

    it("should find files with useEffect", async () => {
      const env = createPipelineEnv();
      const result = await env.exec('grep -l "useEffect" src/hooks/*.ts');
      expect(result.stdout).toContain("useAuth.ts");
      expect(result.stdout).toContain("useFetch.ts");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Code statistics", () => {
    it("should count lines in each component", async () => {
      const env = createPipelineEnv();
      const result = await env.exec("wc -l src/components/*.tsx");
      expect(result.stdout).toContain("Button.tsx");
      expect(result.stdout).toContain("Input.tsx");
      expect(result.exitCode).toBe(0);
    });

    it("should count interface definitions", async () => {
      const env = createPipelineEnv();
      const result = await env.exec(
        'grep -c "^interface" src/components/Button.tsx',
      );
      expect(result.stdout.trim()).toBe("1");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Complex pipelines", () => {
    it("should find imports and sort uniquely", async () => {
      const env = createPipelineEnv();
      const result = await env.exec(
        'grep -h "^import" src/**/*.ts src/**/*.tsx | sort | uniq',
      );
      expect(result.stdout).toContain("import React from 'react'");
      expect(result.stdout).toContain(
        "import { useState, useEffect } from 'react'",
      );
      expect(result.exitCode).toBe(0);
    });

    it("should extract prop types from components", async () => {
      const env = createPipelineEnv();
      const result = await env.exec(
        "grep -A5 '^interface.*Props' src/components/Button.tsx",
      );
      expect(result.stdout).toContain("label: string");
      expect(result.stdout).toContain("onClick");
      expect(result.exitCode).toBe(0);
    });
  });
});

describe("Agent Workflow: awk pattern ranges for log sections", () => {
  const createLogEnv = () =>
    new Bash({
      files: {
        "/logs/server.log": `[2024-01-15 10:00:00] Server starting
[2024-01-15 10:00:01] Loading config
=== ERROR BLOCK START ===
NullPointerException at line 42
Stack trace:
  at main.ts:42
  at bootstrap.ts:15
=== ERROR BLOCK END ===
[2024-01-15 10:00:02] Server ready
[2024-01-15 10:05:00] Request received
=== ERROR BLOCK START ===
ConnectionTimeout after 30s
Stack trace:
  at db.ts:100
  at query.ts:25
=== ERROR BLOCK END ===
[2024-01-15 10:05:01] Request completed`,
        "/logs/config.ini": `[general]
name=MyApp
version=1.0

[database]
host=localhost
port=5432
user=admin

[cache]
enabled=true
ttl=3600

[logging]
level=debug
file=/var/log/app.log`,
        "/data/records.txt": `RECORD: user001
name: Alice Johnson
email: alice@example.com
role: admin
END_RECORD
RECORD: user002
name: Bob Smith
email: bob@example.com
role: user
END_RECORD
RECORD: user003
name: Charlie Brown
email: charlie@example.com
role: user
END_RECORD`,
      },
      cwd: "/",
    });

  describe("Extracting error blocks from logs", () => {
    it("should extract all error blocks using pattern range", async () => {
      const env = createLogEnv();
      const result = await env.exec(
        "awk '/ERROR BLOCK START/,/ERROR BLOCK END/' /logs/server.log",
      );
      expect(result.stdout).toContain("NullPointerException");
      expect(result.stdout).toContain("ConnectionTimeout");
      expect(result.stdout).toContain("Stack trace:");
      expect(result.exitCode).toBe(0);
    });

    it("should extract error blocks with custom formatting", async () => {
      const env = createLogEnv();
      const result = await env.exec(
        "awk '/ERROR BLOCK START/,/ERROR BLOCK END/ { print \"  \" $0 }' /logs/server.log",
      );
      expect(result.stdout).toContain("  === ERROR BLOCK START ===");
      expect(result.stdout).toContain("  NullPointerException");
      expect(result.exitCode).toBe(0);
    });

    it("should count lines in error blocks", async () => {
      const env = createLogEnv();
      const result = await env.exec(
        "awk '/ERROR BLOCK START/,/ERROR BLOCK END/ { count++ } END { print count }' /logs/server.log",
      );
      // Two blocks, 5 lines each (START + error + stack + 2 traces + END)
      expect(parseInt(result.stdout.trim(), 10)).toBeGreaterThan(8);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Extracting config sections", () => {
    it("should extract database section from config", async () => {
      const env = createLogEnv();
      // Use grep to find database section lines
      const result = await env.exec(
        "grep -A3 '\\[database\\]' /logs/config.ini",
      );
      expect(result.stdout).toContain("[database]");
      expect(result.stdout).toContain("host=localhost");
      expect(result.stdout).toContain("port=5432");
      expect(result.exitCode).toBe(0);
    });

    it("should extract cache settings", async () => {
      const env = createLogEnv();
      const result = await env.exec("grep -A3 '\\[cache\\]' /logs/config.ini");
      expect(result.stdout).toContain("[cache]");
      expect(result.stdout).toContain("enabled=true");
      expect(result.stdout).toContain("ttl=3600");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Processing multi-line records with getline", () => {
    it("should combine record fields using getline", async () => {
      const env = createLogEnv();
      const result = await env.exec(
        'awk \'/^RECORD:/ { id=$2; getline; split($0,a,": "); name=a[2]; getline; split($0,b,": "); email=b[2]; print id, name, email }\' /data/records.txt',
      );
      expect(result.stdout).toContain(
        "user001 Alice Johnson alice@example.com",
      );
      expect(result.stdout).toContain("user002 Bob Smith bob@example.com");
      expect(result.exitCode).toBe(0);
    });

    it("should extract records with role field", async () => {
      const env = createLogEnv();
      // Simpler approach: use pattern range to get admin record
      const result = await env.exec(
        "awk '/RECORD: user001/,/END_RECORD/' /data/records.txt | grep role",
      );
      expect(result.stdout).toContain("admin");
      expect(result.exitCode).toBe(0);
    });

    it("should skip header lines using getline", async () => {
      const env = createLogEnv();
      // Read and discard the RECORD line, then print remaining fields
      const result = await env.exec(
        "awk '/^RECORD:/ { getline; print }' /data/records.txt",
      );
      expect(result.stdout).toContain("name: Alice Johnson");
      expect(result.stdout).toContain("name: Bob Smith");
      expect(result.stdout).not.toContain("RECORD:");
      expect(result.exitCode).toBe(0);
    });
  });
});

describe("Agent Workflow: Text Sanitization with tr -c", () => {
  const createSanitizeEnv = () =>
    new Bash({
      files: {
        "/data/user-input.txt": `Hello! My email is user@example.com
Phone: +1 (555) 123-4567
Special chars: <script>alert('xss')</script>
Unicode: café naïve résumé`,
        "/data/filenames.txt": `report 2024.pdf
my file (1).doc
data_export[final].csv
notes & ideas.txt`,
        "/data/ids.txt": `user-001
USER_002
user.003
user@004`,
        "/data/log-entry.txt": `[2024-01-15 10:30:45] ERROR: Connection failed
Details: host=192.168.1.100, port=5432
Stack trace follows...`,
      },
      cwd: "/data",
    });

  describe("Sanitizing user input", () => {
    it("should keep only alphanumeric and spaces", async () => {
      const env = createSanitizeEnv();
      const result = await env.exec(
        "cat /data/user-input.txt | tr -cd 'a-zA-Z0-9 \\n'",
      );
      expect(result.stdout).not.toContain("@");
      expect(result.stdout).not.toContain("<");
      expect(result.stdout).not.toContain(">");
      expect(result.stdout).toContain("Hello");
      expect(result.stdout).toContain("My email is");
      expect(result.exitCode).toBe(0);
    });

    it("should keep only printable ASCII characters", async () => {
      const env = createSanitizeEnv();
      // Delete all except printable ASCII (space through tilde)
      const result = await env.exec(
        "echo 'Hello World 123!' | tr -cd 'A-Za-z0-9 !\\n'",
      );
      expect(result.stdout).toContain("Hello World 123!");
      expect(result.exitCode).toBe(0);
    });

    it("should extract only digits from phone number", async () => {
      const env = createSanitizeEnv();
      const result = await env.exec(
        "grep Phone /data/user-input.txt | tr -cd '0-9\\n'",
      );
      expect(result.stdout.trim()).toBe("15551234567");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Sanitizing filenames", () => {
    it("should replace unsafe filename characters with underscores", async () => {
      const env = createSanitizeEnv();
      const result = await env.exec(
        "cat /data/filenames.txt | tr -c 'a-zA-Z0-9._-\\n' '_'",
      );
      expect(result.stdout).toContain("report_2024.pdf");
      expect(result.stdout).toContain("my_file__1_.doc");
      expect(result.stdout).not.toContain("(");
      expect(result.stdout).not.toContain("[");
      expect(result.exitCode).toBe(0);
    });

    it("should normalize IDs to lowercase alphanumeric", async () => {
      const env = createSanitizeEnv();
      // First remove non-alphanumeric, then lowercase
      const result = await env.exec(
        "cat /data/ids.txt | tr -cd 'a-zA-Z0-9\\n' | tr 'A-Z' 'a-z'",
      );
      expect(result.stdout).toContain("user001");
      expect(result.stdout).toContain("user002");
      expect(result.stdout).toContain("user003");
      expect(result.stdout).toContain("user004");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Extracting data with tr -c", () => {
    it("should extract only letters for word analysis", async () => {
      const env = createSanitizeEnv();
      const result = await env.exec(
        "head -1 /data/user-input.txt | tr -cs 'a-zA-Z' '\\n' | head -5",
      );
      // Squeeze consecutive non-letters into single newlines
      expect(result.stdout).toContain("Hello");
      expect(result.stdout).toContain("My");
      expect(result.stdout).toContain("email");
      expect(result.exitCode).toBe(0);
    });

    it("should extract timestamp digits from log", async () => {
      const env = createSanitizeEnv();
      const result = await env.exec(
        "head -1 /data/log-entry.txt | tr -cd '0-9 :'",
      );
      expect(result.stdout).toContain("2024");
      expect(result.stdout).toContain("10:30:45");
      expect(result.exitCode).toBe(0);
    });

    it("should extract IP address octets", async () => {
      const env = createSanitizeEnv();
      const result = await env.exec(
        "grep host /data/log-entry.txt | tr -cd '0-9.\\n'",
      );
      expect(result.stdout).toContain("192.168.1.100");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Security-focused sanitization", () => {
    it("should remove potential XSS characters", async () => {
      const env = createSanitizeEnv();
      const result = await env.exec(
        "grep script /data/user-input.txt | tr -d '<>/\\'\"'",
      );
      expect(result.stdout).not.toContain("<");
      expect(result.stdout).not.toContain(">");
      expect(result.stdout).toContain("script");
      expect(result.exitCode).toBe(0);
    });

    it("should sanitize for SQL safety (remove quotes)", async () => {
      const env = createSanitizeEnv();
      const result = await env.exec(
        'echo "user\'; DROP TABLE users;--" | tr -d "\';"',
      );
      expect(result.stdout).not.toContain("'");
      expect(result.stdout).not.toContain(";");
      expect(result.stdout).toContain("user");
      expect(result.exitCode).toBe(0);
    });
  });
});

describe("Agent Workflow: printf formatting", () => {
  it("should format numbers with padding", async () => {
    const env = new Bash();
    const result = await env.exec("printf '%05d\\n' 42");
    expect(result.stdout).toBe("00042\n");
  });

  it("should format floats with precision", async () => {
    const env = new Bash();
    const result = await env.exec("printf '%.2f\\n' 3.14159");
    expect(result.stdout).toBe("3.14\n");
  });

  it("should format hex numbers", async () => {
    const env = new Bash();
    const result = await env.exec("printf '%x\\n' 255");
    expect(result.stdout).toBe("ff\n");
  });

  it("should format with width specifier", async () => {
    const env = new Bash();
    const result = await env.exec("printf '%10s\\n' hello");
    expect(result.stdout).toBe("     hello\n");
  });

  it("should left-justify with minus flag", async () => {
    const env = new Bash();
    const result = await env.exec("printf '%-10s|\\n' hello");
    expect(result.stdout).toBe("hello     |\n");
  });

  it("should format table-like output", async () => {
    const env = new Bash();
    // %-10s = "Item" + 6 spaces (10 chars), space, %5d = 3 spaces + "42" (5 chars), space, %8.2f = 4 spaces + "3.14" (8 chars)
    const result = await env.exec("printf '%-10s %5d %8.2f\\n' Item 42 3.14");
    expect(result.stdout).toBe("Item          42     3.14\n");
  });
});
