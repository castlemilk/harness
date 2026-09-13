import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { editFile, editLines, readFile, writeFile } from './file-utils.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('Go edit formatting', () => {
  it('rejects and rolls back a syntactically invalid Go edit', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-file-utils-'));
    temporaryDirectories.push(directory);
    const original = 'package main\n\nfunc main() {}\n';
    await fs.writeFile(path.join(directory, 'main.go'), original, 'utf-8');

    const result = await editLines(directory, 'main.go', 3, 3, 'func main( {');

    expect(result.success).toBe(false);
    expect(result.output).toContain('gofmt failed');
    expect(result.output).toContain('restored to its previous contents');
    await expect(fs.readFile(path.join(directory, 'main.go'), 'utf-8')).resolves.toBe(original);
  });

  it('uses the canonical target for module paths and unique bare filenames', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-file-utils-'));
    temporaryDirectories.push(directory);
    await fs.writeFile(path.join(directory, 'go.mod'), 'module github.com/example/abs\n', 'utf-8');
    await fs.mkdir(path.join(directory, 'evaluator'), { recursive: true });
    await fs.writeFile(path.join(directory, 'evaluator', 'evaluator_test.go'), 'package evaluator\n\nconst old = 1\n', 'utf-8');

    const editResult = await editFile(directory, 'evaluator_test.go', 'const old = 1', 'const updated = 2');
    expect(editResult).toEqual({ success: true, output: 'Edited evaluator/evaluator_test.go' });

    const readResult = await readFile(directory, 'github.com/example/abs/evaluator/evaluator_test.go');
    expect(readResult.success).toBe(true);
    expect(readResult.output).toContain('const updated = 2');
  });

  it('rejects new language-specific test files while allowing existing test edits', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-file-utils-'));
    temporaryDirectories.push(directory);

    const result = await writeFile(directory, 'evaluator/stepped_temp_test.go', 'package evaluator\n');

    expect(result.success).toBe(false);
    expect(result.output).toContain('test/spec paths');
    await expect(fs.access(path.join(directory, 'evaluator', 'stepped_temp_test.go'))).rejects.toThrow();
  });
});
