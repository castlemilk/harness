# Skill: Validating state transitions

Applies to tasks in the "transition-validation" bug class.

## Procedure
1. Extract the permitted transitions into data: a table keyed by current state (and event) whose values are the allowed next states.
2. Centralise the decision in one place: look up the table, then either advance or reject. No other path mutates state directly.
3. On rejection, throw with both the attempted transition and the current state in the message, and leave the state unchanged.
4. Treat unknown states and events as invalid rather than permissive.
5. Verify that a valid path advances, and that an invalid attempt throws and leaves the machine in its previous state.

## Traps to avoid
- Mutating state before validating, so a rejected transition still changes the machine.
- Validating with a permissive default (allowing anything not explicitly forbidden) which accepts unknown events.
