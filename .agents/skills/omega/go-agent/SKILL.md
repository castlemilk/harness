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
