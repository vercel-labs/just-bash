import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";

// Store original fetch
const originalFetch = global.fetch;

// Minimal OpenAPI spec for testing
const minimalOpenApiSpec = {
  openapi: "3.0.0",
  info: {
    title: "Test API",
    version: "1.0.0",
  },
  servers: [{ url: "https://api.example.com" }],
  paths: {
    "/users": {
      get: {
        operationId: "listUsers",
        tags: ["users"],
        summary: "List all users",
        responses: {
          "200": {
            description: "Success",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { type: "object" },
                },
              },
            },
          },
        },
      },
    },
    "/users/{id}": {
      get: {
        operationId: "getUser",
        tags: ["users"],
        summary: "Get user by ID",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "Success" },
        },
      },
    },
  },
};

// OpenAPI spec with security for auth tests
const securedOpenApiSpec = {
  openapi: "3.0.0",
  info: {
    title: "Test API",
    version: "1.0.0",
  },
  servers: [{ url: "https://api.example.com" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/users": {
      get: {
        operationId: "listUsers",
        tags: ["users"],
        summary: "List all users",
        responses: {
          "200": { description: "Success" },
        },
      },
    },
  },
};

// Mock fetch implementation
function createMockFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(
    async (url: string | URL | Request, _init?: RequestInit) => {
      const urlString = typeof url === "string" ? url : url.toString();

      // Mock API responses
      if (urlString === "https://api.example.com/users") {
        return new Response(JSON.stringify([{ id: "1", name: "Alice" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (urlString.startsWith("https://api.example.com/users/")) {
        const id = urlString.split("/").pop();
        return new Response(JSON.stringify({ id, name: "User" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  );
}

describe("specli", () => {
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeAll(() => {
    mockFetch = createMockFetch();
    global.fetch = mockFetch as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("help", () => {
    it("should show help with --help", async () => {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec("specli --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("specli");
      expect(result.stdout).toContain("Turn any OpenAPI spec into a CLI");
      expect(result.stderr).toBe("");
    });

    it("should error without subcommand", async () => {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec("specli");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing subcommand");
    });

    it("should error on unknown subcommand", async () => {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec("specli unknown");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("invalid option");
    });

    it("should error on compile (not supported)", async () => {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec("specli compile ./spec.json");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not supported");
      expect(result.stderr).toContain("requires Bun");
    });
  });

  describe("exec without network", () => {
    it("should not be available when network not configured", async () => {
      const env = new Bash();
      const result = await env.exec("specli exec ./spec.json __schema");
      // specli is only registered when network is configured
      expect(result.exitCode).toBe(127);
      expect(result.stderr).toContain("command not found");
    });
  });

  describe("exec with file spec", () => {
    it("should list schema with __schema", async () => {
      const env = new Bash({
        files: {
          "/spec.json": JSON.stringify(minimalOpenApiSpec),
        },
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });

      const result = await env.exec("specli exec /spec.json __schema");
      expect(result.exitCode).toBe(0);
      // Schema output shows title, resources summary, and hints
      expect(result.stdout).toContain("Test API");
      expect(result.stdout).toContain("users");
      expect(result.stdout).toContain("Resources:");
      expect(result.stderr).toBe("");
    });

    it("should list schema with __schema --json", async () => {
      const env = new Bash({
        files: {
          "/spec.json": JSON.stringify(minimalOpenApiSpec),
        },
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });

      const result = await env.exec("specli exec /spec.json __schema --json");
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      // JSON schema output is an object with title, version, resources, etc.
      expect(parsed.ok).toBe(true);
      expect(parsed.data).toBeDefined();
      expect(parsed.data.title).toBe("Test API");
      expect(result.stderr).toBe("");
    });

    it("should show resource actions when only resource given", async () => {
      const env = new Bash({
        files: {
          "/spec.json": JSON.stringify(minimalOpenApiSpec),
        },
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });

      const result = await env.exec("specli exec /spec.json users");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("users actions");
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("get");
      expect(result.stderr).toBe("");
    });

    it("should error on unknown resource", async () => {
      const env = new Bash({
        files: {
          "/spec.json": JSON.stringify(minimalOpenApiSpec),
        },
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });

      const result = await env.exec("specli exec /spec.json unknown");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown resource");
    });

    it("should execute API call", async () => {
      mockFetch.mockClear();
      const env = new Bash({
        files: {
          "/spec.json": JSON.stringify(minimalOpenApiSpec),
        },
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });

      const result = await env.exec("specli exec /spec.json users list");
      expect(result.exitCode).toBe(0);
      expect(mockFetch).toHaveBeenCalled();
      // Result should contain the mock response
      expect(result.stdout).toContain("Alice");
      expect(result.stderr).toBe("");
    });

    it("should execute API call with path parameter", async () => {
      mockFetch.mockClear();
      const env = new Bash({
        files: {
          "/spec.json": JSON.stringify(minimalOpenApiSpec),
        },
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });

      const result = await env.exec("specli exec /spec.json users get abc123");
      expect(result.exitCode).toBe(0);
      expect(mockFetch).toHaveBeenCalled();
      // Check that the URL included the path parameter
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("abc123");
      expect(result.stderr).toBe("");
    });

    it("should execute API call with --json output", async () => {
      mockFetch.mockClear();
      const env = new Bash({
        files: {
          "/spec.json": JSON.stringify(minimalOpenApiSpec),
        },
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });

      const result = await env.exec("specli exec /spec.json users list --json");
      expect(result.exitCode).toBe(0);
      // JSON output should be parseable
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toBeDefined();
      expect(result.stderr).toBe("");
    });

    it("should error on missing spec file", async () => {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });

      const result = await env.exec("specli exec /missing.json __schema");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("ENOENT");
    });
  });

  describe("exec argument parsing", () => {
    it("should error when spec is missing", async () => {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });

      const result = await env.exec("specli exec");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing spec");
    });

    it("should error when resource is missing", async () => {
      const env = new Bash({
        files: {
          "/spec.json": JSON.stringify(minimalOpenApiSpec),
        },
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });

      const result = await env.exec("specli exec /spec.json");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing resource");
    });
  });

  describe("authentication options", () => {
    it("should pass bearer token when spec has security scheme", async () => {
      mockFetch.mockClear();
      const env = new Bash({
        files: {
          "/spec.json": JSON.stringify(securedOpenApiSpec),
        },
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });

      const result = await env.exec(
        "specli exec /spec.json users list --bearer-token mytoken123",
      );
      expect(result.exitCode).toBe(0);
      // The token should be passed through to the fetch call via our wrapper
      // Our wrapper extracts headers from the Request object
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
