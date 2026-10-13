---
name: {{SKILL}}
description: Writes in {{OWNER}}'s voice for any prose task, including drafting, editing, polishing and rewriting. Do NOT use for code comments or technical documentation. Until /voice-build has filled it in, this skill holds no rules and says so.
metadata:
  kind: voice
  owner: "{{OWNER}}"
  template: "{{TEMPLATE_VERSION}}"
  version: "0.1.0"
---

# {{FIRST_NAME}}'s Voice

This skill contains no drafting procedure of its own. Read the core principles
below, then load the reference files the task calls for, then write.

**This skill is still empty.** It was scaffolded by `ccfg voice new` and nobody
has read {{FIRST_NAME}}'s writing into it yet. Until the section below is
filled, do not claim to write in this voice: write plain, careful prose and say
that the voice skill has not been built. To build it, run
`/voice-build {{NAME}}` in a session.

## Precedence

When two sources disagree, the higher one wins:

1. A paired rewrite in `references/paired/` ({{FIRST_NAME}}'s own rewrite of a draft).
2. `references/corrections.md` (rules stated in conversation, with reasons).
3. `references/mechanics.md`, `references/structure.md`, `references/genres.md`.
4. The finished writing in `references/samples/`.
5. This file.

## When to load what

| The task                              | Load                                  |
| :------------------------------------ | :------------------------------------ |
| Any prose at all                      | `references/mechanics.md`, every file in `references/paired/` |
| Anything longer than a paragraph      | `references/structure.md`             |
| A piece in a recognisable genre       | `references/genres.md`, that genre    |
| A rule was stated or a draft rewritten | `references/UPDATING.md`             |

## Core principles

Not written yet. `/voice-build` writes the few things that matter most about
this voice here, once it has read the samples and run the interview.

## Final checklist

Not written yet. `/voice-build` starts it; it grows by one line each time the
same error is made twice.

## Updating

How this skill learns is in `references/UPDATING.md`. Bump `metadata.version`
on every change.
