# Skill: Traversing self-referential structures

Applies to tasks in the "graph-traversal-memo" bug class.

## Procedure
1. Characterise the input domain: nested containers, and containers that reference themselves.
2. Add an identity-keyed memo (WeakMap for objects, Set for a visited path) recording containers already seen or already copied.
3. Check the memo before descending, and register the new container before visiting its children.
4. On re-entry return the already-produced copy, so internal references point into the copy rather than the original.
5. Verify with a self-referencing object and assert both termination and that the copy's back-reference resolves inside the copy.

## Traps to avoid
- Memoising only primitive values.
- Registering the container after recursion, so the cycle is still re-entered once.
