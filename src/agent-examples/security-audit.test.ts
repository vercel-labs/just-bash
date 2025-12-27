import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Advanced Agent Scenario: Security Audit
 *
 * Simulates an AI agent performing a security audit:
 * - Finding hardcoded secrets and credentials
 * - Identifying unsafe patterns (eval, innerHTML, SQL injection risks)
 * - Checking configuration files for security issues
 * - Analyzing authentication/authorization code
 */
describe("Agent Scenario: Security Audit", () => {
  const createEnv = () =>
    new Bash({
      files: {
        "/app/src/config.ts": `export const config = {
  apiKey: 'sk-1234567890abcdef',
  dbPassword: 'super_secret_password',
  jwtSecret: 'my-jwt-secret-key',
  port: 3000,
};
`,
        "/app/src/auth/login.ts": `import { config } from '../config';

export async function login(username: string, password: string) {
  // WARNING: SQL injection vulnerability
  const query = \`SELECT * FROM users WHERE username = '\${username}' AND password = '\${password}'\`;

  // Unsafe: using eval
  const userData = eval(response.body);

  return userData;
}
`,
        "/app/src/auth/jwt.ts": `import jwt from 'jsonwebtoken';
import { config } from '../config';

export function signToken(payload: object) {
  return jwt.sign(payload, config.jwtSecret);
}

export function verifyToken(token: string) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}
`,
        "/app/src/api/users.ts": `import { Request, Response } from 'express';

export function getUser(req: Request, res: Response) {
  const userId = req.params.id;
  // Missing authorization check!
  const user = db.findUser(userId);
  res.json(user);
}

export function deleteUser(req: Request, res: Response) {
  // No auth check - anyone can delete!
  db.deleteUser(req.params.id);
  res.json({ success: true });
}
`,
        "/app/src/api/render.ts": `export function renderUserProfile(user: { name: string; bio: string }) {
  // XSS vulnerability: innerHTML with user data
  document.getElementById('profile').innerHTML = \`
    <h1>\${user.name}</h1>
    <p>\${user.bio}</p>
  \`;
}

export function safeRender(user: { name: string }) {
  // Safe: using textContent
  document.getElementById('name').textContent = user.name;
}
`,
        "/app/.env": `DATABASE_URL=postgresql://admin:password123@localhost:5432/myapp
API_SECRET=very-secret-key
AWS_ACCESS_KEY=AKIA1234567890ABCDEF
AWS_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
`,
        "/app/.env.example": `DATABASE_URL=postgresql://user:password@localhost:5432/dbname
API_SECRET=your-api-secret
AWS_ACCESS_KEY=your-aws-access-key
AWS_SECRET_KEY=your-aws-secret-key
`,
        "/app/package.json": `{
  "name": "vulnerable-app",
  "dependencies": {
    "express": "^4.17.0",
    "lodash": "4.17.20",
    "jsonwebtoken": "^8.5.0"
  }
}
`,
        "/app/docker-compose.yml": `version: '3'
services:
  db:
    image: postgres
    environment:
      POSTGRES_PASSWORD: admin123
      POSTGRES_USER: admin
`,
      },
      cwd: "/app",
    });

  it("should find hardcoded API keys and secrets", async () => {
    const env = createEnv();
    // Search specifically in config.ts to avoid matching function parameters
    const result = await env.exec(
      'grep -n "apiKey\\|secret\\|password" /app/src/config.ts',
    );
    expect(result.stdout).toBe(`2:  apiKey: 'sk-1234567890abcdef',
3:  dbPassword: 'super_secret_password',
4:  jwtSecret: 'my-jwt-secret-key',
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find SQL injection vulnerabilities", async () => {
    const env = createEnv();
    // Search for SQL queries with string interpolation
    const result = await env.exec(
      'grep -n "SELECT.*\\$" /app/src/auth/login.ts',
    );
    expect(result.stdout).toBe(
      "5:  const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;\n",
    );
    expect(result.exitCode).toBe(0);
  });

  it("should find dangerous eval usage", async () => {
    const env = createEnv();
    const result = await env.exec('grep -rn "eval(" /app/src');
    expect(result.stdout).toBe(
      "/app/src/auth/login.ts:8:  const userData = eval(response.body);\n",
    );
    expect(result.exitCode).toBe(0);
  });

  it("should find XSS vulnerabilities with innerHTML", async () => {
    const env = createEnv();
    const result = await env.exec('grep -rn "innerHTML" /app/src');
    // Both the comment and the actual innerHTML usage match
    expect(
      result.stdout,
    ).toBe(`/app/src/api/render.ts:2:  // XSS vulnerability: innerHTML with user data
/app/src/api/render.ts:3:  document.getElementById('profile').innerHTML = \`
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find missing authorization checks", async () => {
    const env = createEnv();
    // Look for route handlers that don't check auth
    const result = await env.exec(
      'grep -B2 -A5 "function.*req.*res" /app/src/api/users.ts',
    );
    expect(result.stdout).toBe(`import { Request, Response } from 'express';

export function getUser(req: Request, res: Response) {
  const userId = req.params.id;
  // Missing authorization check!
  const user = db.findUser(userId);
  res.json(user);
}

export function deleteUser(req: Request, res: Response) {
  // No auth check - anyone can delete!
  db.deleteUser(req.params.id);
  res.json({ success: true });
}
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find sensitive data in .env file", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -n "KEY\\|SECRET\\|PASSWORD" /app/.env',
    );
    expect(result.stdout).toBe(`2:API_SECRET=very-secret-key
3:AWS_ACCESS_KEY=AKIA1234567890ABCDEF
4:AWS_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find hardcoded credentials in docker-compose", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -n "PASSWORD\\|password" /app/docker-compose.yml',
    );
    expect(result.stdout).toBe(`6:      POSTGRES_PASSWORD: admin123
`);
    expect(result.exitCode).toBe(0);
  });

  it("should check for vulnerable dependencies", async () => {
    const env = createEnv();
    // lodash 4.17.20 has known vulnerabilities
    const result = await env.exec('grep "lodash" /app/package.json');
    expect(result.stdout).toBe('    "lodash": "4.17.20",\n');
    expect(result.exitCode).toBe(0);
  });

  it("should generate security findings summary", async () => {
    const env = createEnv();

    // Count different vulnerability types
    const evalCount = await env.exec(
      'grep -r -c "eval(" /app/src | grep -v ":0$" | wc -l',
    );
    const innerHtmlCount = await env.exec(
      'grep -r -c "innerHTML" /app/src | grep -v ":0$" | wc -l',
    );
    const secretsInCode = await env.exec(
      'grep -rn "secret\\|password\\|apiKey" /app/src/config.ts | wc -l',
    );

    expect(evalCount.stdout.trim()).toBe("1");
    expect(innerHtmlCount.stdout.trim()).toBe("1");
    expect(secretsInCode.stdout.trim()).toBe("3");
  });

  it("should find all files that need security review", async () => {
    const env = createEnv();
    const result = await env.exec('find /app/src -name "*.ts" | sort');
    expect(result.stdout).toBe(`/app/src/api/render.ts
/app/src/api/users.ts
/app/src/auth/jwt.ts
/app/src/auth/login.ts
/app/src/config.ts
`);
    expect(result.exitCode).toBe(0);
  });

  it("should compare .env with .env.example for undocumented secrets", async () => {
    const env = createEnv();
    // Get variable names from both files
    const envVars = await env.exec("grep -o '^[A-Z_]*' /app/.env | sort");
    const exampleVars = await env.exec(
      "grep -o '^[A-Z_]*' /app/.env.example | sort",
    );

    expect(envVars.stdout).toBe(`API_SECRET
AWS_ACCESS_KEY
AWS_SECRET_KEY
DATABASE_URL
`);
    expect(exampleVars.stdout).toBe(`API_SECRET
AWS_ACCESS_KEY
AWS_SECRET_KEY
DATABASE_URL
`);
  });

  it("should identify auth-related files for focused review", async () => {
    const env = createEnv();
    const result = await env.exec(
      'find /app/src -type f -name "*auth*" -o -type f -name "*login*" -o -type f -name "*jwt*" | sort',
    );
    expect(result.stdout).toBe(`/app/src/auth/jwt.ts
/app/src/auth/login.ts
`);
    expect(result.exitCode).toBe(0);
  });
});

describe("Agent Scenario: File Permission Audit with find -perm", () => {
  const createPermEnv = () =>
    new Bash({
      files: {
        "/server/bin/start.sh": {
          content: "#!/bin/bash\nnode app.js",
          mode: 0o755,
        },
        "/server/bin/deploy.sh": {
          content: "#!/bin/bash\n# deploy script",
          mode: 0o755,
        },
        "/server/bin/backup.sh": {
          content: "#!/bin/bash\n# backup",
          mode: 0o700,
        },
        "/server/config/app.json": { content: '{"port": 3000}', mode: 0o644 },
        "/server/config/secrets.json": {
          content: '{"key": "secret"}',
          mode: 0o600,
        },
        "/server/config/db.json": {
          content: '{"host": "localhost"}',
          mode: 0o644,
        },
        "/server/logs/app.log": { content: "log data", mode: 0o644 },
        "/server/logs/error.log": { content: "errors", mode: 0o644 },
        "/server/data/users.db": { content: "user data", mode: 0o600 },
        "/server/data/cache.db": { content: "cache", mode: 0o666 },
        "/server/scripts/cleanup.sh": { content: "#!/bin/bash", mode: 0o777 },
        "/server/scripts/migrate.sh": { content: "#!/bin/bash", mode: 0o755 },
      },
      cwd: "/server",
    });

  describe("Finding executable files", () => {
    it("should find all executable scripts", async () => {
      const env = createPermEnv();
      const result = await env.exec("find /server -type f -perm -100");
      expect(result.stdout).toContain("/server/bin/start.sh");
      expect(result.stdout).toContain("/server/bin/deploy.sh");
      expect(result.stdout).toContain("/server/bin/backup.sh");
      expect(result.stdout).toContain("/server/scripts/cleanup.sh");
      expect(result.stdout).not.toContain("app.json");
      expect(result.exitCode).toBe(0);
    });

    it("should find world-executable files (security concern)", async () => {
      const env = createPermEnv();
      // Files with other-execute bit set (potentially dangerous)
      const result = await env.exec("find /server -type f -perm -001");
      expect(result.stdout).toContain("/server/scripts/cleanup.sh");
      expect(result.stdout).toContain("/server/bin/start.sh");
      expect(result.stdout).not.toContain("backup.sh"); // 0o700 has no other-execute
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Finding overly permissive files", () => {
    it("should find world-writable files (security risk)", async () => {
      const env = createPermEnv();
      // Files with 666 or 777 permissions (world-writable)
      const result = await env.exec("find /server -type f -perm -002");
      expect(result.stdout).toContain("/server/data/cache.db");
      expect(result.stdout).toContain("/server/scripts/cleanup.sh");
      expect(result.exitCode).toBe(0);
    });

    it("should find files with exact 777 permissions", async () => {
      const env = createPermEnv();
      const result = await env.exec("find /server -type f -perm 777");
      expect(result.stdout.trim()).toBe("/server/scripts/cleanup.sh");
      expect(result.exitCode).toBe(0);
    });

    it("should find files with exact 666 permissions", async () => {
      const env = createPermEnv();
      const result = await env.exec("find /server -type f -perm 666");
      expect(result.stdout.trim()).toBe("/server/data/cache.db");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Finding properly secured files", () => {
    it("should find files with restricted permissions (600)", async () => {
      const env = createPermEnv();
      const result = await env.exec("find /server -type f -perm 600");
      expect(result.stdout).toContain("/server/config/secrets.json");
      expect(result.stdout).toContain("/server/data/users.db");
      expect(result.exitCode).toBe(0);
    });

    it("should find owner-only readable files", async () => {
      const env = createPermEnv();
      // Files where only owner has read (no group or world read)
      const result = await env.exec("find /server/config -type f -perm 600");
      expect(result.stdout).toContain("secrets.json");
      expect(result.stdout).not.toContain("app.json");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Finding files with any specific permission", () => {
    it("should find files with any execute bit set", async () => {
      const env = createPermEnv();
      // /111 = any of user/group/other execute bits
      const result = await env.exec("find /server -type f -perm /111");
      expect(result.stdout).toContain("start.sh");
      expect(result.stdout).toContain("deploy.sh");
      expect(result.stdout).toContain("backup.sh");
      expect(result.stdout).toContain("cleanup.sh");
      expect(result.stdout).not.toContain("app.json");
      expect(result.exitCode).toBe(0);
    });

    it("should find files with any write bit for group or other", async () => {
      const env = createPermEnv();
      // /022 = group-write OR other-write
      const result = await env.exec("find /server -type f -perm /022");
      expect(result.stdout).toContain("cache.db");
      expect(result.stdout).toContain("cleanup.sh");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Security audit workflow", () => {
    it("should audit sensitive config files permissions", async () => {
      const env = createPermEnv();
      // Check that secrets.json is properly secured (600)
      const result = await env.exec(
        'find /server/config -name "secret*" -type f -perm 600',
      );
      expect(result.stdout).toContain("secrets.json");
      expect(result.exitCode).toBe(0);
    });

    it("should find scripts that need permission review", async () => {
      const env = createPermEnv();
      // Find all .sh files and check for overly permissive ones
      const allScripts = await env.exec('find /server -name "*.sh" -type f');
      const dangerousScripts = await env.exec(
        'find /server -name "*.sh" -type f -perm -002',
      );

      expect(allScripts.stdout).toContain("start.sh");
      expect(allScripts.stdout).toContain("cleanup.sh");
      // Only cleanup.sh should be flagged as world-writable
      expect(dangerousScripts.stdout.trim()).toBe("/server/scripts/cleanup.sh");
    });

    it("should find database files with incorrect permissions", async () => {
      const env = createPermEnv();
      // DB files should not be world-readable
      const result = await env.exec(
        'find /server/data -name "*.db" -type f -perm /044',
      );
      // cache.db is 666 (world-readable/writable) - security issue
      expect(result.stdout).toContain("cache.db");
      expect(result.exitCode).toBe(0);
    });
  });
});
