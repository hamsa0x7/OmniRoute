// For OpenAI-compatible providers that don't natively support json_schema
// structured output, we inject the schema into the system prompt and downgrade
// response_format to json_object. This mirrors the approach already used in the
// openai-to-claude translator (open-sse/translator/openai-to-claude.ts).

interface ChatMessage {
  role: string;
  content: unknown;
}

interface RequestBodyWithResponseFormat {
  response_format?: {
    type?: string;
    json_schema?: {
      schema?: unknown;
    };
  };
  messages?: ChatMessage[];
  [key: string]: unknown;
}

/**
 * Injects a JSON schema as a system-prompt instruction for OpenAI-compatible
 * providers that don't natively support structured output via
 * `response_format: { type: "json_schema" }`. The schema is embedded into the
 * system message and `response_format` is downgraded to `json_object` so the
 * provider accepts the field instead of rejecting the request.
 *
 * Pure with respect to identity for non-matching bodies (returns the same
 * reference); for matching bodies it returns a new body object and a new
 * `messages` array rather than mutating in place.
 *
 * @param body - The chat completions request body.
 * @returns The (possibly modified) request body.
 */
export function injectJsonSchemaFallback<T extends RequestBodyWithResponseFormat>(body: T): T {
  if (!body || typeof body !== "object") return body;
  const responseFormat = body.response_format;
  if (!responseFormat || responseFormat.type !== "json_schema") return body;
  const schema = responseFormat.json_schema?.schema;
  if (schema === undefined || schema === null) return body;

  const schemaJson = JSON.stringify(schema, null, 2);
  const instruction = `You must respond with valid JSON that strictly follows this JSON schema:
\`\`\`json
${schemaJson}
\`\`\`
Respond ONLY with the JSON object, no other text, no markdown, no code fences.`;

  // Downgrade to json_object so the provider doesn't reject the field.
  const next: T = { ...body, response_format: { type: "json_object" } };

  if (Array.isArray(body.messages)) {
    const messages = [...body.messages];
    const systemIdx = messages.findIndex((m) => m && m.role === "system");
    if (systemIdx >= 0) {
      const existing = messages[systemIdx];
      const existingContent =
        typeof existing.content === "string"
          ? existing.content
          : JSON.stringify(existing.content);
      messages[systemIdx] = {
        role: "system",
        content: `${instruction}\n\n${existingContent}`,
      };
    } else {
      messages.unshift({ role: "system", content: instruction });
    }
    next.messages = messages;
  } else if (typeof body.messages === "undefined") {
    // No messages array yet — unusual for chat completions, but handle gracefully.
    next.messages = [{ role: "system", content: instruction }];
  }

  return next;
}

export default injectJsonSchemaFallback;
