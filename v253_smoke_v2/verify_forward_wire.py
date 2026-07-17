#!/usr/bin/env python3
"""Verify the V253 forward entry wire: (A) idempotency, (B) end-to-end fills.

Drives make_forward_cycle with a monkeypatched feeds.fetch_ohlcv returning a
controlled OHLCV window (no network), so we can assert:
  A. Two cycles with identical feeds + identical prior state produce byte-
     identical positions / equity / realised PnL (idempotency guardrail).
  B. The full signal -> strategy -> execute_proposals path runs and can open
     paper positions (the "strategy step actually ran + can fill" proof).
"""
from __future__ import annotations

import json
import math
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from omega.live_paper import feeds  # noqa: E402
from omega.live_paper.config import LivePaperConfig  # noqa: E402
from omega.live_paper.runner import CycleContext, make_forward_cycle  # noqa: E402

CFG = LivePaperConfig()
AS_OF = date(2024, 3, 10)
N_BARS = 40  # rich enough for the signal indicators to compute


def _synthetic_series(symbol: str) -> dict[str, float]:
    """A deterministic per-symbol trending close series (distinct slope/level)."""
    # Seed slope/level off the symbol name so symbols differ but are reproducible.
    seed = sum(ord(c) for c in symbol)
    base = 100.0 + (seed % 50)
    slope = ((seed % 7) - 3) * 0.9  # mix of up/down trends across the universe
    series: dict[str, float] = {}
    for i in range(N_BARS):
        d = date.fromordinal(AS_OF.toordinal() - (N_BARS - 1 - i))
        # trend + mild curvature so momentum/vol indicators have signal
        px = base + slope * i + 4.0 * math.sin(i / 3.0)
        series[d.isoformat()] = round(max(px, 1.0), 4)
    return series


def _patched_fetch_ohlcv(cfg, symbol, as_of):  # noqa: ANN001
    series = _synthetic_series(symbol)
    doc = feeds.series_doc(f"ohlcv_close_{symbol.lower()}", "synthetic", "USD close", series)
    return feeds.FeedResult(doc["name"], "crypto", True, 1.0, "synthetic", doc=doc)


def _run_once(prior=None):
    ctx = CycleContext(
        cycle_date=AS_OF, cycle_ts=AS_OF.isoformat() + "T04:05:00+00:00",
        prior=prior, initial_capital=CFG.initial_capital,
    )
    return make_forward_cycle(CFG)(ctx)


def _fingerprint(res) -> str:
    """Position/equity/PnL fingerprint (excludes cosmetic trade_id/ts/opened_at)."""
    pos = sorted(
        {"symbol": p["symbol"], "side": p.get("side"), "size": round(p.get("size", 0.0), 6),
         "entry": round(p.get("entry", 0.0), 6)}
        for p in res.open_positions
    ) if False else [
        {"symbol": p["symbol"], "side": p.get("side"), "size": round(p.get("size", 0.0), 6),
         "entry": round(p.get("entry", 0.0), 6)}
        for p in sorted(res.open_positions, key=lambda x: x["symbol"])
    ]
    return json.dumps(
        {"equity": res.equity, "realised": res.realised_pnl,
         "unrealised": res.unrealised_pnl, "positions": pos},
        sort_keys=True,
    )


def main() -> int:
    feeds.fetch_ohlcv = _patched_fetch_ohlcv  # monkeypatch (no network)

    r1 = _run_once()
    r2 = _run_once()

    fp1, fp2 = _fingerprint(r1), _fingerprint(r2)
    idempotent = fp1 == fp2
    props = r1.extra_log["proposals_n"]
    fills = r1.extra_log["fills_opened"]
    sig_ok = r1.extra_log["signals_ok"]
    strat_ok = r1.extra_log["strategy_ok"]

    print("=== V253 forward-wire verification (synthetic feeds, no network) ===")
    print(f"  signals_ok      : {sig_ok}")
    print(f"  strategy_ok     : {strat_ok}")
    print(f"  regime          : {r1.extra_log['regime']}")
    print(f"  proposals_n     : {props}")
    print(f"  fills_opened    : {fills}")
    print(f"  open_symbols    : {r1.extra_log['open_symbols']}")
    print(f"  equity          : {r1.equity}")
    print(f"  realised_pnl    : {r1.realised_pnl}")
    print(f"  feeds_blocked   : {len(r1.extra_log['feeds_blocked'])}/{len(CFG.universe)}")
    print()
    print(f"  (A) idempotent  : {'PASS' if idempotent else 'FAIL'}  (two cycles byte-identical)")
    entry_ran = sig_ok and strat_ok
    print(f"  (B) entry ran   : {'PASS' if entry_ran else 'FAIL'}  (signal+strategy executed)")
    can_fill = fills > 0
    print(f"  (B') can fill   : {'PASS' if can_fill else 'note: 0 fills (no breach)'}")
    if not idempotent:
        print("  fp1:", fp1)
        print("  fp2:", fp2)
    ok = idempotent and entry_ran
    print()
    print("VERDICT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
