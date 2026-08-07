---
name: google-code-review
description: Review code the way Google reviews a CL — design first, then functionality, complexity, tests, naming, comments, style, consistency, documentation, every line. Use whenever reviewing a diff, PR, branch, or file someone (including you) just wrote; whenever asked to "review", "check", "look over", "critique", or "audit" code; and as a self-review pass before reporting any implementation as done. Encodes google/eng-practices reviewer guide.
---

# Google code review

The reviewer's job is one judgment, repeated: **does this change improve the overall code health of the system?** Not "is it perfect." Approve once it definitely improves code health, even if imperfect. Block only when it doesn't.

## The standard

> In general, reviewers should favor approving a CL once it is in a state where it definitely improves the overall code health of the system being worked on, even if the CL isn't perfect.

Two forces in tension, both real:

- **Authors must make progress.** A reviewer who makes every change hard disincentivizes future improvement. There is no perfect code, only better code.
- **Code health must not decay.** Codebases die by a thousand small concessions made under deadline pressure. Never approve something that definitely worsens code health — the only exception is a genuine emergency (see `references/emergencies.md`).

Resolution rules, in priority order:

1. Technical facts and data overrule opinions and personal preferences.
2. On style, the style guide is the absolute authority. Style points not in the guide are personal preference — match the surrounding code; if there's no precedent, accept the author's choice.
3. Design is almost never pure preference. Weigh it on engineering principles. If the author demonstrates several approaches are equally valid, accept the author's.
4. Otherwise, ask for consistency with the existing codebase, as long as that doesn't worsen code health.

Never let a review stall on unresolved disagreement. Escalate to a real decision instead.

## How to run a review

**Step 1 — Take a broad view.** Read the description. Does this change make sense at all? Should it exist? Is now the right time? If the change shouldn't have been made in the first place, say so immediately and courteously, and suggest what to do instead. Do not review the details of a change that shouldn't land.

**Step 2 — Read the main part first.** Find the file with the most logical change; that's the core. Reviewing it first gives context for everything else. **If you find a major design problem, report it immediately without finishing the rest** — the rest of the code may disappear in the rework, and the author needs the bad news before they build more on top of it.

**Step 3 — Then everything else, in a sensible order.** Reading the tests first often reveals what the change is supposed to do. Don't skip files.

## What to look for

Work the list. Details and examples in `references/looking-for.md`.

- **Design** — the most important thing. Do the pieces interact sensibly? Does this belong here, or in a library? Does it integrate with the rest of the system?
- **Functionality** — does it do what the author intended, and is that good for its users? Users means end users _and_ the developers who'll call this code later. Think about edge cases, concurrency, deadlocks, race conditions — bugs you find by reasoning, not by running.
- **Complexity** — "too complex" means _can't be understood quickly by a reader_, or _likely to cause bugs when someone modifies it_. Check at every level: line, function, class. **Over-engineering is a form of complexity**: solve the problem that exists now, not the one speculated for later.
- **Tests** — appropriate unit/integration/e2e tests, in the same change as the production code. Will the test actually fail when the code breaks? Are the assertions simple and useful? Tests are code that must be maintained; don't accept complexity in them just because they don't ship.
- **Naming** — long enough to fully communicate what the thing is or does, short enough to read comfortably.
- **Comments** — necessary, clear, and mostly explaining **why**, not **what**. If code needs a comment to explain what it does, simplify the code instead. Exceptions: regexes, complex algorithms. Also check comments that already existed — a TODO that can now be deleted, a comment that this change invalidates.
- **Style** — the style guide is authority. Prefix non-guide preferences with `Nit:`. Never block on personal style. Major reformatting must be a separate change from functional work.
- **Consistency** — follow the guide; when the guide only recommends, judge between guide and local convention, biased toward the guide unless local inconsistency would confuse.
- **Documentation** — if the change alters how people build, test, use, or release, the docs change with it. If it deletes code, consider deleting the docs.
- **Every line** — actually read every line you were asked to review. Scan only data files, generated code, large literal structures. If you can't understand it, say so and ask; if you can't understand it, neither will the next reader.
- **Context** — look at the whole file, not just the diff window. Four new lines can be fine in isolation and still be the four lines that push a method past the point where it needs splitting. Then zoom out further: is this change improving the health of the system, or adding to its complexity?
- **Good things** — say what you liked and why. Reinforcement teaches at least as well as correction.

If part of the review needs expertise you don't have — security, privacy, concurrency, accessibility, i18n — say so explicitly rather than implying you covered it.

## Writing the comments

- **Be kind.** Comment on the _code_, never the _developer_. "Why did **you** use threads here?" → "The concurrency model here adds complexity without a performance benefit I can see; single-threaded would be simpler."
- **Explain why.** State the reasoning, the principle, or how the suggestion improves code health.
- **Balance directing and pointing.** It's the author's job to fix the change, not yours. Pointing at the problem and letting them solve it teaches more and often produces a better fix, since they're closer to the code. Give direct guidance or code when that's genuinely more helpful.
- **Label severity.** Make intent explicit so the author can prioritize, and so nothing optional reads as mandatory:
  - `Nit:` — minor, technically should do it, low impact.
  - `Optional:` / `Consider:` — probably a good idea, not required.
  - `FYI:` — not for this change, but worth knowing.
  - Unlabeled — required before approval.
- **Don't accept explanations that live only in the review.** If the author explains code you didn't understand, the outcome should be **clearer code**, or occasionally a code comment. An explanation in the review thread helps nobody who reads the file in two years.

## Speed

Optimize for the velocity of the team, not the individual. Slow reviews slow everyone, breed complaints about "strictness" that are really complaints about latency, and create pressure to accept worse code.

- Review promptly when you're not in the middle of focused work. **One business day is the maximum** for a response.
- Do **not** interrupt focused work to review. Wait for a break point — the cost of breaking your own flow exceeds the cost of the author waiting a little.
- Response speed matters more than end-to-end speed. If you can't do the full review, send a quick note: when you'll get to it, or initial broad comments.
- **Approve with comments** when the remaining comments are minor, optional, or you trust the author to handle them. Say which case it is.
- A change too large to review is a legitimate reason to send it back to be split.
- Never trade the standard for speed.

## Handling pushback

When the author disagrees, **first consider that they're right** — they're closer to the code. If they are, say so and drop it.

If they're not: explain again, demonstrating you understood their reply and adding information you didn't give the first time. Keep advocating for changes that improve code health. Improving code health happens in small steps.

"I'll clean it up in a follow-up" is the most common pushback and it usually doesn't happen — not from irresponsibility, but because the work moves on. **Insist on the cleanup now**, before it's in the codebase and "done." If the change merely _exposes_ surrounding problems that genuinely can't be fixed now, ask for a filed bug assigned to the author, optionally with a TODO referencing it.

Politeness is not optional and mostly prevents the upset that reviewers fear.

## When you are the one being reviewed

Read `google-cl-author` for the authoring side: small changes, good descriptions, and how to respond to comments without getting defensive.

## Reference material

Full source text from google/eng-practices, for when you need the detail:

- `references/looking-for.md` — the complete "what to look for" guide
- `references/standard.md` — the standard of code review, principles, conflict resolution
- `references/navigate.md` — navigating a change in review
- `references/speed.md` — speed of code reviews
- `references/comments.md` — how to write review comments
- `references/pushback.md` — handling pushback
- `references/emergencies.md` — what actually counts as an emergency
