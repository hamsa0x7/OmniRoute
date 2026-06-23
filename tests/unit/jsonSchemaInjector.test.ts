import { test } from "node:test";
import assert from "node:assert/strict";

import { injectJsonSchemaFallback } from "@omniroute/open-sse/utils/jsonSchemaInjector.ts";

const sampleSchema = {
  type: "object",
  properties: { name: { type: "string" } },
  required: ["name"],
};

test("downgrades json_schema response_format to json_object", () => {
  const body = {
    model: "some-model",
    response_format: { type: "json_schema", json_schema: { schema: sampleSchema } },
    messages: [{ role: "user", content: "hi" }],
  };
  const out = injectJsonSchemaFallback(body);
  assert.deepEqual(out.response_format, { type: "json_object" });
});

test("prepends schema instruction as a new system message when none exists", () => {
  const body = {
    response_format: { type: "json_schema", json_schema: { schema: sampleSchema } },
    messages: [{ role: "user", content: "hi" }],
  };
  const out = injectJsonSchemaFallback(body);
  assert.equal(out.messages[0].role, "system");
  assert.match(out.messages[0].content as string, /strictly follows this JSON schema/);
  // The schema text must be embedded so the provider sees the contract.
  assert.match(out.messages[0].content as string, /"required"/);
  // Original user message preserved.
  assert.equal(out.messages[1].role, "user");
});

test("merges instruction into an existing system message", () => {
  const body = {
    response_format: { type: "json_schema", json_schema: { schema: sampleSchema } },
    messages: [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "hi" },
    ],
  };
  const out = injectJsonSchemaFallback(body);
  assert.equal(out.messages[0].role, "system");
  assert.match(out.messages[0].content as string, /strictly follows this JSON schema/);
  assert.match(out.messages[0].content as string, /You are helpful\./);
});

test("passes through bodies without json_schema response_format unchanged", () => {
  const jsonObject = {
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: "hi" }],
  };
  assert.equal(injectJsonSchemaFallback(jsonObject), jsonObject);

  const none = { messages: [{ role: "user", content: "hi" }] };
  assert.equal(injectJsonSchemaFallback(none), none);

  const noSchema = {
    response_format: { type: "json_schema", json_schema: {} },
    messages: [{ role: "user", content: "hi" }],
  };
  assert.equal(injectJsonSchemaFallback(noSchema), noSchema);
});

test("does not mutate the original body", () => {
  const body = {
    response_format: { type: "json_schema", json_schema: { schema: sampleSchema } },
    messages: [{ role: "user", content: "hi" }],
  };
  injectJsonSchemaFallback(body);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.messages.length, 1);
});
