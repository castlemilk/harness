# Skill: Waiting instead of rejecting under backpressure

Applies to tasks in the "backpressure-wait" bug class.

## Procedure
1. Establish the saturation contract: the caller's promise must settle only when its work has run or definitively failed.
2. Replace rejection-when-full with waiting: retain the caller's resolver in a pending queue.
3. Admit work through one drain path so ordering is FIFO and no item is admitted twice.
4. Run the drain on completion as well as on enqueue, so the queue empties even when no new submission arrives.
5. Verify by deliberately overflowing, then asserting every submitted item ran exactly once and in order.

## Traps to avoid
- Dropping the retained resolver, leaving the caller pending forever.
- Keeping the old rejection path active as well, so overflow can still fail.
