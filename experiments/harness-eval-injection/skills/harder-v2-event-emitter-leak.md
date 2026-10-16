# Skill: Listener identity and cleanup

Applies to tasks in the "listener-identity" bug class.

## Procedure
1. Note the registration and the removal sites. A removal call only succeeds when it receives the same function object that was registered.
2. Reuse one named reference for both registration and removal, or keep a registry mapping an owner key to the exact callbacks it registered.
3. When a listener closes over per-call state, tie the registry entry to that call and delete it on the same path that removes the listener, so entries cannot accumulate.
4. Verify by asserting the listener count is stable across repeated register/remove cycles, not merely that no error was thrown.

## Traps to avoid
- Removing with fn.bind(this) or an inline arrow expression: both create a new identity.
- Checking that the removal call happened rather than that the internal registry shrank.
