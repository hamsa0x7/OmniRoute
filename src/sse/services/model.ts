// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes, getCustomModels } from "@/lib/localDb";
import { getCachedSettings } from "@/lib/localDb";
import { getComboStepTarget } from "@/lib/combos/steps";
import {
  parseModel,
  resolveModelAliasFromMap,
  getModelInfoCore,
} from "@omniroute/open-sse/services/model.ts";
import { REGISTRY } from "@omniroute/open-sse/config/providers/index.ts";

export { parseModel };

/**
 * Built-in provider ids/aliases that user-defined provider-node prefixes must
 * not be allowed to shadow (e.g. a custom OpenAI-compatible node with
 * `prefix=cf` would otherwise hijack `cf/...` routes away from Cloudflare).
 *
 * Built lazily once from the static registry — REGISTRY is initialized at
 * module-load time, so this Set is stable for the process lifetime.
 *
 * Exported for unit testing.
 */
export const RESERVED_PROVIDER_PREFIXES: ReadonlySet<string> = (() => {
  const reserved = new Set<string>();
  for (const entry of Object.values(REGISTRY)) {
    if (entry.id) reserved.add(entry.id);
    if (entry.alias) reserved.add(entry.alias);
  }
  return reserved;
})();

/**
 * Pure helper: pick the matching provider-node for a given route prefix.
 *
 * A node matches when:
 *  - its internal UUID id equals the prefix (combo-step internal IDs, #2778), OR
 *  - its user-defined `prefix` equals the prefix AND the prefix is NOT a
 *    reserved built-in provider id/alias (shadowing guard, upstream 047fdc89).
 *
 * Exported for direct unit testing without spinning up the DB layer.
 */
export function selectProviderNodeForPrefix<T extends { id?: string; prefix?: string }>(
  prefix: string,
  nodes: T[],
  reserved: ReadonlySet<string> = RESERVED_PROVIDER_PREFIXES
): T | undefined {
  const isReserved = reserved.has(prefix);
  return nodes.find(
    (node) => (!isReserved && node.prefix === prefix) || node.id === prefix
  );
}

/**
 * Build a combined model alias map that merges both alias stores:
 * 1. DB-namespace aliases (key_value WHERE namespace='modelAliases') — set via
 *    /api/models/alias/ and seeded at startup (e.g. gemini-cli default aliases).
 * 2. Settings-based aliases (settings.modelAliases) — set via the Settings UI and
 *    /api/settings/model-aliases/ (stored as a JSON blob in namespace='settings').
 *
 * Settings-based aliases take priority so that UI configuration always wins.
 * Without this merge, aliases configured via the Settings UI were never consulted
 * during provider routing, causing provider inference (e.g. /^gpt-/ → openai) to
 * silently override them (issue #2618 / #2208).
 */
