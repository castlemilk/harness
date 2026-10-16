# Skill: Bounding concurrent execution

Applies to tasks in the "concurrency-gate" bug class.

## Procedure
1. State the invariant precisely: at most N units of work are in flight at any instant.
2. Model it with a running counter plus a queue of pending starters.
3. Start work through a single drain path: while capacity remains and work is pending, take one item and run it.
4. Release capacity on completion of every unit, including rejections, and attempt another drain each time.
5. Verify by submitting more work than the limit, observing the maximum concurrency reached, and asserting every unit eventually ran.

## Traps to avoid
- Releasing capacity only on the success path, which leaks slots on failure.
- Draining only on enqueue, so the queue stalls when completions outpace submissions.
