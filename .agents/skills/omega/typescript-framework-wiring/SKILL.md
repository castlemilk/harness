---
name: typescript-framework-wiring
description: TypeScript library framework-wiring patterns for adding features to existing codebases.
---

When adding a feature, engine, or public API to a TypeScript library:

1. Use `code_overview` first to identify entry points (`src/index.ts`), builders (`src/*/build.ts`), and plugin registration files.
2. Use `lsp_symbol` to locate where types/classes are defined, and `lsp_hover` to confirm signatures before editing.
3. Implement the feature in a focused module, then wire it into the existing framework:
   - Add options to the context/initializer.
   - Hook creation logic in the builder or plugin.
   - Attach instance methods on the built object in the build step.
   - Export public helpers/types from `src/index.ts`.
4. Never rely on TypeScript-only declarations for runtime APIs. The built object must expose the method at runtime; add it as a real property/function assignment.
5. After every source edit, run `lsp_diagnostics` on the changed file, then run the project's test command.
6. Use `verify_api_surface` with a concrete runtime check (e.g. mount/build an instance and test `typeof instance.theMethod === 'function'`) before calling `finish`.
