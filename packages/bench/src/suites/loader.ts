import path from 'node:path';
import type { BenchmarkTask } from '../types.js';
import { syntheticSuite } from './synthetic.js';
import { fastSuite } from './fast.js';
import { deepSuite } from './deep.js';
import { harderSuite } from './harder.js';
import { harderV2Suite } from './harder-v2.js';
import { hardTargetedSuite } from './hard-targeting.js';
import { hardSuite } from './hard.js';
import { loadDeepSWESuite } from '../adapters/deepswe.js';
import { loadSWebenchLiteSuite } from '../adapters/swebench.js';

export type SuiteMode = 'run' | 'consensus' | 'strategy';

export interface SuiteLoadOptions {
  suite: string;
  path?: string;
  nTasks?: number;
  sampleSeed?: number;
  taskIds?: string[];
  repos?: string[];
  useDocker?: boolean;
  mode?: SuiteMode;
}

export const SUITES_BY_MODE: Record<SuiteMode, string[]> = {
  run: ['synthetic', 'fast', 'deep', 'hard', 'harder', 'harder-v2', 'hard-targeting', 'deep-swe', 'swebench-lite'],
  consensus: ['fast', 'deep', 'harder', 'harder-v2', 'hard-targeting', 'hard'],
  strategy: ['fast', 'deep', 'harder', 'harder-v2', 'hard-targeting'],
};

function filterByIds(tasks: BenchmarkTask[], taskIds: string[]): BenchmarkTask[] {
  return taskIds.length > 0 ? tasks.filter((t) => taskIds.includes(t.id)) : tasks;
}

/**
 * Load the task list for a suite, applying the common filters
 * (taskIds, nTasks, sampleSeed) + the mode's suite allow-list.
 */
export async function loadSuiteTasks(options: SuiteLoadOptions): Promise<{ tasks: BenchmarkTask[]; suiteName: string }> {
  const mode = options.mode ?? 'run';
  const allowed = SUITES_BY_MODE[mode];
  if (!allowed.includes(options.suite)) {
    throw new Error(`Unknown suite for ${mode} mode: ${options.suite}. Allowed: ${allowed.join(' | ')}`);
  }

  const { suite } = options;
  let tasks: BenchmarkTask[];
  let suiteName: string;

  if (suite === 'deep-swe') {
    if (!options.path) throw new Error('--path is required for the deep-swe suite');
    tasks = await loadDeepSWESuite({
      tasksDir: options.path,
      nTasks: options.nTasks,
      sampleSeed: options.sampleSeed,
      taskIds: options.taskIds,
      useDocker: options.useDocker,
    });
    suiteName = 'deep-swe';
  } else if (suite === 'synthetic') {
    tasks = filterByIds(syntheticSuite(), options.taskIds ?? []);
    suiteName = 'synthetic';
  } else if (suite === 'fast') {
    tasks = filterByIds(fastSuite(), options.taskIds ?? []);
    suiteName = 'fast';
  } else if (suite === 'deep') {
    tasks = filterByIds(deepSuite(), options.taskIds ?? []);
    suiteName = 'deep';
  } else if (suite === 'hard') {
    if (!options.path) throw new Error('--path is required for the hard suite');
    tasks = filterByIds(await hardSuite(options.path), options.taskIds ?? []);
    suiteName = 'hard';
  } else if (suite === 'harder') {
    tasks = filterByIds(harderSuite(), options.taskIds ?? []);
    suiteName = 'harder';
  } else if (suite === 'harder-v2') {
    tasks = filterByIds(harderV2Suite(), options.taskIds ?? []);
    suiteName = 'harder-v2';
  } else if (suite === 'hard-targeting') {
    tasks = filterByIds(hardTargetedSuite(), options.taskIds ?? []);
    suiteName = 'hard-targeting';
  } else if (suite === 'swebench-lite') {
    if (!options.path) throw new Error('--path is required for the swebench-lite suite (path to JSON file)');
    tasks = await loadSWebenchLiteSuite({
      datasetPath: path.resolve(options.path),  // match runCmd's behavior (bench.ts:201)
      nTasks: options.nTasks,
      sampleSeed: options.sampleSeed,
      taskIds: options.taskIds,
      repos: options.repos,
    });
    suiteName = 'swebench-lite';
  } else {
    throw new Error(`Unknown suite: ${suite}`);
  }

  return { tasks, suiteName };
}
