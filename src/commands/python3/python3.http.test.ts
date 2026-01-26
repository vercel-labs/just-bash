import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Bash } from "../../Bash.js";

// Mock fetch to avoid real network requests
const originalFetch = global.fetch;
const mockFetch = vi.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  mockFetch.mockClear();
});

describe("python3 HTTP requests", () => {
  describe("jb_http module", () => {
    it("should make a GET request", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{"url": "https://api.example.com/get"}', {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
        }),
      );
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com/"],
        },
      });
      await env.exec(`cat > /tmp/test_get.py << 'EOF'
import jb_http
response = jb_http.get("https://api.example.com/get")
print(response.status_code)
print(response.ok)
EOF`);
      const result = await env.exec(`python3 /tmp/test_get.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("200\nTrue\n");
      expect(result.exitCode).toBe(0);
    });

    it("should return response headers", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response("body", {
          status: 200,
          headers: { "content-type": "text/plain", "x-custom": "value" },
        }),
      );
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com/"],
        },
      });
      // Use -c instead of file to eliminate file I/O as a variable
      const result = await env.exec(`python3 -c "
import jb_http
response = jb_http.get('https://api.example.com/get')
print('content-type' in response.headers)
"`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("True\n");
      expect(result.exitCode).toBe(0);
    });

    it("should parse JSON response", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{"key": "value", "number": 42}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com/"],
        },
      });
      await env.exec(`cat > /tmp/test_json.py << 'EOF'
import jb_http
response = jb_http.get("https://api.example.com/json")
data = response.json()
print(type(data).__name__)
print(data["key"])
EOF`);
      const result = await env.exec(`python3 /tmp/test_json.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("dict\nvalue\n");
      expect(result.exitCode).toBe(0);
    });

    it("should send custom headers", async () => {
      mockFetch.mockImplementationOnce(async (_url, options) => {
        const headers = options?.headers as Record<string, string>;
        return new Response(
          JSON.stringify({ headers: { "X-Custom": headers?.["X-Custom"] } }),
          { status: 200 },
        );
      });
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com/"],
        },
      });
      await env.exec(`cat > /tmp/test_custom_headers.py << 'EOF'
import jb_http
response = jb_http.get("https://api.example.com/headers", headers={"X-Custom": "test-value"})
data = response.json()
print(data["headers"].get("X-Custom", "not found"))
EOF`);
      const result = await env.exec(`python3 /tmp/test_custom_headers.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("test-value\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle 404 responses", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response("Not Found", {
          status: 404,
          statusText: "Not Found",
        }),
      );
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com/"],
        },
      });
      await env.exec(`cat > /tmp/test_404.py << 'EOF'
import jb_http
response = jb_http.get("https://api.example.com/notfound")
print(response.status_code)
print(response.ok)
EOF`);
      const result = await env.exec(`python3 /tmp/test_404.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("404\nFalse\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle raise_for_status", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response("Server Error", {
          status: 500,
          statusText: "Internal Server Error",
        }),
      );
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com/"],
        },
      });
      await env.exec(`cat > /tmp/test_raise.py << 'EOF'
import jb_http
response = jb_http.get("https://api.example.com/error")
try:
    response.raise_for_status()
    print("no error")
except Exception as e:
    print("error raised")
EOF`);
      const result = await env.exec(`python3 /tmp/test_raise.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("error raised\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("network access denied", () => {
    it("should fail when network not configured", async () => {
      const env = new Bash(); // No network config
      await env.exec(`cat > /tmp/test_no_network.py << 'EOF'
import jb_http
try:
    response = jb_http.get("https://example.com/")
    print("success")
except Exception as e:
    print("network error")
EOF`);
      const result = await env.exec(`python3 /tmp/test_no_network.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("network error\n");
      expect(result.exitCode).toBe(0);
    });

    it("should fail for URLs not in allow-list", async () => {
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com/"],
        },
      });
      await env.exec(`cat > /tmp/test_blocked.py << 'EOF'
import jb_http
try:
    response = jb_http.get("https://blocked.com/")
    print("success")
except Exception as e:
    print("access denied")
EOF`);
      const result = await env.exec(`python3 /tmp/test_blocked.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("access denied\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("POST requests", () => {
    it("should send POST with form data", async () => {
      mockFetch.mockImplementationOnce(async (_url, options) => {
        return new Response(JSON.stringify({ data: options?.body }), {
          status: 200,
        });
      });
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com/"],
          allowedMethods: ["GET", "POST"],
        },
      });
      await env.exec(`cat > /tmp/test_post.py << 'EOF'
import jb_http
response = jb_http.post("https://api.example.com/post", data="hello=world")
print(response.status_code)
EOF`);
      const result = await env.exec(`python3 /tmp/test_post.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("200\n");
      expect(result.exitCode).toBe(0);
    });

    it("should send POST with JSON", async () => {
      mockFetch.mockImplementationOnce(async (_url, options) => {
        const body = JSON.parse(options?.body as string);
        return new Response(JSON.stringify({ json: body }), { status: 200 });
      });
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com/"],
          allowedMethods: ["GET", "POST"],
        },
      });
      await env.exec(`cat > /tmp/test_post_json.py << 'EOF'
import jb_http
response = jb_http.post("https://api.example.com/post", json={"key": "value"})
data = response.json()
print(data["json"]["key"])
EOF`);
      const result = await env.exec(`python3 /tmp/test_post_json.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("value\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("other HTTP methods", () => {
    it("should make HEAD request", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response("", {
          status: 200,
          headers: { "content-length": "1234" },
        }),
      );
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com/"],
          allowedMethods: ["GET", "HEAD"],
        },
      });
      await env.exec(`cat > /tmp/test_head.py << 'EOF'
import jb_http
response = jb_http.head("https://api.example.com/resource")
print(response.status_code)
print(len(response.text))
EOF`);
      const result = await env.exec(`python3 /tmp/test_head.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("200\n0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should make PUT request", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{"updated": true}', { status: 200 }),
      );
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com/"],
          allowedMethods: ["GET", "PUT"],
        },
      });
      await env.exec(`cat > /tmp/test_put.py << 'EOF'
import jb_http
response = jb_http.put("https://api.example.com/resource", json={"update": "data"})
print(response.status_code)
EOF`);
      const result = await env.exec(`python3 /tmp/test_put.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("200\n");
      expect(result.exitCode).toBe(0);
    });

    it("should make DELETE request", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{"deleted": true}', { status: 200 }),
      );
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com/"],
          allowedMethods: ["GET", "DELETE"],
        },
      });
      await env.exec(`cat > /tmp/test_delete.py << 'EOF'
import jb_http
response = jb_http.delete("https://api.example.com/resource")
print(response.status_code)
EOF`);
      const result = await env.exec(`python3 /tmp/test_delete.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("200\n");
      expect(result.exitCode).toBe(0);
    });

    it("should make PATCH request", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{"patched": true}', { status: 200 }),
      );
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com/"],
          allowedMethods: ["GET", "PATCH"],
        },
      });
      await env.exec(`cat > /tmp/test_patch.py << 'EOF'
import jb_http
response = jb_http.patch("https://api.example.com/resource", json={"partial": "update"})
print(response.status_code)
EOF`);
      const result = await env.exec(`python3 /tmp/test_patch.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("200\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("integration with file system", () => {
    it("should download and save to file", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{"slideshow": {"title": "Test"}}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com/"],
        },
      });
      await env.exec(`cat > /tmp/test_download.py << 'EOF'
import jb_http
response = jb_http.get("https://api.example.com/json")
with open("/tmp/downloaded.json", "w") as f:
    f.write(response.text)
print("saved")
EOF`);
      const pyResult = await env.exec(`python3 /tmp/test_download.py`);
      expect(pyResult.stderr).toBe("");
      expect(pyResult.stdout).toBe("saved\n");

      // Verify the file was saved
      const catResult = await env.exec(`cat /tmp/downloaded.json`);
      expect(catResult.stdout).toContain("slideshow");
    });
  });
});
