import type { DataCallback } from "./types";

/**
 * Maps keyboard events to terminal escape sequences
 * Compatible with xterm.js input format
 */
export class InputHandler {
  private callbacks: DataCallback[] = [];
  private container: HTMLElement | null = null;
  private textarea: HTMLTextAreaElement | null = null;
  private composing = false;

  // Touch handling state
  private touchStartPos: { x: number; y: number } | null = null;
  private mouseDownPos: { x: number; y: number } | null = null;
  private static readonly DRAG_THRESHOLD = 10; // pixels to consider it a drag/scroll

  /**
   * Attach input handling to an element
   */
  attach(container: HTMLElement): void {
    this.container = container;

    // Create hidden textarea for mobile keyboard support
    this.textarea = document.createElement("textarea");
    this.textarea.className = "lite-terminal-input";
    this.textarea.setAttribute("autocapitalize", "off");
    this.textarea.setAttribute("autocomplete", "off");
    this.textarea.setAttribute("autocorrect", "off");
    this.textarea.setAttribute("spellcheck", "false");
    this.textarea.setAttribute("tabindex", "0");
    this.textarea.setAttribute("aria-label", "Terminal input");
    // Prevent zoom on iOS
    this.textarea.style.fontSize = "16px";
    container.appendChild(this.textarea);

    // Attach events to textarea
    this.textarea.addEventListener("keydown", this.handleKeyDown);
    this.textarea.addEventListener("input", this.handleInput);
    this.textarea.addEventListener("compositionstart", this.handleCompositionStart);
    this.textarea.addEventListener("compositionend", this.handleCompositionEnd);
    this.textarea.addEventListener("paste", this.handlePaste);
    this.textarea.addEventListener("focus", this.handleFocus);
    this.textarea.addEventListener("blur", this.handleBlur);

    // Focus textarea when container is tapped (not scrolled)
    container.addEventListener("mousedown", this.handleMouseDown);
    container.addEventListener("click", this.handleContainerClick);
    container.addEventListener("touchstart", this.handleTouchStart, { passive: true });
    container.addEventListener("touchmove", this.handleTouchMove, { passive: true });
    container.addEventListener("touchend", this.handleTouchEnd);
  }

  /**
   * Detach input handling
   */
  detach(): void {
    if (this.textarea) {
      this.textarea.removeEventListener("keydown", this.handleKeyDown);
      this.textarea.removeEventListener("input", this.handleInput);
      this.textarea.removeEventListener("compositionstart", this.handleCompositionStart);
      this.textarea.removeEventListener("compositionend", this.handleCompositionEnd);
      this.textarea.removeEventListener("paste", this.handlePaste);
      this.textarea.removeEventListener("focus", this.handleFocus);
      this.textarea.removeEventListener("blur", this.handleBlur);
      this.textarea.remove();
      this.textarea = null;
    }
    if (this.container) {
      this.container.removeEventListener("mousedown", this.handleMouseDown);
      this.container.removeEventListener("click", this.handleContainerClick);
      this.container.removeEventListener("touchstart", this.handleTouchStart);
      this.container.removeEventListener("touchmove", this.handleTouchMove);
      this.container.removeEventListener("touchend", this.handleTouchEnd);
      this.container = null;
    }
  }

  /**
   * Focus the input
   */
  focus(): void {
    this.textarea?.focus({ preventScroll: true });
  }

  /**
   * Register a callback for input data
   */
  onData(callback: DataCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Emit data to all registered callbacks
   */
  private emit(data: string): void {
    for (const cb of this.callbacks) {
      cb(data);
    }
  }

  private handleMouseDown = (e: MouseEvent): void => {
    this.mouseDownPos = { x: e.clientX, y: e.clientY };
  };

  private handleContainerClick = (e: Event): void => {
    // Don't interfere with link clicks
    if (e.target instanceof HTMLAnchorElement) {
      return;
    }

    // Check if mouse moved significantly (user was trying to select)
    if (this.mouseDownPos && e instanceof MouseEvent) {
      const wasDragging =
        Math.abs(e.clientX - this.mouseDownPos.x) > InputHandler.DRAG_THRESHOLD ||
        Math.abs(e.clientY - this.mouseDownPos.y) > InputHandler.DRAG_THRESHOLD;
      this.mouseDownPos = null;
      if (wasDragging) {
        return;
      }
    }

    // Don't interfere with text selection
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }

    this.textarea?.focus({ preventScroll: true });
  };

  private handleTouchStart = (e: TouchEvent): void => {
    this.touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  private handleTouchMove = (): void => {
    // We check distance in touchEnd
  };

  private handleTouchEnd = (e: TouchEvent): void => {
    // Don't interfere with link clicks
    if (e.target instanceof HTMLAnchorElement) {
      return;
    }

    // Check if touch moved (scrolling)
    if (this.touchStartPos && e.changedTouches.length > 0) {
      const touch = e.changedTouches[0];
      const dx = Math.abs(touch.clientX - this.touchStartPos.x);
      const dy = Math.abs(touch.clientY - this.touchStartPos.y);
      this.touchStartPos = null;
      if (dx > InputHandler.DRAG_THRESHOLD || dy > InputHandler.DRAG_THRESHOLD) {
        return; // User was scrolling
      }
    }

    // Don't interfere with text selection
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }

    // Focus the textarea to bring up keyboard
    this.textarea?.focus();

    // Scroll cursor into view after keyboard appears
    setTimeout(() => {
      this.scrollCursorIntoView();
    }, 300);
  };

  private handleFocus = (): void => {
    this.container?.classList.add("focused");
  };

  private handleBlur = (): void => {
    this.container?.classList.remove("focused");
  };

