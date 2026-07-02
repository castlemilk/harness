import { Command } from 'commander';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { findProtoPath } from '../lib/proto-path.js';

const GRPC_TARGET = process.env.HARNESS_GRPC_TARGET ?? 'localhost:50051';

const packageDefinition = protoLoader.loadSync(findProtoPath(), {
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

interface TaskIngestionClient extends grpc.Client {
  submitTask(
    request: unknown,
    callback: (err: grpc.ServiceError | null, response: unknown) => void
  ): void;
  streamTasks(): grpc.ClientWritableStream<unknown>;
}

export const taskFeedCmd = new Command('feed')
  .description('Feed a task into the harness via gRPC')
  .requiredOption('--project <id>', 'project id')
  .requiredOption('--title <title>', 'task title')
  .option('--description <text>', 'task description')
  .option('--complexity <level>', 'simple | medium | complex', 'simple')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--auto-run', 'run the task immediately after submission', false)
  .option('--stream', 'stream task updates after submission', false)
  .action(
    (opts: {
      project: string;
      title: string;
      description?: string;
      complexity: string;
      tags?: string;
      autoRun: boolean;
      stream: boolean;
    }) => {
      const client = new proto.omega.TaskIngestion(
        GRPC_TARGET,
        grpc.credentials.createInsecure()
      ) as unknown as TaskIngestionClient;

      const request = {
        project_id: opts.project,
        title: opts.title,
        description: opts.description ?? '',
        complexity: opts.complexity,
        tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : [],
        auto_run: opts.autoRun,
      };

      if (opts.stream) {
        const call = client.streamTasks();
        call.on('data', (event: unknown) => {
          console.log(JSON.stringify(event, null, 2));
        });
        call.on('error', (err: Error) => {
          console.error('Stream error:', err.message);
          process.exit(1);
        });
        call.on('end', () => {
          process.exit(0);
        });
        call.write({ project_id: opts.project });
      }

      client.submitTask(request, (err, response) => {
        if (err) {
          console.error('gRPC error:', err.message);
          process.exit(1);
        }
        console.log(JSON.stringify(response, null, 2));
        if (!opts.stream) {
          client.close();
        }
      });
    }
  );
