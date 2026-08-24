import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDeepSWESuite } from './deepswe.js';

const BASELINE_EXHORTATION = 'Implement precisely to the spec below - the hidden test suite checks exact behaviour (error message text, formatting, attribute names, signatures).';
const TASK_INSTRUCTION = 'Return the exact error `example failure` for invalid input.';
const roots: string[] = [];
const originalSpecGate = process.env.OMEGA_DEEPSWE_SPEC_GATE;
const originalTimeBudget = process.env.OMEGA_DEEPSWE_TIME_BUDGET;

function restorePromptSwitches(): void {
  if (originalSpecGate === undefined) {
    Reflect.deleteProperty(process.env, 'OMEGA_DEEPSWE_SPEC_GATE');
  } else {
    process.env.OMEGA_DEEPSWE_SPEC_GATE = originalSpecGate;
  }
  if (originalTimeBudget === undefined) {
    Reflect.deleteProperty(process.env, 'OMEGA_DEEPSWE_TIME_BUDGET');
  } else {
    process.env.OMEGA_DEEPSWE_TIME_BUDGET = originalTimeBudget;
  }
}

async function loadDescription(timeoutMs?: number): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-description-'));
  roots.push(root);
  const taskDir = path.join(root, 'description-task');
  await fs.mkdir(path.join(taskDir, 'tests'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(taskDir, 'task.toml'), `[task]\nname = "description-task"\n\n[metadata]\ntask_id = "description-task"\ndisplay_title = "Description task"\nlanguage = "python"\n`, 'utf-8'),
    fs.writeFile(path.join(taskDir, 'instruction.md'), `${TASK_INSTRUCTION}\n`, 'utf-8'),
    fs.writeFile(path.join(taskDir, 'tests', 'config.json'), '{"f2p_node_ids":["DO_NOT_LEAK_CONFIG_SENTINEL"]}\n', 'utf-8'),
    fs.writeFile(path.join(taskDir, 'tests', 'test.patch'), 'DO_NOT_LEAK_PATCH_SENTINEL\n', 'utf-8'),
  ]);

  const [task] = await loadDeepSWESuite({ tasksDir: root, timeoutMs });
  return task.description ?? '';
}

