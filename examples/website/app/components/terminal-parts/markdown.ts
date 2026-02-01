// ANSI escape codes for styling
// Base color: #0AC5B3 = rgb(10, 197, 179)
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const UNDERLINE = "\x1b[4m";
const CYAN = "\x1b[38;2;10;197;179m"; // #0AC5B3
const RESET = "\x1b[0m";

/**
 * Apply terminal formatting to markdown-style text.
 * Preserves the actual characters but wraps them in ANSI escape sequences.
 */
export function formatMarkdown(text: string): string {
  let result = text;

  // Headers: # Header, ## Header, ### Header (at start of line)
  result = result.replace(/^(#{1,3})\s+(.+)$/gm, (_, hashes, content) => {
    return `${hashes} ${BOLD}${CYAN}${content}${RESET}`;
  });

  // Bold: **text** or __text__
  result = result.replace(/\*\*([^*]+)\*\*/g, (_, content) => {
    return `**${BOLD}${content}${RESET}**`;
  });
  result = result.replace(/__([^_]+)__/g, (_, content) => {
    return `__${BOLD}${content}${RESET}__`;
  });

  // Italic: *text* or _text_ (but not inside words for underscore)
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, content) => {
    return `*${ITALIC}${content}${RESET}*`;
  });
  result = result.replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, (_, content) => {
    return `_${ITALIC}${content}${RESET}_`;
  });

  // Inline code: `code` (single line only, no nested backticks)
  result = result.replace(/`([^`\n]+)`/g, (match) => {
    return `${CYAN}${match}${RESET}`;
  });

  // Links: [text](url) - style the URL part (will be made clickable by terminal renderer)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) => {
    return `[${linkText}](${UNDERLINE}${CYAN}${url}${RESET})`;
  });

  // Bullet points: - item or * item (at start of line)
  result = result.replace(/^(\s*[-*])\s+/gm, (_, bullet) => {
    return `${CYAN}${bullet}${RESET} `;
  });

  // Numbered lists: 1. item (at start of line)
  result = result.replace(/^(\s*\d+\.)\s+/gm, (_, num) => {
    return `${CYAN}${num}${RESET} `;
  });

  return result;
}
