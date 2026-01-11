import path from "node:path";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { OverlayFs } from "../../fs/overlay-fs/overlay-fs.js";

const fixturesDir = path.join(import.meta.dirname, "fixtures");

describe("sqlite3 with fixtures", () => {
  describe("users.db", () => {
    it("should query all users", async () => {
      const fs = new OverlayFs({ root: fixturesDir });
      const env = new Bash({ fs, cwd: fs.getMountPoint() });

      const result = await env.exec('sqlite3 users.db "SELECT * FROM users"');
      expect(result.stdout).toBe(
        "1|Alice|alice@example.com|30|1\n" +
          "2|Bob|bob@example.com|25|1\n" +
          "3|Charlie|charlie@example.com|35|0\n" +
          "4|Diana|diana@example.com|28|1\n",
      );
      expect(result.exitCode).toBe(0);
    });

    it("should filter users with WHERE clause", async () => {
      const fs = new OverlayFs({ root: fixturesDir });
      const env = new Bash({ fs, cwd: fs.getMountPoint() });

      const result = await env.exec(
        'sqlite3 users.db "SELECT name, age FROM users WHERE active = 1 ORDER BY age"',
      );
      expect(result.stdout).toBe("Bob|25\nDiana|28\nAlice|30\n");
      expect(result.exitCode).toBe(0);
    });

    it("should aggregate users with COUNT", async () => {
      const fs = new OverlayFs({ root: fixturesDir });
      const env = new Bash({ fs, cwd: fs.getMountPoint() });

      const result = await env.exec(
        'sqlite3 users.db "SELECT COUNT(*) FROM users WHERE active = 1"',
      );
      expect(result.stdout).toBe("3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should output users as JSON", async () => {
      const fs = new OverlayFs({ root: fixturesDir });
      const env = new Bash({ fs, cwd: fs.getMountPoint() });

      const result = await env.exec(
        'sqlite3 -json users.db "SELECT id, name FROM users WHERE id = 1"',
      );
      expect(result.stdout).toBe('[{"id":1,"name":"Alice"}]\n');
      expect(result.exitCode).toBe(0);
    });
  });

  describe("products.db", () => {
    it("should query all products", async () => {
      const fs = new OverlayFs({ root: fixturesDir });
      const env = new Bash({ fs, cwd: fs.getMountPoint() });

      const result = await env.exec(
        'sqlite3 products.db "SELECT name, price FROM products ORDER BY price DESC"',
      );
      // Full IEEE 754 precision for floats
      expect(result.stdout).toBe(
        "Laptop|999.99000000000001\nPhone|699.5\nHeadphones|149.99000000000001\nPython Book|49.990000000000002\nT-Shirt|19.989999999999998\n",
      );
      expect(result.exitCode).toBe(0);
    });

    it("should join products with categories", async () => {
      const fs = new OverlayFs({ root: fixturesDir });
      const env = new Bash({ fs, cwd: fs.getMountPoint() });

      const result = await env.exec(
        "sqlite3 products.db \"SELECT p.name, c.name FROM products p JOIN categories c ON p.category_id = c.id WHERE c.name = 'Electronics' ORDER BY p.name\"",
      );
      expect(result.stdout).toBe(
        "Headphones|Electronics\nLaptop|Electronics\nPhone|Electronics\n",
      );
      expect(result.exitCode).toBe(0);
    });

    it("should calculate sum with GROUP BY", async () => {
      const fs = new OverlayFs({ root: fixturesDir });
      const env = new Bash({ fs, cwd: fs.getMountPoint() });

      const result = await env.exec(
        'sqlite3 -header products.db "SELECT c.name, SUM(p.price) as total FROM products p JOIN categories c ON p.category_id = c.id GROUP BY c.name ORDER BY total DESC"',
      );
      expect(result.stdout).toContain("Electronics");
      expect(result.stdout).toContain("1849.48"); // 999.99 + 699.5 + 149.99
      expect(result.exitCode).toBe(0);
    });

    it("should output products in box mode", async () => {
      const fs = new OverlayFs({ root: fixturesDir });
      const env = new Bash({ fs, cwd: fs.getMountPoint() });

      const result = await env.exec(
        'sqlite3 -box products.db "SELECT id, name FROM products WHERE id <= 2"',
      );
      expect(result.stdout).toContain("┌");
      expect(result.stdout).toContain("│");
      expect(result.stdout).toContain("Laptop");
      expect(result.stdout).toContain("Phone");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("datatypes.db", () => {
    it("should handle NULL values", async () => {
      const fs = new OverlayFs({ root: fixturesDir });
      const env = new Bash({ fs, cwd: fs.getMountPoint() });

      const result = await env.exec(
        'sqlite3 -nullvalue "NULL" datatypes.db "SELECT int_val, real_val, text_val FROM mixed WHERE id = 2"',
      );
      expect(result.stdout).toBe("NULL|NULL|NULL\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle different numeric types", async () => {
      const fs = new OverlayFs({ root: fixturesDir });
      const env = new Bash({ fs, cwd: fs.getMountPoint() });

      const result = await env.exec(
        'sqlite3 -json datatypes.db "SELECT int_val, real_val FROM mixed WHERE id IN (1, 3, 4) ORDER BY id"',
      );
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveLength(3);
      expect(parsed[0]).toEqual({ int_val: 42, real_val: 3.14 });
      expect(parsed[1]).toEqual({ int_val: -100, real_val: 0.001 });
      expect(parsed[2]).toEqual({ int_val: 0, real_val: -99.99 });
      expect(result.exitCode).toBe(0);
    });

    it("should handle empty strings vs NULL", async () => {
      const fs = new OverlayFs({ root: fixturesDir });
      const env = new Bash({ fs, cwd: fs.getMountPoint() });

      const result = await env.exec(
        'sqlite3 -nullvalue "NULL" datatypes.db "SELECT id, text_val FROM mixed WHERE text_val IS NULL OR text_val = \'\' ORDER BY id"',
      );
      expect(result.stdout).toBe("2|NULL\n4|\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("read-only access", () => {
    it("should not modify fixture with -readonly", async () => {
      const fs = new OverlayFs({ root: fixturesDir });
      const env = new Bash({ fs, cwd: fs.getMountPoint() });

      // Try to insert with readonly
      await env.exec(
        "sqlite3 -readonly users.db \"INSERT INTO users (name, email, age) VALUES ('Test', 'test@test.com', 99)\"",
      );

      // Verify original data unchanged
      const result = await env.exec(
        'sqlite3 users.db "SELECT COUNT(*) FROM users"',
      );
      expect(result.stdout).toBe("4\n");
      expect(result.exitCode).toBe(0);
    });

    it("should allow writes to overlay (not persisted to disk)", async () => {
      const fs = new OverlayFs({ root: fixturesDir });
      const env = new Bash({ fs, cwd: fs.getMountPoint() });

      // Insert new user
      await env.exec(
        "sqlite3 users.db \"INSERT INTO users (name, email, age) VALUES ('Test', 'test@test.com', 99)\"",
      );

      // Should see new user in same session
      const result = await env.exec(
        "sqlite3 users.db \"SELECT name FROM users WHERE email = 'test@test.com'\"",
      );
      expect(result.stdout).toBe("Test\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("schema queries", () => {
    it("should list tables", async () => {
      const fs = new OverlayFs({ root: fixturesDir });
      const env = new Bash({ fs, cwd: fs.getMountPoint() });

      const result = await env.exec(
        "sqlite3 products.db \"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\"",
      );
      expect(result.stdout).toBe("categories\nproducts\n");
      expect(result.exitCode).toBe(0);
    });

    it("should describe table schema", async () => {
      const fs = new OverlayFs({ root: fixturesDir });
      const env = new Bash({ fs, cwd: fs.getMountPoint() });

      const result = await env.exec(
        'sqlite3 users.db "PRAGMA table_info(users)"',
      );
      expect(result.stdout).toContain("id");
      expect(result.stdout).toContain("name");
      expect(result.stdout).toContain("email");
      expect(result.stdout).toContain("INTEGER");
      expect(result.stdout).toContain("TEXT");
      expect(result.exitCode).toBe(0);
    });
  });
});
