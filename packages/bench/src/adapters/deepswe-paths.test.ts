import { describe, expect, it } from 'vitest';
import {
  ALL_TASK_ENVIRONMENT_OVERRIDES,
  applyKnownEnvironmentFailures,
  getTaskEnvironmentOverride,
  rewriteContainerPaths,
} from './deepswe.js';

/**
 * Container-path rewriting for deep-swe task configs.
 *
 * Every case here is drawn from a real deep-swe task config whitelist. The
 * failure mode being pinned is silent and total: a mangled test id can never
 * match anything pytest/go emits, so it counts as "missing from report" and
 * zeroes the task for EVERY model on EVERY run.
 */
const targets = {
  '/logs/verifier': '/host/verifier',
  '/logs/artifacts': '/host/artifacts',
  '/tests': '/host/tests',
  '/app': '/host/app',
} as const;

describe('rewriteContainerPaths', () => {
  it('keeps a /tests segment inside an /app path intact (psd-tools: 428 ids)', () => {
    expect(
      rewriteContainerPaths('tests/test_psd.py::test_psd_read_write[/app/tests/psd_files/0layers.psb]', targets),
    ).toBe('tests/test_psd.py::test_psd_read_write[/host/app/tests/psd_files/0layers.psb]');
  });

  it('never rewrites /app inside an ordinary word (tomlkit, csstree, expr)', () => {
    // A \b-less pattern mangled these into `[invalid/table<APP_DIR>end-...]`.
    expect(
      rewriteContainerPaths('tests.test_toml_tests.test_invalid_decode[invalid/table/append-with-dotted-keys-01]', targets),
    ).toBe('tests.test_toml_tests.test_invalid_decode[invalid/table/append-with-dotted-keys-01]');
    expect(rewriteContainerPaths('/application/config', targets)).toBe('/application/config');
    expect(rewriteContainerPaths('appendix /appliance', targets)).toBe('appendix /appliance');
  });

  it('never rewrites /app inside a Go subtest name (pebble)', () => {
    expect(rewriteContainerPaths('TestBatchGet/apply,mem=67108864', targets)).toBe(
      'TestBatchGet/apply,mem=67108864',
    );
  });

  it('still rewrites genuinely container-rooted paths', () => {
    expect(rewriteContainerPaths('cp /tests/config.json /logs/verifier/out', targets)).toBe(
      'cp /host/tests/config.json /host/verifier/out',
    );
    expect(rewriteContainerPaths('cd /app && pytest /tests', targets)).toBe(
      'cd /host/app && pytest /host/tests',
    );
    expect(rewriteContainerPaths('/app', targets)).toBe('/host/app');
  });

  it('handles several ids on one line, and :: separators', () => {
    expect(rewriteContainerPaths('/app/tests/a.py::t[x] /app/tests/b.py::u[/app/tests/f.bin]', targets)).toBe(
      '/host/app/tests/a.py::t[x] /host/app/tests/b.py::u[/host/app/tests/f.bin]',
    );
  });

  it('is not confusable by a sentinel already present in the input', () => {
    const sentinel = '\uE000';
    expect(rewriteContainerPaths(`A${sentinel}0${sentinel}B /app/real`, targets)).toBe('A0B /host/app/real');
  });

  it('leaves strings with no container paths untouched', () => {
    expect(rewriteContainerPaths('pytest -q tests/unit', targets)).toBe('pytest -q tests/unit');
  });
});

const ankoTask = 'anko-default-function-arguments';
const ankoHttpTest = 'github.com/mattn/anko/vm.Example_vmHttp';

