import type { DispatchMode, IntentProfile, StartRunRequest } from './types.js';
import { toWorkflowYaml } from './yaml.js';

/**
 * Translates a harness task into a cuttlefish `Workflow` document.
 *
 * Three translation modes, in priority order:
 *
 * 1. `workflowTemplate` — a YAML template with `{{task.*}}` / `{{project.*}}`
 *    placeholders. Interpolated verbatim, so teams can shape the DAG.
 * 2. `nodeImage` + `nodeCommand` — a single inline node that runs the given
 *    shell command in the given container image.
 * 3. Default smoke workflow — `examples/echo` → `examples/write-file` from the
 *    cuttlefish example catalog. Useful to verify the wiring end to end.
 */

export interface FlowTaskInput {
  id: string;
  title: string;
  description?: string | null;
  complexity?: string | null;
  tags?: string[] | null;
  provider?: string | null;
  model?: string | null;
}

export interface FlowProjectInput {
  id: string;
  name: string;
  path?: string | null;
  repoUrl?: string | null;
}

export interface FlowRuntimeConfig {
  /** Pins the run to an already-published workflow version. */
  workflowVersionId?: string | null;
  /** YAML template with `{{...}}` placeholders. */
  workflowTemplate?: string | null;
  /** Inline-node container image (mode 2). */
  nodeImage?: string | null;
  /** Inline-node shell command (mode 2). */
  nodeCommand?: string | null;
  nodeTimeout?: string | null;
  nodeRetries?: number | null;
  runnerPool?: string | null;
  runnerLabels?: Record<string, string> | null;
  runnerCapabilities?: string[] | null;
  dispatchMode?: DispatchMode | null;
  intentProfile?: IntentProfile | null;
  candidateLimit?: number | null;
  /** Extra inputs merged into every generated run. */
  baseInputs?: Record<string, unknown> | null;
}

export interface BuildTaskWorkflowInput {
  task: FlowTaskInput;
  project: FlowProjectInput;
  connection?: FlowRuntimeConfig;
  /** Overrides the generated workflow name (defaults to `omega-<task short id>`). */
  workflowName?: string;
  /** Omega server URL exposed to workflow templates. */
  serverUrl?: string;
}

export interface WorkflowNode {
  id: string;
  kind: 'task';
  taskRef?: { name: string; version: string };
  image?: string;
  script?: string;
  inputs?: Record<string, { value: unknown } | { secretRef: { name: string } }>;
  run?: { timeout?: string; retry?: { maxAttempts: number } };
  disabled?: boolean;
  dockerSocket?: boolean;
}

export interface WorkflowEdge {
  id: string;
  from: { input: string } | { node: string; port: string };
  to: { node: string; port: string };
}

export interface WorkflowDocument {
  apiVersion: 'cuttlefish.dev/v1alpha1';
  kind: 'Workflow';
  metadata: { name: string; description?: string };
  spec: {
    inputs?: {
      schema?: Record<string, unknown>;
      defaults?: Record<string, unknown>;
    };
    nodes: WorkflowNode[];
    edges?: WorkflowEdge[];
    outputs?: Record<string, { from: { node: string; port: string } }>;
    triggers?: Record<string, unknown>[];
  };
}

const WORKFLOW_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    taskTitle: { type: 'string' },
    taskDescription: { type: 'string' },
    taskComplexity: { type: 'string' },
    taskTags: { type: 'array', items: { type: 'string' } },
    taskProvider: { type: 'string' },
    taskModel: { type: 'string' },
    projectId: { type: 'string' },
    projectName: { type: 'string' },
    projectPath: { type: 'string' },
    repoUrl: { type: 'string' },
    omegaServerUrl: { type: 'string' },
  },
  required: ['taskId', 'taskTitle', 'projectId', 'projectName'],
};

export function sanitizeWorkflowName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug.length > 0 ? slug : 'omega-task';
}

export function buildFlowContext(input: BuildTaskWorkflowInput): Record<string, string> {
  const { task, project } = input;
  return {
    'task.id': task.id,
    'task.title': task.title,
    'task.description': task.description ?? '',
    'task.complexity': task.complexity ?? 'simple',
    'task.tags': (task.tags ?? []).join(','),
    'task.provider': task.provider ?? '',
    'task.model': task.model ?? '',
    'project.id': project.id,
    'project.name': project.name,
    'project.path': project.path ?? '',
    'project.repoUrl': project.repoUrl ?? '',
    'omega.serverUrl': input.serverUrl ?? '',
  };
}

