---
name: voice-build
description: Builds or extends a writing-voice skill from the owner's writing samples and a short interview. Invoke by name as /voice-build NAME after `ccfg voice new NAME` has scaffolded the skill.
disable-model-invocation: true
---

# Build a voice skill

You are filling in a voice skill that `ccfg voice new` scaffolded: a directory
`skills/NAME-voice/` under the config directory (`~/.claude` unless
`CLAUDE_CONFIG_DIR` says otherwise) that holds the right files and no rules
yet. Your job is to read the owner's writing, ask what the writing cannot show,
and write the rules down where the skill's own protocol says they go.

The argument is the voice's name. With no argument, run `ccfg voice list`, show
the result, and ask which voice to build.

## Rules for the whole run

- **Only this skill's files.** Write inside `skills/NAME-voice/` and nowhere
  else.
- **Never rewrite a skill that already has rules.** If `references/mechanics.md`
  or `references/structure.md` holds anything beyond the scaffold's headings,
  you are extending: add, and log each addition in `references/corrections.md`.
  Change an existing rule only when the owner tells you it is wrong.
- **Every rule cites its evidence**: the sample file and the sentence, or the
  owner's own words from the interview. A rule you cannot cite is a guess, and
  a guess is left out.
- **One sample is a data point.** Write a rule from a habit seen in at least
  three places, or stated by the owner. Note a habit seen once under a heading
  "Seen once, not yet a rule".
- **Samples are private.** Quote a sentence to show a rule; never paste a
  sample whole into another file, and never send one anywhere.

## Step 1: Read

Read `SKILL.md`, `references/UPDATING.md`, then every file in
`references/samples/` and `references/paired/`.

With fewer than three samples, stop and say so: three is the least that shows a
habit and not an accident. Tell the owner to add more with
`ccfg voice add NAME FILE...` and offer to go on with the interview alone if
they prefer.

Fill in the table in `references/samples/README.md`: one row per file with its
genre, when it was written if the file says, and one line on what it shows.

## Step 2: Say what you see, and check it

Before asking anything, tell the owner in plain words what the samples show:
five to eight observations, each with one quoted sentence. Cover punctuation,
sentence length and how it varies, how pieces open and close, how paragraphs
hand off, and the words that recur. Ask which observations are right, which
are accidents of those particular pieces, and which are habits they are trying
to drop.

## Step 3: Interview

Ask what samples cannot show. One question at a time, and follow up on any
answer that surprises you. Stop when two questions in a row add nothing.

- Which of these samples sounds most like you, and which least? Why?
- What do you cut when you edit your own drafts?
- What do you see in other people's writing, or in machine writing, that you
  never want in yours?
- Which kinds of writing will you use this for? (This decides the sections of
  `references/genres.md`. A genre with no sample gets no section.)
- Who do you imagine reading, and how formal are you with them?
- Any hard rules: words you never use, marks you never use, spelling variant?

Record each answer that states a rule in `references/corrections.md`, in the
owner's words, with the date.

## Step 4: Write

Following `references/UPDATING.md`:

1. `references/mechanics.md`: sentence-level rules, each with one cited
   example.
2. `references/structure.md`: how pieces are built, each with one cited
   example.
3. `references/genres.md`: one section per genre the samples contain.
4. In `SKILL.md`: replace the "This skill is still empty" paragraph and the
   "Core principles" stub with the three to five things that matter most about
   this voice, and start the "Final checklist" with one line per hard rule.
   Rewrite the `description` so it says what the voice is for in the owner's
   terms. Change no other frontmatter key except `version`.
5. Bump `metadata.version` (`0.1.0` to `0.2.0` on the first build; the minor
   number on each later one).

## Step 5: Prove it

Draft one short paragraph in the voice on a topic the owner picks, and ask them
to rewrite it. Run `ccfg voice learn NAME --slug first-draft`, and fill the file
it prints with your draft, their rewrite, and one line per change naming the
move. A pair outranks every rule: correct any rule their rewrite contradicts.

## Report

End by listing the files you changed, how many rules each now holds, the
observations left under "Seen once", and the new version. Say what you did not
verify: a voice is judged by its owner reading the next thing it writes.
