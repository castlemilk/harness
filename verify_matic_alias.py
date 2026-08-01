"""Verify MATIC->POL alias prices the 86 legacy MATIC trades on real basis.

Compares BasisLoader behavior with the alias (current code) vs. without it,
using the actual V255.C trade set.
"""
import copy

from omega.nodes.funding_carry.hold_scaled import HoldScaledParams, simulate_universe_scaled
from omega.nodes.funding_carry.data import FundingDataLoader
from omega.nodes.funding_carry.regime import FundingRegimeClassifier
from omega.nodes.funding_carry.basis_data import BasisLoader, _SYMBOL_ALIASES
from omega.nodes.funding_carry.v255c_scorer import build_market_index, _apply_frozen_basis

loader = FundingDataLoader()
universe = loader.load_universe()
dates, market_index = build_market_index(universe)
clf = FundingRegimeClassifier()
date_regimes = clf.classify_span(dates, market_index)
trades = simulate_universe_scaled(universe, date_regimes, HoldScaledParams())

matic = [t for t in trades if t.symbol == "MATICUSDT"]
print(f"Total trades: {len(trades)}")
print(f"MATIC trades: {len(matic)}")
if matic:
    ds = sorted(t.entry_date for t in matic)
    xs = sorted(t.exit_date for t in matic)
    print(f"MATIC entry date range: {ds[0]} .. {ds[-1]}")
    print(f"MATIC exit  date range: {xs[0]} .. {xs[-1]}")

# POL series coverage
bl = BasisLoader()
loaded = bl._load_one("POLUSDT")
if loaded:
    mark, index = loaded
    mk = sorted(mark.keys())
    print(f"POL mark coverage: {mk[0]} .. {mk[-1]} ({len(mk)} obs)")

# How many MATIC trades now price with real basis (alias active)?
priced = 0
date_miss = 0
for t in matic:
    res = bl.residual_pnl(t.symbol, t.entry_date, t.exit_date, t.perp_side, t.notional_usd)
    if res is None:
        date_miss += 1
    else:
        priced += 1
print(f"\nWith alias active: MATIC priced={priced}, date-fallback={date_miss}")
print(f"MATICUSDT in available set? {'MATICUSDT' in bl.available(['MATICUSDT'])}")

# Per-trade delta: zero-basis pnl vs alias-priced pnl for MATIC
trades_zero = copy.deepcopy(trades)
trades_alias = copy.deepcopy(trades)
_apply_frozen_basis(trades_alias, None)

# baseline: without alias, MATIC keeps zero basis (residual $0)
zero_by_key = {(t.symbol, t.entry_date, t.exit_date): t.pnl_usd for t in trades_zero}
deltas = []
for t in trades_alias:
    if t.symbol != "MATICUSDT":
        continue
    z = zero_by_key[(t.symbol, t.entry_date, t.exit_date)]
    deltas.append(t.pnl_usd - z)
nonzero = [d for d in deltas if abs(d) > 1e-9]
print(f"\nMATIC per-trade PnL deltas (alias - zero): n={len(deltas)}, nonzero={len(nonzero)}")
if nonzero:
    nonzero.sort()
    print(f"  min={nonzero[0]:.4f}  median={nonzero[len(nonzero)//2]:.4f}  max={nonzero[-1]:.4f}")
    print(f"  sum={sum(deltas):.4f}")
