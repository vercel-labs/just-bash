import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Advanced Agent Scenario: Dependency Analysis
 *
 * Simulates an AI agent analyzing a codebase's dependency structure:
 * - Mapping import/export relationships
 * - Finding circular dependencies
 * - Identifying unused exports
 * - Understanding module coupling
 */
describe("Agent Scenario: Dependency Analysis", () => {
  const createEnv = () =>
    new Bash({
      files: {
        "/project/src/index.ts": `import { App } from './app';
import { logger } from './utils/logger';

logger.info('Starting application');
const app = new App();
app.start();
`,
        "/project/src/app.ts": `import { Router } from './router';
import { Database } from './db';
import { logger } from './utils/logger';
import { Config } from './config';

export class App {
  private router: Router;
  private db: Database;

  constructor() {
    this.db = new Database(Config.dbUrl);
    this.router = new Router(this.db);
    logger.info('App initialized');
  }

  start() {
    this.router.listen(Config.port);
  }
}
`,
        "/project/src/router.ts": `import { Database } from './db';
import { UserController } from './controllers/user';
import { PostController } from './controllers/post';
import { logger } from './utils/logger';

export class Router {
  constructor(private db: Database) {
    logger.debug('Router created');
  }

  listen(port: number) {
    logger.info(\`Listening on port \${port}\`);
  }
}
`,
        "/project/src/db.ts": `import { logger } from './utils/logger';
import { Config } from './config';

export class Database {
  constructor(private url: string) {
    logger.info(\`Connecting to \${url}\`);
  }

  query(sql: string) {
    return [];
  }
}

export function createConnection() {
  return new Database(Config.dbUrl);
}
`,
        "/project/src/config.ts": `export const Config = {
  port: 3000,
  dbUrl: 'postgresql://localhost:5432/app',
  logLevel: 'info',
};

export const FeatureFlags = {
  newDashboard: true,
  darkMode: false,
};

export function getEnv(key: string): string | undefined {
  return process.env[key];
}
`,
        "/project/src/utils/logger.ts": `import { Config } from '../config';

export const logger = {
  info: (msg: string) => console.log(\`[INFO] \${msg}\`),
  debug: (msg: string) => Config.logLevel === 'debug' && console.log(\`[DEBUG] \${msg}\`),
  error: (msg: string) => console.error(\`[ERROR] \${msg}\`),
};

export function createLogger(name: string) {
  return {
    log: (msg: string) => logger.info(\`[\${name}] \${msg}\`),
  };
}
`,
        "/project/src/utils/helpers.ts": `export function formatDate(date: Date): string {
  return date.toISOString();
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/\\s+/g, '-');
}

export function debounce(fn: Function, ms: number) {
  let timeout: NodeJS.Timeout;
  return (...args: any[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
}
`,
        "/project/src/controllers/user.ts": `import { Database } from '../db';
import { logger } from '../utils/logger';
import { formatDate } from '../utils/helpers';

export class UserController {
  constructor(private db: Database) {}

  getUser(id: string) {
    logger.info(\`Getting user \${id}\`);
    return this.db.query(\`SELECT * FROM users WHERE id = \${id}\`);
  }
}
`,
        "/project/src/controllers/post.ts": `import { Database } from '../db';
import { logger } from '../utils/logger';
import { slugify, formatDate } from '../utils/helpers';

export class PostController {
  constructor(private db: Database) {}

  createPost(title: string, content: string) {
    const slug = slugify(title);
    logger.info(\`Creating post: \${slug}\`);
    return { slug, title, content, createdAt: formatDate(new Date()) };
  }
}
`,
        "/project/src/models/user.ts": `export interface User {
  id: string;
  name: string;
  email: string;
}

export type UserRole = 'admin' | 'user' | 'guest';
`,
        "/project/src/models/post.ts": `import { User } from './user';

export interface Post {
  id: string;
  title: string;
  content: string;
  author: User;
}
`,
      },
      cwd: "/project",
    });

  it("should find all import statements in the codebase", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -rh "^import" /project/src | sort | uniq',
    );
    expect(result.stdout).toBe(`import { App } from './app';
import { Config } from '../config';
import { Config } from './config';
import { Database } from '../db';
import { Database } from './db';
import { formatDate } from '../utils/helpers';
import { logger } from '../utils/logger';
import { logger } from './utils/logger';
import { PostController } from './controllers/post';
import { Router } from './router';
import { slugify, formatDate } from '../utils/helpers';
import { User } from './user';
import { UserController } from './controllers/user';
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find all export statements", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -rh "^export" /project/src | sort | uniq',
    );
    expect(result.stdout).toBe(`export class App {
export class Database {
export class PostController {
export class Router {
export class UserController {
export const Config = {
export const FeatureFlags = {
export const logger = {
export function createConnection() {
export function createLogger(name: string) {
export function debounce(fn: Function, ms: number) {
export function formatDate(date: Date): string {
export function getEnv(key: string): string | undefined {
export function slugify(text: string): string {
export interface Post {
export interface User {
export type UserRole = 'admin' | 'user' | 'guest';
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find which modules import logger", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -rl "import.*logger" /project/src --include="*.ts" | sort',
    );
    expect(result.stdout).toBe(`/project/src/app.ts
/project/src/controllers/post.ts
/project/src/controllers/user.ts
/project/src/db.ts
/project/src/index.ts
/project/src/router.ts
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find which modules import Database", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -rl "import.*Database" /project/src --include="*.ts" | sort',
    );
    expect(result.stdout).toBe(`/project/src/app.ts
/project/src/controllers/post.ts
/project/src/controllers/user.ts
/project/src/router.ts
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find unused exports (exports not imported elsewhere)", async () => {
    const env = createEnv();

    // Find FeatureFlags export
    const featureFlagsExport = await env.exec(
      'grep "FeatureFlags" /project/src/config.ts',
    );
    expect(featureFlagsExport.stdout).toBe(`export const FeatureFlags = {
`);

    // Check if FeatureFlags is imported anywhere
    const featureFlagsImport = await env.exec(
      'grep -r "FeatureFlags" /project/src --include="*.ts" | grep -v config.ts || echo "Not imported"',
    );
    expect(featureFlagsImport.stdout).toBe("Not imported\n");
  });

  it("should find unused helper functions", async () => {
    const env = createEnv();

    // debounce is exported but never imported
    const debounceImport = await env.exec(
      'grep -r "debounce" /project/src --include="*.ts" | grep -v helpers.ts || echo "Not used"',
    );
    expect(debounceImport.stdout).toBe("Not used\n");
  });

  it("should map the dependency tree from index.ts", async () => {
    const env = createEnv();

    // index.ts imports
    const indexImports = await env.exec('grep "^import" /project/src/index.ts');
    expect(indexImports.stdout).toBe(`import { App } from './app';
import { logger } from './utils/logger';
`);

    // app.ts imports
    const appImports = await env.exec('grep "^import" /project/src/app.ts');
    expect(appImports.stdout).toBe(`import { Router } from './router';
import { Database } from './db';
import { logger } from './utils/logger';
import { Config } from './config';
`);
    expect(appImports.exitCode).toBe(0);
  });

  it("should find potential circular dependencies", async () => {
    const env = createEnv();

    // config.ts is imported by logger.ts (using case-insensitive match to find both lines)
    const loggerImportsConfig = await env.exec(
      'grep -i "config" /project/src/utils/logger.ts',
    );
    expect(loggerImportsConfig.stdout).toBe(`import { Config } from '../config';
  debug: (msg: string) => Config.logLevel === 'debug' && console.log(\`[DEBUG] \${msg}\`),
`);

    // Check if config.ts imports logger (would be circular)
    const configImportsLogger = await env.exec(
      'grep "logger" /project/src/config.ts || echo "No circular dependency"',
    );
    expect(configImportsLogger.stdout).toBe("No circular dependency\n");
  });

  it("should count imports per module to find highly coupled modules", async () => {
    const env = createEnv();
    // Use grep -c recursive with --include to count imports per file
    const result = await env.exec(
      'grep -rc "^import" /project/src --include="*.ts" | sort -t: -k2 -rn | head -5',
    );
    expect(result.stdout).toBe(`/project/src/router.ts:4
/project/src/app.ts:4
/project/src/controllers/user.ts:3
/project/src/controllers/post.ts:3
/project/src/index.ts:2
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find all model type definitions", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -rn "^export interface\\|^export type" /project/src/models',
    );
    expect(
      result.stdout,
    ).toBe(`/project/src/models/post.ts:3:export interface Post {
/project/src/models/user.ts:1:export interface User {
/project/src/models/user.ts:7:export type UserRole = 'admin' | 'user' | 'guest';
`);
    expect(result.exitCode).toBe(0);
  });

  it("should identify the utils directory as a shared dependency hub", async () => {
    const env = createEnv();

    // Count how many files import from utils
    const result = await env.exec(
      'grep -rl "from.*utils" /project/src | wc -l',
    );
    expect(result.stdout.trim()).toBe("6");
  });

  it("should find controllers and their database dependencies", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -l "Database" /project/src/controllers/*.ts',
    );
    expect(result.stdout).toBe(`/project/src/controllers/post.ts
/project/src/controllers/user.ts
`);
    expect(result.exitCode).toBe(0);
  });
});
