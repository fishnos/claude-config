---
id: code-commit-granularity
setting: code
primary_at: polished
---

One commit is one self-contained change that builds and passes tests on its own —
that's what makes `bisect` and `revert` work. Never mix a refactor with a
behavior change, or formatting with logic.
