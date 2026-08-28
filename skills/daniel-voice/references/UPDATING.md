# Updating this skill

Bump `metadata.version` in SKILL.md on every change.

## Where a new thing goes

| What Daniel gives you | Where it goes |
|---|---|
| A punctuation or grammar rule | `mechanics.md`, plus the checklist in SKILL.md |
| A structural or rhythm preference | `structure.md` |
| A rule that applies to one genre only | `genres.md`, under that genre |
| A rule stated in conversation, with his reasoning | append to `corrections.md` |
| An error you made twice | the checklist in SKILL.md |
| A rewrite of your draft | `paired/`, see below |
| A new piece of his finished writing | `samples/` |

Always append to `corrections.md` as well as filing the rule where it belongs.
The log carries his reasoning and the failing example; the reference file
carries the rule. Both are needed, because a rule without its reason breaks the
first time it meets a counterexample.

## Paired samples

The highest-value data in this skill. A pair holds content fixed and varies
only the writing, which isolates voice in a way no finished essay can, since a
finished essay confounds his style with his subject matter.

Workflow: Claude drafts, Daniel rewrites it in his own words, Daniel pastes the
rewrite back. Without the paste, nothing is learned.

File as `paired/NNN-short-slug.md`:

```markdown
# 001 — short slug

**Date:** YYYY-MM-DD
**Genre:** academic | reflection | narrative | application

## Claude's draft

...

## Daniel's rewrite

...

## What changed

- One line per change, naming the move.
- Split a subordinate clause into two sentences: the payload was buried (LL1).
- Reordered the close: new information moved to the stress position.
- Swapped a verb: diction.
```

Two cautions when writing the note.

His rewrite is revision, not composition. Some changes mean "that is not my
sentence" and some mean "that reads like a machine wrote it." Both are useful
and they are different signals. When a change is the second kind, say so, so
that future-Claude does not encode an anti-AI reflex as a positive preference.

Do not generalize from one pair. `Mentioned once` is not `always does this`.
Three pairs showing the same move is a pattern; one is a data point.

## Pairs outrank rules

When a pair contradicts something written in this skill, the pair wins and the
rule gets corrected. The rules are a model of his writing. The pairs are his
writing.
