#!/usr/bin/env python3
"""PostToolUse(Edit|Write) check for style-guide violations a formatter cannot fix.

Only flags patterns that are unambiguous in the Google style guides or that silently
break a test suite. High precision on purpose -- a noisy hook gets ignored.
Never fails the tool call; any internal error exits 0.
"""

import json
import os
import re
import sys

WEB = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
PY = {".py"}
CHECKED = WEB | PY

MAX_BYTES = 400_000

TEST_PATH = re.compile(r"(^|/)(tests?|__tests__|spec)/|[._-](test|spec)\.[a-z]+$|(^|/)test_[^/]+\.py$")

# Each rule is (pattern, message, tolerated_in_test_files). The style guide explicitly
# permits suppressions in tests to build partial mocks; nothing excuses a stray `.only`.
WEB_RULES = [
    (re.compile(r"@ts-(ignore|nocheck)\b"),
     "@ts-ignore / @ts-nocheck are banned -- they hide the real error and leave the "
     "surrounding types unpredictable. Fix the type, narrow with a guard, or use a "
     "documented `unknown` cast.",
     True),
    (re.compile(r"(?m)^\s*var\s+[A-Za-z_$]"),
     "`var` is function-scoped and causes scoping bugs. Use `const`, or `let` when reassigned.",
     False),
    (re.compile(r"(?m)^\s*debugger\s*;?\s*$"),
     "`debugger` statement must not ship.",
     False),
    (re.compile(r"\b(describe|it|test)\.only\s*\(|^\s*(fdescribe|fit)\s*\(", re.M),
     "`.only` silently disables every other test in the file -- CI will pass while "
     "covering almost nothing. Remove before committing.",
     False),
    (re.compile(r"(?<![=!<>])(?<!=)==(?!=)\s*(?!null\b)"),
     "Loose `==` coerces types unpredictably. Use `===` (only `== null` is allowed, to "
     "catch null and undefined together). Regex-based, so check for a false positive "
     "inside a string, comment, or regex literal.",
     False),
]

PY_RULES = [
    (re.compile(r"(?m)^\s*except\s*:"),
     "Bare `except:` catches SystemExit and KeyboardInterrupt too. Catch a specific "
     "exception type, or `except Exception:` if you truly mean all errors.",
     False),
    (re.compile(r"def\s+\w+\s*\([^)]*=\s*(\[\]|\{\}|set\(\))"),
     "Mutable default argument -- it is created once and shared across every call. "
     "Default to `None` and build the container inside the function.",
     False),
    (re.compile(r"(?m)^\s*from\s+[.\w]+\s+import\s+\*"),
     "Wildcard import makes the namespace unknowable and breaks static analysis. "
     "Import the names you use.",
     False),
]


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return

    if payload.get("tool_name") not in ("Edit", "Write", "MultiEdit"):
        return

    path = payload.get("tool_input", {}).get("file_path", "")
    if not path:
        return

    extension = os.path.splitext(path)[1]
    if extension not in CHECKED:
        return

    try:
        if os.path.getsize(path) > MAX_BYTES:
            return
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            source = handle.read()
    except Exception:
        return

    is_test = bool(TEST_PATH.search(path))
    rules = WEB_RULES if extension in WEB else PY_RULES

    findings = []
    for pattern, message, tolerated_in_tests in rules:
        if is_test and tolerated_in_tests:
            continue
        match = pattern.search(source)
        if not match:
            continue
        line = source.count("\n", 0, match.start()) + 1
        findings.append(f"- {os.path.basename(path)}:{line} -- {message}")

    if findings:
        note = (
            "Style-guide violations in the file just written (google-style):\n"
            + "\n".join(findings)
            + "\nFix these now rather than leaving them for review. These checks are regex-based "
            "and cannot tell code from a string literal or comment -- if a hit is fixture data or "
            "an example, say so and move on rather than editing it."
        )
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": note,
            }
        }))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
