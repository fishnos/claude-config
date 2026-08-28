---
name: daniel-voice
description: Writes in Daniel Kosukhin's voice for any prose task, including academic essays, reading reflections, personal narrative, college supplements, scholarship applications, cover letters, and any draft he wants polished or rewritten. Use this skill whenever Daniel asks for help writing, drafting, editing, polishing, restructuring, or giving feedback on prose, even when he does not say "in my voice" and even when the request sounds like ordinary editing. Do NOT use for code comments, technical documentation, or commit messages.
license: MIT
metadata:
  version: "3.0.0"
  supersedes: "1.x (April 2026), which was built from two samples and is wrong in several places"
---

# Daniel's Voice

This skill contains no drafting procedure of its own. Read the core principles
below, then load the reference files the task calls for, then write.

## Precedence

When two sources conflict, the higher one wins:

1. **`references/paired/`** — Daniel's own rewrites of drafts. Evidence, not inference.
2. **`references/corrections.md`** — rules he stated directly, with his reasoning.
3. **`references/samples/`** — his finished writing.
4. Everything else in this skill — a model derived from the above, and wrong before.

Against the `humanizer` skill: **daniel-voice wins on style, humanizer wins on
tells.** Humanizer §10 flags tricolons and §31 flags short declaratives; Daniel
uses both on purpose. Humanizer's own Voice Calibration section concedes this,
since a writing sample outranks its style rules. Apply humanizer for AI
vocabulary, inflated significance, and hollow closers.

## When to load what

| Situation | Read |
|---|---|
| Any prose task, before writing a word | `references/mechanics.md` |
| Any prose task, before writing a word | `references/structure.md` |
| Academic essay, rhetorical analysis, argument | `references/genres.md` → Academic |
| Reading reflection, personal reflection | `references/genres.md` → Reflection |
| Narrative, personal essay, scene writing | `references/genres.md` → Narrative |
| Supplement, personal statement, application | `references/genres.md` → Application |
| Before returning any draft | the checklist at the bottom of this file |
| He gives a new rule or rewrites your draft | `references/UPDATING.md` |

Read the samples in `references/samples/` when you need to hear the register
rather than read rules about it. His sentences teach faster than my summaries
of them, and most past failures came from trusting the summary.

## The four things that matter most

Everything else is detail. These are load-bearing, and getting them wrong
produces prose he rejects regardless of how many surface patterns are correct.

### 1. Flow is the first requirement, not a finishing touch

Flow is the single thing he cares about most and the thing most drafts fail.
It is not a property of individual sentences. It comes from each sentence
opening on something the previous sentence established, and closing on what is
new. A sentence that opens cold, on a name or an abstraction the paragraph has
not yet introduced, reads as disjointed no matter how well built it is.

Full mechanism in `references/structure.md`. Do not skip it.

### 2. The payload goes in the main clause

His class framework (LL1) states it directly: the most important idea belongs
in the main clause. Burying the turn of a paragraph inside a participial
phrase or a relative clause is the most common failure. Subordinate what is
genuinely secondary and nothing else.

### 3. Vary the joint, not just the length

Long sentences are the baseline. Repeating one joining structure is what he
calls chopped, and `independent clause, and independent clause` repeated across
a paragraph is the specific pattern he dislikes most. Six long sentences built
the same way read worse than a mix of lengths built differently.

Equally: do not overcorrect into stuffing. Cramming two ideas that each deserve
a main clause into one sentence demotes one of them. Combine only when one idea
truly serves the other.

### 4. Mechanics are checked, not trusted

Rules known are not rules applied. Introductory-phrase commas and interrupted
verb phrases have been missed repeatedly while attention was on rhythm. Run the
checklist below as a separate pass.

## Register

Plain over elevated. His documented weakness, confirmed by his teacher's
margin comments and by peer feedback, is abstraction and reaching past what the
words support. The previous version of this skill told Claude to prefer
elevated vocabulary "when the rhythm allows," which encouraged the exact failure
he is working to correct. Do not restore it.

His writing has moved from ornate toward plain across 2026. Write at the plain
end. When a fancier word and a plain word both fit, take the plain one.

## Final checklist

Run this as a separate pass on the finished draft, not while drafting.

- [ ] Comma after every introductory phrase or clause
- [ ] Comma before `and`/`but`/`yet` joining two independent clauses
- [ ] No comma before an essential `because`
- [ ] Subject and verb not separated by an interrupting aside
- [ ] Every pronoun and demonstrative points at a specific named noun, not a whole preceding clause
- [ ] No sentence, clause, or phrase opens with `and`, `that`, or `but`
- [ ] `and so`, never bare `so`
- [ ] Zero em dashes (one permitted only if genuinely unavoidable)
- [ ] Every sentence opens on something already established
- [ ] Every sentence ends on its new information
- [ ] No two consecutive sentences share a joining structure
- [ ] No abstract noun given a verb a person would not use (`the conclusion holds`)
- [ ] Read it aloud. If any sentence catches, rebuild it.

## Updating

This skill is designed to grow. See `references/UPDATING.md` for where a new
rule goes. Bump the version in the frontmatter on every change.
