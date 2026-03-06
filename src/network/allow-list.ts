/**
 * URL allow-list matching
 *
 * This module provides URL allow-list matching that is enforced at the fetch layer,
 * independent of any parsing or user input manipulation.
 */

/**
 * Parses a URL string into its components.
 * Returns null if the URL is invalid.
 */
export function parseUrl(
  urlString: string,
): { origin: string; pathname: string; href: string } | null {
  try {
    const url = new URL(urlString);
    return {
      origin: url.origin,
      pathname: url.pathname,
      href: url.href,
    };
  } catch {
    return null;
  }
}

/**
 * Normalizes an allow-list entry for consistent matching.
 * - Removes trailing slashes from origins without paths
 * - Preserves path prefixes as-is
 */
export function normalizeAllowListEntry(entry: string): {
  origin: string;
  pathPrefix: string;
} | null {
  const parsed = parseUrl(entry);
  if (!parsed) {
    return null;
  }

  return {
    origin: parsed.origin,
    // Keep the pathname exactly as specified (including trailing slash if present)
    pathPrefix: parsed.pathname,
  };
}

/**
 * Checks if a URL matches an allow-list entry.
 *
 * The matching rules are:
 * 1. Origins must match exactly (case-sensitive for scheme and host)
 * 2. The URL's path must start with the allow-list entry's path
 * 3. If the allow-list entry has no path (or just "/"), all paths are allowed
 *
 * @param url The URL to check (as a string)
 * @param allowedEntry The allow-list entry to match against
 * @returns true if the URL matches the allow-list entry
 */
export function matchesAllowListEntry(
  url: string,
  allowedEntry: string,
): boolean {
  const parsedUrl = parseUrl(url);
  if (!parsedUrl) {
    return false;
  }

  const normalizedEntry = normalizeAllowListEntry(allowedEntry);
  if (!normalizedEntry) {
    return false;
  }

  // Origins must match exactly
  if (parsedUrl.origin !== normalizedEntry.origin) {
    return false;
  }

  // If the allow-list entry is just the origin (path is "/" or empty), allow all paths
  if (normalizedEntry.pathPrefix === "/" || normalizedEntry.pathPrefix === "") {
    return true;
  }

  // The URL's path must start with the allow-list entry's path prefix
  return parsedUrl.pathname.startsWith(normalizedEntry.pathPrefix);
}

/**
 * Checks if a URL is allowed by any entry in the allow-list.
 *
 * @param url The URL to check
 * @param allowedUrlPrefixes The list of allowed URL prefixes
 * @returns true if the URL is allowed
 */
export function isUrlAllowed(
  url: string,
  allowedUrlPrefixes: string[],
): boolean {
  if (!allowedUrlPrefixes || allowedUrlPrefixes.length === 0) {
    return false;
  }

  return allowedUrlPrefixes.some((entry) => matchesAllowListEntry(url, entry));
}

/**
 * Check if a hostname is a private/loopback IP address.
 * Only checks the string format — does not perform DNS resolution.
 */
export function isPrivateIp(hostname: string): boolean {
  // Strip IPv6 brackets
  const h = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;

  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const parts = h.split(".").map(Number);
    const [a, b] = parts;
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16
    if (a === 0) return true; // 0.0.0.0
    return false;
  }

  // IPv6
  const lower = h.toLowerCase();
  if (lower === "::1") return true;
  // fe80::/10 — first 10 bits are 1111 1110 10, covering fe80-febf
  if (/^fe[89ab][0-9a-f]/.test(lower)) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
  if (lower === "::") return true; // unspecified
  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const v4mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4mapped) return isPrivateIp(v4mapped[1]);

  return false;
}

/**
 * Validates an allow-list configuration.
 * Each entry must be a full origin (scheme + host), optionally followed by a path prefix.
 * Returns an array of error messages for invalid entries.
 */
export function validateAllowList(allowedUrlPrefixes: string[]): string[] {
  const errors: string[] = [];

  for (const entry of allowedUrlPrefixes) {
    const parsed = parseUrl(entry);
    if (!parsed) {
      errors.push(
        `Invalid URL in allow-list: "${entry}" - must be a valid URL with scheme and host (e.g., "https://example.com")`,
      );
      continue;
    }

    const url = new URL(entry);

    // Only allow http and https
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      errors.push(
        `Only http and https URLs are allowed in allow-list: "${entry}"`,
      );
      continue;
    }

    // Must have a valid host (not empty)
    if (!url.hostname) {
      errors.push(`Allow-list entry must include a hostname: "${entry}"`);
      continue;
    }

    // Warn about query strings and fragments (they'll be ignored)
    if (url.search || url.hash) {
      errors.push(
        `Query strings and fragments are ignored in allow-list entries: "${entry}"`,
      );
    }
  }

  return errors;
}
