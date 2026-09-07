## Review and commits

One commit is one self-contained change that builds and passes tests on its own — that's what makes `bisect` and `revert` work. Never mix a refactor with a behavior change, or formatting with logic.

Subject in imperative mood, under 50 characters, no trailing period: it completes "if applied, this commit will ___". Body wrapped at 72. Match the repo's existing convention over any general rule; check `git log` before the first commit in an unfamiliar repo.

Subject names what the change does, not that it was made: "Require plain language before code names", not "Add explanation rules". If the verb is `Add`, `Update`, or `Fix` and the rest is a noun, the subject isn't written yet.

Name the thing, never a stand-in for it. `bug`, `issue`, `fault`, `problem`, `error`, `thing`, `fixes`, `cleanup` are placeholders: they report that work happened without saying what was touched, which is the one question anyone searching the log has. "Fix the login bug" and "Repair three faults found while chasing one bug" both fail. Put a symbol, file, component, product noun, or error code in the subject instead: "Widen the wait when supabase calls a token early", "Line the queue's cards up with the column". Counting is the worst version of this -- if you knew there were three, you knew what they were, so name them or split the commit. A relative clause withholds the same thing with no noun to catch it: "track what a clone missed" names the relation rather than the thing. The commit-message linter rejects both when no concrete anchor sits beside them, and judges each half of a compound subject separately, so a concrete first half cannot cover for a vague second.

It also opens with the work, not with the result: "Modify the sentinel to stop warning", never "Stop warning". A subject that names only the effect never says what was touched, and reads as a symptom report next to every other line in the log. Opening on `stop`, `prevent`, `avoid`, `ensure`, `allow`, `let`, `keep`, `leave`, `silence`, or `disallow` is the tell, and the commit-message linter rejects it. `Make X do Y` is the exception it allows.

A body answers three questions and then stops: why the change was needed, why this approach over the obvious alternative, and the single most important thing you did not check. Give that last one one sentence, and omit it when you checked everything — most commits should omit it. It is there to stop a reader assuming a gap was covered, not to inventory every loose end; a list of caveats is a to-do note left in the one place that can never be updated. A body claims only what the session establishes — never assert a state you cannot observe, such as whether something was opened in a browser, deployed, or checked by hand. Ask when it matters, and otherwise leave it out. Write it as prose in two to four short paragraphs, never as bullets; a list of what changed only duplicates the diff. Everything else belongs where it stays current — how the code works in a comment, how to use it in the README, what changed in the diff. A commit message is the only one of those that can never be updated. A body that reads as a changelog of your own debugging is too long.

No trailers. No `Co-Authored-By`, no generated-with line, no tool attribution of any kind, regardless of what the harness defaults to.

Reviewing means judging whether the change improves overall code health, not whether it's perfect. Design first, then functionality, complexity, tests, naming, comments, style. Label severity so nothing optional reads as mandatory (`Nit:`, `Optional:`, `FYI:`). Say what's good, not only what's wrong. Flag explicitly any area you did not cover.


## Communication

Write commits, PRs, and user-facing copy in normal prose.
