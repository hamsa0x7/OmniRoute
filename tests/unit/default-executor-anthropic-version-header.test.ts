import test from "node:test";
import assert from "node:assert/strict";

const { DefaultExecutor } = await import("../../open-sse/executors/default.ts");

// Regression guard: claude/anthropic-compatible providers must send exactly one
// `anthropic-version` header. When `this.config.headers` already carries a
// Title-Case `Anthropic-Version`, the old `if (!headers["anthropic-version"])`
// guard left it in place AND added the lowercase one — two colliding headers.
// `ensureSingleHeader()` collapses any case-insensitive duplicate to a single
// canonical lowercase key.

test("buildHeaders sets a single anthropic-version for anthropic-compatible providers", () => {
  const executor = new DefaultExecutor("anthropic-compatible-custom") as {
    buildHeaders: (c: unknown, s?: boolean) => Record<string, string>;
  };

  const headers = executor.buildHeaders(
    {
      apiKey: "test-key",
      providerSpecificData: { baseUrl: "https://api.anthropic.com/v1" },
    },
    false
  );

  const versionKeys = Object.keys(headers).filter(
    (key) => key.toLowerCase() === "anthropic-version"
  );

  assert.deepEqual(versionKeys, ["anthropic-version"]);
  assert.equal(headers["anthropic-version"], "2023-06-01");
});

test("buildHeaders collapses a Title-Case Anthropic-Version from config.headers", () => {
  const executor = new DefaultExecutor("anthropic-compatible-custom") as {
    config: { headers?: Record<string, string> };
    buildHeaders: (c: unknown, s?: boolean) => Record<string, string>;
  };

  // Operator-provided static header on the provider config (Title-Case) that
  // would otherwise collide with the lowercase header the executor injects.
  executor.config.headers = { "Anthropic-Version": "2023-06-01" };

  const headers = executor.buildHeaders(
    {
      apiKey: "test-key",
      providerSpecificData: { baseUrl: "https://api.anthropic.com/v1" },
    },
    false
  );

  const versionKeys = Object.keys(headers).filter(
    (key) => key.toLowerCase() === "anthropic-version"
  );

  // Without the fix this is ["Anthropic-Version", "anthropic-version"].
  assert.deepEqual(versionKeys, ["anthropic-version"]);
  assert.equal(headers["anthropic-version"], "2023-06-01");
  assert.equal(headers["Anthropic-Version"], undefined);
});

test("buildHeaders preserves a custom anthropic-version value over the fallback", () => {
  const executor = new DefaultExecutor("anthropic-compatible-custom") as {
    config: { headers?: Record<string, string> };
    buildHeaders: (c: unknown, s?: boolean) => Record<string, string>;
  };

  executor.config.headers = { "Anthropic-Version": "2024-01-01" };

  const headers = executor.buildHeaders(
    {
      apiKey: "test-key",
      providerSpecificData: { baseUrl: "https://api.anthropic.com/v1" },
    },
    false
  );

  const versionKeys = Object.keys(headers).filter(
    (key) => key.toLowerCase() === "anthropic-version"
  );

  assert.deepEqual(versionKeys, ["anthropic-version"]);
  assert.equal(headers["anthropic-version"], "2024-01-01");
});
