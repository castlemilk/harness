# Tier 1 DeepSWE grading corpus

These four patches and expected reward summaries came from Docker benchmark run
`4e8be75d-cfa3-4063-8a7c-c50532b56dcf`. The source harness task and `TaskDiff`
IDs are pinned in `manifest.json`; each patch is also protected by SHA-256 so a
line-ending change is detected before any repository setup or verifier work.

The fixtures cover four observed grading shapes: a clean pass, a stable near
miss, a regression-heavy failure, and a large-suite partial result. They pin the
grader's treatment of known patches. They do not measure whether a model can
produce those patches.

Run all four with `pnpm bench:deepswe:golden`, or select a fixture with, for
example, `pnpm bench:deepswe:golden -- --task abs-stepped-slices`.
