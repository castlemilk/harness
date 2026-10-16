# Skill: Aggregating outcomes across parallel work

Applies to tasks in the "error-aggregation" bug class.

## Procedure
1. Enumerate the required outcomes first: all inputs fail, some fail, none fail. Write down the expected return for each.
2. Collect every outcome without short-circuiting: await all work, then partition into fulfilled and rejected.
3. When every input rejected, throw the collected error (AggregateError, or the single error when only one exists).
4. Otherwise return the fulfilled values; keep rejections out of the successful return value.
5. Never let a rejection escape an await inside a loop that is meant to continue, and never let a catch turn 'all failed' into a silent success.

## Traps to avoid
- await inside try/catch that rethrows per item, or that swallows the only rejection.
- Returning early on the first failure, so partial successes are lost.
