import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

const API = process.env.HARNESS_API_URL || 'http://localhost:4000';

type Task = {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  complexity: string;
  tags: string;
  status: 'todo' | 'in_progress' | 'done' | 'failed';
  result?: string;
  error?: string;
  provider?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
};

type LogEntry = {
  time: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
};

function formatTime(d: Date) {
  return d.toLocaleTimeString('en-US', { hour12: false });
}

function statusColor(status: Task['status']) {
  switch (status) {
    case 'done':
      return 'green';
    case 'failed':
      return 'red';
    case 'in_progress':
      return 'yellow';
    default:
      return 'gray';
  }
}

function statusSymbol(status: Task['status']) {
  switch (status) {
    case 'done':
      return '✓';
    case 'failed':
      return '✗';
    case 'in_progress':
      return '◐';
    default:
      return '○';
  }
}

function useTasks(pollMs = 1000) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const previousTasks = useRef<Record<string, Task>>({});

  const addLog = (message: string, level: LogEntry['level'] = 'info') => {
    setLogs((prev) => {
      const next = [...prev, { time: formatTime(new Date()), message, level }];
      return next.slice(-50);
    });
  };

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`${API}/tasks`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Task[];
        setConnected(true);

        const current: Record<string, Task> = {};
        for (const task of data) {
          current[task.id] = task;
          const prev = previousTasks.current[task.id];
          if (!prev) {
            addLog(`New task queued: "${task.title}"`, 'info');
          } else if (prev.status !== task.status) {
            if (task.status === 'in_progress') {
              const provider = task.provider || 'unknown';
              const model = task.model || 'unknown';
              addLog(`LLM picked up "${task.title}" → ${provider}/${model}`, 'info');
            } else if (task.status === 'done') {
              addLog(`Completed: "${task.title}"`, 'success');
            } else if (task.status === 'failed') {
              addLog(`Failed: "${task.title}"${task.error ? ` — ${task.error}` : ''}`, 'error');
            }
          }
        }

        // Detect removed tasks
        for (const id of Object.keys(previousTasks.current)) {
          if (!current[id]) {
            addLog(`Task removed: "${previousTasks.current[id].title}"`, 'warning');
          }
        }

        previousTasks.current = current;
        setTasks(data);
      } catch (err) {
        setConnected(false);
        const message = err instanceof Error ? err.message : String(err);
        if (message !== previousTasks.current['__last_error']?.title) {
          addLog(`Connection lost: ${message}`, 'error');
          previousTasks.current['__last_error'] = { title: message } as Task;
        }
      }
      if (!cancelled) {
        setTimeout(tick, pollMs);
      }
    };

    tick();
    return () => {
      cancelled = true;
    };
  }, [pollMs]);

  return { tasks, logs, connected };
}

function Header({ connected }: { connected: boolean }) {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text bold color="cyan">
        Omega Harness Console
      </Text>
      <Box flexGrow={1} />
      <Text color={connected ? 'green' : 'red'}>{connected ? '● connected' : '● disconnected'}</Text>
      <Text dimColor>  {API}</Text>
    </Box>
  );
}

function TaskList({ tasks }: { tasks: Task[] }) {
  const sorted = useMemo(
    () =>
      [...tasks].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
    [tasks]
  );

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} minHeight={10}>
      <Text bold underline>
        Tasks ({tasks.length})
      </Text>
      {sorted.length === 0 && <Text dimColor>No tasks yet. Create one in the web UI.</Text>}
      {sorted.map((task) => (
        <Box key={task.id} flexDirection="row" gap={1}>
          <Text color={statusColor(task.status)}>{statusSymbol(task.status)}</Text>
          <Box width={20}>
            <Text dimColor>{formatTime(new Date(task.updatedAt))}</Text>
          </Box>
          <Box width={12}>
            <Text color={statusColor(task.status)} bold>
              {task.status.toUpperCase()}
            </Text>
          </Box>
          <Box width={24}>
            <Text dimColor>{task.provider ? `${task.provider}/${task.model}` : '-'}</Text>
          </Box>
          <Box flexGrow={1}>
            <Text>{task.title}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function ConsoleLog({ logs }: { logs: LogEntry[] }) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} flexGrow={1}>
      <Text bold underline>
        Console
      </Text>
      {logs.length === 0 && <Text dimColor>Waiting for activity...</Text>}
      {logs.map((log, i) => (
        <Box key={i} flexDirection="row" gap={1}>
          <Text dimColor>{log.time}</Text>
          <Text color={log.level}>{log.message}</Text>
        </Box>
      ))}
    </Box>
  );
}

function Stats({ tasks }: { tasks: Task[] }) {
  const counts = useMemo(() => {
    const total = tasks.length;
    const todo = tasks.filter((t) => t.status === 'todo').length;
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
    const done = tasks.filter((t) => t.status === 'done').length;
    const failed = tasks.filter((t) => t.status === 'failed').length;
    return { total, todo, inProgress, done, failed };
  }, [tasks]);

  return (
    <Box borderStyle="single" paddingX={1} gap={2}>
      <Text>total: {counts.total}</Text>
      <Text color="gray">todo: {counts.todo}</Text>
      <Text color="yellow">in progress: {counts.inProgress}</Text>
      <Text color="green">done: {counts.done}</Text>
      <Text color="red">failed: {counts.failed}</Text>
    </Box>
  );
}

export function TuiApp() {
  const { exit } = useApp();
  const { tasks, logs, connected } = useTasks();

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit();
    }
  });

  return (
    <Box flexDirection="column" height="100%" gap={1} padding={1}>
      <Header connected={connected} />
      <Stats tasks={tasks} />
      <TaskList tasks={tasks} />
      <ConsoleLog logs={logs} />
      <Text dimColor>Press q or Esc to quit</Text>
    </Box>
  );
}
