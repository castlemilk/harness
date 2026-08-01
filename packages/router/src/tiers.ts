import type { Capability, ProviderConfig } from '@omega/core';

export type ModelTier = 'high' | 'medium' | 'low';

export interface TierModelSelection {
  provider: string;
  model: string;
}

/**
 * Minimal structural view of the Prisma client used by pickModelForTier.
 * Declared locally so the router package does not need a dependency on
 * @omega/db; a real PrismaClient is structurally assignable to this.
 */
export interface ProviderConfigRow {
  id: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  apiKey: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  defaultModel: string;
  capabilities: string;
  enabled: boolean;
}

export interface ProviderConfigStore {
  providerConfig: {
    findMany: () => Promise<ProviderConfigRow[]>;
  };
}

/**
 * Best-effort context window size for a capability. Prefers the explicit
 * contextWindow field; falls back to parsing sizes from model names such as
 * "moonshot-v1-128k" (128k -> 131072).
 */
function contextSize(cap: Capability): number {
  if (typeof cap.contextWindow === 'number' && cap.contextWindow > 0) {
    return cap.contextWindow;
  }
  const match = /(\d+)\s*k\b/i.exec(cap.name);
  return match ? parseInt(match[1], 10) * 1024 : 0;
}

function rowToConfig(row: ProviderConfigRow): ProviderConfig {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ProviderConfig['kind'],
    baseUrl: row.baseUrl ?? undefined,
    apiKey: row.apiKey ?? undefined,
    refreshToken: row.refreshToken ?? undefined,
    tokenExpiresAt: row.tokenExpiresAt?.getTime() ?? undefined,
    defaultModel: row.defaultModel,
    capabilities: JSON.parse(row.capabilities) as ProviderConfig['capabilities'],
    enabled: row.enabled,
  };
}

/**
 * Pick a provider/model for an orchestration tier from already-loaded configs:
 * - high:   'advanced' models, largest context window (e.g. moonshot-v1-128k).
 * - medium: 'advanced' models, smallest context window (e.g. moonshot-v1-32k).
 * - low:    'capable' models, largest context window (e.g. moonshot-v1-8k).
 * Falls back to the first enabled provider's defaultModel when no capability
 * matches the requested tier.
 */
export function pickModelFromConfigs(
  configs: ProviderConfig[],
  tier: ModelTier
): TierModelSelection | undefined {
  const enabled = configs.filter((cfg) => cfg.enabled);
  if (enabled.length === 0) return undefined;

  const advanced: { cfg: ProviderConfig; cap: Capability }[] = [];
  const capable: { cfg: ProviderConfig; cap: Capability }[] = [];
  for (const cfg of enabled) {
    for (const cap of cfg.capabilities) {
      if (cap.level === 'advanced') advanced.push({ cfg, cap });
      else if (cap.level === 'capable') capable.push({ cfg, cap });
    }
  }
  // Largest context first.
  advanced.sort((a, b) => contextSize(b.cap) - contextSize(a.cap));
  capable.sort((a, b) => contextSize(b.cap) - contextSize(a.cap));

  if (tier === 'high' && advanced.length > 0) {
    return { provider: advanced[0].cfg.name, model: advanced[0].cap.name };
  }
  if (tier === 'medium' && advanced.length > 0) {
    // Prefer the smallest advanced model with a known context size; models with
    // no size metadata (e.g. glm-*) are kept as a fallback because some
    // providers have weaker tool-use support.
    const withSize = advanced.filter((a) => contextSize(a.cap) > 0);
    const smallest = withSize.length > 0 ? withSize[withSize.length - 1] : advanced[advanced.length - 1];
    return { provider: smallest.cfg.name, model: smallest.cap.name };
  }
  if (tier === 'low' && capable.length > 0) {
    return { provider: capable[0].cfg.name, model: capable[0].cap.name };
  }

  const fallback = enabled[0];
  return { provider: fallback.name, model: fallback.defaultModel };
}

/**
 * Load enabled provider configs from the database and pick a provider/model
 * for the given orchestration tier. See pickModelFromConfigs for tier rules.
 */
export async function pickModelForTier(
  prisma: ProviderConfigStore,
  tier: ModelTier
): Promise<TierModelSelection | undefined> {
  const rows = await prisma.providerConfig.findMany();
  return pickModelFromConfigs(rows.map(rowToConfig), tier);
}
