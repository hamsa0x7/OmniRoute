/**
 * Tolerant JSONC parsing for cli-tools settings files.
 *
 * Mirrors decolua/9router 6c10edf8 (thanks @Zireael): the cli-tools settings
 * routes used to throw `SyntaxError` from `JSON.parse` on any JSONC (//, /*…*​/,
 * trailing commas) settings file the user pasted in, then the UI rendered the
 * resulting 500 as "tool not installed" — wrong cause, wrong cure.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseJsoncTolerantly,
  stripJsonComments,
} from "../../src/lib/cli-helper/jsoncSettings";

test("parses plain JSON unchanged", () => {
  const parsed = parseJsoncTolerantly<{ a: number; b: string }>('{"a": 1, "b": "x"}');
  assert.deepEqual(parsed, { a: 1, b: "x" });
});

test("tolerates a trailing comma (the canonical opencode/cline JSONC case)", () => {
  const parsed = parseJsoncTolerantly<{ env: { BASE_URL: string } }>(
    '{\n  "env": {\n    "BASE_URL": "http://127.0.0.1:20128",\n  },\n}'
  );
  assert.deepEqual(parsed, { env: { BASE_URL: "http://127.0.0.1:20128" } });
});

test("tolerates // line comments", () => {
  const parsed = parseJsoncTolerantly<{ enabled: boolean }>(
    '// preamble\n{\n  // toggle the proxy\n  "enabled": true\n}'
  );
  assert.deepEqual(parsed, { enabled: true });
});

test("tolerates /* block comments */", () => {
  const parsed = parseJsoncTolerantly<{ provider: string }>(
    '/* multi\n  line */\n{ "provider": "omniroute" /* inline */ }'
  );
  assert.deepEqual(parsed, { provider: "omniroute" });
});

test("returns null on truly malformed input (no exception escapes)", () => {
  assert.equal(parseJsoncTolerantly("{ this is not json"), null);
  assert.equal(parseJsoncTolerantly("not json at all"), null);
});

test("returns null on empty/blank/missing input", () => {
  assert.equal(parseJsoncTolerantly(""), null);
  assert.equal(parseJsoncTolerantly("   \n  "), null);
  assert.equal(parseJsoncTolerantly(null), null);
  assert.equal(parseJsoncTolerantly(undefined), null);
});

test("does not mangle // sequences inside string values", () => {
  const parsed = parseJsoncTolerantly<{ url: string }>(
    '{ "url": "http://example.com/path" }'
  );
  assert.deepEqual(parsed, { url: "http://example.com/path" });
});

test("does not mangle /* sequences inside string values", () => {
  const parsed = parseJsoncTolerantly<{ glob: string }>(
    '{ "glob": "/*.ts" }'
  );
  assert.deepEqual(parsed, { glob: "/*.ts" });
});

test("stripJsonComments preserves escape sequences inside strings", () => {
  // A quote escaped INSIDE a string must not be misread as the string's terminator.
  const stripped = stripJsonComments('{ "msg": "he said \\"hi\\" // not a comment" }');
  const parsed = JSON.parse(stripped);
  assert.equal(parsed.msg, 'he said "hi" // not a comment');
});
