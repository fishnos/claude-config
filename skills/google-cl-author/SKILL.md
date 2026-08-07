---
name: google-cl-author
description: Author changes the way Google expects them — one self-contained change per commit/PR, tests in the same change, a description that says what and why, and collaborative responses to review feedback. Use when planning how to split work into commits or PRs, writing a commit message or PR description, deciding whether a change is too big, or responding to review comments. Encodes google/eng-practices CL author guide.
---

# Google CL authoring

A "CL" (changelist) is Google's unit of review — read it as **one commit or one PR**. Three things make a change easy to review and safe to land: it's small, it explains itself, and its author engages with feedback collaboratively.

## Small changes

Small changes are reviewed faster, reviewed more thoroughly, less likely to carry bugs, cheaper to throw away if the direction is wrong, easier to merge, easier to design well, and simpler to roll back. A reviewer may reject a change **for size alone**.

**The right size is one self-contained change**:

- Addresses **just one thing** — usually one part of a feature, not a whole feature.
- Includes its related test code (see below).
- Contains everything the reviewer needs to understand it, in the change, its description, the existing codebase, or a change they already reviewed.
- Leaves the system working for users and developers after it lands.
- Is not so small its implications are unclear. A new API should land with a use of that API, so the reviewer can see how it's meant to be called — and so unused APIs don't accumulate.

~100 lines is usually reasonable; ~1000 is usually too large; file count matters too — 200 lines in one file may be fine, spread over 50 files it isn't. When in doubt, go smaller. Reviewers rarely complain about a change being too small.

Large is more acceptable when: deleting a whole file (roughly one line of review), or a mechanical refactor from a tool you trust completely, where the reviewer's job is to confirm they want it.

**Splitting strategies** — think about this _before_ coding, not after:

- **Stack** changes on top of each other; send the first for review and keep building on it.
- **Split by files** when different groups of files need different reviewers.
- **Split horizontally** by layer (model → service → API → client), using a shared signature or stub to decouple the layers.
- **Split vertically** by sub-feature, each a full-stack slice that can progress independently.
- Combine both: a grid of layer × feature, where each cell is its own change.

**Separate refactorings from behavior changes.** Moving or renaming a class goes in a different change from fixing a bug in it. Small cleanups (a local variable name) can ride along with a feature change; judge when a refactor is big enough to obscure the review.

**Never break the build.** If changes depend on each other, each one must leave the system working when it lands.

"It has to be large" is almost always false. Before writing a big change, consider whether a refactoring-only change first would make the real change clean. If it truly can't be split, get the reviewer's consent _in advance_, expect a long review, and be extra diligent about tests.

## Tests belong in the same change

Tests are expected for all changes. A change that adds or alters logic ships with new or updated tests for that behavior. A pure refactor should already be covered by tests — if it isn't, add them.

Test work that _can_ go in its own earlier change: adding tests to already-submitted code (which then validates a later refactor), refactoring test helpers, and introducing larger test framework code.

For how to write tests worth having, see `google-testing`.

## Writing the description

The description is a permanent record. It must answer:

1. **What** is being changed — enough that a reader gets the shape of it without reading the diff.
2. **Why** — the context you had, the decisions that aren't visible in the source, the problem being solved.

Source code shows what the software does; it rarely shows why it exists. Without the why, a future developer can't tell whether they're allowed to remove your fence.

**First line**: a short summary of specifically what the change does, written as a complete imperative sentence, followed by a blank line. "**Delete** the FizzBuzz RPC and **replace** it with the new system." — not "Deleting… and replacing…". It must stand alone, because that's what shows in history.

**Body**: fill in the details — the problem, why this approach, any shortcomings of the approach, relevant bug numbers, benchmark results, design doc links. Include enough context inline that a link rotting doesn't erase the reasoning. Even small changes deserve this.

Inadequate: "Fix bug." "Fix build." "Add patch." "Moving code from A to B." "Phase 1." "Add convenience functions."

Good:

> RPC: Remove size limit on RPC server message freelist.
>
> Servers like FizzBuzz have very large messages and would benefit from reuse. Make the freelist larger, and add a goroutine that frees the freelist entries slowly over time, so that idle servers eventually release all freelist entries.

Tags (`[tag]`, `#tag`, `tag:`) are optional. Keep them short if they're on the first line, or move them to the body — long tags bury the content.

**Re-read the description before submitting.** Changes drift during review; the description often stops being true.

## Handling review comments

**Don't take it personally.** The critique is aimed at the code and the codebase. If a reviewer sounds frustrated, ask what the constructive point underneath is, and respond to that.

**Never respond in anger.** It's permanent and it's a serious breach of professional etiquette. Walk away and come back.

**Fix the code, not the thread.** If the reviewer didn't understand something, the first move is to clarify the code. If the code can't be clarified, add a comment explaining why it's there. Only if a comment would be pointless does an explanation in the review thread make sense — future readers of the file never see review threads.

**Think collaboratively, not defensively.** First ask yourself whether you actually understand what's being requested; if not, ask. If you understand and still disagree:

> Bad: "No, I'm not going to do that."
>
> Good: "I went with X because of [these pros/cons] with [these tradeoffs]. My understanding is that using Y would be worse because of [these reasons]. Are you suggesting that Y better serves the original tradeoffs, that we should weigh the tradeoffs differently, or something else?"

You often know things about the users, the codebase, or the change that the reviewer doesn't. Give them that context. Consensus on technical facts is usually reachable; when it isn't, escalate rather than stall.

## Reference material

Full source text from google/eng-practices:

- `references/small-cls.md` — small changes, splitting strategies, test colocation
- `references/cl-descriptions.md` — writing good descriptions, with worked examples
- `references/handling-comments.md` — responding to reviewers