afterEach(async () => {
  restorePromptSwitches();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('DeepSWE task description', () => {
  it('enables the ordered executable spec gate by default without leaking hidden verifier inputs', async () => {
    Reflect.deleteProperty(process.env, 'OMEGA_DEEPSWE_SPEC_GATE');

    const description = await loadDescription();
    const phases = [
      '1. Plan and spec-check',
      '2. Implement',
      '3. Verify',
      '4. Clean up',
      '5. Finish',
    ];

    expect(description).toContain('SPEC GATE');
    expect(description).toContain('omega_specgate');
    expect(description).toContain('expected to fail before implementation');
    expect(description).toContain('exact string comparison');
    expect(description).toContain('not a substring');
    expect(description).toContain('defaults');
    expect(description).toContain('boundary and negative cases');
    const positions = phases.map((phase) => description.indexOf(phase));
    expect(positions.every((position) => position >= 0)).toBe(true);
    for (let index = 1; index < phases.length; index++) {
      expect(positions[index]).toBeGreaterThan(positions[index - 1]);
    }
    expect(description).not.toContain(BASELINE_EXHORTATION);
    expect(description).not.toContain('DO_NOT_LEAK_CONFIG_SENTINEL');
    expect(description).not.toContain('DO_NOT_LEAK_PATCH_SENTINEL');
    expect(description).not.toContain('f2p_node_ids');
    expect(description.indexOf(TASK_INSTRUCTION)).toBeLessThan(description.indexOf('1. Plan and spec-check'));
    expect(description.length - TASK_INSTRUCTION.length).toBeLessThan(2_259);
  });

  it.each(['0', 'false', 'off', 'no', 'OFF', 'NO'])('accepts %s as a case-insensitive spec-gate off value', async (value) => {
    process.env.OMEGA_DEEPSWE_SPEC_GATE = value;

    const description = await loadDescription();

    expect(description).toContain(BASELINE_EXHORTATION);
    expect(description).not.toContain('SPEC GATE');
  });

  it('keeps the spec gate and time-budget experiments independently switchable', async () => {
    process.env.OMEGA_DEEPSWE_SPEC_GATE = 'off';
    Reflect.deleteProperty(process.env, 'OMEGA_DEEPSWE_TIME_BUDGET');
    const timeOnly = await loadDescription(1_200_000);
    expect(timeOnly).toContain(BASELINE_EXHORTATION);
    expect(timeOnly).not.toContain('SPEC GATE');
    expect(timeOnly).toContain('20 minutes');

    Reflect.deleteProperty(process.env, 'OMEGA_DEEPSWE_SPEC_GATE');
    process.env.OMEGA_DEEPSWE_TIME_BUDGET = 'off';
    const gateOnly = await loadDescription(1_200_000);
    expect(gateOnly).toContain('SPEC GATE');
    expect(gateOnly).not.toContain('TIME BUDGET');
    expect(gateOnly).not.toContain('20 minutes');
  });

  it('reproduces the pre-change prompt byte for byte when both experiments are off', async () => {
    process.env.OMEGA_DEEPSWE_SPEC_GATE = 'off';
    process.env.OMEGA_DEEPSWE_TIME_BUDGET = 'no';

    const description = await loadDescription(1_200_000);

    expect(description).toBe(`Language: Python.
- Use interpreter: python3.12 (DeepSWE tasks pin older native deps; python3.13+ often fails to build pydantic-core/msgspec/orjson wheels). If python3.12 is unavailable, fall back to python3.
- Install deps if missing: python3.12 -m venv .venv && source .venv/bin/activate && pip install -e .  (or: pip install -r requirements.txt)
- Run existing tests: python3.12 -m pytest -q  (uses .venv if present)
- If no pytest, fall back to: python3.12 -m unittest

BUILD GATE (critical): the verifier scores you zero if the project does not compile or the existing test suite breaks. Before calling finish you MUST:
   1. Run the build/compile command above and confirm zero errors.
   2. Run the existing test command above and confirm the pre-existing tests still pass.
   3. If either fails, fix it before finishing. Do NOT finish while the build is broken.

SCOPE CONSTRAINT: Only edit source files directly related to the task. Do NOT modify CI/CD configs (.github/, .coderabbit.yaml, .codesandbox/), documentation (README.md, AUTHORS, CONTRIBUTING.md), meta files (.release-it.json, .prettierignore), build configs (package.json, rollup.config.js, webpack.config.js, tsconfig.json), or project scaffolding. Do NOT delete existing files. Do NOT create new files unless necessary for the implementation. Every extraneous change wastes steps and risks breaking the verifier.

${BASELINE_EXHORTATION}

---
${TASK_INSTRUCTION}`);
  });

  it('states the total wall-clock budget and the named verification cutoff', async () => {
    const description = await loadDescription(1_200_000);

    expect(description).toContain('20 minutes');
    expect(description).toContain('60% of the budget');
    expect(description).toContain('12 minutes');
    expect(description).toContain('get the new behaviour working, then reserve time to run the existing suite and fix every regression you caused');
    expect(description).toContain('a broken existing test scores zero no matter how good the feature is');
    expect(description).toContain('stop exploring and start verifying');
    expect(description).toContain('Internal runs report both steps and wall-clock remaining in budget notices');
    expect(description).toContain('external CLI runs receive their launch time and absolute UTC deadline');
    expect(description).not.toContain('runner or provider may impose an earlier deadline');
  });

  it('describes a sub-second budget without rounding it up to a second', async () => {
    const description = await loadDescription(1);

    expect(description).toContain('1 millisecond');
    expect(description).toContain('0.6 milliseconds elapsed');
    expect(description).not.toContain('1 second');
  });

  it('omits time guidance when no valid budget was supplied', async () => {
    const description = await loadDescription(Number.NaN);

    expect(description).not.toContain('TIME BUDGET');
    expect(description).not.toContain('NaN');
    expect(description).not.toContain('undefined');
  });
});
