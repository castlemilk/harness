---
name: go-agent
description: Go agent patterns for exploring, editing, and validating Go codebases.
---

When working in a Go codebase:

1. Use `code_overview` to find `go.mod`, entry packages, and test layout.
2. Use `lsp_symbol` to find definitions; `lsp_hover` to read signatures and docs.
3. Prefer `edit_file` for small changes; use `write_file` only for new files.
4. After edits run `go build ./...` and `go test ./...` (or the focused package).
5. Use `lsp_diagnostics` to catch type errors after changes.
6. Keep changes idiomatic: handle errors explicitly, avoid unused imports, and run `go fmt` before finishing.

Parser/grammar tasks in Go:
- If the task requires extending a goyacc-generated parser (e.g., Anko) and the instructions forbid regenerating checked-in parser artifacts, do NOT modify `parser.go.y` or regenerate `parser.go`.
- Instead, add a source preprocessor in the `parser/` package that rewrites the new syntax into syntax the existing parser already understands, then wire `ParseSrc` (or the entry point used by `core/core.go`) to call the preprocessor before lexing.
- For example, `func f(a = 1, b = a) { ... }` can be rewritten to a variadic wrapper that assigns defaults inside the function body.
- After adding the preprocessor, run `go build ./...`, then run `go test ./...` and fix any failures.
