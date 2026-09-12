#!/usr/bin/env python3
"""Fetch a small LiveCodeBench-Hard sample as JSON for the ledger eval.

Run with uv so the datasets dependency is ephemeral:

    uv run --no-project --python 3.12 --with 'datasets<4' \\
      scripts/fetch-lcb-problems.py \\
      --lcb-root /path/to/GVS5H/codebase/livecodebench \\
      --ids-file /path/to/GVS5H/codebase/v2-current/escalation/lcb100_hardest_v6.json \\
      --n 4 --out scripts/fixtures/lcb-hard-sample.json

Requires the GVS5H clone for the patched LiveCodeBench loader and the pinned
hardest-100 id list (release_v6).
"""

from __future__ import annotations

import argparse
import json
import os
import sys


def stdin_tests(raw_tests):
    tests = []
    if isinstance(raw_tests, str):
        raw_tests = json.loads(raw_tests)
    for test in raw_tests or []:
        if isinstance(test, dict):
            stdin, expected, testtype = test.get("input", ""), test.get("output", ""), test.get("testtype")
        else:
            stdin, expected, testtype = test.input, test.output, getattr(test, "testtype", None)
        testtype_value = getattr(testtype, "value", testtype)
        if str(testtype_value).lower() != "stdin":
            continue
        tests.append({"input": stdin or "", "output": expected or ""})
    return tests


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lcb-root", required=True, help="path to GVS5H/codebase/livecodebench")
    ap.add_argument("--ids-file", required=True, help="path to lcb100_hardest_v6.json")
    ap.add_argument("--release", default="release_v6")
    ap.add_argument("--n", type=int, default=4)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    sys.path.insert(0, args.lcb_root)
    from lcb_runner.benchmarks.code_generation import load_code_generation_dataset  # noqa: PLC0415

    dataset = load_code_generation_dataset(release_version=args.release)
    by_id = {p.question_id: p for p in dataset}
    ids = json.load(open(args.ids_file, encoding="utf-8"))

    picked = []
    for qid in ids:
        problem = by_id.get(qid)
        if problem is None:
            continue
        tests = stdin_tests(problem.public_test_cases)
        hidden = stdin_tests(getattr(problem, "private_test_cases", None))

        statement = f"### Question\n{problem.question_content}\n\n"
        if problem.starter_code:
            statement += (
                "### Format: You will use the following starter code to write the "
                "solution to the problem and enclose your code within delimiters.\n"
                f"```python\n{problem.starter_code}\n```\n\n"
            )
        else:
            statement += (
                "### Format: Read the inputs from stdin solve the problem and write "
                "the answer to stdout (do not directly test on the sample inputs). "
                "Enclose your code within delimiters as follows. Ensure that when the "
                "python program runs, it reads the inputs, runs the algorithm and "
                "writes output to STDOUT.\n\n"
            )

        picked.append({
            "id": problem.question_id,
            "difficulty": str(getattr(problem.difficulty, "value", problem.difficulty)),
            "contestDate": str(problem.contest_date),
            "platform": str(getattr(problem, "platform", "")),
            "statement": statement,
            "tests": tests,
            "hiddenTests": hidden,
        })
        if len(picked) >= args.n:
            break

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(picked, handle, indent=2)
    print(f"wrote {len(picked)} problems to {args.out}")
    for item in picked:
        print(
            f"  {item['id']:20s} public={len(item['tests']):2d} hidden={len(item['hiddenTests']):2d} "
            f"{item['contestDate'][:10]} {item['platform']}"
        )


if __name__ == "__main__":
    main()
