---
id: code-commit-granularity
setting: code
primary_at: polished
worker: n/a
---

One commit is one self-contained change that builds and passes tests on its own;
that's what makes `bisect` and `revert` work. Never mix a refactor with a
behavior change, or formatting with logic, once the refactor or formatting would
hide the change from someone reading the diff; a small move, rename or reformat
that only prepares the change goes in the same commit. Small independent tweaks
of one kind may share a commit whose subject names that kind. A fix to a commit
that has not been pushed is folded into that commit instead of landing on its
own.
