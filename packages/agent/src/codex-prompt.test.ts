import { describe, it, expect } from 'vitest';
import { buildCodexTaskPrompt } from './codex-prompt.js';

describe('buildCodexTaskPrompt', () => {
  it('emits the task and contract blocks in order', () => {
    const prompt = buildCodexTaskPrompt({ title: 'Add slicing', description: 'Support start:end:step.' });

    expect(prompt).toContain('<task>');
    expect(prompt).toContain('Add slicing');
    expect(prompt).toContain('Support start:end:step.');
    expect(prompt.indexOf('<task>')).toBeLessThan(prompt.indexOf('<structured_output_contract>'));
    expect(prompt.indexOf('<structured_output_contract>')).toBeLessThan(prompt.indexOf('<default_follow_through_policy>'));
    expect(prompt.indexOf('<default_follow_through_policy>')).toBeLessThan(prompt.indexOf('<completeness_contract>'));
    expect(prompt.indexOf('<completeness_contract>')).toBeLessThan(prompt.indexOf('<verification_loop>'));
    expect(prompt.indexOf('<verification_loop>')).toBeLessThan(prompt.indexOf('<action_safety>'));
  });

  it('injects the verification command when provided', () => {
    const prompt = buildCodexTaskPrompt({
      title: 'Fix bug',
      verificationCommand: 'pnpm build && pnpm test',
    });

    expect(prompt).toContain('<verification_loop>');
    expect(prompt).toContain('pnpm build && pnpm test');
    expect(prompt).toContain('rerun until it passes');
  });

  it('uses the generic verification loop when no command is given', () => {
    const prompt = buildCodexTaskPrompt({ title: 'Fix bug' });

    expect(prompt).toContain('verify the result against the task requirements');
    expect(prompt).not.toContain('verification command below');
  });

  it('includes extra repository context when provided', () => {
    const prompt = buildCodexTaskPrompt({ title: 'Fix bug', extraContext: 'This is a Rust workspace.' });

    expect(prompt).toContain('Repository context:');
    expect(prompt).toContain('This is a Rust workspace.');
  });

  it('all blocks are closed', () => {
    const prompt = buildCodexTaskPrompt({ title: 'Fix bug', verificationCommand: 'pnpm test' });

    for (const tag of ['task', 'structured_output_contract', 'default_follow_through_policy', 'completeness_contract', 'verification_loop', 'action_safety']) {
      const openCount = prompt.split(`<${tag}>`).length - 1;
      const closeCount = prompt.split(`</${tag}>`).length - 1;
      expect(openCount).toBe(1);
      expect(closeCount).toBe(1);
    }
  });
});
