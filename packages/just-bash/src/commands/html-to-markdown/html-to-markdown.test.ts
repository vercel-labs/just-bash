import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("html-to-markdown", () => {
  describe("basic conversion", () => {
    it("converts simple HTML to markdown", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<h1>Hello World</h1>" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("# Hello World\n");
      expect(result.stderr).toBe("");
    });

    it("converts paragraphs", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<p>First paragraph.</p><p>Second paragraph.</p>" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("First paragraph.");
      expect(result.stdout).toContain("Second paragraph.");
    });

    it("converts links", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<a href=\\"https://example.com\\">Click here</a>" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("[Click here](https://example.com)\n");
    });

    it("converts bold and italic", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<strong>bold</strong> and <em>italic</em>" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("**bold** and _italic_\n");
    });

    it("converts unordered lists", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<ul><li>One</li><li>Two</li><li>Three</li></ul>" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("-   One");
      expect(result.stdout).toContain("-   Two");
      expect(result.stdout).toContain("-   Three");
    });

    it("converts ordered lists", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<ol><li>First</li><li>Second</li></ol>" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("1.");
      expect(result.stdout).toContain("First");
      expect(result.stdout).toContain("Second");
    });

    it("converts code blocks", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<pre><code>const x = 1;</code></pre>" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("```");
      expect(result.stdout).toContain("const x = 1;");
    });

    it("converts inline code", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "Use <code>npm install</code> to install" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("`npm install`");
    });

    it("converts images", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<img src=\\"photo.jpg\\" alt=\\"A photo\\">" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("![A photo](photo.jpg)\n");
    });

    it("converts blockquotes", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<blockquote>A wise quote</blockquote>" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("> A wise quote");
    });
  });

  describe("options", () => {
    it("uses custom bullet marker with -b", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<ul><li>Item</li></ul>" | html-to-markdown -b "*"',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("*   Item");
    });

    it("uses custom bullet marker with --bullet", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<ul><li>Item</li></ul>" | html-to-markdown --bullet="+"',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("+   Item");
    });

    it("uses custom code fence with -c", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<pre><code>code</code></pre>" | html-to-markdown -c "~~~"',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("~~~");
    });

    it("uses custom hr with -r", async () => {
      const env = new Bash();
      const result = await env.exec('echo "<hr>" | html-to-markdown -r "***"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("***");
    });

    it("uses setext heading style", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<h1>Title</h1>" | html-to-markdown --heading-style=setext',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Title");
      expect(result.stdout).toContain("=");
    });
  });

  describe("file input", () => {
    it("reads from file", async () => {
      const env = new Bash({
        files: { "/test.html": "<h2>From File</h2>" },
      });
      const result = await env.exec("html-to-markdown /test.html");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("## From File\n");
    });

    it("reports missing file", async () => {
      const env = new Bash();
      const result = await env.exec("html-to-markdown /nonexistent.html");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(
        "html-to-markdown: /nonexistent.html: No such file or directory\n",
      );
    });
  });

  describe("help", () => {
    it("shows help with --help", async () => {
      const env = new Bash();
      const result = await env.exec("html-to-markdown --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("html-to-markdown");
      expect(result.stdout).toContain("convert HTML to Markdown");
      expect(result.stdout).toContain("--bullet");
    });

    it("shows detailed description in help", async () => {
      const env = new Bash();
      const result = await env.exec("html-to-markdown --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("BashEnv extension");
      expect(result.stdout).toContain("turndown");
      expect(result.stdout).toContain("Description:");
    });

    it("shows examples in help", async () => {
      const env = new Bash();
      const result = await env.exec("html-to-markdown --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Examples:");
      expect(result.stdout).toContain("echo");
      expect(result.stdout).toContain("curl");
    });

    it("documents supported HTML elements", async () => {
      const env = new Bash();
      const result = await env.exec("html-to-markdown --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Headings");
      expect(result.stdout).toContain("Links");
      expect(result.stdout).toContain("Bold");
      expect(result.stdout).toContain("Lists");
    });
  });

  describe("script and style removal", () => {
    it("strips inline script content", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<p>Hello</p><script>alert(1);</script><p>World</p>" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Hello");
      expect(result.stdout).toContain("World");
      expect(result.stdout).not.toContain("alert");
      expect(result.stdout).not.toContain("script");
    });

    it("strips inline style content", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<style>.red { color: red; }</style><p>Styled text</p>" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Styled text");
      expect(result.stdout).not.toContain("color");
      expect(result.stdout).not.toContain(".red");
    });

    it("strips multiple script and style tags", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<style>body{}</style><h1>Title</h1><script>var x=1;</script><p>Text</p><script>var y=2;</script>" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("# Title");
      expect(result.stdout).toContain("Text");
      expect(result.stdout).not.toContain("body");
      expect(result.stdout).not.toContain("var x");
      expect(result.stdout).not.toContain("var y");
    });

    it("strips script with type attribute", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<script type=\\"text/javascript\\">console.log(1);</script><p>Content</p>" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Content");
      expect(result.stdout).not.toContain("console");
    });
  });

  describe("edge cases", () => {
    it("handles empty input", async () => {
      const env = new Bash();
      const result = await env.exec('echo "" | html-to-markdown');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });

    it("handles plain text", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "Just plain text" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Just plain text\n");
    });

    it("handles complex nested HTML", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "<div><h1>Title</h1><p>Text with <strong>bold</strong></p></div>" | html-to-markdown',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("# Title");
      expect(result.stdout).toContain("**bold**");
    });

    it("reports unknown option", async () => {
      const env = new Bash();
      const result = await env.exec("html-to-markdown --invalid");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unrecognized option");
    });
  });
});
