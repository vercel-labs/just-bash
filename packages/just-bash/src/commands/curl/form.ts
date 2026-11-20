// Automa modifications: N00b byte-preserving multipart bodies.
/**
 * Form data handling for curl command
 */

import type { FormField } from "./types.js";

export function encodeCurlData(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)
    .replace(/%20/g, "+")
    .replace(/%[0-9A-F]{2}/g, (percentEscape) => percentEscape.toLowerCase());
}

/**
 * URL-encode form data in curl's --data-urlencode format
 * Supports: name=content, =content, content. The `@file` / `name@file` forms
 * are detected in parseOptions and deferred to execute time (see resolveData).
 */
export function encodeFormData(input: string): string {
  // Check for name=value format
  const eqIndex = input.indexOf("=");
  if (eqIndex >= 0) {
    const name = input.slice(0, eqIndex);
    const value = input.slice(eqIndex + 1);
    const encoded = encodeCurlData(value);
    return name ? `${name}=${encoded}` : encoded;
  }
  // Plain value
  return encodeCurlData(input);
}

/**
 * Parse -F/--form field specification
 * Supports: name=value, name=@file, name=<file, name=value;type=mime
 */
export function parseFormField(spec: string): FormField | null {
  const eqIndex = spec.indexOf("=");
  if (eqIndex < 0) return null;

  const name = spec.slice(0, eqIndex);
  let value = spec.slice(eqIndex + 1);
  let filename: string | undefined;
  let contentType: string | undefined;

  // Check for ;type= suffix
  const typeMatch = value.match(/;type=([^;]+)/);
  if (typeMatch) {
    contentType = typeMatch[1];
    value = value.replace(typeMatch[0], "");
  }

  // Check for ;filename= suffix
  const filenameMatch = value.match(/;filename=([^;]+)/);
  if (filenameMatch) {
    filename = filenameMatch[1];
    value = value.replace(filenameMatch[0], "");
  }

  // @ means file upload, < means file content
  if (value.startsWith("@") || value.startsWith("<")) {
    filename = filename ?? value.slice(1).split("/").pop();
    // Value will be replaced with file content in execute
  }

  return { name, value, filename, contentType };
}

/**
 * Generate multipart form data body and boundary
 */
export function generateMultipartBody(
  fields: FormField[],
  fileContents: Map<string, Uint8Array>,
): { body: Uint8Array<ArrayBuffer>; boundary: string } {
  const boundary = `----CurlFormBoundary${Date.now().toString(36)}`;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const field of fields) {
    let value: Uint8Array;
    if (field.value.startsWith("@") || field.value.startsWith("<")) {
      const filePath = field.value.slice(1);
      const content = fileContents.get(filePath);
      if (content === undefined)
        throw new Error(`curl: missing form file: ${filePath}`);
      value = content;
    } else value = encoder.encode(field.value);
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"`;
    if (field.filename) header += `; filename="${field.filename}"`;
    header += "\r\n";
    if (field.contentType) header += `Content-Type: ${field.contentType}\r\n`;
    parts.push(encoder.encode(`${header}\r\n`), value, encoder.encode("\r\n"));
  }
  parts.push(encoder.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(
    parts.reduce((size, part) => size + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return { body, boundary };
}
