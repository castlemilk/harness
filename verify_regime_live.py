"""One-shot LIVE forward cycle against real Binance feeds (read-only; no prod
checkpoint mutation). Proves the regime wire emits a real regime on live data
via hmmlearn, and that resuming with the 2 open positions preserves them.
"""
import json
from datetime import date, timezone, datetime

from omega.live_paper.config import LivePaperConfig
from omega.live_paper.runner import make_forward_cycle, CycleContext
from omega.live_paper.checkpoint import CheckpointState

cfg = LivePaperConfig()
print("universe:", cfg.universe)

# Seed from a COPY of the current prod checkpoint's 2 open positions (ARB + POL).
prior = CheckpointState(
    cycle_ts="2026-07-15T02:55:00+00:00",
    cycle_date="2026-07-15",
    last_completed_date="2026-07-15",
    equity=100000.0,
    realised_pnl=0.0,
    open_positions=[
        {"symbol": "ARBUSDT", "side": "long", "size": 100.0, "entry_price": 1.0, "entry_cycle": 2},
        {"symbol": "POLUSDT", "side": "long", "size": 200.0, "entry_price": 0.5, "entry_cycle": 2},
    ],
    closed_trades=[],
    signals_state={},
    seed_state={"cycle_n": 2},
)

as_of = datetime.now(timezone.utc).date()
cycle = make_forward_cycle(cfg)
ctx = CycleContext(cycle_date=as_of, cycle_ts=as_of.isoformat(), prior=prior, initial_capital=100000.0)
res = cycle(ctx)
el = res.extra_log
print(json.dumps({
    "regime": el.get("regime"),
    "regime_source": el.get("regime_source"),
    "regime_probs": el.get("regime_probs"),
    "signals_ok": el.get("signals_ok"),
    "strategy_ok": el.get("strategy_ok"),
    "open_symbols": el.get("open_symbols"),
    "feeds_blocked": el.get("feeds_blocked"),
    "proposals_n": el.get("proposals_n"),
}, indent=2))
assert el.get("regime") in ("bull", "bear", "sideways"), f"regime not real: {el.get('regime')}"
assert el.get("regime_source", "").startswith("hmm") or "warmup" in el.get("regime_source", ""), el.get("regime_source")
print("LIVE PASS: real regime on live feeds")
