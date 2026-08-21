import type { PrismaClient } from '@omega/db';

/**
 * Pulse retention.
 *
 * Pulse rows accrue one per heartbeat forever, and since 2026-08-21 each can
 * carry up to 48k of captured prompt/response. Two decay policies, both
 * deliberately conservative:
 *
 * - **Text decay** (14 days): the captured exchange is an audit trail for
 *   recent behaviour, not an archive. After two weeks the prompt/response
 *   bodies are stripped; the pulse row itself — seq, outcome, summary, model,
 *   cost, tokens — is untouched, so spend accounting and the transcript
 *   narrative survive intact.
 * - **Row decay** (120 days, ok-outcome only): an ok heartbeat pulse older
 *   than every usage window (the API caps `days` at 90) says nothing a
 *   summary row still needs to say. warn/fail pulses are findings and are
 *   KEPT forever — deleting the interesting ones to save space would be
 *   optimizing for the wrong reader.
 */
export const TEXT_DECAY_DAYS = 14;
export const ROW_DECAY_DAYS = 120;

export interface PruneResult {
  textStripped: number;
  rowsDeleted: number;
}

export async function prunePulses(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<PruneResult> {
  const textCutoff = new Date(now.getTime() - TEXT_DECAY_DAYS * 24 * 60 * 60 * 1_000);
  const rowCutoff = new Date(now.getTime() - ROW_DECAY_DAYS * 24 * 60 * 60 * 1_000);

  const stripped = await prisma.pulse.updateMany({
    where: {
      startedAt: { lt: textCutoff },
      OR: [{ promptText: { not: null } }, { responseText: { not: null } }],
    },
    data: { promptText: null, responseText: null },
  });

  const deleted = await prisma.pulse.deleteMany({
    where: { startedAt: { lt: rowCutoff }, outcome: 'ok' },
  });

  return { textStripped: stripped.count, rowsDeleted: deleted.count };
}
