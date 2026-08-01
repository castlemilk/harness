import type { BenchmarkTask } from '../types.js';
import { loadDeepSWESuite } from '../adapters/deepswe.js';

/**
 * Hard regression suite: DeepSWE tasks that previously failed on the current
 * harness. Use this to drive capability improvements and to verify they stick.
 */
export const HARD_DEEPSWE_TASK_IDS = [
  'ytt-jsonpath-query-api',
  'dynamodb-toolbox-conditional-attribute-requirements',
  'katex-multicolumn-array-spans',
  'cliffy-config-file-parsing',
  'query-persist-restored-query-state',
  'mnamer-daemon-watch-lifecycle',
];

export async function hardSuite(tasksDir: string): Promise<BenchmarkTask[]> {
  return loadDeepSWESuite({ tasksDir, taskIds: HARD_DEEPSWE_TASK_IDS });
}
