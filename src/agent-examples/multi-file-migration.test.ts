import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Advanced Agent Scenario: Multi-File Migration
 *
 * Simulates an AI agent performing a complex CommonJS to ESM migration:
 * - Finding all require statements
 * - Converting to import syntax
 * - Updating file extensions
 * - Modifying package.json
 */
describe("Agent Scenario: Multi-File Migration", () => {
  const createEnv = () =>
    new Bash({
      files: {
        "/project/package.json": `{
  "name": "legacy-app",
  "version": "1.0.0",
  "main": "src/index.js"
}`,
        "/project/tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "outDir": "./dist"
  }
}`,
        "/project/src/index.js": `const express = require('express');
const { createServer } = require('./server');
const config = require('./config');

const app = express();
const server = createServer(app);

module.exports = { app, server };
`,
        "/project/src/config.js": `const path = require('path');

const config = {
  port: process.env.PORT || 3000,
  env: process.env.NODE_ENV || 'development',
  paths: {
    root: path.resolve(__dirname, '..'),
  },
};

module.exports = config;
module.exports.default = config;
`,
        "/project/src/server.js": `const http = require('http');
const { logger } = require('./utils/logger');

function createServer(app) {
  const server = http.createServer(app);
  logger.info('Server created');
  return server;
}

module.exports = { createServer };
`,
        "/project/src/db.js": `const { logger } = require('./utils/logger');

class Database {
  constructor() {
    this.connection = null;
  }

  async connect() {
    logger.info('Connecting to database');
    // Connection logic
  }
}

module.exports = { db: new Database() };
`,
        "/project/src/utils/logger.js": `const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
});

module.exports = { logger };
module.exports.createLogger = (name) => logger.child({ name });
`,
        "/project/src/utils/helpers.js": `const _ = require('lodash');

const formatDate = (date) => date.toISOString();
const slugify = (str) => _.kebabCase(str);

module.exports = { formatDate, slugify };
`,
        "/project/src/controllers/user.js": `const { db } = require('../db');
const { logger } = require('../utils/logger');

class UserController {
  async getUsers(req, res) {
    logger.info('Fetching users');
    const users = await db.query('SELECT * FROM users');
    res.json(users);
  }

  async createUser(req, res) {
    logger.info('Creating user');
    const user = await db.query('INSERT INTO users');
    res.json(user);
  }
}

module.exports = { UserController };
`,
        "/project/src/routes/users.js": `const express = require('express');
const { UserController } = require('../controllers/user');

const router = express.Router();
const controller = new UserController();

router.get('/', controller.getUsers);

module.exports = router;
module.exports.userRoutes = router;
`,
      },
      cwd: "/project",
    });

  it("should find all CommonJS require statements", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -rn "require(" /project/src --include="*.js"',
    );
    expect(
      result.stdout,
    ).toBe(`/project/src/config.js:1:const path = require('path');
/project/src/controllers/user.js:1:const { db } = require('../db');
/project/src/controllers/user.js:2:const { logger } = require('../utils/logger');
/project/src/db.js:1:const { logger } = require('./utils/logger');
/project/src/index.js:1:const express = require('express');
/project/src/index.js:2:const { createServer } = require('./server');
/project/src/index.js:3:const config = require('./config');
/project/src/routes/users.js:1:const express = require('express');
/project/src/routes/users.js:2:const { UserController } = require('../controllers/user');
/project/src/server.js:1:const http = require('http');
/project/src/server.js:2:const { logger } = require('./utils/logger');
/project/src/utils/helpers.js:1:const _ = require('lodash');
/project/src/utils/logger.js:1:const winston = require('winston');
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find all module.exports statements", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -rn "module.exports" /project/src --include="*.js"',
    );
    expect(
      result.stdout,
    ).toBe(`/project/src/config.js:11:module.exports = config;
/project/src/config.js:12:module.exports.default = config;
/project/src/controllers/user.js:18:module.exports = { UserController };
/project/src/db.js:14:module.exports = { db: new Database() };
/project/src/index.js:8:module.exports = { app, server };
/project/src/routes/users.js:9:module.exports = router;
/project/src/routes/users.js:10:module.exports.userRoutes = router;
/project/src/server.js:10:module.exports = { createServer };
/project/src/utils/helpers.js:6:module.exports = { formatDate, slugify };
/project/src/utils/logger.js:8:module.exports = { logger };
/project/src/utils/logger.js:9:module.exports.createLogger = (name) => logger.child({ name });
`);
    expect(result.exitCode).toBe(0);
  });

  it("should count files needing migration", async () => {
    const env = createEnv();
    const result = await env.exec('find /project/src -name "*.js" | wc -l');
    expect(result.stdout.trim()).toBe("8");
  });

  it("should identify external vs internal dependencies", async () => {
    const env = createEnv();

    // External (from node_modules)
    const external = await env.exec(
      'grep -rh "require(" /project/src --include="*.js" | grep -v "require(\'\\.\\.\\|require(\'\\./" | sort | uniq',
    );
    expect(external.stdout).toBe(`const _ = require('lodash');
const express = require('express');
const http = require('http');
const path = require('path');
const winston = require('winston');
`);
    expect(external.exitCode).toBe(0);
  });

  it("should convert require to import using sed", async () => {
    const env = createEnv();

    // Convert a simple require to import (escape parens for regex)
    await env.exec(
      "sed \"s/const express = require\\('express'\\);/import express from 'express';/g\" /project/src/index.js > /project/src/index.js.new",
    );
    await env.exec("mv /project/src/index.js.new /project/src/index.js");

    const result = await env.exec("head -1 /project/src/index.js");
    expect(result.stdout).toBe("import express from 'express';\n");
    expect(result.exitCode).toBe(0);
  });

  it("should rename .js to .mjs files", async () => {
    const env = createEnv();

    // Simulate renaming one file
    await env.exec(
      "mv /project/src/utils/helpers.js /project/src/utils/helpers.mjs",
    );

    const result = await env.exec("ls /project/src/utils");
    expect(result.stdout).toBe("helpers.mjs\nlogger.js\n");
    expect(result.exitCode).toBe(0);
  });

  it("should update package.json type to module", async () => {
    const env = createEnv();

    // Check current package.json
    const before = await env.exec(
      'grep "type" /project/package.json || echo "No type field"',
    );
    expect(before.stdout).toBe("No type field\n");

    // Add type: module - directly write the modified content
    await env.exec(
      'echo \'{"name":"legacy-app","type":"module"}\' > /project/package.json',
    );

    const after = await env.exec('grep "type" /project/package.json');
    expect(after.stdout).toBe('{"name":"legacy-app","type":"module"}\n');
    expect(after.exitCode).toBe(0);
  });

  it("should update tsconfig module to ESNext", async () => {
    const env = createEnv();

    await env.exec(
      'sed \'s/"module": "CommonJS"/"module": "ESNext"/\' /project/tsconfig.json > /project/tsconfig.json.new',
    );
    await env.exec("mv /project/tsconfig.json.new /project/tsconfig.json");

    const result = await env.exec('grep "module" /project/tsconfig.json');
    expect(result.stdout).toBe('    "module": "ESNext",\n');
    expect(result.exitCode).toBe(0);
  });

  it("should find files with mixed export patterns", async () => {
    const env = createEnv();

    // Find files that have both module.exports = AND module.exports.something (mixed patterns)
    // First find files with module.exports =
    const result = await env.exec(
      'grep -rl "module.exports =" /project/src --include="*.js" | sort | uniq',
    );
    // All JS files have module.exports =, so this returns all of them
    expect(result.stdout).toBe(`/project/src/config.js
/project/src/controllers/user.js
/project/src/db.js
/project/src/index.js
/project/src/routes/users.js
/project/src/server.js
/project/src/utils/helpers.js
/project/src/utils/logger.js
`);
    expect(result.exitCode).toBe(0);
  });

  it("should identify circular dependency risks", async () => {
    const env = createEnv();

    // Check if db.js imports from utils/logger.js
    const dbImports = await env.exec(
      'grep -l "require.*logger" /project/src/db.js',
    );
    expect(dbImports.stdout).toBe("/project/src/db.js\n");

    // Check if server.js also imports logger
    const serverImports = await env.exec(
      'grep -l "require.*logger" /project/src/server.js',
    );
    expect(serverImports.stdout).toBe("/project/src/server.js\n");
  });

  it("should backup files before migration", async () => {
    const env = createEnv();

    await env.exec("cp /project/src/index.js /project/src/index.js.bak");

    const result = await env.exec("ls /project/src | grep index");
    expect(result.stdout).toBe("index.js\nindex.js.bak\n");
    expect(result.exitCode).toBe(0);
  });

  it("should generate migration summary report", async () => {
    const env = createEnv();

    const jsFileCount = await env.exec(
      'find /project/src -name "*.js" | wc -l',
    );
    const requireCount = await env.exec(
      'grep -r "require(" /project/src --include="*.js" | wc -l',
    );
    const exportsCount = await env.exec(
      'grep -r "module.exports" /project/src --include="*.js" | wc -l',
    );

    expect(jsFileCount.stdout.trim()).toBe("8");
    expect(requireCount.stdout.trim()).toBe("13");
    expect(exportsCount.stdout.trim()).toBe("11");
  });

  it("should find relative imports that need extension updates", async () => {
    const env = createEnv();
    const result = await env.exec(
      "grep -rh \"require('\\./\\|require('../\" /project/src | sort | uniq",
    );
    expect(result.stdout).toBe(`const { createServer } = require('./server');
const { db } = require('../db');
const { logger } = require('../utils/logger');
const { logger } = require('./utils/logger');
const { UserController } = require('../controllers/user');
const config = require('./config');
`);
    expect(result.exitCode).toBe(0);
  });
});