describe('DeepSWE task environment overrides', () => {
  it('caps Narwhals below the PyArrow release that introduced its fatal warning', () => {
    const override = getTaskEnvironmentOverride('narwhals-rolling-window-suite');

    expect(override?.pip).toEqual(['pyarrow>=23,<25']);
    expect(override?.dependencyReason).toContain('filterwarnings');
  });

  it('removes only the exact known Anko p2p failure from the copied grader config', () => {
    const input = {
      f2p_node_ids: [ankoHttpTest],
      p2p_node_ids: [`${ankoHttpTest}/near-match`, ankoHttpTest, 'github.com/mattn/anko/vm.Example_vmMaps'],
    };

    // The exclusion is evidence-bearing: it applies only when :8080 is busy.
    const result = applyKnownEnvironmentFailures(ankoTask, input, new Set([8080]));

    expect(result.config.p2p_node_ids).toEqual([
      `${ankoHttpTest}/near-match`,
      'github.com/mattn/anko/vm.Example_vmMaps',
    ]);
    expect(result.config.f2p_node_ids).toEqual([ankoHttpTest]);
    expect(input.p2p_node_ids).toContain(ankoHttpTest);
    expect(result.applied).toEqual([
      expect.objectContaining({
        kind: 'known-p2p-environment-failure',
        task: ankoTask,
        testId: ankoHttpTest,
        reason: expect.stringContaining(':8080'),
      }),
    ]);
    expect(result.config.omega_known_environment_failures).toEqual([
      expect.objectContaining({
        bucket: 'p2p',
        task: ankoTask,
        test_id: ankoHttpTest,
        reason: expect.stringContaining(':8080'),
      }),
    ]);
  });

  it('does not alter another task config', () => {
    const input = { p2p_node_ids: [ankoHttpTest] };

    expect(applyKnownEnvironmentFailures('another-task', input)).toEqual({
      config: input,
      applied: [],
    });
  });

  it('does not claim an exclusion when the exact Anko id is absent', () => {
    const input = { p2p_node_ids: [`${ankoHttpTest}/near-match`] };

    expect(applyKnownEnvironmentFailures(ankoTask, input)).toEqual({
      config: input,
      applied: [],
    });
  });
});

describe('known-environment-failure exclusions are evidence-bearing', () => {
  const ankoTaskName = 'anko-default-function-arguments';
  const httpTest = 'github.com/mattn/anko/vm.Example_vmHttp';
  const cfg = () => ({
    f2p_node_ids: [httpTest],
    p2p_node_ids: [httpTest, `${httpTest}Secure`, 'github.com/mattn/anko/vm.Example_vmMaps'],
  });

  it('withholds the exclusion when the asserted port is NOT busy', () => {
    // A real regression in that test must fail the task, not be forgiven by
    // an exclusion whose stated cause never happened.
    const result = applyKnownEnvironmentFailures(ankoTaskName, cfg(), new Set<number>());
    expect(result.applied).toEqual([]);
    expect(result.config.p2p_node_ids).toContain(httpTest);
  });

  it('applies it only when the asserted port IS busy, and only to that id', () => {
    const result = applyKnownEnvironmentFailures(ankoTaskName, cfg(), new Set([8080]));
    expect(result.applied).toHaveLength(1);
    expect(result.config.p2p_node_ids).toEqual([
      `${httpTest}Secure`,
      'github.com/mattn/anko/vm.Example_vmMaps',
    ]);
    // f2p is never touched by a p2p exclusion.
    expect(result.config.f2p_node_ids).toEqual([httpTest]);
  });

  it('a different busy port does not unlock the exclusion', () => {
    const result = applyKnownEnvironmentFailures(ankoTaskName, cfg(), new Set([9090]));
    expect(result.applied).toEqual([]);
  });

  it('scope guard: exactly one task carries exactly one excluded id', () => {
    // The property most likely to erode in future edits.
    const withExclusions = ALL_TASK_ENVIRONMENT_OVERRIDES.filter(
      ([, override]) => (override.knownP2PEnvironmentFailures ?? []).length > 0,
    );
    expect(withExclusions.map(([task]) => task)).toEqual([ankoTaskName]);
    expect(withExclusions[0][1].knownP2PEnvironmentFailures).toHaveLength(1);
  });
});
