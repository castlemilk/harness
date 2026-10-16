# Skill: Type-directed merging

Applies to tasks in the "merge-semantics" bug class.

## Procedure
1. Write down what merge means per type: scalars overwrite, arrays combine, nested objects recurse, order preserved left-then-right.
2. Find the actual collision: a generic assign/copy path that treats containers like scalars, so the right side replaces the left.
3. Special-case containers before the scalar path: recurse for objects, combine for arrays.
4. Do not mutate the inputs unless the previous behaviour did.
5. Verify with a key defined as a container on both sides, and assert non-conflicting keys from both sides survive.

## Traps to avoid
- Object.assign or spread, which is shallow and replaces arrays wholesale.
- Recursing into the first differing type without checking both sides are containers.
