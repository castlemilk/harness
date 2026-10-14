// Minimal MCP stdio client used to smoke-test `harness mcp` end to end.
// Spawns the CLI, performs the handshake, calls tools, and always exits.
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const toolName = args[0] ?? 'omega_harness_info';
const toolArgs = args[1] ? JSON.parse(args[1]) : {};

const extraArgs = (process.env.MCP_ARGS ?? '').split(/\s+/).filter(Boolean);
const child = spawn(process.execPath, ['apps/cli/dist/index.js', 'mcp', ...extraArgs], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let out = '';
let err = '';
child.stdout.on('data', (c) => {
  out += String(c);
});
child.stderr.on('data', (c) => {
  err += String(c);
});

const timer = setTimeout(() => {
  console.log('TIMEOUT after 120s');
  console.log('stderr:', err.slice(0, 800));
  child.kill('SIGKILL');
  process.exit(1);
}, 120_000);

const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '1' } },
});

setTimeout(() => {
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: toolArgs } });
}, 1500);

// Leave stdin open: closing it is the server's shutdown signal, so it would
// tear the server down before it could answer.

const poll = setInterval(() => {
  const lines = out.trim().split('\n').filter(Boolean);
  const call = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((j) => j && j.id === 2);
  if (call) {
    clearInterval(poll);
    clearTimeout(timer);
    console.log('TOOL RESULT:', JSON.stringify(call.result ?? call.error));
    child.kill('SIGKILL');
    process.exit(0);
  }
}, 300);