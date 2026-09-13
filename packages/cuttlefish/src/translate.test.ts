import { describe, it, expect } from 'vitest';
import {
  buildStartRunRequest,
  buildTaskInputs,
  buildTaskWorkflowDocument,
  buildTaskWorkflowYaml,
  interpolateWorkflowTemplate,
  sanitizeWorkflowName,
} from './translate.js';

const task = {
  id: '11111111-2222-3333-4444-555555555555',
  title: 'Add a greet util',
  description: 'Create src/greet.js',
  complexity: 'medium',
  tags: ['agent', 'code'],
};

const project = { id: 'project-1', name: 'demo', path: '/tmp/demo', repoUrl: 'https://example.com/demo.git' };

describe('translate', () => {
  it('sanitizes workflow names to DNS labels', () => {
    expect(sanitizeWorkflowName('Omega Task: Add greet!!')).toBe('omega-task-add-greet');
    expect(sanitizeWorkflowName('')).toBe('omega-task');
  });

  it('builds inputs from task and project', () => {
    const inputs = buildTaskInputs({ task, project });
    expect(inputs.taskId).toBe(task.id);
    expect(inputs.taskTitle).toBe('Add a greet util');
    expect(inputs.projectName).toBe('demo');
    expect(inputs.taskTags).toEqual(['agent', 'code']);
  });

  it('generates a smoke workflow that validates against the example catalog', () => {
    const doc = buildTaskWorkflowDocument({ task, project });
    expect(doc.apiVersion).toBe('cuttlefish.dev/v1alpha1');
    expect(doc.metadata.name).toBe('omega-11111111');
    expect(doc.spec.nodes.map((n) => n.id)).toEqual(['echo', 'write']);
    expect(doc.spec.edges).toHaveLength(2);

    const yaml = buildTaskWorkflowYaml({ task, project });
    expect(yaml).toContain('kind: Workflow');
    expect(yaml).toContain('taskRef:');
    expect(yaml).toContain('name: examples/echo');
  });

  it('generates a single inline node when image and command are configured', () => {
    const doc = buildTaskWorkflowDocument({
      task,
      project,
      connection: { nodeImage: 'node:20-alpine', nodeCommand: 'echo "{{task.title}}"' },
    });
    // Cuttlefish requires spec.edges even when there are no dataflow edges.
    expect(doc.spec.edges).toEqual([]);

    const yaml = buildTaskWorkflowYaml({
      task,
      project,
      connection: { nodeImage: 'node:20-alpine', nodeCommand: 'echo "{{task.title}}"' },
    });
    expect(yaml).toContain('node:20-alpine');
    expect(yaml).toContain('Add a greet util');
    expect(yaml).toContain('run:');
    expect(yaml).not.toContain('taskRef');
  });

  it('interpolates workflow templates with task and project context', () => {
    const template = 'metadata:\n  name: {{project.name}}-flow\ndescription: {{task.description}}\n';
    const result = interpolateWorkflowTemplate(template, {
      'project.name': 'demo',
      'task.description': 'Create src/greet.js',
    });
    expect(result).toContain('name: demo-flow');
    expect(result).toContain('description: Create src/greet.js');
  });

  it('prefers a pinned workflow version over generated YAML', () => {
    const request = buildStartRunRequest({
      task,
      project,
      connection: { workflowVersionId: '99999999-8888-7777-6666-555555555555' },
    });
    expect(request.workflowVersionId).toBe('99999999-8888-7777-6666-555555555555');
    expect(request.workflowYAML).toBeUndefined();
    expect(request.dispatchMode).toBe('autopilot');
  });

  it('carries runner selectors into the start request', () => {
    const request = buildStartRunRequest({
      task,
      project,
      connection: {
        runnerPool: 'gpu',
        runnerLabels: { region: 'syd' },
        runnerCapabilities: ['docker'],
        intentProfile: 'high_capacity',
        dispatchMode: 'manual',
      },
    });
    expect(request.runnerPoolName).toBe('gpu');
    expect(request.runnerLabels).toEqual({ region: 'syd' });
    expect(request.runnerCapabilities).toEqual(['docker']);
    expect(request.intentProfile).toBe('high_capacity');
    expect(request.dispatchMode).toBe('manual');
  });
});
