import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("help", () => {
  describe("list all commands", () => {
    it("should list available commands", async () => {
      const env = new Bash();
      const result = await env.exec("help");
      expect(result.stdout).toContain("Available commands");
      expect(result.exitCode).toBe(0);
    });

    it("should show file operations category", async () => {
      const env = new Bash();
      const result = await env.exec("help");
      expect(result.stdout).toContain("File operations");
      expect(result.stdout).toContain("ls");
      expect(result.stdout).toContain("cat");
    });

    it("should show text processing category", async () => {
      const env = new Bash();
      const result = await env.exec("help");
      expect(result.stdout).toContain("Text processing");
      expect(result.stdout).toContain("grep");
      expect(result.stdout).toContain("sed");
    });

    it("should show usage hint", async () => {
      const env = new Bash();
      const result = await env.exec("help");
      expect(result.stdout).toContain("--help");
    });
  });

  describe("help for specific command", () => {
    it("should show help for ls", async () => {
      const env = new Bash();
      const result = await env.exec("help ls");
      expect(result.stdout).toContain("ls");
      expect(result.exitCode).toBe(0);
    });

    it("should show help for grep", async () => {
      const env = new Bash();
      const result = await env.exec("help grep");
      expect(result.stdout).toContain("grep");
      expect(result.exitCode).toBe(0);
    });

    it("should error for unknown command", async () => {
      const env = new Bash();
      const result = await env.exec("help nonexistent");
      expect(result.exitCode).toBe(127);
    });
  });

  describe("--help flag", () => {
    it("should show help's own help", async () => {
      const env = new Bash();
      const result = await env.exec("help --help");
      expect(result.stdout).toContain("help");
      expect(result.stdout).toContain("Usage");
      expect(result.exitCode).toBe(0);
    });

    it("should support -h flag", async () => {
      const env = new Bash();
      const result = await env.exec("help -h");
      expect(result.stdout).toContain("help");
      expect(result.exitCode).toBe(0);
    });
  });
});
