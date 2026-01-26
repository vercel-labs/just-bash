import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), "utf-8");
}

/**
 * Python Scripting Scenario
 * An AI agent writing complex Python scripts for data analysis,
 * file processing, and automation tasks.
 */
describe("Agent Scenario: Python Data Analysis", () => {
  const createDataEnv = () =>
    new Bash({
      files: {
        "/data/sales.csv": `date,product,quantity,price
2024-01-15,Widget A,10,29.99
2024-01-15,Widget B,5,49.99
2024-01-16,Widget A,8,29.99
2024-01-16,Widget C,12,19.99
2024-01-17,Widget B,3,49.99
2024-01-17,Widget A,15,29.99
2024-01-18,Widget C,20,19.99
2024-01-18,Widget B,7,49.99`,
        "/data/users.json": `[
  {"id": 1, "name": "Alice", "email": "alice@example.com", "role": "admin"},
  {"id": 2, "name": "Bob", "email": "bob@example.com", "role": "user"},
  {"id": 3, "name": "Charlie", "email": "charlie@example.com", "role": "user"},
  {"id": 4, "name": "Diana", "email": "diana@example.com", "role": "admin"}
]`,
        "/scripts/analyze.py": loadFixture("analyze_csv.py"),
        "/scripts/filter.py": loadFixture("filter_json.py"),
        "/scripts/stats.py": loadFixture("sales_stats.py"),
      },
      cwd: "/data",
    });

  it("should parse CSV and calculate total revenue per product", async () => {
    const env = createDataEnv();
    const result = await env.exec("python3 /scripts/analyze.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "Widget A: $989.67\nWidget B: $749.85\nWidget C: $639.68\n",
    );
    expect(result.exitCode).toBe(0);
  });

  it("should analyze JSON data and filter by role", async () => {
    const env = createDataEnv();
    const result = await env.exec("python3 /scripts/filter.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "Total users: 4\nAdmin users: 2\nAdmin names: Alice, Diana\n",
    );
    expect(result.exitCode).toBe(0);
  });

  it("should generate statistics from sales data", async () => {
    const env = createDataEnv();
    const result = await env.exec("python3 /scripts/stats.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "Total items sold: 80\nTotal revenue: $2379.20\nMost popular: Widget A\nUnique products: 3\n",
    );
    expect(result.exitCode).toBe(0);
  });
});

