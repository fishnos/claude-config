---
id: code-test-behaviors
setting: code
primary_at: decent
---

Test behaviors, not methods — name the test after the behavior so a failure
explains itself without opening the file. Assertions stay narrow; a broad object
dump fails for reasons unrelated to what's under test. No logic in tests: no
conditionals, no loops, no computed expectations. Tests are DAMP, not DRY —
duplication that keeps a test readable in isolation is correct.
