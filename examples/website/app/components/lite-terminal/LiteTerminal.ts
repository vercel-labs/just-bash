import type {
  LiteTerminalOptions,
  ThemeConfig,
  TextStyle,
  DataCallback,
  StyledSegment,
} from "./types";
import { AnsiParser, type ParseResult } from "./ansi-parser";
import { InputHandler } from "./input-handler";

/** Maximum number of lines to keep in scrollback */
const MAX_SCROLLBACK_LINES = 100_000;

/**
 * Lightweight terminal implementation optimized for iOS
 * Drop-in compatible with xterm.js API surface used in this project
 */
export class LiteTerminal {
  private container: HTMLElement | null = null;
  private outputElement: HTMLElement | null = null;
  private cursorElement: HTMLElement | null = null;

  private parser: AnsiParser;
  private inputHandler: InputHandler;

  private lines: StyledSegment[][] = [[]];
  private currentLine = 0;
  private currentCol = 0;
  private currentStyle: TextStyle = {};

  private _cols = 80;
  private _options: LiteTerminalOptions;

  private pendingWrites: string[] = [];
  private writeScheduled = false;

  // Incremental rendering state
  private lineElements: HTMLElement[] = [];
  private dirtyLines: Set<number> = new Set();
  private lastCursorLine = -1;

  constructor(options: LiteTerminalOptions = {}) {
    this._options = {
      cursorBlink: true,
      fontSize: 15,
      fontFamily: '"Geist Mono", "SF Mono", Menlo, monospace',
      lineHeight: 1.2,
      letterSpacing: 0,
      theme: {
        background: "#000",
        foreground: "#e0e0e0",
        cursor: "#fff",
        cyan: "#0AC5B3",
        brightCyan: "#3DD9C8",
        brightBlack: "#666",
      },
      ...options,
    };

    this.parser = new AnsiParser();
    this.inputHandler = new InputHandler();
  }

  /**
   * Get terminal width in columns
   */
  get cols(): number {
    return this._cols;
  }

  /**
   * Get/set terminal options (for theme updates)
   */
  get options(): { theme: ThemeConfig } {
    // Capture `this` so the inner setter can call back to the instance
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const terminal = this;
    return {
      get theme() {
        return terminal._options.theme as ThemeConfig;
      },
      set theme(newTheme: ThemeConfig) {
        terminal._options.theme = { ...terminal._options.theme, ...newTheme };
        terminal.applyTheme();
      },
    };
  }

