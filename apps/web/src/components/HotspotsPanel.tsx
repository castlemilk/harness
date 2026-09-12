import { useCallback, useEffect, useState } from 'react';
import { api, type HotspotsResponse, type ObservabilityStatus } from '../lib/api.js';

const WINDOWS = ['5m', '15m', '1h'];

function formatMs(ms: number): string {
  if (ms < 1) return '-';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function StatusDot({ ok, label, title }: { ok: boolean; label: string; title: string }) {
  return (
    <span className="flex items-center gap-1 text-[9px] text-gray-500" title={title}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
      {label}
    </span>
  );
}

export function HotspotsPanel() {
  const [status, setStatus] = useState<ObservabilityStatus | null>(null);
  const [hotspots, setHotspots] = useState<HotspotsResponse | null>(null);
  const [window, setWindow] = useState('15m');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (range: string) => {
    setLoading(true);
    try {
      const [nextStatus, nextHotspots] = await Promise.all([
        api.getObservabilityStatus().catch(() => null),
        api.getObservabilityHotspots(range, 8).catch(() => null),
      ]);
      setStatus(nextStatus);
      setHotspots(nextHotspots);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(window);
  }, [load, window]);

  return (
    <div className="border-b border-gray-200 p-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold text-gray-700">Hotspots</h3>
        <div className="ml-auto flex gap-1">
          {WINDOWS.map((range) => (
            <button
              key={range}
              onClick={() => { setWindow(range); }}
              className={`rounded px-1.5 py-0.5 text-[9px] ${window === range ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'}`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {status && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusDot ok={status.tracing.enabled} label="OTLP" title={status.tracing.otlpEndpoint ?? 'disabled'} />
          <StatusDot ok={status.tempo.ok} label="Tempo" title={status.tempo.url} />
          <StatusDot ok={status.mimir.ok} label="Mimir" title={status.mimir.url} />
        </div>
      )}

      {loading && !hotspots && <div className="text-[10px] text-gray-400">Loading hotspots…</div>}

      {hotspots && !hotspots.available && (
        <div className="text-[10px] text-gray-400">
          {hotspots.reason ?? 'No span metrics yet.'}
        </div>
      )}

      {hotspots?.available && (
        <div className="space-y-1">
          {hotspots.entries.map((entry) => (
            <div
              key={`${entry.service}|${entry.operation}`}
              className="rounded bg-gray-50 px-1.5 py-1"
              title={`p50 ${formatMs(entry.p50Ms)} · p99 ${formatMs(entry.p99Ms)} · ${entry.callsPerSec.toFixed(2)} calls/s`}
            >
              <div className="flex items-center justify-between gap-1 text-[10px]">
                <span className="truncate text-gray-700" title={`${entry.service} · ${entry.operation}`}>
                  {entry.operation}
                </span>
                <span className="font-medium text-gray-800">{formatMs(entry.p95Ms)}</span>
              </div>
              <div className="flex items-center justify-between text-[9px] text-gray-400">
                <span className="truncate">{entry.service}</span>
                <span>
                  {entry.callsPerSec.toFixed(2)}/s
                  {entry.errorRate > 0.01 && (
                    <span className="ml-1 text-red-500">{(entry.errorRate * 100).toFixed(1)}% err</span>
                  )}
                </span>
              </div>
            </div>
          ))}
          <div className="pt-1 text-right text-[8px] text-gray-300">
            {hotspots.metrics.duration ?? ''} · {new Date(hotspots.generatedAt).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}
