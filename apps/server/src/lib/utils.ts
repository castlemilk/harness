/**
 * Shared utility functions for the Omega harness server.
 */

import type { ProviderConfig as CoreProviderConfig } from '@omega/core';

/**
 * Convert a Prisma ProviderConfig row to the core ProviderConfig type.
 * Used across routes and lib modules that need to create provider instances.
 */
export function toCoreConfig(row: {
  id: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  apiKey: string | null;
  defaultModel: string;
  capabilities: string;
  enabled: boolean;
}): CoreProviderConfig {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as CoreProviderConfig['kind'],
    baseUrl: row.baseUrl ?? undefined,
    apiKey: row.apiKey ?? undefined,
    defaultModel: row.defaultModel,
    capabilities: JSON.parse(row.capabilities) as CoreProviderConfig['capabilities'],
    enabled: row.enabled,
  };
}

/**
 * Classify an error message into a category for routing and alerting.
 */
export type ErrorCategory = 'auth' | 'rate_limit' | 'timeout' | 'server_error' | 'model_error' | 'unknown';

export function classifyError(message: string): ErrorCategory {
  const lower = message.toLowerCase();
  if (lower.includes('401') || lower.includes('403') || lower.includes('credential') || lower.includes('unauthorized')) {
    return 'auth';
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many')) {
    return 'rate_limit';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'timeout';
  }
  if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('internal')) {
    return 'server_error';
  }
  if (lower.includes('model') || lower.includes('invalid_request')) {
    return 'model_error';
  }
  return 'unknown';
}

/**
 * Check if an error is a credential/auth error (for circuit breaker decisions).
 */
export function isCredentialError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('401') || lower.includes('403') ||
    lower.includes('authentication') || lower.includes('unauthorized') ||
    lower.includes('invalid api key') || lower.includes('login fail') ||
    lower.includes('no api-key') || lower.includes('invalid_authentication') ||
    message.includes('CREDENTIAL_ERROR');
}

/**
 * Check if an error is a rate limit error.
 */
export function isRateLimitError(message: string): boolean {
  return message.includes('429') || message.toLowerCase().includes('rate') || message.includes('Too Many');
}

/**
 * Check if an error is a timeout error.
 */
export function isTimeoutError(message: string): boolean {
  return message.includes('timeout') || message.includes('TIMEOUT') || message.includes('aborted');
}

/**
 * Safe JSON.parse with fallback. Returns default value on parse failure.
 */
export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Read an integer from an environment variable with a fallback default.
 */
export function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Truncate a date to the start of a time bucket (hour, day, or week).
 * Used for time-series aggregation in cost and analytics endpoints.
 */
export function truncateToBucket(date: Date, bucket: 'hour' | 'day' | 'week'): string {
  const d = new Date(date);
  if (bucket === 'week') {
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
  } else if (bucket === 'hour') {
    d.setMinutes(0, 0, 0);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d.toISOString();
}
