# Skill: Cancelling scheduled work

Applies to tasks in the "timer-cancellation" bug class.

## Procedure
1. Identify what the cancel path must stop: a scheduled callback, an in-flight loop, or both.
2. Clear the exact handle produced by the scheduling call, and make cancel safe to call more than once.
3. Reset the correlated bookkeeping (handle, deadline, pending flag) so a later invocation cannot read stale state.
4. Decide the post-cancel contract for the wrapped call: it must not fire, and it must not leave a caller waiting for a result that will never come.
5. Verify by cancelling and then waiting past the original delay, asserting the callback never ran.

## Traps to avoid
- Clearing a handle variable that was reassigned by a later schedule call.
- Setting a cancelled boolean without clearing the timer, leaving the callback pending.
