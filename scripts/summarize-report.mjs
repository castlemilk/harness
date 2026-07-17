import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync(process.argv[2] ?? '.omega/reports/benchmark-latest.json', 'utf8'));
console.log('total', r.total, 'passed', r.passed, 'failed', r.failed, 'timeouts', r.timeouts);
console.log('totalDurationHours', (r.totalDurationMs / 3600000).toFixed(2));
const scores = [];
let partialSum = 0;
let countWithPartial = 0;
let quotaFails = 0;
let dockerFails = 0;
let applyFails = 0;
for (const res of r.results) {
  const m = res.evaluation.metrics || {};
  const score = typeof res.evaluation.score === 'number' ? res.evaluation.score : (res.evaluation.passed ? 1 : 0);
  const f2p = (m.f2p_passed ?? 0) + '/' + (m.f2p_total ?? 0);
  const p2p = (m.p2p_passed ?? 0) + '/' + (m.p2p_total ?? 0);
  const msg = (res.evaluation.message || '').slice(0, 120);
  scores.push({ name: res.task.name, status: res.status, score, f2p, p2p, msg });
  if (score > 0 && score < 1) { partialSum += score; countWithPartial++; }
  if (msg.includes('quota') || (res.error || '').includes('quota')) quotaFails++;
  if (msg.includes('Docker build failed')) dockerFails++;
  if (m.apply_failed) applyFails++;
}
console.log('quota-like fails', quotaFails, 'docker build fails', dockerFails, 'apply_failed', applyFails);
console.log('tasks with partial score', countWithPartial, 'avg partial', countWithPartial ? (partialSum / countWithPartial).toFixed(3) : 0);
console.log('--- all scores ---');
scores.sort((a, b) => b.score - a.score);
for (const s of scores) {
  console.log(s.score.toFixed(3), s.status.padEnd(8), s.name, 'f2p', s.f2p, 'p2p', s.p2p, s.msg);
}