async function getCombinedModelAliases(): Promise<Record<string, unknown>> {
  const [dbAliases, settings] = await Promise.all([
    getModelAliases().catch(() => ({})),
    getCachedSettings().catch(() => ({}) as Record<string, unknown>),
  ]);

  const settingsAliases =
    settings.modelAliases &&
    typeof settings.modelAliases === "object" &&
    !Array.isArray(settings.modelAliases)
      ? (settings.modelAliases as Record<string, unknown>)
      : {};

  // Settings-based aliases win over DB-namespace aliases on key collision
  return { ...dbAliases, ...settingsAliases };
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

/**
 * Look up custom-model metadata from the DB in a single read:
 *  - apiFormat: "responses" when the model is configured for the Responses API.
 *  - targetFormat: the optional per-model wire format override (#2905).
 */
async function lookupCustomModelMeta(
  providerId: string,
  modelId: string
): Promise<{ apiFormat?: string; targetFormat?: string }> {
  try {
    const models = await getCustomModels(providerId);
    if (!Array.isArray(models)) return {};
    const match = models.find((m: any) => m.id === modelId);
    if (!match) return {};
    return {
      apiFormat: match.apiFormat === "responses" ? "responses" : undefined,
      targetFormat: typeof match.targetFormat === "string" ? match.targetFormat : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  const parsed = parseModel(modelStr);
  const { extendedContext } = parsed;

  const attachCustomApiFormat = async (info: any) => {
    if (!info?.provider || !info?.model) return info;
    const { apiFormat, targetFormat } = await lookupCustomModelMeta(
      String(info.provider),
      String(info.model)
    );
    if (apiFormat || targetFormat) {
      return {
        ...info,
        ...(apiFormat && { apiFormat }),
        ...(targetFormat && { targetFormat }),
      };
    }
    return info;
  };

  // Check custom provider nodes first (for both alias and non-alias formats)
  if (parsed.providerAlias || parsed.provider) {
    // Ensure prefixToCheck is always a concise identifier, not a full model string
    const prefixToCheck = parsed.providerAlias || parsed.provider;

    // Provider-node prefixes are user-defined. They must not override built-in
    // provider ids/aliases like `cf`, `cloudflare-ai`, `openai`, `anthropic`, etc.
    // Without this guard, a custom OpenAI-compatible node with `prefix=cf` would
    // hijack `cf/@cf/...` routes away from Cloudflare AI (upstream 047fdc89).
    // Internal node UUIDs are still honored via the `id === prefix` branch in
    // selectProviderNodeForPrefix.

    // Check OpenAI Compatible nodes — selectProviderNodeForPrefix applies the
    // reserved-prefix guard while keeping internal-UUID (#2778) lookups live.
    const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
    const matchedOpenAI = selectProviderNodeForPrefix(prefixToCheck as string, openaiNodes);
    if (matchedOpenAI) {
      const { apiFormat, targetFormat } = await lookupCustomModelMeta(
        matchedOpenAI.id as string,
        parsed.model as string
      );
      return {
        provider: matchedOpenAI.id,
        model: parsed.model,
        extendedContext,
        ...(apiFormat && { apiFormat }),
        ...(targetFormat && { targetFormat }),
      };
    }

    // Check Anthropic Compatible nodes — same reserved-prefix guard.
    const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
    const matchedAnthropic = selectProviderNodeForPrefix(
      prefixToCheck as string,
      anthropicNodes
    );
    if (matchedAnthropic) {
      const { apiFormat, targetFormat } = await lookupCustomModelMeta(
        matchedAnthropic.id as string,
        parsed.model as string
      );
      return {
        provider: matchedAnthropic.id,
        model: parsed.model,
        extendedContext,
        ...(apiFormat && { apiFormat }),
        ...(targetFormat && { targetFormat }),
      };
    }

    // stripModelPrefix: if enabled, strip provider prefix and re-resolve
    // the bare model name using existing heuristics (claude-* → anthropic, etc.)
    try {
      const settings = await getCachedSettings();
      if (settings.stripModelPrefix === true) {
        const strippedResult = await getModelInfoCore(parsed.model, getCombinedModelAliases);
        return { ...strippedResult, extendedContext };
      }
    } catch {
      // If settings read fails, fall through to normal resolution
    }
  }

  if (!parsed.isAlias) {
    return await attachCustomApiFormat(await getModelInfoCore(modelStr, null));
  }

  return await attachCustomApiFormat(await getModelInfoCore(modelStr, getCombinedModelAliases));
}

/**
 * Check if model is a combo and return the full combo object
 * @returns {Promise<Object|null>} Full combo object or null if not a combo
 */
export async function getCombo(modelStr) {
  // Try exact match first (supports combos actually named "combo/ANY")
  let combo = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo;
  }

  // Fallback: Strip combo/ prefix if present
  if (modelStr.startsWith("combo/")) {
    const nameToSearch = modelStr.substring(6);
    combo = await getComboByName(nameToSearch);
    if (combo && combo.models && combo.models.length > 0) {
      return combo;
    }
  }

  return null;
}

/**
 * Check if model matches a combo by name OR by model-combo mapping pattern.
 * This augments getCombo() with glob-based model-to-combo resolution (#563).
 *
 * Resolution order:
 * 1. Exact combo name match (existing behavior)
 * 2. Model-combo mapping pattern match (new — glob patterns by priority)
 * 3. null (no combo — single-model request)
 */
export async function getComboForModel(modelStr) {
  // 1. Existing behavior — exact combo name match
  const combo = await getCombo(modelStr);
  if (combo) return combo;

  // 2. NEW — check model-combo mappings table (pattern match)
  try {
    const { resolveComboForModel } = await import("@/lib/localDb");
    const mapped = await resolveComboForModel(modelStr);
    if (mapped && (mapped as any).models?.length > 0) {
      return mapped;
    }
  } catch {
    // If the mappings table doesn't exist yet (pre-migration), continue gracefully
  }

  return null;
}

/**
 * Legacy: get combo models as string array
 * @returns {Promise<string[]|null>}
 */
export async function getComboModels(modelStr) {
  const combo = await getCombo(modelStr);
  if (!combo) return null;
  return (combo.models || [])
    .map((entry) => getComboStepTarget(entry))
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}
