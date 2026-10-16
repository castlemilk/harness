# Skill: Recency bookkeeping and eviction

Applies to tasks in the "recency-ordering" bug class.

## Procedure
1. Separate the two responsibilities: capacity enforcement and recency bookkeeping.
2. Make every read and write path refresh recency. A read that does not refresh order yields FIFO, not LRU.
3. Enforce capacity after the recency update, evicting exactly one least-recent entry per over-capacity insert.
4. Assert that the container's size stays bounded; growth past capacity means eviction is not running or picks the wrong end.
5. Verify with an interleaved sequence: fill to capacity, read one key, insert again, then assert the read key survived and the untouched key was evicted.

## Traps to avoid
- Tracking recency with a counter but comparing with >= or <=, so eviction removes the wrong entry.
- Refreshing recency only in set(), leaving get() to look like a no-op for ordering.
