---
description: Judge the current diff against the google-code-review bar and rank what matters
argument-hint: "[optional: path, commit range, or area to focus on]"
---

Review the change named in `$ARGUMENTS` — or the uncommitted work if that is
empty — and deliver a verdict.

Judge whether the change improves overall code health, not whether it is
perfect. Take the dimensions in order: design first, then functionality,
complexity, tests, naming, comments, style. A design objection outranks every
style note beneath it, so say the design is sound before spending a word on
naming.

Label every point so nothing optional reads as mandatory: `Nit:`, `Optional:`,
`FYI:`, or unlabelled for something that must change before this lands. Say what
is good, not only what is wrong.

End with the two things a verdict is for: whether this should land as it stands,
and which areas you did not cover. Name the uncovered areas explicitly — a
review that is silent about its own gaps reads as a review that found none.
