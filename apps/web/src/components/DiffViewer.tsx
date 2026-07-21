import { useState } from 'react';

export interface DiffFile {
  path: string;
  kind: 'new' | 'modified' | 'deleted';
  lines: string[];
}

export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let pendingOld = '';

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git')) {
      if (current) files.push(current);
      const m = /b\/(.+)$/.exec(line);
      current = { path: m?.[1] ?? line, kind: 'modified', lines: [] };
      pendingOld = '';
    } else if (line.startsWith('--- ')) {
      pendingOld = line.slice(4).trim();
      if (current && pendingOld === '/dev/null') current.kind = 'new';
    } else if (line.startsWith('+++ ')) {
      const next = line.slice(4).trim();
      if (current) {
        if (next === '/dev/null') {
          current.kind = 'deleted';
        } else {
          current.path = next.replace(/^b\//, '');
          if (current.kind === 'modified' && pendingOld && pendingOld !== '/dev/null') {
            const oldPath = pendingOld.replace(/^a\//, '');
            if (oldPath !== current.path) current.path = `${oldPath} → ${current.path}`;
          }
        }
      }
    } else if (line.startsWith('new file mode')) {
      if (current) current.kind = 'new';
    } else if (line.startsWith('deleted file mode')) {
      if (current) current.kind = 'deleted';
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) files.push(current);
  return files;
}

const KIND_BADGES: Record<DiffFile['kind'], { label: string; classes: string }> = {
  new: { label: 'new file', classes: 'bg-green-100 text-green-700' },
  modified: { label: 'modified', classes: 'bg-blue-100 text-blue-700' },
  deleted: { label: 'deleted', classes: 'bg-red-100 text-red-700' },
};

function lineClasses(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'bg-green-50 text-green-700';
  if (line.startsWith('-') && !line.startsWith('---')) return 'bg-red-50 text-red-700';
  if (line.startsWith('@@')) return 'text-blue-600';
  return 'text-gray-600';
}

function DiffFileSection({ file, defaultExpanded }: { file: DiffFile; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const badge = KIND_BADGES[file.kind];
  return (
    <div className="border border-gray-200 rounded overflow-hidden">
      <button
        onClick={() => { setExpanded((e) => !e); }}
        className="w-full flex items-center gap-2 px-2 py-1 bg-gray-100 hover:bg-gray-200 text-left"
      >
        <span className="text-gray-400 w-3">{expanded ? '−' : '+'}</span>
        <span className="font-mono text-[11px] truncate flex-1" title={file.path}>{file.path}</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.classes}`}>{badge.label}</span>
        <span className="text-[10px] text-gray-400">{file.lines.length} lines</span>
      </button>
      {expanded && (
        <pre className="text-[10px] leading-4 overflow-auto max-h-72 bg-white">
          {file.lines.map((line, i) => (
            <div key={i} className={`px-2 whitespace-pre-wrap ${lineClasses(line)}`}>
              {line || ' '}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

interface Props {
  patch: string;
  defaultExpanded?: boolean;
}

export function DiffViewer({ patch, defaultExpanded = true }: Props) {
  const files = parseUnifiedDiff(patch);
  if (files.length === 0) {
    return <div className="text-xs text-gray-400">No parseable diff content.</div>;
  }
  return (
    <div className="space-y-2">
      {files.map((file, i) => (
        <DiffFileSection key={`${file.path}-${String(i)}`} file={file} defaultExpanded={defaultExpanded} />
      ))}
    </div>
  );
}
