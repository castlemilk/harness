import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function findProtoPath(): string {
  const candidates = [
    // Bundled / installed package layout: dist/proto/tasks.proto
    path.join(__dirname, 'proto/tasks.proto'),
    // Development layout from apps/cli/src/lib: ../../../../proto/tasks.proto
    path.resolve(__dirname, '../../../../proto/tasks.proto'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // Fallback to the bundled location even if missing; caller will get a clearer error.
  return candidates[0] ?? 'proto/tasks.proto';
}
