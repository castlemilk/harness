"""Drive one make_forward_cycle end-to-end with synthetic feeds; confirm the
cycle emits a REAL regime (not 'unknown') and preserves prior open positions.
"""
import math
from datetime import date
from types import SimpleNamespace

import omega.live_paper.feeds as feeds
from omega.live_paper.runner import make_forward_cycle, CycleContext
from omega.live_paper.checkpoint import CheckpointState

UNIVERSE = ("BTCUSDT", "ETHUSDT", "ARBUSDT", "POLUSDT")

# Synthetic deterministic 130-bar daily-close series per symbol.
def _series(base, drift):
    out = {}
    p = base
    for i in range(130):
        p *= (1.0 + drift * math.sin(i / 9.0) + (0.003 if i > 80 else -0.0015))
        d = date.fromordinal(date(2026, 2, 26).toordinal() + i).isoformat()
        out[d] = round(p, 2)
    return out

SERIES = {
    "BTCUSDT": _series(60000.0, 0.004),
    "ETHUSDT": _series(3000.0, 0.005),
    "ARBUSDT": _series(1.2, 0.006),
    "POLUSDT": _series(0.5, 0.006),
}
AS_OF = date(2026, 7, 6)  # within the synthetic series span

def fake_fetch(cfg, symbol, as_of):
    return feeds.FeedResult(
        name=symbol, kind="crypto", reachable=True, latency_ms=1.0,
        provider_used="synthetic", doc={"series": SERIES[symbol]},
    )

feeds.fetch_ohlcv = fake_fetch  # monkeypatch

cfg = SimpleNamespace(universe=UNIVERSE)
cycle = make_forward_cycle(cfg)

# Prior state with 2 open positions (mirror the live daemon's ARB + POL).
prior = CheckpointState(
    cycle_ts="2026-07-05T00:00:00+00:00",
    cycle_date="2026-07-05",
    last_completed_date="2026-07-05",
    equity=100000.0,
    realised_pnl=0.0,
    open_positions=[
        {"symbol": "ARBUSDT", "side": "long", "size": 100.0, "entry_price": 1.1, "entry_cycle": 2},
        {"symbol": "POLUSDT", "side": "long", "size": 200.0, "entry_price": 0.48, "entry_cycle": 2},
    ],
    closed_trades=[],
    signals_state={},
    seed_state={"cycle_n": 3},
)

ctx = CycleContext(cycle_date=AS_OF, cycle_ts=AS_OF.isoformat(), prior=prior, initial_capital=100000.0)
res = cycle(ctx)

print("regime:        ", res.extra_log.get("regime"))
print("regime_source: ", res.extra_log.get("regime_source"))
print("regime_probs:  ", res.extra_log.get("regime_probs"))
print("signals_ok:    ", res.extra_log.get("signals_ok"))
print("strategy_ok:   ", res.extra_log.get("strategy_ok"))
print("open_symbols:  ", res.extra_log.get("open_symbols"))
print("feeds_blocked: ", res.extra_log.get("feeds_blocked"))

# Determinism: run again, same regime.
res2 = cycle(ctx)
print("deterministic: ", res.extra_log.get("regime") == res2.extra_log.get("regime")
      and res.extra_log.get("regime_probs") == res2.extra_log.get("regime_probs"))

assert res.extra_log.get("regime") in ("bull", "bear", "sideways"), "regime not a real label!"
print("PASS: real regime emitted (not 'unknown')")
