import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface LspDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

export interface LspHover {
  contents: string | { language: string; value: string } | (string | { language: string; value: string })[];
  range?: unknown;
}

export interface LspSymbol {
  name: string;
  kind: number;
  location?: {
    uri: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
  containerName?: string;
}

export class LspClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number | string, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  private buffer = '';
  private initialized = false;
  private rootUri: string;

  constructor(private command: string, private args: string[], rootPath: string) {
    super();
    this.rootUri = `file://${rootPath}`;
  }

  async start(): Promise<void> {
    if (this.process) return;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = (err?: Error): void => {
        if (settled) return;
        settled = true;
        if (this.process) {
          this.process.removeAllListeners();
          try {
            this.process.kill();
          } catch {
            // ignore
          }
          this.process = null;
        }
        if (err) reject(err);
        else resolve();
      };

      try {
        this.process = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err) {
        cleanup(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      this.process.on('error', (err) => {
        this.emit('error', err);
        cleanup(err);
      });
      this.process.on('exit', (code) => {
        this.emit('exit', code);
        if (!settled) {
          cleanup(new Error(`${this.command} exited with code ${String(code)}`));
        }
      });
      this.process.stdout?.on('data', (chunk: Buffer) => {
        this.onData(chunk);
      });
      this.process.stderr?.on('data', (chunk: Buffer) => {
        this.emit('stderr', chunk.toString());
      });

      // Wait a moment for server to start, then initialize.
      setTimeout(() => {
        this.sendRequest('initialize', {
          processId: process.pid,
          rootUri: this.rootUri,
          capabilities: {},
        })
          .then(() => {
            this.initialized = true;
            return this.sendNotification('initialized', {});
          })
          .then(() => {
            cleanup();
          })
          .catch((err: unknown) => {
            cleanup(err instanceof Error ? err : new Error(String(err)));
          });
      }, 500);
    });
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    try {
      await this.sendNotification('shutdown', {});
      await this.sendNotification('exit', {});
    } catch {
      // ignore
    }
    this.process.kill();
    this.process = null;
    this.pending.clear();
  }

  async getDiagnostics(filePath: string): Promise<LspDiagnostic[]> {
    const uri = this.toUri(filePath);
    await this.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: this.inferLanguageId(uri), version: 1, text: '' },
    });
    // Give server a moment to compute diagnostics.
    await new Promise((r) => setTimeout(r, 1000));
    const result = (await this.sendRequest('textDocument/diagnostic', { textDocument: { uri } })) as {
      items?: LspDiagnostic[];
      kind?: string;
    } | null;
    return result?.items ?? [];
  }

  async getHover(filePath: string, line: number, character: number): Promise<string> {
    const uri = this.toUri(filePath);
    const result = (await this.sendRequest('textDocument/hover', {
      textDocument: { uri },
      position: { line, character },
    })) as LspHover | null;
    if (!result) return '';
    const contents = result.contents;
    if (typeof contents === 'string') return contents;
    if (Array.isArray(contents)) {
      return contents
        .map((c) => (typeof c === 'string' ? c : c.value))
        .join('\n');
    }
    return contents.value;
  }

  async findSymbol(query: string): Promise<LspSymbol[]> {
    const result = (await this.sendRequest('workspace/symbol', { query })) as LspSymbol[] | null;
    return result ?? [];
  }

  private toUri(filePath: string): string {
    if (filePath.startsWith('file://')) return filePath;
    return `file://${filePath}`;
  }

  private inferLanguageId(uri: string): string {
    if (uri.endsWith('.ts')) return 'typescript';
    if (uri.endsWith('.tsx')) return 'typescriptreact';
    if (uri.endsWith('.js')) return 'javascript';
    if (uri.endsWith('.jsx')) return 'javascriptreact';
    if (uri.endsWith('.go')) return 'go';
    if (uri.endsWith('.py')) return 'python';
    if (uri.endsWith('.rs')) return 'rust';
    return 'text';
  }

  private sendNotification(method: string, params: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('LSP server not started'));
        return;
      }
      const message: JsonRpcMessage = { jsonrpc: '2.0', method, params };
      const json = JSON.stringify(message);
      const data = `Content-Length: ${String(json.length)}\r\n\r\n${json}`;
      this.process.stdin.write(data, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('LSP server not started'));
        return;
      }
      this.requestId++;
      const id = this.requestId;
      this.pending.set(id, { resolve, reject });
      const message: JsonRpcMessage = { jsonrpc: '2.0', id, method, params };
      const json = JSON.stringify(message);
      const data = `Content-Length: ${String(json.length)}\r\n\r\n${json}`;
      this.process.stdin.write(data, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
      // Timeout after 10s to avoid hanging on unsupported methods.
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP request ${method} timed out`));
        }
      }, 10000);
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf-8');
    for (;;) {
      const headerMatch = /^Content-Length: (\d+)\r\n/.exec(this.buffer);
      if (!headerMatch) break;
      const contentLength = parseInt(headerMatch[1], 10);
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const messageStart = headerEnd + 4;
      if (this.buffer.length < messageStart + contentLength) break;
      const json = this.buffer.slice(messageStart, messageStart + contentLength);
      this.buffer = this.buffer.slice(messageStart + contentLength);
      try {
        const message = JSON.parse(json) as JsonRpcMessage;
        this.handleMessage(message);
      } catch {
        // ignore malformed message
      }
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    } else if (message.method === 'textDocument/publishDiagnostics') {
      this.emit('diagnostics', message.params);
    }
  }
}
