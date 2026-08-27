# Tier 1 DeepSWE grading corpus

These five patches and expected reward summaries pin the grader's treatment of
known patches. They do not measure whether a model can produce those patches.

The first four came from Docker benchmark run
`4e8be75d-cfa3-4063-8a7c-c50532b56dcf`. The fifth (vulture) came from run
`7c8a47d7-9bc6-494d-a3f1-7836de20b85b` (ox-alpha); its source `TaskDiff` row
was later deleted by DB retention, so the patch file itself is the only durable
record — which is exactly why this corpus stores patches as files. Each patch
is protected by SHA-256 so a line-ending change is detected before any
repository setup or verifier work.

The fixtures cover five observed grading shapes: a clean pass, a stable near
miss, a regression-heavy failure, a large-suite partial result, and a phantom
penalty (vulture: four p2p ids missing-from-report because the patch renumbered
positional pytest ids — behaviour is irrelevant to those four).

Run all five with `pnpm bench:deepswe:golden`, or select a fixture with, for
example, `pnpm bench:deepswe:golden -- --task abs-stepped-slices`.
