// Regression test: when the Claude OAuth /api/oauth/usage endpoint returns 429,
// subsequent calls with the same access token must skip the OAuth probe and go
// straight to the legacy fallback for a cooldown window. Without the cooldown
// the dashboard hammers the rate-limited endpoint on every auto-refresh and
// users see chronic 429 spam (upstream decolua/9router commit 79df34ca).

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  getClaudeUsage,
  _resetClaudeOAuthUsageCooldownForTests,
  _peekClaudeOAuthUsageCooldownForTests,
} from "../../open-sse/services/usage.ts";

type FetchInput = Parameters<typeof fetch>[0];

const OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

const originalFetch = globalThis.fetch;

let calls: string[] = [];

function installFetchMock(
  responder: (url: string) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>
) {
  globalThis.fetch = (async (input: FetchInput) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String((input as Request).url);
    calls.push(url);
    const r = await responder(url);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    } as unknown as Response;
  }) as typeof fetch;
}

describe("Claude OAuth usage 429 cooldown", () => {
  before(() => {
    // capture original — restored in after()
  });

  beforeEach(() => {
    calls = [];
    _resetClaudeOAuthUsageCooldownForTests();
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("after a 429 on the OAuth usage endpoint, the next call skips OAuth and uses legacy", async () => {
    const token = "oauth-token-A";

    // First call: OAuth → 429, legacy fallback responds 401 (treated as fallback).
    installFetchMock((url) => {
      if (url === OAUTH_USAGE_URL) return { status: 429 };
      return { status: 401 };
    });
    await getClaudeUsage(token);

    const cooldownUntil = _peekClaudeOAuthUsageCooldownForTests(token);
    assert.ok(cooldownUntil && cooldownUntil > Date.now(), "cooldown timestamp set in the future");

    // Second call: bootstrap call goes out (best-effort), but the OAuth
    // /api/oauth/usage URL must NOT be called again while cooling down.
    calls = [];
    installFetchMock(() => ({ status: 401 }));
    await getClaudeUsage(token);

    const oauthCalls = calls.filter((u) => u === OAUTH_USAGE_URL);
    assert.equal(oauthCalls.length, 0, "OAuth usage endpoint must be skipped during cooldown");
  });

  it("a different access token is not affected by another token's cooldown", async () => {
    const tokenA = "oauth-token-A";
    const tokenB = "oauth-token-B";

    installFetchMock((url) => (url === OAUTH_USAGE_URL ? { status: 429 } : { status: 401 }));
    await getClaudeUsage(tokenA);
    assert.ok(_peekClaudeOAuthUsageCooldownForTests(tokenA), "tokenA in cooldown");
    assert.equal(
      _peekClaudeOAuthUsageCooldownForTests(tokenB),
      undefined,
      "tokenB not in cooldown"
    );

    // tokenB call should still attempt the OAuth endpoint.
    calls = [];
    await getClaudeUsage(tokenB);
    assert.ok(calls.includes(OAUTH_USAGE_URL), "tokenB still probes OAuth endpoint");
  });
});