  /**
   * Open terminal in a container element
   */
  open(container: HTMLElement): void {
    this.container = container;

    // Create terminal structure
    container.innerHTML = "";
    container.className = "lite-terminal";
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", "Terminal");

    // Output area
    this.outputElement = document.createElement("pre");
    this.outputElement.className = "lite-terminal-output";
    this.outputElement.setAttribute("role", "log");
    this.outputElement.setAttribute("aria-live", "off"); // Don't auto-announce (too noisy)
    this.outputElement.setAttribute("aria-label", "Terminal output");
    container.appendChild(this.outputElement);

    // Cursor element (inline within text flow)
    this.cursorElement = document.createElement("span");
    this.cursorElement.className = "lite-terminal-cursor";
    if (this._options.cursorBlink) {
      this.cursorElement.classList.add("blink");
    }
    this.outputElement.appendChild(this.cursorElement);

    // Apply theme colors
    this.applyTheme();

    // Calculate columns
    this.calculateCols();

    // Attach input handler
    this.inputHandler.attach(container);

    // Handle resize
    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(() => {
        this.calculateCols();
      });
      resizeObserver.observe(container);
    }
  }

  /**
   * Write data to the terminal
   */
  write(data: string): void {
    this.pendingWrites.push(data);
    this.scheduleWrite();
  }

  /**
   * Write data followed by newline
   */
  writeln(data: string): void {
    this.write(data + "\n");
  }

  /**
   * Clear the terminal
   */
  clear(): void {
    this.lines = [[]];
    this.currentLine = 0;
    this.currentCol = 0;
    this.currentStyle = {};
    this.parser.reset();
    this.lineElements = [];
    this.dirtyLines.clear();
    this.lastCursorLine = -1;
    this.render(true); // Force full render
  }

  /**
   * Register callback for input data
   */
  onData(callback: DataCallback): void {
    this.inputHandler.onData(callback);
  }

  /**
   * Focus the terminal
   */
  focus(): void {
    this.inputHandler.focus();
  }

  /**
   * Dispose of terminal resources
   */
  dispose(): void {
    this.inputHandler.detach();
    if (this.container) {
      this.container.innerHTML = "";
      this.container = null;
    }
    this.outputElement = null;
    this.cursorElement = null;
  }

  /**
   * Schedule a batched write operation
   */
  private scheduleWrite(): void {
    if (this.writeScheduled) return;
    this.writeScheduled = true;

    requestAnimationFrame(() => {
      this.writeScheduled = false;
      this.processWrites();
    });
  }

  /**
   * Process all pending writes
   */
  private processWrites(): void {
    if (this.pendingWrites.length === 0) return;

    const combined = this.pendingWrites.join("");
    this.pendingWrites = [];

    const results = this.parser.parse(combined);

    // Track starting line for dirty marking
    const startLine = this.currentLine;

    for (const result of results) {
      this.processParseResult(result);
    }

    // Mark affected lines as dirty
    for (let i = startLine; i <= this.currentLine; i++) {
      this.dirtyLines.add(i);
    }

    this.render(false);
    this.scrollToBottom();
  }

  /**
   * Process a single parse result
   */
  private processParseResult(result: ParseResult): void {
    switch (result.type) {
      case "text":
        this.writeText(result.text || "");
        break;

      case "style":
        if (result.style) {
          this.currentStyle = { ...result.style };
        }
        break;

      case "cursor":
        if (result.cursor) {
          this.handleCursor(result.cursor);
        }
        break;

      case "clear":
        this.handleClear(result.clear || "line");
        break;
    }
  }

  /**
   * Write text to the current position
   */
  private writeText(text: string): void {
    for (const char of text) {
      if (char === "\n") {
        this.newLine();
      } else {
        this.writeChar(char);
      }
    }
  }

  /**
   * Write a single character at current position
   */
  private writeChar(char: string): void {
    const line = this.lines[this.currentLine];

    // Find or create segment at current position
    let pos = 0;
    let segmentIndex = 0;
    let charInSegment = 0;

    // Find where in the segments the cursor is
    while (segmentIndex < line.length && pos < this.currentCol) {
      const segLen = line[segmentIndex].text.length;
      if (pos + segLen > this.currentCol) {
        charInSegment = this.currentCol - pos;
        break;
      }
      pos += segLen;
      segmentIndex++;
      charInSegment = 0;
    }

    // If we're past all segments, we need to add spaces or a new segment
    if (segmentIndex >= line.length) {
      // Need to add spaces if there's a gap
      const gap = this.currentCol - pos;
      if (gap > 0) {
        line.push({ text: " ".repeat(gap), style: {} });
      }
      // Try to append to last segment if styles match
      const lastSeg = line[line.length - 1];
      if (lastSeg && this.stylesEqual(lastSeg.style, this.currentStyle)) {
        lastSeg.text += char;
      } else {
        // Add new segment with current style
        line.push({ text: char, style: { ...this.currentStyle } });
      }
    } else if (charInSegment > 0) {
      // We're in the middle of a segment, need to split it
      const seg = line[segmentIndex];
      const before = seg.text.slice(0, charInSegment);
      const after = seg.text.slice(charInSegment + 1);

      // Check if styles match
      if (this.stylesEqual(seg.style, this.currentStyle)) {
        // Same style, just replace the character
        seg.text = before + char + after;
      } else {
        // Different style, need to split
        const newSegments: StyledSegment[] = [];
        if (before) {
          newSegments.push({ text: before, style: seg.style });
        }
        newSegments.push({ text: char, style: { ...this.currentStyle } });
        if (after) {
          newSegments.push({ text: after, style: seg.style });
        }
        line.splice(segmentIndex, 1, ...newSegments);
      }
    } else {
      // We're at the start of a segment
      const seg = line[segmentIndex];
      if (this.stylesEqual(seg.style, this.currentStyle)) {
        // Same style, replace first char
        seg.text = char + seg.text.slice(1);
      } else {
        // Different style
        const after = seg.text.slice(1);
        const newSegments: StyledSegment[] = [
          { text: char, style: { ...this.currentStyle } },
        ];
        if (after) {
          newSegments.push({ text: after, style: seg.style });
        }
        line.splice(segmentIndex, 1, ...newSegments);
      }
    }

    this.currentCol++;
  }

  /**
   * Start a new line
   */
  private newLine(): void {
    // Mark current line as dirty before moving
    this.dirtyLines.add(this.currentLine);

    this.currentLine++;
    this.currentCol = 0;
    if (this.currentLine >= this.lines.length) {
      this.lines.push([]);
      // Add new line element to DOM
      if (this.outputElement) {
        const lineEl = document.createElement("div");
        lineEl.className = "lite-terminal-line";
        this.lineElements.push(lineEl);
        this.outputElement.appendChild(lineEl);
      }
    }

    // Mark new line as dirty
    this.dirtyLines.add(this.currentLine);

    // Trim old lines if we exceed the scrollback limit
    if (this.lines.length > MAX_SCROLLBACK_LINES) {
      const trimCount = this.lines.length - MAX_SCROLLBACK_LINES;
      this.lines.splice(0, trimCount);
      this.currentLine -= trimCount;
      // Also remove corresponding line elements
      for (let i = 0; i < trimCount; i++) {
        const el = this.lineElements.shift();
        el?.remove();
      }
    }
  }

  /**
   * Handle cursor movement commands
   */
  private handleCursor(cursor: {
    action: "left" | "right" | "home";
    count?: number;
  }): void {
    const count = cursor.count || 1;

    switch (cursor.action) {
      case "left":
        this.currentCol = Math.max(0, this.currentCol - count);
        break;

      case "right":
        this.currentCol += count;
        break;

      case "home":
        this.currentCol = 0;
        break;
    }
  }

  /**
   * Handle clear commands
   */
  private handleClear(type: "line" | "screen" | "scrollback"): void {
    switch (type) {
      case "line":
        // Clear from cursor to end of line
        const line = this.lines[this.currentLine];
        let pos = 0;
        let segmentIndex = 0;

        while (segmentIndex < line.length && pos < this.currentCol) {
          const segLen = line[segmentIndex].text.length;
          if (pos + segLen > this.currentCol) {
            // Truncate this segment
            line[segmentIndex].text = line[segmentIndex].text.slice(
              0,
              this.currentCol - pos
            );
            segmentIndex++;
            break;
          }
          pos += segLen;
          segmentIndex++;
        }
        // Remove all segments after cursor position
        line.splice(segmentIndex);
        // Mark as dirty
        this.dirtyLines.add(this.currentLine);
        break;

      case "screen":
      case "scrollback":
        this.lines = [[]];
        this.currentLine = 0;
        this.currentCol = 0;
        this.lineElements = [];
        this.dirtyLines.clear();
        this.lastCursorLine = -1;
        break;
    }
  }

  /**
   * Compare two styles for equality
   */
  private stylesEqual(a: TextStyle, b: TextStyle): boolean {
    return (
      a.bold === b.bold &&
      a.dim === b.dim &&
      a.italic === b.italic &&
      a.underline === b.underline &&
      a.color === b.color &&
      a.link === b.link
    );
  }

  /**
   * Render the terminal content to DOM with inline cursor
   * Uses incremental updates when possible for better iOS performance
   */
  private render(forceFullRender = false): void {
    if (!this.outputElement || !this.cursorElement) return;

    // Full render if forced or if structure changed significantly
    if (forceFullRender || this.lineElements.length === 0 ||
        this.lines.length !== this.lineElements.length) {
      this.fullRender();
      return;
    }

    // Incremental render: only update dirty lines and cursor position
    const cursorMoved = this.lastCursorLine !== this.currentLine;

    // If cursor moved to a different line, mark both old and new lines dirty
    if (cursorMoved && this.lastCursorLine >= 0 && this.lastCursorLine < this.lines.length) {
      this.dirtyLines.add(this.lastCursorLine);
    }
    this.dirtyLines.add(this.currentLine);

    // Update only dirty lines
    for (const lineIndex of this.dirtyLines) {
      if (lineIndex < this.lines.length && lineIndex < this.lineElements.length) {
        this.renderLine(lineIndex);
      }
    }

    this.dirtyLines.clear();
    this.lastCursorLine = this.currentLine;

    // Update cursor size if needed
    this.updateCursorSize();
  }

  /**
   * Full re-render of all content (used on initial render or structural changes)
   */
  private fullRender(): void {
    if (!this.outputElement || !this.cursorElement) return;

    this.outputElement.innerHTML = "";
    this.lineElements = [];

    for (let lineIndex = 0; lineIndex < this.lines.length; lineIndex++) {
      const lineEl = document.createElement("div");
      lineEl.className = "lite-terminal-line";
      this.lineElements.push(lineEl);
      this.outputElement.appendChild(lineEl);
      this.renderLineContent(lineIndex, lineEl);
    }

    this.dirtyLines.clear();
    this.lastCursorLine = this.currentLine;
    this.updateCursorSize();
  }

  /**
   * Re-render a single line
   */
  private renderLine(lineIndex: number): void {
    const lineEl = this.lineElements[lineIndex];
    if (!lineEl) return;
    this.renderLineContent(lineIndex, lineEl);
  }

  /**
   * Render the content of a single line into a line element
   */
  private renderLineContent(lineIndex: number, lineEl: HTMLElement): void {
    if (!this.cursorElement) return;

    lineEl.innerHTML = "";
    const line = this.lines[lineIndex];
    const isCursorLine = lineIndex === this.currentLine;

    if (!isCursorLine) {
      // Simple case: no cursor on this line, just render segments
      for (const segment of line) {
        if (segment.text) {
          lineEl.appendChild(this.createStyledSpan(segment.text, segment.style));
        }
      }
      // Add empty text node to ensure line has height
      if (line.length === 0 || line.every(s => !s.text)) {
        lineEl.appendChild(document.createTextNode("\u200B")); // Zero-width space
      }
      return;
    }

    // Cursor line: need to insert cursor at correct position
    let charPos = 0;
    let cursorInserted = false;

    for (const segment of line) {
      if (!segment.text) continue;

      const segStart = charPos;
      const segEnd = charPos + segment.text.length;

      if (!cursorInserted && this.currentCol >= segStart && this.currentCol < segEnd) {
        // Cursor is within this segment
        const offsetInSegment = this.currentCol - segStart;
        const beforeCursor = segment.text.slice(0, offsetInSegment);
        const afterCursor = segment.text.slice(offsetInSegment);

        if (beforeCursor) {
          lineEl.appendChild(this.createStyledSpan(beforeCursor, segment.style));
        }
        lineEl.appendChild(this.cursorElement);
        cursorInserted = true;
        if (afterCursor) {
          lineEl.appendChild(this.createStyledSpan(afterCursor, segment.style));
        }
      } else {
        lineEl.appendChild(this.createStyledSpan(segment.text, segment.style));
      }

      charPos += segment.text.length;
    }

    // Cursor at end of line
    if (!cursorInserted) {
      lineEl.appendChild(this.cursorElement);
    }
  }

  // URL detection regex for plain URLs (fallback when no OSC 8)
  private static readonly URL_REGEX = /(https?:\/\/[^\s)<>]+)/g;

  /**
   * Create a styled element - span, anchor, or text node
   */
  private createStyledSpan(text: string, style: TextStyle): HTMLSpanElement | HTMLAnchorElement | Text | DocumentFragment {
    const classes = this.getStyleClasses(style);
    const inlineStyle = this.getInlineStyle(style);

    // If style has a link (from OSC 8), create an anchor element
    if (style.link) {
      const link = document.createElement("a");
      link.href = style.link;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = text;
      if (classes) link.className = classes;
      if (inlineStyle) link.style.cssText = inlineStyle;
      link.style.cursor = "pointer";
      return link;
    }

    // Check if text contains plain URLs (fallback detection)
    const urlMatch = text.match(LiteTerminal.URL_REGEX);
    if (urlMatch) {
      return this.createTextWithLinks(text, classes, inlineStyle);
    }

    if (!classes && !inlineStyle) {
      // Use text node for unstyled content (more efficient)
      return document.createTextNode(text);
    }

    const span = document.createElement("span");
    if (classes) span.className = classes;
    if (inlineStyle) span.style.cssText = inlineStyle;
    span.textContent = text;
    return span;
  }

  /**
   * Create text content with clickable URL links (for plain URLs without OSC 8)
   */
  private createTextWithLinks(
    text: string,
    classes: string,
    inlineStyle: string
  ): DocumentFragment {
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;

    // Reset regex state
    LiteTerminal.URL_REGEX.lastIndex = 0;

    let match;
    while ((match = LiteTerminal.URL_REGEX.exec(text)) !== null) {
      // Add text before the URL
      if (match.index > lastIndex) {
        const beforeText = text.slice(lastIndex, match.index);
        fragment.appendChild(this.createStyledElement(beforeText, classes, inlineStyle));
      }

      // Add the URL as a clickable link
      const url = match[0];
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = url;
      if (classes) link.className = classes;
      if (inlineStyle) link.style.cssText = inlineStyle;
      link.style.cursor = "pointer";
      fragment.appendChild(link);

      lastIndex = match.index + url.length;
    }

    // Add remaining text after last URL
    if (lastIndex < text.length) {
      const afterText = text.slice(lastIndex);
      fragment.appendChild(this.createStyledElement(afterText, classes, inlineStyle));
    }

    return fragment;
  }

  /**
   * Create a styled element (span or text node) - helper for createTextWithLinks
   */
  private createStyledElement(text: string, classes: string, inlineStyle: string): HTMLSpanElement | Text {
    if (!classes && !inlineStyle) {
      return document.createTextNode(text);
    }
    const span = document.createElement("span");
    if (classes) span.className = classes;
    if (inlineStyle) span.style.cssText = inlineStyle;
    span.textContent = text;
    return span;
  }

  /**
   * Update cursor size based on font metrics
   */
  private updateCursorSize(): void {
    if (!this.cursorElement || !this.outputElement) return;

    const charWidth = this.measureCharWidth();
    const computedStyle = getComputedStyle(this.outputElement);
    const lineHeight = parseFloat(computedStyle.lineHeight) ||
                       (this._options.fontSize! * (this._options.lineHeight || 1.2));

    this.cursorElement.style.width = `${charWidth}px`;
    this.cursorElement.style.height = `${lineHeight}px`;
  }

  // Allowlist of valid color class names (prevents XSS via class injection)
  private static readonly VALID_COLOR_CLASSES = new Set([
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "brightBlack", "brightRed", "brightGreen", "brightYellow",
    "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
  ]);

  /**
   * Get CSS classes for a text style
   */
  private getStyleClasses(style: TextStyle): string {
    const classes: string[] = [];

    if (style.bold) classes.push("bold");
    if (style.dim) classes.push("dim");
    if (style.italic) classes.push("italic");
    if (style.underline) classes.push("underline");

    // Named colors - only allow known color names (XSS protection)
    if (style.color && LiteTerminal.VALID_COLOR_CLASSES.has(style.color)) {
      classes.push(style.color);
    }

    return classes.join(" ");
  }

  // Regex to validate rgb() color format (XSS protection)
  private static readonly RGB_COLOR_REGEX = /^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/;

  /**
   * Get inline style for RGB colors
   */
  private getInlineStyle(style: TextStyle): string {
    // Only allow properly formatted rgb() values (XSS protection)
    if (style.color && LiteTerminal.RGB_COLOR_REGEX.test(style.color)) {
      return `color: ${style.color}`;
    }
    return "";
  }



  /**
   * Scroll to bottom of terminal (uses window scroll)
   */
  private scrollToBottom(): void {
    window.scrollTo(0, document.body.scrollHeight);
  }

  /**
   * Calculate terminal width in columns
   */
  private calculateCols(): void {
    if (!this.container || !this.outputElement) return;

    const charWidth = this.measureCharWidth();
    // Use window width since we're using body scroll
    // Account for container padding (16px each side by default)
    const containerPadding = 32;
    const availableWidth = (this.container.clientWidth || window.innerWidth) - containerPadding;

    this._cols = Math.floor(availableWidth / charWidth) || 80;
  }

  /**
   * Measure character width for monospace font
   */
  private measureCharWidth(): number {
    if (!this.outputElement) return 8;

    const measureSpan = document.createElement("span");
    measureSpan.textContent = "M";
    measureSpan.style.visibility = "hidden";
    measureSpan.style.position = "absolute";
    this.outputElement.appendChild(measureSpan);

    const width = measureSpan.offsetWidth;
    this.outputElement.removeChild(measureSpan);

    return width || 8;
  }

  /**
   * Apply theme colors
   */
  private applyTheme(): void {
    if (!this.container) return;

    const theme = this._options.theme || {};

    this.container.style.setProperty(
      "background-color",
      theme.background || "#000"
    );
    this.container.style.setProperty("color", theme.foreground || "#e0e0e0");

    // Set CSS custom properties for colors
    this.container.style.setProperty("--term-cyan", theme.cyan || "#0AC5B3");
    this.container.style.setProperty(
      "--term-brightCyan",
      theme.brightCyan || "#3DD9C8"
    );
    this.container.style.setProperty(
      "--term-brightBlack",
      theme.brightBlack || "#666"
    );

    // Cursor color
    if (this.cursorElement) {
      this.cursorElement.style.backgroundColor = theme.cursor || "#fff";
    }
  }
}