const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export function interpolateWorkflowTemplate(template: string, context: Record<string, string | undefined>): string {
  return template.replace(PLACEHOLDER_RE, (match, key: string) => {
    const value = context[key];
    return value ?? match;
  });
}

export function buildTaskInputs(input: BuildTaskWorkflowInput): Record<string, unknown> {
  const { task, project, connection } = input;
  return {
    ...(connection?.baseInputs ?? {}),
    taskId: task.id,
    taskTitle: task.title,
    taskDescription: task.description ?? '',
    taskComplexity: task.complexity ?? 'simple',
    taskTags: task.tags ?? [],
    taskProvider: task.provider ?? '',
    taskModel: task.model ?? '',
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path ?? '',
    repoUrl: project.repoUrl ?? '',
    omegaServerUrl: input.serverUrl ?? '',
  };
}

export function buildTaskWorkflowDocument(input: BuildTaskWorkflowInput): WorkflowDocument {
  const name = sanitizeWorkflowName(input.workflowName ?? `omega-${input.task.id.slice(0, 8)}`);
  const connection = input.connection ?? {};

  if (connection.workflowTemplate) {
    throw new Error('buildTaskWorkflowDocument cannot render a workflowTemplate; use buildTaskWorkflowYaml');
  }

  if (connection.nodeImage && connection.nodeCommand) {
    const context = buildFlowContext(input);
    return {
      apiVersion: 'cuttlefish.dev/v1alpha1',
      kind: 'Workflow',
      metadata: {
        name,
        description: `Omega task: ${input.task.title}`,
      },
      spec: {
        inputs: { schema: WORKFLOW_INPUT_SCHEMA },
        nodes: [
          {
            id: 'execute',
            kind: 'task',
            image: connection.nodeImage,
            script: interpolateWorkflowTemplate(connection.nodeCommand, context),
            run: {
              timeout: connection.nodeTimeout ?? '30m',
              ...(connection.nodeRetries ? { retry: { maxAttempts: connection.nodeRetries } } : {}),
            },
          },
        ],
        edges: [],
        triggers: [{ kind: 'manual' }],
      },
    };
  }

  return {
    apiVersion: 'cuttlefish.dev/v1alpha1',
    kind: 'Workflow',
    metadata: {
      name,
      description: `Omega task: ${input.task.title}`,
    },
    spec: {
      inputs: { schema: WORKFLOW_INPUT_SCHEMA },
      nodes: [
        { id: 'echo', kind: 'task', taskRef: { name: 'examples/echo', version: '0.1.0' } },
        {
          id: 'write',
          kind: 'task',
          taskRef: { name: 'examples/write-file', version: '0.1.0' },
          inputs: { path: { value: `omega/${input.task.id}.txt` } },
        },
      ],
      edges: [
        {
          id: 'e_input_taskTitle__echo_who',
          from: { input: 'taskTitle' },
          to: { node: 'echo', port: 'who' },
        },
        {
          id: 'e_echo_message__write_content',
          from: { node: 'echo', port: 'message' },
          to: { node: 'write', port: 'content' },
        },
      ],
      triggers: [{ kind: 'manual' }],
    },
  };
}

export function buildTaskWorkflowYaml(input: BuildTaskWorkflowInput): string {
  const connection = input.connection ?? {};
  if (connection.workflowTemplate) {
    return interpolateWorkflowTemplate(connection.workflowTemplate, buildFlowContext(input));
  }
  return toWorkflowYaml(buildTaskWorkflowDocument(input));
}

export function buildStartRunRequest(input: BuildTaskWorkflowInput): StartRunRequest {
  const connection = input.connection ?? {};
  const request: StartRunRequest = {
    inputs: buildTaskInputs(input),
    dispatchMode: connection.dispatchMode ?? 'autopilot',
  };

  if (connection.workflowVersionId) {
    request.workflowVersionId = connection.workflowVersionId;
  } else {
    request.workflowYAML = buildTaskWorkflowYaml(input);
  }

  if (connection.runnerPool) request.runnerPoolName = connection.runnerPool;
  if (connection.runnerLabels) request.runnerLabels = connection.runnerLabels;
  if (connection.runnerCapabilities?.length) request.runnerCapabilities = connection.runnerCapabilities;
  if (connection.intentProfile) request.intentProfile = connection.intentProfile;
  if (connection.candidateLimit !== undefined && connection.candidateLimit !== null) {
    request.candidateLimit = connection.candidateLimit;
  }
  return request;
}
