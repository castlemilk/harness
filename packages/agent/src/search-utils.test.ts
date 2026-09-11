import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { codeOverview } from './search-utils.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('codeOverview', () => {
  it('describes Go modules and discovers Go source and test files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-search-utils-'));
    temporaryDirectories.push(directory);
    await fs.writeFile(path.join(directory, 'go.mod'), 'module github.com/example/abs\n', 'utf-8');
    await fs.mkdir(path.join(directory, 'parser'), { recursive: true });
    await fs.writeFile(path.join(directory, 'parser', 'parser.go'), 'package parser\n', 'utf-8');
    await fs.writeFile(path.join(directory, 'parser', 'parser_test.go'), 'package parser\n', 'utf-8');

    const result = await codeOverview(directory);

    expect(result.success).toBe(true);
    expect(result.output).toContain('language: go');
    expect(result.output).toContain('module: github.com/example/abs');
    expect(result.output).toContain('source roots: parser');
    expect(result.output).toContain('[f] parser/parser_test.go');
  });
});
