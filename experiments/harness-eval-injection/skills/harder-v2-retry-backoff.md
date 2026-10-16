# Skill: Computing a delay schedule

Applies to tasks in the "retry-schedule" bug class.

## Procedure
1. Write out the required delay sequence for attempts 0..n before implementing.
2. Implement the sequence as one formula over base delay and attempt index, not a chain of special cases.
3. Keep schedule state per call, so concurrent retries cannot share mutable delay state.
4. Apply jitter or caps only if the specification asks for them.
5. Verify by recording the delays actually used and comparing them against the expected sequence.

## Traps to avoid
- Accumulating with delay += step (linear) when the specification asks for doubling from the base.
- Reusing one mutable delay variable across attempts so the growth compounds incorrectly.
