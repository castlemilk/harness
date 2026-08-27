/**
 * The one client every Prompt Lab view shares.
 *
 * Built from `createDataSource` (the kit transport) against the harness API,
 * NOT fetched by hand: the config → env resolution → typed error behaviour is
 * the kit's, and the health dot in the chrome probes this same source, so a
 * red dot and a red tab always mean the same thing.
 */
import { createDataSource } from '@omega-harness/usecase-kit';
import { HARNESS_API_SOURCE } from './source.js';

export const api = createDataSource(HARNESS_API_SOURCE);

/** One row of the PromptVersion ledger, as the list endpoint returns it. */
export interface PromptVersionRow {
  id: string;
  name: string;
  hash: string;
  benchmarkScore: number | null;
  createdAt: string;
}

/** GET /prompt-versions — newest first, whole prompt texts included but unused here. */
export function loadPromptVersions(
  client: Pick<ReturnType<typeof createDataSource>, 'getJson'>
): Promise<PromptVersionRow[]> {
  return client.getJson<PromptVersionRow[]>('/prompt-versions');
}

/** GET /benchmarks/reports — report file names, newest first, split by kind. */
export interface ReportLists {
  benchmark: string[];
  ab: string[];
}

export interface BenchmarkReportBody {
  passed?: number;
  total?: number;
  results?: {
    task?: { name?: string };
    evaluation?: { passed?: boolean; message?: string | null };
  }[];
}

/** What the Benchmarks tab renders from a lists-plus-latest-body pair. */
export interface BenchSummary {
  /** Newest benchmark report's file name, or null when none exist. */
  file: string | null;
  /** Whole-number percent, or null when the report has no tasks. */
  passRate: number | null;
  /** Failed tasks in report order, message attached. */
  failures: { name: string; message: string | null }[];
  /** All benchmark files, newest first — rendered as the recent list. */
  recent: string[];
}

export function summariseReport(lists: ReportLists, body: BenchmarkReportBody | undefined): BenchSummary {
  // Length-guard rather than `?? null`: an index into a possibly-empty array
  // is genuinely absent at runtime even though the element type says string.
  const file = lists.benchmark.length > 0 ? lists.benchmark[0] : null;
  const total = body?.total ?? 0;
  const passRate = file !== null && total > 0 ? Math.round(((body?.passed ?? 0) / total) * 100) : null;
  const failures = (body?.results ?? [])
    .filter((r) => r.evaluation?.passed === false)
    .map((r) => ({ name: r.task?.name ?? 'unnamed', message: r.evaluation?.message ?? null }));
  return { file, passRate, failures, recent: lists.benchmark };
}

/**
 * The two requests the Benchmarks tab makes, sequenced: the list, then the
 * newest benchmark report's body. Returns null when no reports exist yet — a
 * normal state, not an error.
 */
export async function loadBenchSummary(
  client: Pick<ReturnType<typeof createDataSource>, 'getJson'>
): Promise<BenchSummary | null> {
  const lists = await client.getJson<ReportLists>('/benchmarks/reports');
  if (lists.benchmark.length === 0) return summariseReport(lists, undefined);
  const next = lists.benchmark[0];
  const body = await client.getJson<BenchmarkReportBody>(
    `/benchmarks/reports/${encodeURIComponent(next)}`
  );
  return summariseReport(lists, body);
}
