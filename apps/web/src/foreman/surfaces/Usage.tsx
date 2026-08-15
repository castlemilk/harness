import { useMemo } from 'react';
import type { UsageSummary } from '../types.js';
import { capRatio, Meter, SectionLabel } from '../ui/primitives.js';
import { compactCount, money, percent } from '../ui/format.js';

/**
 * Surface 1h — Usage.
 *
 * What the objective is costing, split by model and by harness, against the
 * cap. The stacked bars are absolute dollars so a spike is a spike, not a
 * re-normalised shape.
 */

const MODEL_COLOR = ['#5b9dff', '#a67ff0', '#4ec97a', '#e8963c', '#e5675b'];

export function Usage({
  usage,
  objectiveName,
  days,
  onDaysChange,
  onOpenHarness,
}: {
  usage: UsageSummary | null;
  objectiveName: string;
  days: number;
  onDaysChange: (d: number) => void;
  onOpenHarness: (id: string) => void;
}) {
  // A model that appears in a day's spend but not in `models` would otherwise
  // inflate the scale while never being drawn.
  const models = useMemo(() => {
    const seen = new Set(usage?.models ?? []);
    for (const d of usage?.days ?? []) for (const m of Object.keys(d.byModel)) seen.add(m);
    return [...seen];
  }, [usage]);

  const colorFor = useMemo(() => {
    const map = new Map<string, string>();
    models.forEach((m, i) => map.set(m, MODEL_COLOR[i % MODEL_COLOR.length]));
    return map;
  }, [models]);

  // One scale across the whole chart so day-to-day comparison is honest.
  const dayMax = useMemo(() => {
    if (!usage) return 1;
    return Math.max(
      ...usage.days.map((d) => Object.values(d.byModel).reduce((a, b) => a + b, 0)),
      0.01,
    );
  }, [usage]);

  const spendRatio = capRatio(usage?.spend ?? 0, usage?.spendCap);

  if (!usage) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12px] text-muted">
        No usage recorded for this objective yet.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-5 py-[18px] text-ink">
      <div className="mx-auto max-w-[1040px]">
      <div className="flex items-start gap-5">
        <div>
          <h3 className="m-0 text-[16px] font-semibold">Usage · {objectiveName}</h3>
          <div className="mt-1 font-mono text-[10.5px] text-muted">
            last {days} days · {usage.harnessCount} harnesses
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex gap-1.5">
          {[7, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => { onDaysChange(d); }}
              className={`rounded-[5px] px-2 py-[3px] font-mono text-[10.5px] font-medium ${
                days === d
                  ? 'border border-edge bg-controlAlt text-ink'
                  : 'border border-transparent text-muted hover:text-ink2'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex gap-2.5">
        <Tile label="Spend" value={money(usage.spend)}>
          {spendRatio != null && usage.spendCap != null && (
            <div className="mt-2 flex items-center gap-1.5">
              <Meter
                value={spendRatio}
                color={spendRatio > 0.9 ? '#e5675b' : '#5b9dff'}
                height={4}
                className="flex-1"
                track="#25252c"
              />
              <span className="font-mono text-[9px] text-muted">
                of {money(usage.spendCap)} cap
              </span>
            </div>
          )}
        </Tile>
        <Tile label="Tokens" value={compactCount(usage.tokens)}>
          {usage.cacheHitRate != null && (
            <div className="mt-2 font-mono text-[9.5px] text-muted">
              {percent(usage.cacheHitRate)} cache hit
            </div>
          )}
        </Tile>
        <Tile
          label="Per merged ticket"
          value={usage.costPerMergedTicket != null ? money(usage.costPerMergedTicket) : '—'}
        >
          {usage.costPerTicketDelta != null && (
            <div
              className={`mt-2 font-mono text-[9.5px] ${
                usage.costPerTicketDelta < 0 ? 'text-ok-tint' : 'text-warn'
              }`}
            >
              {usage.costPerTicketDelta > 0 ? '+' : ''}
              {Math.round(usage.costPerTicketDelta * 100)}% vs last period
            </div>
          )}
        </Tile>
        <Tile label="Wasted" value={money(usage.wasted)} valueClass="text-warn">
          <div className="mt-2 font-mono text-[9.5px] text-muted">failed + retired runs</div>
        </Tile>
      </div>

      <div className="mt-[18px] rounded-lg border border-hair bg-panel p-3.5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold">Daily spend by model</span>
          <div className="flex gap-3 font-mono text-[9.5px] text-muted">
            {models.map((m) => (
              <span key={m}>
                <span style={{ color: colorFor.get(m) }}>■</span> {m}
              </span>
            ))}
          </div>
        </div>

        <div className="flex h-28 items-end gap-2.5">
          {usage.days.map((d, dayIndex) => {
            const total = Object.values(d.byModel).reduce((a, b) => a + b, 0);
            return (
              <div
                key={`${d.label}-${String(dayIndex)}`}
                className="flex h-full flex-1 flex-col justify-end overflow-hidden"
                title={`${d.label}: ${money(total)}`}
              >
                {models.map((m, i) => {
                  const v = d.byModel[m] ?? 0;
                  if (v <= 0) return null;
                  return (
                    <div
                      key={m}
                      style={{
                        height: `${String((v / dayMax) * 100)}%`,
                        background: colorFor.get(m),
                        opacity: d.projected ? 0.45 : 1,
                        borderRadius: i === 0 ? '2px 2px 0 0' : undefined,
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-2.5 font-mono text-[9px] text-faint">
          {usage.days.map((d, dayIndex) => (
            <span key={`${d.label}-${String(dayIndex)}`} className="flex-1 text-center">
              {d.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3.5">
        <SectionLabel className="mb-2">Top spenders</SectionLabel>
        <div className="overflow-hidden rounded-lg border border-hair">
          {usage.topSpenders.map((s, i) => (
            <button
              key={s.harnessId}
              type="button"
              onClick={() => { onOpenHarness(s.harnessId); }}
              className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left font-mono text-[10.5px] ${
                i % 2 === 0 ? 'bg-card' : 'bg-cardAlt'
              } hover:bg-raised`}
            >
              <span className="min-w-0 flex-1 truncate text-ink2">
                {s.name}
                {s.childCount > 0 && (
                  <span className="text-faint"> + {s.childCount} children</span>
                )}
              </span>
              <Meter
                value={s.share}
                color={s.outcomeTone === 'fail' ? '#e5675b' : '#5b9dff'}
                height={4}
                className="w-[150px]"
                track="#25252c"
              />
              <span className="w-14 text-right text-ink">{money(s.spend)}</span>
              <span
                title={s.outcome}
                className={`w-28 flex-none truncate text-right ${
                  s.outcomeTone === 'ok'
                    ? 'text-ok-tint'
                    : s.outcomeTone === 'fail'
                      ? 'text-danger'
                      : 'text-muted'
                }`}
              >
                {s.outcome}
              </span>
            </button>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  valueClass = '',
  children,
}: {
  label: string;
  value: string;
  valueClass?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex-1 rounded-lg border border-hair bg-card px-3.5 py-3">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[.07em] text-faint">
        {label}
      </div>
      <div className={`mt-1.5 text-[21px] font-semibold ${valueClass}`}>{value}</div>
      {children}
    </div>
  );
}
