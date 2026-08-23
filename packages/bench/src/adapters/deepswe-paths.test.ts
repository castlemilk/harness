import { describe, expect, it } from 'vitest';
import { rewriteContainerPaths } from './deepswe.js';

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
