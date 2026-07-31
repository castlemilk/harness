#!/usr/bin/env node
import readline from 'node:readline';

const args = process.argv.slice(2);

if (args[0] === '--version') {
  process.stdout.write('codex-cli 0.144.5 (test fake)\n');
  process.exit(0);
}

if (args[0] === 'app-server' && (args[1] === '--help' || args[1] === '-h')) {
  process.stdout.write('[experimental] Run the app server or related tooling\n');
  process.exit(0);
}

if (args[0] !== 'app-server') {
  process.stderr.write(`fake codex: unexpected args ${args.join(' ')}\n`);
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin });

const respond = (reqId, result) => {
  process.stdout.write(`${JSON.stringify({ id: reqId, result })}\n`);
};

const notify = (method, params) => {
  process.stdout.write(`${JSON.stringify({ method, params })}\n`);
};

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.method === 'initialize') {
    respond(msg.id, { ok: true });
    return;
  }

  if (msg.method === 'thread/start') {
    respond(msg.id, { thread: { id: 'thread-test-1' } });
    return;
  }

  if (msg.method === 'thread/name/set') {
    respond(msg.id, {});
    return;
  }

  if (msg.method === 'turn/start') {
    respond(msg.id, { turn: { id: 'turn-test-1', status: 'inProgress' } });
    if (process.env.FAKE_CODEX_MODE === 'hang') {
      return;
    }
    notify('turn/started', { threadId: 'thread-test-1', turn: { id: 'turn-test-1', status: 'inProgress' } });
    notify('item/completed', {
      threadId: 'thread-test-1',
      turnId: 'turn-test-1',
      item: { id: 'it1', type: 'commandExecution', command: 'pnpm test', status: 'completed', exitCode: 0 },
    });
    notify('item/completed', {
      threadId: 'thread-test-1',
      turnId: 'turn-test-1',
      item: { id: 'it2', type: 'fileChange', status: 'completed', changes: [{ path: 'src/foo.ts' }, { path: 'src/bar.ts' }] },
    });
    notify('item/completed', {
      threadId: 'thread-test-1',
      turnId: 'turn-test-1',
      item: { id: 'it3', type: 'reasoning', summary: { text: 'Analyzed the code' } },
    });
    notify('item/completed', {
      threadId: 'thread-test-1',
      turnId: 'turn-test-1',
      item: { id: 'it4', type: 'agentMessage', phase: 'final_answer', text: 'Done implementing the task.' },
    });
    notify('turn/completed', { threadId: 'thread-test-1', turn: { id: 'turn-test-1', status: 'completed' } });
    return;
  }

  if (msg.method === 'turn/interrupt') {
    respond(msg.id, {});
    return;
  }

  if (msg.id !== undefined) {
    respond(msg.id, {});
  }
});

rl.on('close', () => {
  process.exit(0);
});
