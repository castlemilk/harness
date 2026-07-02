import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';

const API = process.env.HARNESS_API_URL ?? 'http://localhost:4000';

interface Task {
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
}

interface LogEntry {
  time: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
}

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
  const previousTasks = useRef<Record<string, Task | undefined>>({});

  const addLog = (message: string, level: LogEntry['level'] = 'info') => {
    setLogs((prev) => {
      const next = [...prev, { time: formatTime(new Date()), message, level }];
      return next.slice(-200);
    });
  };

  useEffect(() => {
    let cancelled = false;
    let timer: NodeJS.Timeout | undefined;

    const tick = async () => {
      try {
        const res = await fetch(`${API}/tasks`);
        if (!res.ok) throw new Error(`HTTP ${res.status.toString()}`);
        const data = (await res.json()) as Task[];
        setConnected(true);

        const current: Record<string, Task | undefined> = {};
        for (const task of data) {
          current[task.id] = task;
          const prev = previousTasks.current[task.id];
          if (!prev) {
            addLog(`New task queued: "${task.title}"`, 'info');
          } else if (prev.status !== task.status) {
            if (task.status === 'in_progress') {
              const provider = task.provider ?? 'unknown';
              const model = task.model ?? 'unknown';
              addLog(`LLM picked up "${task.title}" → ${provider}/${model}`, 'info');
            } else if (task.status === 'done') {
              addLog(`Completed: "${task.title}"`, 'success');
            } else if (task.status === 'failed') {
              addLog(`Failed: "${task.title}"${task.error ? ` — ${task.error}` : ''}`, 'error');
            }
          }
        }

        for (const id of Object.keys(previousTasks.current)) {
          const removed = previousTasks.current[id];
          if (!current[id] && !id.startsWith('__') && removed) {
            addLog(`Task removed: "${removed.title}"`, 'warning');
          }
        }

        previousTasks.current = current;
        setTasks(data);
      } catch (err) {
        setConnected(false);
        const message = err instanceof Error ? err.message : String(err);
        if (message !== previousTasks.current.__last_error?.title) {
          addLog(`Connection lost: ${message}`, 'error');
          previousTasks.current.__last_error = { title: message } as Task;
        }
      }
      if (!cancelled) {
        timer = setTimeout(() => {
          void tick();
        }, pollMs);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollMs]);

  return { tasks, logs, connected };
}

function truncate(str: string, max: number) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

function Header({ connected }: { connected: boolean }) {
  return (
    <Box borderStyle="single" paddingX={1} height={3} flexShrink={0}>
      <Text bold color="cyan">
        Omega Harness Console
      </Text>
      <Box flexGrow={1} />
      <Text color={connected ? 'green' : 'red'}>{connected ? '● connected' : '● disconnected'}</Text>
      <Text dimColor>  {API}</Text>
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
    <Box borderStyle="single" paddingX={1} height={3} flexShrink={0} gap={2}>
      <Text>total: {counts.total}</Text>
      <Text color="gray">todo: {counts.todo}</Text>
      <Text color="yellow">in progress: {counts.inProgress}</Text>
      <Text color="green">done: {counts.done}</Text>
      <Text color="red">failed: {counts.failed}</Text>
    </Box>
  );
}

function TaskList({
  tasks,
  height,
  collapsed,
  columns,
}: {
  tasks: Task[];
  height: number;
  collapsed: boolean;
  columns: number;
}) {
  const sorted = useMemo(
    () =>
      [...tasks].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
    [tasks]
  );

  const header = (
    <Box flexDirection="row" gap={1}>
      <Text bold underline>
        Tasks ({tasks.length})
      </Text>
      <Text dimColor>[t] {collapsed ? 'expand' : 'collapse'}</Text>
    </Box>
  );

  if (collapsed) {
    return (
      <Box borderStyle="single" paddingX={1} height={3} flexShrink={0}>
        {header}
      </Box>
    );
  }

  // Account for border (2 lines) and header (1 line)
  const availableLines = Math.max(0, height - 3);
  const visible = sorted.slice(0, availableLines);

  return (
    <Box
      borderStyle="single"
      paddingX={1}
      flexDirection="column"
      height={height}
      flexShrink={0}
    >
      {header}
      {visible.length === 0 && <Text dimColor>No tasks yet. Create one in the web UI.</Text>}
      {visible.map((task) => {
        const providerText = task.provider ? `${task.provider}/${task.model ?? ''}` : '-';
        // Fit columns: timestamp(20) + gap(1) + status(12) + gap(1) + provider(24) + gaps(4) = ~62
        const titleMax = Math.max(10, columns - 62);
        return (
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
              <Text dimColor>{truncate(providerText, 23)}</Text>
            </Box>
            <Box flexGrow={1}>
              <Text>{truncate(task.title, titleMax)}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function ConsoleLog({
  logs,
  height,
  columns,
}: {
  logs: LogEntry[];
  height: number;
  columns: number;
}) {
  const availableLines = Math.max(0, height - 3);
  const visible = logs.slice(-availableLines);

  return (
    <Box borderStyle="single" paddingX={1} flexDirection="column" height={height} flexGrow={1}>
      <Text bold underline>
        Console
      </Text>
      {visible.length === 0 && <Text dimColor>Waiting for activity...</Text>}
      {visible.map((log, i) => {
        const timeWidth = 10;
        const msgMax = Math.max(10, columns - timeWidth - 4);
        return (
          <Box key={i} flexDirection="row" gap={1}>
            <Box width={timeWidth}>
              <Text dimColor>{log.time}</Text>
            </Box>
            <Box flexGrow={1}>
              <Text color={log.level}>{truncate(log.message, msgMax)}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export function TuiApp() {
  const { exit } = useApp();
  const { tasks, logs, connected } = useTasks();
  const { columns, rows } = useWindowSize();
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  const [sidebar, setSidebar] = useState(() => columns >= 100);

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit();
    }
    if (input === 't') {
      setTasksCollapsed((c) => !c);
    }
    if (input === 's') {
      setSidebar((s) => !s);
    }
  });

  // Keep a sane default layout when the terminal is resized.
  useEffect(() => {
    if (columns >= 100 && !sidebar) setSidebar(true);
    if (columns < 80 && sidebar) setSidebar(false);
  }, [columns, sidebar]);

  // In sidebar mode, allocate ~40% width to the task list (min 30 cols).
  const taskListWidth = sidebar ? Math.max(30, Math.floor(columns * 0.4)) : columns;
  const consoleColumns = sidebar ? Math.max(20, columns - taskListWidth - 1) : columns;

  // Reserve fixed-height rows for header (3), stats (3), footer (1) and gaps (3).
  const mainHeight = Math.max(6, rows - 9);

  const taskListHeight = sidebar
    ? mainHeight
    : tasksCollapsed
      ? 3
      : Math.max(6, Math.floor(mainHeight * 0.45));
  const consoleHeight = sidebar ? mainHeight : Math.max(3, mainHeight - taskListHeight);

  return (
    <Box flexDirection="column" height={rows} width={columns} gap={1}>
      <Header connected={connected} />
      <Stats tasks={tasks} />
      <Box flexDirection={sidebar ? 'row' : 'column'} gap={1} flexGrow={1}>
        <TaskList
          tasks={tasks}
          height={taskListHeight}
          collapsed={tasksCollapsed}
          columns={taskListWidth}
        />
        <ConsoleLog logs={logs} height={consoleHeight} columns={consoleColumns} />
      </Box>
      <Box height={1} flexShrink={0}>
        <Text dimColor>q/esc quit  •  t toggle tasks  •  s toggle sidebar</Text>
      </Box>
    </Box>
  );
}
