import { xml } from './prompt-formatters.js';

export interface CodexTaskPromptOptions {
  title: string;
  description?: string;
  verificationCommand?: string;
  extraContext?: string;
}

export function buildCodexTaskPrompt(options: CodexTaskPromptOptions): string {
  const { title, description, verificationCommand, extraContext } = options;

  const taskBody = [
    description ? `Implement the following task.\n\n${description}` : 'Implement the following task.',
    extraContext ? `\n\nRepository context:\n${extraContext}` : '',
  ].join('');

  const blocks = [
    xml('task', `${title}\n\n${taskBody}`),
    xml(
      'structured_output_contract',
      'Return exactly the requested output shape and nothing else.\nKeep the answer compact.\nPut the highest-value findings or decisions first.',
    ),
    xml(
      'default_follow_through_policy',
      'Default to the most reasonable low-risk interpretation and keep going.\nOnly stop to ask questions when a missing detail changes correctness, safety, or an irreversible action.',
    ),
    xml(
      'completeness_contract',
      'Resolve the task fully before stopping.\nDo not stop at the first plausible answer.\nCheck whether there are follow-on fixes, edge cases, or cleanup needed for a correct result.',
    ),
    xml(
      'verification_loop',
      verificationCommand
        ? `Run the verification command below against your changes before finalizing:\n${verificationCommand}\nIf it fails, revise the code and rerun until it passes.`
        : 'Before finalizing, verify the result against the task requirements and the changed files or tool outputs.\nIf a check fails, revise the answer instead of reporting the first draft.',
    ),
    xml(
      'action_safety',
      'Keep changes tightly scoped to the stated task.\nAvoid unrelated refactors, renames, or cleanup unless they are required for correctness.\nCall out any risky or irreversible action before taking it.',
    ),
  ];

  return blocks.join('\n');
}
