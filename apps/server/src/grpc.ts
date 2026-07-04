import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { PrismaClient } from '@omega/db';
import { runTask } from './lib/run-task.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveProtoPath(): string {
  const candidates = [
    process.env.OMEGA_PROTO_PATH,
    path.resolve(__dirname, '../../../proto/tasks.proto'),
    path.resolve(__dirname, '../../proto/tasks.proto'),
    path.resolve(__dirname, '../proto/tasks.proto'),
    path.resolve(process.cwd(), 'proto/tasks.proto'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? path.resolve(__dirname, '../../../proto/tasks.proto');
}

const PROTO_PATH = resolveProtoPath();

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as {
  omega: {
    TaskIngestion: grpc.ServiceClientConstructor;
  };
};

interface SubmitTaskRequest {
  project_id: string;
  title: string;
  description?: string;
  complexity?: string;
  tags?: string[];
  auto_run?: boolean;
}

interface StreamTasksRequest {
  project_id?: string;
}

function isValidComplexity(value: string): value is 'simple' | 'medium' | 'complex' {
  return ['simple', 'medium', 'complex'].includes(value);
}

function parseRequest(req: unknown): SubmitTaskRequest {
  const r = req as Record<string, unknown>;
  return {
    project_id: typeof r.project_id === 'string' ? r.project_id : '',
    title: typeof r.title === 'string' ? r.title : '',
    description: typeof r.description === 'string' ? r.description : undefined,
    complexity: typeof r.complexity === 'string' ? r.complexity : undefined,
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : undefined,
    auto_run: typeof r.auto_run === 'boolean' ? r.auto_run : undefined,
  };
}

export function startGrpcServer(prisma: PrismaClient, port = 50051): grpc.Server {
  const server = new grpc.Server();

  server.addService(proto.omega.TaskIngestion.service, {
    submitTask: (call: grpc.ServerUnaryCall<unknown, unknown>, callback: grpc.sendUnaryData<unknown>) => {
      void (async () => {
        try {
          const req = parseRequest(call.request);
          if (!req.project_id || !req.title) {
            callback(
              { code: grpc.status.INVALID_ARGUMENT, message: 'project_id and title are required' },
              null
            );
            return;
          }

          const complexity = isValidComplexity(req.complexity ?? '') ? req.complexity : 'simple';

          const task = await prisma.task.create({
            data: {
              projectId: req.project_id,
              title: req.title,
              description: req.description ?? null,
              complexity,
              tags: JSON.stringify(req.tags ?? []),
            },
          });

          if (req.auto_run) {
            await runTask(prisma, task.id, { detached: true });
          }

          const updated = await prisma.task.findUnique({ where: { id: task.id } });
          callback(null, {
            id: updated?.id ?? task.id,
            status: updated?.status ?? task.status,
            error: updated?.error ?? '',
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          callback({ code: grpc.status.INTERNAL, message }, null);
        }
      })();
    },

    streamTasks: (call: grpc.ServerWritableStream<unknown, unknown>) => {
      const req = call.request as StreamTasksRequest;
      const projectId = req.project_id;
      let cancelled = false;

      const interval = setInterval(() => {
        if (cancelled) return;
        void (async () => {
          try {
            const tasks = await prisma.task.findMany({
              where: projectId ? { projectId } : undefined,
              orderBy: { updatedAt: 'desc' },
              take: 20,
            });
            for (const task of tasks) {
              call.write({
                id: task.id,
                title: task.title,
                status: task.status,
                provider: task.provider ?? '',
                model: task.model ?? '',
                result: task.result ?? '',
                error: task.error ?? '',
              });
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            call.write({ id: '', title: '', status: 'error', error: message });
          }
        })();
      }, 1000);

      call.on('cancelled', () => {
        cancelled = true;
        clearInterval(interval);
      });

      call.on('error', () => {
        cancelled = true;
        clearInterval(interval);
      });
    },
  });

  server.bindAsync(`0.0.0.0:${port.toString()}`, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) {
      console.error('gRPC server failed to start:', err);
      return;
    }
    console.log(`gRPC task ingestion on 0.0.0.0:${port.toString()}`);
  });

  return server;
}
