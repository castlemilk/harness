import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { HarnessApiClient, HarnessApiError, type HarnessApiClientOptions } from './api-client.js';

export interface CreateHarnessMcpServerOptions {
  client: HarnessApiClient;
  name?: string;
  version?: string;
}

const DEFAULT_NAME = 'omega-harness';
const DEFAULT_VERSION = '0.6.11';

function ok(data: unknown): { content: { type: 'text'; text: string }[] } {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function fail(err: unknown): { isError: true; content: { type: 'text'; text: string }[] } {
  const message = err instanceof HarnessApiError
    ? err.message
    : err instanceof Error
      ? err.message
      : String(err);
  return { isError: true, content: [{ type: 'text', text: `Error: ${message}` }] };
}

/**
 * Builds the harness MCP server. Tools are grouped:
 * - `omega_*` project/task/run management
 * - `omega_runtime_*` / `omega_flow_*` cuttlefish workflow runtime
 */
export function createHarnessMcpServer(options: CreateHarnessMcpServerOptions): McpServer {
  const { client } = options;
  const server = new McpServer(
    { name: options.name ?? DEFAULT_NAME, version: options.version ?? DEFAULT_VERSION },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'omega_harness_info',
    {
      title: 'Harness info',
      description: 'Report harness capabilities, execution modes and configured endpoints.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return ok(await client.capabilities());
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ── Projects ────────────────────────────────────────────────────────────
  server.registerTool(
    'omega_projects_list',
    {
      title: 'List projects',
      description: 'List all registered harness projects.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return ok(await client.listProjects());
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_project_create',
    {
      title: 'Create project',
      description: 'Register a project directory or repository with the harness.',
      inputSchema: {
        name: z.string().describe('Human-readable project name'),
        path: z.string().describe('Absolute path to the project checkout'),
        repoUrl: z.string().optional().describe('Optional git remote URL'),
        description: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return ok(await client.createProject(args));
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ── Tasks ───────────────────────────────────────────────────────────────
  server.registerTool(
    'omega_tasks_list',
    {
      title: 'List tasks',
      description: 'List tasks, optionally filtered by project.',
      inputSchema: {
        projectId: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return ok(await client.listTasks(args));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_task_create',
    {
      title: 'Create task',
      description:
        'Create a task. Tags control execution: agent, orchestrate, external:<cli>, flow:<workflow>, flow-version:<id>, runtime:<connection>, flow-off.',
      inputSchema: {
        projectId: z.string().describe('Project id'),
        title: z.string().describe('Short task title'),
        description: z.string().optional().describe('Full task instructions'),
        complexity: z.enum(['simple', 'medium', 'complex']).optional(),
        tags: z.array(z.string()).max(20).optional(),
      },
    },
    async (args) => {
      try {
        return ok(await client.createTask(args));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_task_get',
    {
      title: 'Get task',
      description: 'Fetch a task by id or unique id prefix.',
      inputSchema: { taskId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ taskId }) => {
      try {
        return ok(await client.getTask(taskId));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_task_run',
    {
      title: 'Run task',
      description:
        'Start a task. If its project has an auto-routed cuttlefish runtime or the task carries flow tags, execution is dispatched to cuttlefish; otherwise it runs locally.',
      inputSchema: {
        taskId: z.string(),
        tokenBudget: z.number().int().positive().optional(),
        timeoutMs: z.number().int().positive().optional(),
      },
    },
    async ({ taskId, ...rest }) => {
      try {
        return ok(await client.runTask(taskId, rest));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_task_cancel',
    {
      title: 'Cancel task',
      description: 'Cancel a running task (local agent or cuttlefish flow).',
      inputSchema: { taskId: z.string() },
    },
    async ({ taskId }) => {
      try {
        return ok(await client.cancelTask(taskId));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_task_retry',
    {
      title: 'Retry task',
      description: 'Retry a failed task using the harness retry strategies.',
      inputSchema: { taskId: z.string() },
    },
    async ({ taskId }) => {
      try {
        return ok(await client.retryTask(taskId));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_task_traces',
    {
      title: 'Get task traces',
      description: 'Return the step-by-step trace flow for a task.',
      inputSchema: { taskId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ taskId }) => {
      try {
        return ok(await client.taskTraceFlow(taskId));
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ── Runs / providers ────────────────────────────────────────────────────
  server.registerTool(
    'omega_runs_list',
    {
      title: 'List runs',
      description: 'List recent task runs with their latest flow/agent run.',
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return ok(await client.listRuns(args));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_run_get',
    {
      title: 'Get run',
      description: 'Fetch a run by task id, flow id or cuttlefish run id.',
      inputSchema: { runId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ runId }) => {
      try {
        return ok(await client.getRun(runId));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_providers_list',
    {
      title: 'List providers',
      description: 'List configured model providers.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return ok(await client.listProviders());
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_router_select',
    {
      title: 'Preview router selection',
      description: 'Ask the capability router which provider/model it would pick for a task.',
      inputSchema: {
        title: z.string(),
        complexity: z.enum(['simple', 'medium', 'complex']).optional(),
        tags: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return ok(await client.routerSelect(args));
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ── Runtime connections (cuttlefish) ────────────────────────────────────
  server.registerTool(
    'omega_runtimes_list',
    {
      title: 'List runtime connections',
      description: 'List configured external workflow runtimes (cuttlefish control planes).',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return ok(await client.listRuntimes());
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_runtime_create',
    {
      title: 'Create runtime connection',
      description:
        'Register a cuttlefish control plane. Fields: name, baseUrl, projectId, apiToken, externalProjectId, defaultWorkflowVersionId, workflowTemplate, nodeImage, nodeCommand, runnerPool, runnerLabels, autoRoute, enabled.',
      inputSchema: {
        name: z.string(),
        baseUrl: z.string().url(),
        projectId: z.string().optional(),
        apiToken: z.string().optional(),
        externalProjectId: z.string().optional(),
        defaultWorkflowVersionId: z.string().optional(),
        workflowTemplate: z.string().optional(),
        nodeImage: z.string().optional(),
        nodeCommand: z.string().optional(),
        runnerPool: z.string().optional(),
        runnerLabels: z.record(z.string()).optional(),
        autoRoute: z.boolean().optional(),
        enabled: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        return ok(await client.createRuntime(args));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_runtime_health',
    {
      title: 'Check runtime health',
      description: 'Ping a runtime connection and record the health status.',
      inputSchema: { runtimeId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ runtimeId }) => {
      try {
        return ok(await client.runtimeHealth(runtimeId));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_runtime_workflows',
    {
      title: 'List runtime workflows',
      description: 'List workflows published on a cuttlefish runtime.',
      inputSchema: { runtimeId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ runtimeId }) => {
      try {
        return ok(await client.runtimeWorkflows(runtimeId));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_runtime_publish_workflow',
    {
      title: 'Publish runtime workflow',
      description:
        'Create or update a workflow on a cuttlefish runtime and publish a new version. Tasks can then reference it with flow:<name>.',
      inputSchema: {
        runtimeId: z.string(),
        name: z.string().describe('Workflow name (DNS label)'),
        workflowYAML: z.string().describe('Full cuttlefish.dev/v1alpha1 Workflow YAML'),
        description: z.string().optional(),
        updateExisting: z.boolean().optional().describe('Update the draft when the workflow already exists (default true)'),
        publish: z.boolean().optional().describe('Publish a new workflow version (default true)'),
      },
    },
    async (args) => {
      try {
        return ok(await client.publishWorkflow(args.runtimeId, args));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_runtime_runners',
    {
      title: 'List runtime runners',
      description: 'List compute runners registered on a cuttlefish runtime.',
      inputSchema: { runtimeId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ runtimeId }) => {
      try {
        return ok(await client.runtimeRunners(runtimeId));
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ── Flows (cuttlefish runs) ─────────────────────────────────────────────
  server.registerTool(
    'omega_flow_start',
    {
      title: 'Start flow for task',
      description:
        'Translate a task into a cuttlefish workflow and dispatch it. Optionally pin a workflow or workflowVersionId from the runtime.',
      inputSchema: {
        runtimeId: z.string(),
        taskId: z.string(),
        workflow: z.string().optional(),
        workflowVersionId: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return ok(await client.startFlow(args.runtimeId, args));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_flows_list',
    {
      title: 'List flows',
      description: 'List cuttlefish flow runs tracked by the harness.',
      inputSchema: {
        taskId: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return ok(await client.listFlows(args));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_flow_get',
    {
      title: 'Get flow',
      description: 'Fetch a tracked flow run.',
      inputSchema: { flowId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ flowId }) => {
      try {
        return ok(await client.getFlow(flowId));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_flow_cancel',
    {
      title: 'Cancel flow',
      description: 'Cancel a cuttlefish run and mark the linked task failed.',
      inputSchema: { flowId: z.string() },
    },
    async ({ flowId }) => {
      try {
        return ok(await client.cancelFlow(flowId));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_flow_events',
    {
      title: 'Get flow events',
      description: 'Fetch the cuttlefish event list for a flow run.',
      inputSchema: { flowId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ flowId }) => {
      try {
        return ok(await client.flowEvents(flowId));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_flow_logs',
    {
      title: 'Get flow logs',
      description: 'Fetch logs for a cuttlefish run.',
      inputSchema: { flowId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ flowId }) => {
      try {
        return ok(await client.flowLogs(flowId));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_flow_artifacts',
    {
      title: 'Get flow artifacts',
      description: 'Fetch artifacts produced by a cuttlefish run.',
      inputSchema: { flowId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ flowId }) => {
      try {
        return ok(await client.flowArtifacts(flowId));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_flow_trace',
    {
      title: 'Get distributed flow trace',
      description:
        'Return the distributed trace for a flow: harness + cuttlefish spans from Tempo, harness database spans, and the cuttlefish runner history trace.',
      inputSchema: { flowId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ flowId }) => {
      try {
        return ok(await client.flowTrace(flowId));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_observability_status',
    {
      title: 'Observability status',
      description: 'Report whether tracing is enabled and whether Tempo/Mimir are reachable.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return ok(await client.observabilityStatus());
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_observability_hotspots',
    {
      title: 'Latency hotspots',
      description:
        'Rank service/operation pairs by p95 latency, error rate and call rate using spanmetrics in Mimir.',
      inputSchema: {
        window: z.string().optional().describe('PromQL range window, e.g. 5m, 15m, 1h'),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return ok(await client.observabilityHotspots(args));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'omega_observability_trace',
    {
      title: 'Get trace by id',
      description: 'Fetch a normalized distributed trace from Tempo by trace id.',
      inputSchema: { traceId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ traceId }) => {
      try {
        return ok(await client.observabilityTrace(traceId));
      } catch (err) {
        return fail(err);
      }
    }
  );

  return server;
}

export function resolveHarnessApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.OMEGA_API_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const configuredPort = env.PORT?.trim();
  const port = configuredPort !== undefined && configuredPort.length > 0 ? configuredPort : '4000';
  return `http://127.0.0.1:${port}`;
}

export function createHarnessMcpServerFromEnv(overrides: Partial<HarnessApiClientOptions> = {}): McpServer {
  const client = new HarnessApiClient({
    baseUrl: resolveHarnessApiUrl(),
    token: process.env.OMEGA_API_TOKEN,
    ...overrides,
  });
  return createHarnessMcpServer({ client });
}
