/**
 * Tests for yq command using fixture files
 *
 * Tests various input formats (YAML, JSON, XML, INI, CSV) and
 * format conversion capabilities.
 *
 * Each test run writes companion .parsed.json files showing the internal
 * representation of each format after parsing.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const fixturesDir = path.join(import.meta.dirname, "fixtures");

type Format = "yaml" | "json" | "xml" | "ini" | "csv" | "toml";

interface FixtureFile {
  format: Format;
  name: string;
  path: string;
  virtualPath: string;
  content: string;
}

/**
 * Load all fixtures from format subdirectories
 */
function loadFixtures(): {
  files: Record<string, string>;
  fixtures: FixtureFile[];
} {
  const files: Record<string, string> = {};
  const fixtures: FixtureFile[] = [];

  const formats: Format[] = ["yaml", "json", "xml", "ini", "csv", "toml"];

  for (const format of formats) {
    const formatDir = path.join(fixturesDir, format);
    if (!fs.existsSync(formatDir)) continue;

    for (const file of fs.readdirSync(formatDir)) {
      if (file.endsWith(".parsed.json")) continue; // Skip generated files

      const filePath = path.join(formatDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const virtualPath = `/fixtures/${format}/${file}`;

      files[virtualPath] = content;
      fixtures.push({
        format,
        name: file,
        path: filePath,
        virtualPath,
        content,
      });
    }
  }

  return { files, fixtures };
}

/**
 * Write the parsed JSON representation of a fixture file
 */
async function writeParsedJson(
  bash: Bash,
  fixture: FixtureFile,
): Promise<void> {
  const formatFlag = fixture.format === "yaml" ? "" : `-p ${fixture.format}`;
  const cmd = `yq ${formatFlag} '.' '${fixture.virtualPath}' -o json`.trim();

  const result = await bash.exec(cmd);

  if (result.exitCode === 0 && result.stdout.trim()) {
    const parsedPath = fixture.path.replace(/\.[^.]+$/, ".parsed.json");
    try {
      // Pretty print the JSON
      const parsed = JSON.parse(result.stdout);
      fs.writeFileSync(parsedPath, `${JSON.stringify(parsed, null, 2)}\n`);
    } catch {
      // If JSON parsing fails, write raw output
      fs.writeFileSync(parsedPath, result.stdout);
    }
  }
}

describe("yq fixtures", () => {
  const { files, fixtures } = loadFixtures();

  // Generate parsed JSON files for all fixtures before tests run
  beforeAll(async () => {
    const bash = new Bash({ files });

    for (const fixture of fixtures) {
      await writeParsedJson(bash, fixture);
    }
  });

  describe("YAML fixtures", () => {
    it("should extract user names from users.yaml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.users[].name' /fixtures/yaml/users.yaml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("alice\nbob\ncharlie\n");
    });

    it("should filter active users from users.yaml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '[.users[] | select(.active)] | length' /fixtures/yaml/users.yaml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("2\n");
    });

    it("should get metadata version from users.yaml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.metadata.version' /fixtures/yaml/users.yaml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("1\n");
    });

    it("should extract tags from simple.yaml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec("yq '.tags[]' /fixtures/yaml/simple.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("important\nfeatured\nnew\n");
    });
  });

  describe("JSON fixtures", () => {
    it("should extract user emails from users.json", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p json '.users[].email' /fixtures/json/users.json",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("alice@example.com");
      expect(result.stdout).toContain("bob@example.com");
    });

    it("should get department names from nested.json", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p json '.company.departments[].name' /fixtures/json/nested.json",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Engineering\nSales\nMarketing\n");
    });

    it("should calculate total employees from nested.json", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p json '[.company.departments[].employees] | add' /fixtures/json/nested.json",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("100\n");
    });

    it("should find departments with budget > 250000", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p json '[.company.departments[] | select(.budget > 250000) | .name]' /fixtures/json/nested.json -o json",
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(["Engineering", "Sales"]);
    });
  });

  describe("XML fixtures", () => {
    it("should extract book titles from books.xml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p xml '.library.book[].title' /fixtures/xml/books.xml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("The Great Adventure");
      expect(result.stdout).toContain("Learning TypeScript");
      expect(result.stdout).toContain("Mystery Manor");
    });

    it("should get book by ID attribute from books.xml", async () => {
      const bash = new Bash({ files });
      // XML attributes are strings; use -o json to verify
      const result = await bash.exec(
        "yq -p xml '.library.book[0][\"+@id\"]' /fixtures/xml/books.xml -o json",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('"1"\n');
    });

    it("should filter fiction books from books.xml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        'yq -p xml \'[.library.book[] | select(.["+@genre"] == "fiction") | .title]\' /fixtures/xml/books.xml -o json',
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([
        "The Great Adventure",
        "Mystery Manor",
      ]);
    });

    it("should extract user names from users.xml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p xml '.root.users.user[].name' /fixtures/xml/users.xml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("alice\nbob\ncharlie\n");
    });
  });

  describe("INI fixtures", () => {
    it("should get database host from config.ini", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p ini '.database.host' /fixtures/ini/config.ini",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("localhost\n");
    });

    it("should get server port from config.ini", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p ini '.server.port' /fixtures/ini/config.ini",
      );
      expect(result.exitCode).toBe(0);
      // INI values are strings
      expect(result.stdout.trim()).toMatch(/8080/);
    });

    it("should get all section keys from config.ini", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p ini 'keys' /fixtures/ini/config.ini",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("database");
      expect(result.stdout).toContain("server");
      expect(result.stdout).toContain("logging");
    });

    it("should get top-level name from app.ini", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec("yq -p ini '.name' /fixtures/ini/app.ini");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("MyApp\n");
    });

    it("should get feature flags from app.ini", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p ini '.features' /fixtures/ini/app.ini -o json",
      );
      expect(result.exitCode).toBe(0);
      const features = JSON.parse(result.stdout);
      expect(features.dark_mode).toBe(true);
      expect(features.notifications).toBe(true);
      expect(features.analytics).toBe(false);
    });
  });

  describe("CSV fixtures", () => {
    it("should get first user name from users.csv", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p csv '.[0].name' /fixtures/csv/users.csv",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("alice\n");
    });

    it("should get all user ages from users.csv", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p csv '.[].age' /fixtures/csv/users.csv",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("30\n25\n35\n");
    });

    it("should filter electronics products from products.csv", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p csv '[.[] | select(.category == \"electronics\") | .name]' /fixtures/csv/products.csv -o json",
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(["Widget", "Gadget", "Doodad"]);
    });

    it("should calculate total price of in-stock items from products.csv", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p csv '[.[] | select(.in_stock == true) | .price] | add' /fixtures/csv/products.csv",
      );
      expect(result.exitCode).toBe(0);
      // Widget (19.99) + Gadget (29.99) + Doodad (49.99) + Thingamajig (14.99) = 114.96
      expect(Number.parseFloat(result.stdout.trim())).toBeCloseTo(114.96, 2);
    });

    it("should get product count from products.csv", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p csv 'length' /fixtures/csv/products.csv",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("5\n");
    });
  });

  describe("TOML fixtures", () => {
    it("should get package name from cargo.toml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.package.name' /fixtures/toml/cargo.toml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("my-rust-app\n");
    });

    it("should get package version from cargo.toml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.package.version' /fixtures/toml/cargo.toml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("1.2.3\n");
    });

    it("should get dependency versions from cargo.toml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.dependencies.serde.version' /fixtures/toml/cargo.toml -o json -r",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("1.0\n");
    });

    it("should get project name from pyproject.toml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.project.name' /fixtures/toml/pyproject.toml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("my-python-app\n");
    });

    it("should get author emails from pyproject.toml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.project.authors[].email' /fixtures/toml/pyproject.toml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("alice@example.com");
      expect(result.stdout).toContain("bob@example.com");
    });

    it("should get database settings from config.toml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.database.max_connections' /fixtures/toml/config.toml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("100\n");
    });

    it("should get nested pool settings from config.toml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.database.pool.max_size' /fixtures/toml/config.toml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("50\n");
    });

    it("should get feature flags from config.toml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.features' /fixtures/toml/config.toml -o json",
      );
      expect(result.exitCode).toBe(0);
      const features = JSON.parse(result.stdout);
      expect(features.dark_mode).toBe(true);
      expect(features.analytics).toBe(false);
    });

    it("should handle array of tables from special.toml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.products[].name' /fixtures/toml/special.toml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Widget\nGadget\nDoodad\n");
    });

    it("should handle inline tables from special.toml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.inline.name' /fixtures/toml/special.toml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("inline\n");
    });

    it("should handle unicode from special.toml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.unicode' /fixtures/toml/special.toml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Hello");
    });

    it("should convert TOML to JSON", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.server' /fixtures/toml/config.toml -o json",
      );
      expect(result.exitCode).toBe(0);
      const server = JSON.parse(result.stdout);
      expect(server.host).toBe("localhost");
      expect(server.port).toBe(8080);
    });
  });

  describe("format conversion", () => {
    it("should convert YAML to JSON", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.title' /fixtures/yaml/simple.yaml -o json -r",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Simple Document\n");
    });

    it("should convert JSON to YAML", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p json '.company.name' /fixtures/json/nested.json",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Acme Corp\n");
    });

    it("should convert CSV to JSON", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p csv '.[0]' /fixtures/csv/users.csv -o json",
      );
      expect(result.exitCode).toBe(0);
      const user = JSON.parse(result.stdout);
      expect(user.name).toBe("alice");
      expect(user.age).toBe(30);
    });

    it("should convert JSON to CSV", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p json '.users' /fixtures/json/users.json -o csv",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("name,age,email,active");
      expect(result.stdout).toContain("alice,30");
    });

    it("should convert YAML to INI", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.' /fixtures/yaml/simple.yaml -o ini",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("title=Simple Document");
      expect(result.stdout).toContain("count=42");
    });

    it("should convert INI to JSON", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p ini '.' /fixtures/ini/config.ini -o json",
      );
      expect(result.exitCode).toBe(0);
      const config = JSON.parse(result.stdout);
      expect(config.database.host).toBe("localhost");
      // INI values are strings
      expect(config.server.port).toBe("8080");
    });

    it("should convert XML to JSON", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p xml '.library.book[0].title' /fixtures/xml/books.xml -o json -r",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("The Great Adventure\n");
    });

    it("should convert YAML to TOML", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.' /fixtures/yaml/simple.yaml -o toml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('title = "Simple Document"');
      expect(result.stdout).toContain("count = 42");
    });

    it("should convert TOML to YAML", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec("yq '.' /fixtures/toml/config.toml");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("server:");
      expect(result.stdout).toContain("host: localhost");
    });
  });

  describe("special YAML cases", () => {
    it("should handle empty string", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.empty_string' /fixtures/yaml/special.yaml -o json",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('""');
    });

    it("should handle null value", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.null_value' /fixtures/yaml/special.yaml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("null");
    });

    it("should handle multiline string", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.multiline' /fixtures/yaml/special.yaml -o json -r",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("multiline string");
    });

    it("should handle nested arrays", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.nested_arrays[0][1]' /fixtures/yaml/special.yaml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("2");
    });

    it("should handle YAML anchors and references", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.reference.shared' /fixtures/yaml/special.yaml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("data");
    });
  });

  describe("special JSON cases", () => {
    it("should handle deeply nested structures", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p json '.deeply.nested.structure.value' /fixtures/json/special.json",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("found it");
    });

    it("should handle keys with special characters", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p json '.objects[\"with-dash\"]' /fixtures/json/special.json",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("value");
    });

    it("should handle mixed arrays", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p json '.arrays.mixed | length' /fixtures/json/special.json",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("5");
    });

    it("should handle unicode", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p json '.unicode' /fixtures/json/special.json -r",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Hello");
    });
  });

  describe("special XML cases", () => {
    it("should handle self-closing tags", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p xml '.root | has(\"self-closing\")' /fixtures/xml/special.xml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("true");
    });

    it("should handle multiple attributes", async () => {
      const bash = new Bash({ files });
      // XML attributes are strings; use -o json to verify
      const result = await bash.exec(
        'yq -p xml \'.root["multiple-attrs"]["+@id"]\' /fixtures/xml/special.xml -o json',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('"1"');
    });

    it("should handle deeply nested XML", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p xml '.root.nested.level1.level2.level3' /fixtures/xml/special.xml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("deep value");
    });

    it("should handle repeated elements as array", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p xml '.root.repeated.item | length' /fixtures/xml/special.xml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("3");
    });
  });

  describe("special INI cases", () => {
    it("should handle global keys before sections", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p ini '.global_key' /fixtures/ini/special.ini",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("global_value");
    });

    it("should handle various boolean formats", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p ini '.booleans' /fixtures/ini/special.ini -o json",
      );
      expect(result.exitCode).toBe(0);
      const bools = JSON.parse(result.stdout);
      // ini package parses "true"/"false" as actual booleans
      expect(bools.true_val).toBe(true);
      expect(bools.yes_val).toBe("yes"); // "yes" stays as string
    });

    it("should handle paths with special characters", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p ini '.paths.url' /fixtures/ini/special.ini",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("https://example.com");
    });
  });

  describe("special CSV cases", () => {
    it("should handle quoted values with commas", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p csv '.[1].name' /fixtures/csv/special.csv",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("With, comma");
    });

    it("should handle escaped quotes", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p csv '.[2].name' /fixtures/csv/special.csv",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("quotes");
    });

    it("should auto-detect semicolon delimiter", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p csv '.[0].name' /fixtures/csv/semicolon.csv",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("Widget");
    });

    it("should auto-detect tab delimiter", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p csv '.[0].name' /fixtures/csv/tabs.tsv",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("Apple");
    });

    it("should handle unicode in CSV", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p csv '.[5].description' /fixtures/csv/special.csv",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Hello");
    });
  });

  describe("complex queries", () => {
    it("should calculate average age from users.yaml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '[.users[].age] | add / length' /fixtures/yaml/users.yaml",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("30\n");
    });

    it("should find highest budget department from nested.json", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p json '[.company.departments[] | {name, budget}] | max_by(.budget) | .name' /fixtures/json/nested.json",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Engineering\n");
    });

    it("should group products by category from products.csv", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq -p csv 'group_by(.category) | map({category: .[0].category, count: length})' /fixtures/csv/products.csv -o json",
      );
      expect(result.exitCode).toBe(0);
      const groups = JSON.parse(result.stdout);
      expect(groups).toHaveLength(2);
    });

    it("should transform user data structure from users.yaml", async () => {
      const bash = new Bash({ files });
      const result = await bash.exec(
        "yq '.users | map({(.name): .email}) | add' /fixtures/yaml/users.yaml -o json",
      );
      expect(result.exitCode).toBe(0);
      const emails = JSON.parse(result.stdout);
      expect(emails.alice).toBe("alice@example.com");
      expect(emails.bob).toBe("bob@example.com");
    });
  });
});
