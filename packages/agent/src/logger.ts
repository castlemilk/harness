export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelRank: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function envLevel(): LogLevel {
  const env = typeof process !== 'undefined' ? process.env.OMEGA_LOG_LEVEL : undefined;
  if (env && env in levelRank) return env as LogLevel;
  return 'info';
}

function envFormat(): 'json' | 'text' {
  const env = typeof process !== 'undefined' ? process.env.OMEGA_LOG_FORMAT : undefined;
  return env === 'json' ? 'json' : 'text';
}

export interface LogContext {
  taskId?: string;
  agentRunId?: string;
  step?: string;
  tool?: string;
  [key: string]: unknown;
}

function log(level: LogLevel, message: string, context?: LogContext) {
  if (levelRank[level] < levelRank[envLevel()]) return;

  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  if (envFormat() === 'json') {
    console.log(JSON.stringify(entry));
    return;
  }

  const ctx = context && Object.keys(context).length > 0
    ? Object.entries(context)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' ')
    : '';
  console.log(`[${entry.time}] ${level.toUpperCase()} ${message}${ctx ? ` | ${ctx}` : ''}`);
}

export const logger = {
  debug: (message: string, context?: LogContext) => { log('debug', message, context); },
  info: (message: string, context?: LogContext) => { log('info', message, context); },
  warn: (message: string, context?: LogContext) => { log('warn', message, context); },
  error: (message: string, context?: LogContext) => { log('error', message, context); },
};