describe("Agent Scenario: Log Analysis with Python", () => {
  const createLogEnv = () =>
    new Bash({
      files: {
        "/logs/app.log": `2024-01-15 10:23:45 INFO  Server started on port 8080
2024-01-15 10:24:01 DEBUG Processing request /api/users
2024-01-15 10:24:02 INFO  Request completed in 45ms
2024-01-15 10:25:15 WARN  High memory usage detected: 85%
2024-01-15 10:26:30 ERROR Database connection failed: timeout
2024-01-15 10:26:31 INFO  Retrying database connection...
2024-01-15 10:26:35 INFO  Database reconnected successfully
2024-01-15 10:30:00 ERROR Authentication failed for user: admin
2024-01-15 10:30:05 WARN  Rate limit exceeded for IP: 192.168.1.100
2024-01-15 10:35:22 INFO  Scheduled backup completed
2024-01-15 10:40:00 ERROR Disk space critical: 95% used
2024-01-15 10:45:00 DEBUG Cache miss for key: user_session_123`,
        "/logs/access.log": `192.168.1.1 - - [15/Jan/2024:10:00:00] "GET /api/users HTTP/1.1" 200 1234
192.168.1.2 - - [15/Jan/2024:10:00:05] "POST /api/login HTTP/1.1" 200 456
192.168.1.1 - - [15/Jan/2024:10:00:10] "GET /api/products HTTP/1.1" 200 5678
192.168.1.3 - - [15/Jan/2024:10:00:15] "GET /api/users HTTP/1.1" 404 89
192.168.1.2 - - [15/Jan/2024:10:00:20] "DELETE /api/users/5 HTTP/1.1" 403 123
192.168.1.1 - - [15/Jan/2024:10:00:25] "GET /api/products HTTP/1.1" 200 5678
192.168.1.4 - - [15/Jan/2024:10:00:30] "POST /api/orders HTTP/1.1" 500 234`,
        "/scripts/parse_logs.py": loadFixture("parse_logs.py"),
        "/scripts/access.py": loadFixture("access_logs.py"),
        "/scripts/timestamps.py": loadFixture("timestamps.py"),
      },
      cwd: "/logs",
    });

  it("should count log levels and identify errors", async () => {
    const env = createLogEnv();
    const result = await env.exec("python3 /scripts/parse_logs.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("INFO: 5");
    expect(result.stdout).toContain("ERROR: 3");
    expect(result.stdout).toContain("Database connection failed");
    expect(result.stdout).toContain("Authentication failed");
    expect(result.exitCode).toBe(0);
  });

  it("should parse access logs and calculate request statistics", async () => {
    const env = createLogEnv();
    const result = await env.exec("python3 /scripts/access.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("GET: 4");
    expect(result.stdout).toContain("POST: 2");
    expect(result.stdout).toContain("200: 4");
    expect(result.stdout).toContain("500: 1");
    expect(result.exitCode).toBe(0);
  });

  it("should extract and analyze timestamps", async () => {
    const env = createLogEnv();
    const result = await env.exec("python3 /scripts/timestamps.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("First entry: 10:23:45");
    expect(result.stdout).toContain("Last entry: 10:45:00");
    expect(result.stdout).toContain("Time span: 21 minutes");
    expect(result.stdout).toContain("Total entries: 12");
    expect(result.exitCode).toBe(0);
  });
});

describe("Agent Scenario: Code Generation with Python", () => {
  const createCodeGenEnv = () =>
    new Bash({
      files: {
        "/project/schema.json": `{
  "User": {
    "fields": {
      "id": "int",
      "username": "str",
      "email": "str",
      "created_at": "datetime"
    }
  },
  "Product": {
    "fields": {
      "id": "int",
      "name": "str",
      "price": "float",
      "in_stock": "bool"
    }
  }
}`,
        "/scripts/codegen.py": loadFixture("codegen_dataclass.py"),
        "/scripts/sqlgen.py": loadFixture("codegen_sql.py"),
      },
      cwd: "/project",
    });

  it("should generate Python dataclass definitions from schema", async () => {
    const env = createCodeGenEnv();
    const result = await env.exec("python3 /scripts/codegen.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("from dataclasses import dataclass");
    expect(result.stdout).toContain("@dataclass");
    expect(result.stdout).toContain("class User:");
    expect(result.stdout).toContain("username: str");
    expect(result.stdout).toContain("class Product:");
    expect(result.stdout).toContain("price: float");
    expect(result.exitCode).toBe(0);
  });

  it("should generate SQL CREATE TABLE statements", async () => {
    const env = createCodeGenEnv();
    const result = await env.exec("python3 /scripts/sqlgen.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("CREATE TABLE users (");
    expect(result.stdout).toContain("id INTEGER PRIMARY KEY");
    expect(result.stdout).toContain("username VARCHAR(255)");
    expect(result.stdout).toContain("CREATE TABLE products (");
    expect(result.stdout).toContain("price DECIMAL(10,2)");
    expect(result.exitCode).toBe(0);
  });
});

describe("Agent Scenario: File Processing Pipeline", () => {
  const createPipelineEnv = () =>
    new Bash({
      files: {
        "/input/data1.txt": `name: John Doe
age: 30
city: New York
occupation: Engineer`,
        "/input/data2.txt": `name: Jane Smith
age: 25
city: San Francisco
occupation: Designer`,
        "/input/data3.txt": `name: Bob Wilson
age: 35
city: Chicago
occupation: Manager`,
        "/scripts/merge.py": loadFixture("merge_files.py"),
        "/scripts/transform.py": loadFixture("transform_files.py"),
      },
      cwd: "/",
    });

  it("should merge multiple files into structured JSON", async () => {
    const env = createPipelineEnv();
    const result = await env.exec("python3 /scripts/merge.py");
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout);
    expect(output).toHaveLength(3);
    expect(output[0].name).toBe("John Doe");
    expect(output[0].age).toBe(30);
    expect(output[1].city).toBe("San Francisco");
    expect(result.exitCode).toBe(0);
  });

  it("should filter and transform data across files", async () => {
    const env = createPipelineEnv();
    const result = await env.exec("python3 /scripts/transform.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("John Doe (30) - Engineer in New York");
    expect(result.stdout).toContain("Bob Wilson (35) - Manager in Chicago");
    expect(result.stdout).not.toContain("Jane Smith");
    expect(result.stdout).toContain("Total: 2");
    expect(result.exitCode).toBe(0);
  });
});

describe("Agent Scenario: API Response Processing", () => {
  const createApiEnv = () =>
    new Bash({
      files: {
        "/api/response.json": `{
  "status": "success",
  "data": {
    "users": [
      {"id": 1, "name": "Alice", "posts": [{"id": 101, "title": "Hello World"}, {"id": 102, "title": "My Second Post"}]},
      {"id": 2, "name": "Bob", "posts": [{"id": 201, "title": "Introduction"}]},
      {"id": 3, "name": "Charlie", "posts": []}
    ],
    "pagination": {
      "page": 1,
      "total_pages": 5,
      "total_items": 45
    }
  }
}`,
        "/scripts/flatten.py": loadFixture("flatten_json.py"),
        "/scripts/stats.py": loadFixture("api_stats.py"),
      },
      cwd: "/api",
    });

  it("should flatten nested JSON structure", async () => {
    const env = createApiEnv();
    const result = await env.exec("python3 /scripts/flatten.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Flattened 4 records");
    expect(result.stdout).toContain("User Alice: Post #101: Hello World");
    expect(result.stdout).toContain("User Alice: Post #102: My Second Post");
    expect(result.stdout).toContain("User Bob: Post #201: Introduction");
    expect(result.stdout).toContain("User Charlie: No posts");
    expect(result.exitCode).toBe(0);
  });

  it("should extract statistics from API response", async () => {
    const env = createApiEnv();
    const result = await env.exec("python3 /scripts/stats.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Status: success");
    expect(result.stdout).toContain("Users in response: 3");
    expect(result.stdout).toContain("Users with posts: 2");
    expect(result.stdout).toContain("Total posts: 3");
    expect(result.stdout).toContain("Average posts per user: 1.0");
    expect(result.stdout).toContain("Page: 1 of 5");
    expect(result.exitCode).toBe(0);
  });
});

describe("Agent Scenario: Text Processing and Transformation", () => {
  const createTextEnv = () =>
    new Bash({
      files: {
        "/docs/README.md": `# Project Title

This is a sample project README.

## Features

- Feature one: Does something cool
- Feature two: Does something else
- Feature three: The best feature

## Installation

\`\`\`bash
npm install my-package
\`\`\`

## Usage

See the [documentation](https://docs.example.com) for more info.

## License

MIT License`,
        "/docs/CHANGELOG.md": `# Changelog

## [2.0.0] - 2024-01-15
### Added
- New feature X
- New feature Y

### Changed
- Improved performance

### Fixed
- Bug in module A
- Bug in module B

## [1.1.0] - 2024-01-01
### Added
- Feature Z

## [1.0.0] - 2023-12-01
### Added
- Initial release`,
        "/scripts/headers.py": loadFixture("parse_headers.py"),
        "/scripts/changelog.py": loadFixture("parse_changelog.py"),
        "/scripts/links.py": loadFixture("extract_links.py"),
      },
      cwd: "/docs",
    });

  it("should extract and count markdown headers", async () => {
    const env = createTextEnv();
    const result = await env.exec("python3 /scripts/headers.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("- Project Title");
    expect(result.stdout).toContain("  - Features");
    expect(result.stdout).toContain("  - Installation");
    expect(result.stdout).toContain("h1: 1");
    expect(result.stdout).toContain("h2: 4");
    expect(result.exitCode).toBe(0);
  });

  it("should parse changelog and extract versions", async () => {
    const env = createTextEnv();
    const result = await env.exec("python3 /scripts/changelog.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Found 3 versions");
    expect(result.stdout).toContain("v2.0.0");
    expect(result.stdout).toContain("v1.1.0");
    expect(result.stdout).toContain("v1.0.0");
    expect(result.exitCode).toBe(0);
  });

  it("should extract links from markdown", async () => {
    const env = createTextEnv();
    const result = await env.exec("python3 /scripts/links.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Found 1 links");
    expect(result.stdout).toContain(
      "[documentation] -> https://docs.example.com",
    );
    expect(result.exitCode).toBe(0);
  });
});

describe("Agent Scenario: Configuration Management", () => {
  const createConfigEnv = () =>
    new Bash({
      files: {
        "/config/base.json": `{
  "app": {
    "name": "MyApp",
    "version": "1.0.0"
  },
  "database": {
    "host": "localhost",
    "port": 5432
  },
  "features": {
    "caching": false,
    "logging": true
  }
}`,
        "/config/production.json": `{
  "database": {
    "host": "prod-db.example.com",
    "port": 5432,
    "ssl": true
  },
  "features": {
    "caching": true
  }
}`,
        "/config/.env.example": `DATABASE_URL=postgres://localhost:5432/myapp
API_KEY=your-api-key-here
DEBUG=false
LOG_LEVEL=info`,
        "/scripts/merge_config.py": loadFixture("merge_config.py"),
        "/scripts/parse_env.py": loadFixture("parse_env.py"),
      },
      cwd: "/config",
    });

  it("should merge configuration files with override", async () => {
    const env = createConfigEnv();
    const result = await env.exec("python3 /scripts/merge_config.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain('"name": "MyApp"');
    expect(result.stdout).toContain('"host": "prod-db.example.com"');
    expect(result.stdout).toContain('"ssl": true');
    expect(result.stdout).toContain('"caching": true');
    expect(result.stdout).toContain('"logging": true');
    expect(result.exitCode).toBe(0);
  });

  it("should validate and parse env file", async () => {
    const env = createConfigEnv();
    const result = await env.exec("python3 /scripts/parse_env.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      "DATABASE_URL=postgres://localhost:5432/myapp",
    );
    expect(result.stdout).toContain("API_KEY=***");
    expect(result.stdout).toContain("Total: 4 variables");
    expect(result.stdout).toContain("No issues found");
    expect(result.exitCode).toBe(0);
  });
});

describe("Agent Scenario: Data Validation and Cleaning", () => {
  const createValidationEnv = () =>
    new Bash({
      files: {
        "/data/users.csv": `id,email,phone,created_at
1,alice@example.com,555-1234,2024-01-15
2,notanemail,555-5678,2024-01-16
3,charlie@example.org,5559012,2024-01-17
4,,555-3456,2024-01-18
5,diana@example.com,123,2024-01-19
6,eve@test.co,555-7890,notadate`,
        "/scripts/validate.py": loadFixture("validate_data.py"),
      },
      cwd: "/data",
    });

  it("should validate data and report errors", async () => {
    const env = createValidationEnv();
    const result = await env.exec("python3 /scripts/validate.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Valid rows: 2");
    expect(result.stdout).toContain("Invalid rows: 4");
    expect(result.stdout).toContain("Row 2: email: Invalid format");
    expect(result.stdout).toContain("Row 4: email: Empty email");
    expect(result.stdout).toContain("Row 5: phone: Invalid length");
    expect(result.stdout).toContain("Row 6: date: Invalid format");
    expect(result.exitCode).toBe(0);
  });
});