  private scrollCursorIntoView(): void {
    if (!this.container) return;

    const cursor = this.container.querySelector(".lite-terminal-cursor");
    if (cursor) {
      // Use "nearest" to avoid scrolling too far on iOS
      cursor.scrollIntoView({ block: "nearest" });
    }
  }

  private handleInput = (e: Event): void => {
    // Handle input from mobile keyboard (for characters that don't trigger keydown)
    if (this.composing) return;

    const textarea = e.target as HTMLTextAreaElement;
    const data = textarea.value;

    if (data) {
      this.emit(data);
      textarea.value = "";
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Skip during IME composition
    if (this.composing) return;

    const key = e.key;
    const ctrl = e.ctrlKey;
    const alt = e.altKey || e.metaKey; // Meta (Cmd on Mac) often acts like Alt
    const shift = e.shiftKey;

    // Prevent default for keys we handle
    let handled = true;
    let data: string | null = null;

    // Control key combinations
    if (ctrl && !alt && !shift) {
      switch (key.toLowerCase()) {
        case "a":
          data = "\x01";
          break; // Ctrl+A - start of line
        case "b":
          data = "\x02";
          break; // Ctrl+B - back one char
        case "c":
          data = "\x03";
          break; // Ctrl+C - interrupt
        case "d":
          data = "\x04";
          break; // Ctrl+D - EOF
        case "e":
          data = "\x05";
          break; // Ctrl+E - end of line
        case "f":
          data = "\x06";
          break; // Ctrl+F - forward one char
        case "h":
          data = "\x08";
          break; // Ctrl+H - backspace
        case "k":
          data = "\x0b";
          break; // Ctrl+K - kill to end of line
        case "l":
          data = "\x0c";
          break; // Ctrl+L - clear screen
        case "n":
          data = "\x0e";
          break; // Ctrl+N - next history
        case "p":
          data = "\x10";
          break; // Ctrl+P - previous history
        case "r":
          data = "\x12";
          break; // Ctrl+R - reverse search
        case "u":
          data = "\x15";
          break; // Ctrl+U - kill line
        case "w":
          data = "\x17";
          break; // Ctrl+W - kill word
        default:
          handled = false;
      }
    }
    // Alt key combinations
    else if (alt && !ctrl) {
      switch (key.toLowerCase()) {
        case "b":
          data = "\x1bb";
          break; // Alt+B - back word
        case "f":
          data = "\x1bf";
          break; // Alt+F - forward word
        case "d":
          data = "\x1bd";
          break; // Alt+D - delete word forward
        case "backspace":
          data = "\x1b\x7f";
          break; // Alt+Backspace - delete word backward
        case "arrowleft":
          data = "\x1b[1;3D";
          break; // Alt+Left - word left
        case "arrowright":
          data = "\x1b[1;3C";
          break; // Alt+Right - word right
        default:
          handled = false;
      }
    }
    // Ctrl+Shift combinations (word movement)
    else if (ctrl && shift) {
      switch (key) {
        case "ArrowLeft":
          data = "\x1b[1;5D";
          break; // Ctrl+Shift+Left
        case "ArrowRight":
          data = "\x1b[1;5C";
          break; // Ctrl+Shift+Right
        default:
          handled = false;
      }
    }
    // Ctrl + Arrow (word movement)
    else if (ctrl && !shift && !alt) {
      switch (key) {
        case "ArrowLeft":
          data = "\x1b[1;5D";
          break; // Ctrl+Left - word left
        case "ArrowRight":
          data = "\x1b[1;5C";
          break; // Ctrl+Right - word right
        default:
          handled = false;
      }
    }
    // Regular keys
    else {
      switch (key) {
        case "Enter":
          data = "\r";
          // Close virtual keyboard on mobile
          if ("ontouchend" in window) {
            this.textarea?.blur();
          }
          break;
        case "Backspace":
          data = "\x7f";
          break;
        case "Tab":
          data = "\t";
          break;
        case " ":
        case "Spacebar": // Older browsers
          data = " ";
          break;
        case "Escape":
          data = "\x1b";
          break;
        case "ArrowUp":
          data = "\x1b[A";
          break;
        case "ArrowDown":
          data = "\x1b[B";
          break;
        case "ArrowRight":
          data = "\x1b[C";
          break;
        case "ArrowLeft":
          data = "\x1b[D";
          break;
        case "Home":
          data = "\x1b[H";
          break;
        case "End":
          data = "\x1b[F";
          break;
        case "Delete":
          data = "\x1b[3~";
          break;
        case "PageUp":
          data = "\x1b[5~";
          break;
        case "PageDown":
          data = "\x1b[6~";
          break;
        case "Insert":
          data = "\x1b[2~";
          break;
        default:
          // Don't handle printable characters here - let handleInput do it
          // This avoids double-input on desktop
          if (key.length === 1 && !ctrl && !alt) {
            handled = false;
          } else {
            handled = false;
          }
      }
    }

    if (data !== null) {
      e.preventDefault();
      // Clear the textarea to prevent handleInput from re-emitting
      if (this.textarea) {
        this.textarea.value = "";
      }
      this.emit(data);
    } else if (!handled) {
      // Let the browser handle it (for things like Cmd+C for copy, etc.)
    } else {
      e.preventDefault();
    }
  };

  private handleCompositionStart = (): void => {
    this.composing = true;
  };

  private handleCompositionEnd = (e: CompositionEvent): void => {
    this.composing = false;
    // Emit the composed text
    if (e.data) {
      this.emit(e.data);
    }
    // Clear the textarea
    if (this.textarea) {
      this.textarea.value = "";
    }
  };

  private handlePaste = (e: ClipboardEvent): void => {
    e.preventDefault();
    const text = e.clipboardData?.getData("text");
    if (text) {
      this.emit(text);
    }
  };
}
