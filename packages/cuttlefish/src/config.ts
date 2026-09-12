import { CuttlefishClient } from './client.js';

export interface CuttlefishConfig {
  baseUrl: string;
  token?: string;
  projectId?: string;
}

const DEFAULT_BASE_URL = 'http://localhost:4444';

/**
 * Resolves cuttlefish connection settings from the environment. Both the
 * cuttlefish-native names (`CUTTLE_*`) and the harness-scoped names
 * (`CUTTLEFISH_*`) are accepted so the same shell works with the `cuttle` CLI.
 */
export function resolveCuttlefishConfig(env: NodeJS.ProcessEnv = process.env): CuttlefishConfig {
  const baseUrl = firstNonEmpty(env.CUTTLEFISH_BASE_URL, env.CUTTLE_BASE_URL) ?? DEFAULT_BASE_URL;
  const token = firstNonEmpty(env.CUTTLEFISH_TOKEN, env.CUTTLE_TOKEN);
  const projectId = firstNonEmpty(env.CUTTLEFISH_PROJECT, env.CUTTLE_PROJECT);
  return { baseUrl, token, projectId };
}

export function createCuttlefishClient(
  overrides: Partial<CuttlefishConfig> = {},
  env: NodeJS.ProcessEnv = process.env
): CuttlefishClient {
  const config = { ...resolveCuttlefishConfig(env), ...overrides };
  return new CuttlefishClient(config);
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}
