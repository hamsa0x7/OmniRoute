/**
 * Claude Haiku rejects adaptive thinking and output_config.effort.
 *
 * The Anthropic Messages API supports `thinking.type:"adaptive"` and
 * `output_config.effort` only on Sonnet / Opus. On Haiku 4.5+ the same shape
 * is a hard 400 ("model does not support adaptive thinking" /
 * "output_config not supported"). Newer Cowork / Claude Code clients send
 * both shapes by default — OmniRoute must downgrade them before dispatch:
 *
 *   - `thinking.type:"adaptive"` → `{ type: "enabled", budget_tokens: 10000 }`
 *   - `output_config.effort` is stripped (and `output_config` is removed
 *     entirely when that leaves it empty).
 *
 * Sonnet / Opus targets are unchanged.
 *
 * Port of decolua/9router 401d93bd5 (thanks @decolua).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeClaudeAdaptiveUnsupported } from "../../open-sse/services/claudeAdaptiveThinking.ts";

test("Haiku 4.5: thinking.type:adaptive is downgraded to enabled+budget", () => {
  const body = { model: "claude-haiku-4-5-20251001", thinking: { type: "adaptive" } };
  const out = normalizeClaudeAdaptiveUnsupported(body, "claude-haiku-4-5-20251001");
  assert.deepEqual(out.thinking, { type: "enabled", budget_tokens: 10000 });
});

test("Haiku 4.5: output_config.effort is stripped; remaining output_config keys survive", () => {
  const body = {
    model: "claude-haiku-4-5-20251001",
    output_config: { effort: "high", format: "json" },
  };
  const out = normalizeClaudeAdaptiveUnsupported(body, "claude-haiku-4-5-20251001");
  assert.deepEqual(out.output_config, { format: "json" });
});

test("Haiku 4.5: output_config is removed entirely when effort was the only key", () => {
  const body = {
    model: "claude-haiku-4-5-20251001",
    output_config: { effort: "high" },
  };
  const out = normalizeClaudeAdaptiveUnsupported(body, "claude-haiku-4-5-20251001");
  assert.equal("output_config" in out, false);
});

test("Haiku 4.5: alias `claude-haiku-4.5` is recognized too (canonicalization)", () => {
  const body = { model: "claude-haiku-4.5", thinking: { type: "adaptive" } };
  const out = normalizeClaudeAdaptiveUnsupported(body, "claude-haiku-4.5");
  assert.deepEqual(out.thinking, { type: "enabled", budget_tokens: 10000 });
});

test("Sonnet 4.6: untouched (adaptive + output_config.effort both supported)", () => {
  const body = {
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
  };
  const out = normalizeClaudeAdaptiveUnsupported(body, "claude-sonnet-4.6");
  assert.deepEqual(out.thinking, { type: "adaptive" });
  assert.deepEqual(out.output_config, { effort: "high" });
});

test("Opus 4.7: untouched (adaptive-only)", () => {
  const body = {
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
  };
  const out = normalizeClaudeAdaptiveUnsupported(body, "claude-opus-4-7-20251101");
  assert.deepEqual(out.thinking, { type: "adaptive" });
  assert.deepEqual(out.output_config, { effort: "high" });
});

test("no-op when there is no adaptive thinking and no output_config.effort", () => {
  const body = { messages: [{ role: "user", content: "hi" }] };
  const out = normalizeClaudeAdaptiveUnsupported(body, "claude-haiku-4-5-20251001");
  // Same reference — fast path must not allocate when nothing changes.
  assert.strictEqual(out, body);
});

test("Haiku: leaves thinking.type:enabled (not adaptive) alone", () => {
  const body = {
    thinking: { type: "enabled", budget_tokens: 4096 },
  };
  const out = normalizeClaudeAdaptiveUnsupported(body, "claude-haiku-4-5-20251001");
  assert.deepEqual(out.thinking, { type: "enabled", budget_tokens: 4096 });
});

test("unknown model: no-op (only acts on models we KNOW reject adaptive)", () => {
  const body = {
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
  };
  const out = normalizeClaudeAdaptiveUnsupported(body, "some-other-model");
  assert.strictEqual(out, body);
});
