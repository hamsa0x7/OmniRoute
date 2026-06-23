// Regression test: user-defined provider-node prefixes must not shadow built-in
// provider ids/aliases. Before this fix, creating an OpenAI-compatible node with
// `prefix=cf` would hijack `cf/@cf/...` routes away from the built-in Cloudflare
// AI provider (upstream decolua/9router commit 047fdc89).

import test from "node:test";
import assert from "node:assert/strict";

const {
  RESERVED_PROVIDER_PREFIXES,
  selectProviderNodeForPrefix,
} = await import("../../src/sse/services/model.ts");

test("RESERVED_PROVIDER_PREFIXES includes built-in provider ids and aliases", () => {
  // Sample: Cloudflare AI ships id=cloudflare-ai with alias=cf — both must be reserved.
  assert.ok(RESERVED_PROVIDER_PREFIXES.has("cloudflare-ai"), "cloudflare-ai id reserved");
  assert.ok(RESERVED_PROVIDER_PREFIXES.has("cf"), "cf alias reserved");
  assert.ok(RESERVED_PROVIDER_PREFIXES.has("openai"), "openai id reserved");
  assert.ok(RESERVED_PROVIDER_PREFIXES.has("anthropic"), "anthropic id reserved");
});

test("user-defined provider-node prefix does NOT shadow a reserved built-in prefix (cf)", () => {
  const nodes = [
    { id: "openai-compatible-uuid-1234", prefix: "cf", name: "user-cf-collision" },
  ];
  const match = selectProviderNodeForPrefix("cf", nodes);
  assert.equal(match, undefined, "cf must not match a user-defined prefix=cf node");
});

test("internal UUID-style id still matches even when reserved-prefix guard is active", () => {
  // Combo steps store the internal node UUID (which cannot collide with any
  // built-in provider id/alias) — that path must keep working (#2778).
  const internalId = "openai-compatible-uuid-1234";
  const nodes = [{ id: internalId, prefix: "cf", name: "user-cf-collision" }];
  const match = selectProviderNodeForPrefix(internalId, nodes);
  assert.equal(match?.name, "user-cf-collision");
});

test("non-reserved user prefix still resolves normally", () => {
  const nodes = [
    { id: "openai-compatible-uuid-5678", prefix: "my-custom-host", name: "custom" },
  ];
  const match = selectProviderNodeForPrefix("my-custom-host", nodes);
  assert.equal(match?.name, "custom");
});

test("empty nodes list returns undefined", () => {
  assert.equal(selectProviderNodeForPrefix("cf", []), undefined);
});

test("reserved-prefix guard accepts an injected set (for isolation testing)", () => {
  const reserved = new Set(["my-fake-builtin"]);
  const nodes = [{ id: "uuid-x", prefix: "my-fake-builtin", name: "shadow" }];
  // With the custom set, our fake-builtin is reserved → the prefix match is blocked.
  assert.equal(selectProviderNodeForPrefix("my-fake-builtin", nodes, reserved), undefined);
  // But without it, the prefix match succeeds.
  assert.equal(
    selectProviderNodeForPrefix("my-fake-builtin", nodes, new Set())?.name,
    "shadow"
  );
});
