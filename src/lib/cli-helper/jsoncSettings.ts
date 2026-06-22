/**
 * Tolerant JSON-with-comments parser for CLI tool settings files.
 *
 * Several CLI tools (opencode, openclaw, kilo, droid, cline, …) ship settings
 * in JSONC: regular JSON plus `// line` / `/* block *​/` comments and trailing
 * commas. A plain `JSON.parse` throws `SyntaxError` on the first comment or
 * trailing comma, which the cli-tools settings routes used to surface as 500
 * "Server error" — and the UI in turn rendered as "tool not installed", even
 * when the tool was installed and runnable.
 *
 * `parseJsoncTolerantly` returns `null` on ANY parse failure (rather than
 * re-throwing) so the UI can show "installed but not configured" instead of
 * mis-labelling a real install as missing. It deliberately does NOT try to
 * rebuild the file's structure — it only strips the two common JSONC features
 * (line + block comments, trailing commas) before handing the result to
 * `JSON.parse`. Anything else still falls through to `null`.
 *
 * Mirrors decolua/9router 6c10edf8 (thanks @Zireael).
 */

/**
 * Strip `// line` and `/* block *​/` comments and trailing commas (`,]` or `,}`)
 * from a JSONC source string. String literals are skipped so a `"// inside a
 * string"` value survives intact. Returns the input unchanged for empty/blank
 * input.
 */
export function stripJsonComments(source: string): string {
  if (!source) return source;
  const len = source.length;
  let out = "";
  let i = 0;
  let inString = false;
  let stringQuote = "";
  while (i < len) {
    const ch = source[i];
    const next = i + 1 < len ? source[i + 1] : "";

    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < len) {
        // Preserve escape sequence verbatim.
        out += source[i + 1];
        i += 2;
        continue;
      }
      if (ch === stringQuote) {
        inString = false;
        stringQuote = "";
      }
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      // Skip to end of line (or EOF).
      i += 2;
      while (i < len && source[i] !== "\n" && source[i] !== "\r") i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      // Skip until the closing */ (or EOF).
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }
  // Strip trailing commas before `}` or `]`.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Tolerantly parse a JSONC settings file body. Returns `null` on any parse
 * failure (caller surfaces "no config" rather than a 500). On success returns
 * the parsed JSON value.
 */
export function parseJsoncTolerantly<T = unknown>(content: string | null | undefined): T | null {
  if (typeof content !== "string" || !content.trim()) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    // Fall through to JSONC stripping.
  }
  try {
    return JSON.parse(stripJsonComments(content)) as T;
  } catch {
    return null;
  }
}
