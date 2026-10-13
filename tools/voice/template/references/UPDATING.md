# Updating this skill

Bump `metadata.version` in SKILL.md on every change.

## Where a new thing goes

| What {{FIRST_NAME}} gives you                        | Where it goes                                 |
| :--------------------------------------------------- | :-------------------------------------------- |
| A punctuation or grammar rule                        | `mechanics.md`, plus the checklist in SKILL.md |
| A structural or rhythm preference                    | `structure.md`                                |
| A rule that applies to one genre only                | `genres.md`, under that genre                 |
| A rule stated in conversation, with the reasoning    | append to `corrections.md`                    |
| An error you made twice                              | the checklist in SKILL.md                     |
| A rewrite of your draft                              | `paired/`, see below                          |
| A new piece of finished writing                      | `samples/` (`ccfg voice add {{NAME}} FILE`)   |

Always append to `corrections.md` as well as filing the rule where it belongs.
The log carries the reasoning and the failing example; the reference file
carries the rule. Both are needed, because a rule without its reason breaks the
first time it meets a counterexample.

## Paired samples

The highest-value data in this skill. A pair holds content fixed and varies
only the writing, which isolates voice in a way no finished piece can, since a
finished piece confounds style with subject matter.

Workflow: Claude drafts, {{FIRST_NAME}} rewrites it in their own words, and
pastes the rewrite back. Without the paste, nothing is learned.

Start the file with `ccfg voice learn {{NAME}} --slug short-slug`. It creates
the next numbered file, `paired/NNN-short-slug.md`, with these headings:

- **Claude's draft**
- **{{FIRST_NAME}}'s rewrite**
- **What changed**: one line per change, naming the move. For example: split
  a subordinate clause into two sentences because the payload was buried;
  reordered the close so new information lands last; swapped a verb.

Two cautions when writing the note.

A rewrite is revision, not composition. Some changes mean "that is not my
sentence" and some mean "that reads like a machine wrote it." Both are useful
and they are different signals. When a change is the second kind, say so, so
that a later session does not encode a reflex against machine prose as a
positive preference.

Do not generalize from one pair. Mentioned once is not "always does this".
Three pairs showing the same move is a pattern; one is a data point.

## Pairs outrank rules

When a pair contradicts something written in this skill, the pair wins and the
rule gets corrected. The rules are a model of the writing. The pairs are the
writing.
