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

let activeThreadId = 'thread-test-1';

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
    activeThreadId = msg.params?.ephemeral === false ? 'thread-test-1' : 'thread-ephemeral';
    respond(msg.id, { thread: { id: activeThreadId } });
    return;
  }

  if (msg.method === 'thread/resume') {
    activeThreadId = msg.params?.threadId ?? 'thread-resume-missing';
    respond(msg.id, { thread: { id: activeThreadId } });
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

    if (process.env.FAKE_CODEX_MODE === 'collaboration' || process.env.FAKE_CODEX_MODE === 'collaboration-final-answer-first') {
      const nestedThreadId = 'thread-test-subagent';
      const nestedTurnId = 'turn-test-subagent';
      const collaborationItem = {
        id: 'collaboration-1',
        type: 'collabAgentToolCall',
        status: 'inProgress',
        tool: 'spawn_agent',
        receiverThreadIds: [nestedThreadId],
      };

      notify('turn/started', { threadId: activeThreadId, turn: { id: 'turn-test-1', status: 'inProgress' } });
      notify('item/started', {
        threadId: activeThreadId,
        turnId: 'turn-test-1',
        item: collaborationItem,
      });
      notify('item/completed', {
        threadId: activeThreadId,
        turnId: 'turn-test-1',
        item: collaborationItem,
      });
      notify('thread/started', { thread: { id: nestedThreadId, agentNickname: 'subagent' } });
      notify('turn/started', { threadId: nestedThreadId, turn: { id: nestedTurnId, status: 'inProgress' } });

      const completeNestedTurn = () => {
        notify('item/completed', {
          threadId: nestedThreadId,
          turnId: nestedTurnId,
          item: { id: 'subagent-file', type: 'fileChange', status: 'completed', changes: [{ path: 'src/subagent.ts' }] },
        });
        notify('turn/completed', { threadId: nestedThreadId, turn: { id: nestedTurnId, status: 'completed' } });
        notify('item/completed', {
          threadId: activeThreadId,
          turnId: 'turn-test-1',
          item: { ...collaborationItem, status: 'completed' },
        });
      };

      if (process.env.FAKE_CODEX_MODE === 'collaboration-final-answer-first') {
        notify('item/completed', {
          threadId: activeThreadId,
          turnId: 'turn-test-1',
          item: { id: 'it4', type: 'agentMessage', phase: 'final_answer', text: 'Done implementing the task.' },
        });
        setTimeout(completeNestedTurn, 400);
      } else {
        completeNestedTurn();
        notify('item/completed', {
          threadId: activeThreadId,
          turnId: 'turn-test-1',
          item: { id: 'it4', type: 'agentMessage', phase: 'final_answer', text: 'Done implementing the task.' },
        });
      }
      return;
    }

    notify('turn/started', { threadId: activeThreadId, turn: { id: 'turn-test-1', status: 'inProgress' } });
    notify('item/completed', {
      threadId: activeThreadId,
      turnId: 'turn-test-1',
      item: { id: 'it1', type: 'commandExecution', command: 'pnpm test', status: 'completed', exitCode: 0 },
    });
    notify('item/completed', {
      threadId: activeThreadId,
      turnId: 'turn-test-1',
      item: { id: 'it2', type: 'fileChange', status: 'completed', changes: [{ path: 'src/foo.ts' }, { path: 'src/bar.ts' }] },
    });
    notify('item/completed', {
      threadId: activeThreadId,
      turnId: 'turn-test-1',
      item: { id: 'it3', type: 'reasoning', summary: { text: 'Analyzed the code' } },
    });
    notify('item/completed', {
      threadId: activeThreadId,
      turnId: 'turn-test-1',
      item: { id: 'it4', type: 'agentMessage', phase: 'final_answer', text: 'Done implementing the task.' },
    });
    notify('turn/completed', { threadId: activeThreadId, turn: { id: 'turn-test-1', status: 'completed' } });
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
