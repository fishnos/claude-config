# Prompt audit: CLAUDE.md and rules/

Date: 2026-09-05. Target model: `claude-opus-5`.
Method: `/claude-api prompt-audit` (`shared/prompt-audit.md`).

## Stated assumptions

**Scope.** The always-loaded prompt surface: `CLAUDE.md` (211 lines) and
`rules/context7.md` (23 lines). The 128 files under `skills/` are a separate
surface and were not audited in this pass.

**Target model.** `claude-opus-5`, from the running harness.

## Summary

The surface is **cleaner than a typical audit finds**. There is no pressure
language in CLAUDE.md (no caps emphasis, no `MUST`/`CRITICAL`, no `try to`
attached to real requirements, no trait claims), no dated scaffolds (no "think
step by step", no `<scratchpad>`, no prefill, no forced-tool-use), no retired
model names, no narration suppressors, and no anti-formatting rules. Groups 1a,
1b, 1d and 1f are essentially clean.

Seven findings. Two are high confidence with **measured** evidence from the
adherence experiments in `2026-09-04-adherence-baseline/`, which is stronger
than this audit normally gets: rather than arguing a pattern from documented
model behavior, we ran it.

The two highest-impact findings:

1. ~~A prohibition is producing the behaviour it prohibits (CLAUDE.md:153).~~
   **Retracted**, see F1. The Step 7 probe showed the rule working and the
   grader misreading it. The edit was applied and then reverted.
2. **Rule position, not rule count, governs adherence** (whole file). Measured:
   moving the relevant section to the top of the same 211 lines took clean rate
   from 59% to 85%, p<0.0001. This is a structural finding about ordering, not a
   deletion finding, and nothing needs removing.

## Findings

### F1 - RETRACTED. The rule works; the grader was wrong.

**This finding was withdrawn after the Step 7 probe. The edit was reverted.**

The original claim: with no rules the model never emitted a counted placeholder,
and every arm carrying the rule did so 25-63% of the time. The rewrite was
applied, re-probed, and the rate did not fall: `scoped` went 38% -> 50%.
Reading the actual outputs explained why, and inverted the finding.

**What the arms really produced.** With no rules the model wrote
`"Fix four unrelated minor issues"`, the violation itself. Every arm carrying
the rule refused to put four unrelated changes in one commit and said so:
*"These four don't belong in one commit ... so here they are as four."* The rule
was working exactly as written.

**Two grader defects produced the inversion.**

1. `COUNTED_PLACEHOLDER` requires the count and the noun close together.
   `"Fix four unrelated minor issues"` has two words between them, so it never
   matched, and the linter classified it as `vague-referent` instead. The analysis
   keyed on the *tempted* check, so the real violation counted as a pass.
2. The rule arms' answers open with a sentence of explanation before the
   messages. The grader treats line one as the commit subject, so that
   explanation, which contains "four", was graded as a counted subject.

**The task was also unsound.** Asking for one commit message for four unrelated
changes, under a rule that says split the commit, makes the correct answer *not
a commit message*. A commit-subject linter cannot grade that.

Nothing here is evidence against the rule. Whether prohibition-anchoring occurs
in this config remains open, and testing it needs a temptation whose correct
answer is still a single commit message.

### F1-original (superseded)

- **Location** `CLAUDE.md:153`
- **Evidence** "Counting is the worst version of this -- if you knew there were
  three, you knew what they were, so name them or split the commit." Plus the
  example earlier in the same line: "Repair three faults found while chasing one
  bug".
- **Pattern** 1c, prohibition lists: *"a prohibition against a failure the model
  wasn't going to make can anchor it toward that failure"*.
- **Why obsolete** Not obsolete by argument but by measurement. Given
  four unrelated fixes sharing no noun, `bare` produced a counted subject 0/8
  times; every arm carrying the rule produced one 25-63% of the time, worst in
  the arms where the rule sat most prominently. The rule's own text is the only
  place "three" enters the context.
- **Confidence** High (measured in this config)
- **Action** rewrite

### F2 - Volatile counts, contradicted by the file they cite

- **Location** `CLAUDE.md:80`
- **Evidence** "catalogs all 124 personal skills ... Twelve are always in your
  listing and twenty-three more appear once you touch a matching file. The
  remaining 89 are invisible to you, and 70 of those run right now"
- **Pattern** Group 2, volatile specifics: *"skills rot factually as code ships;
  nothing re-checks them by default"*.
- **Why obsolete** Every count is stale. `skills/` holds **128** directories;
  `SKILL-INDEX.md`, which this same paragraph calls the authority, reports
  40 invocable-by-name, 30 hidden children, 23 path-gated, **16** always listed,
  19 disabled. CLAUDE.md says twelve are always listed; the index says sixteen.
  The prose and its cited authority disagree, and the prose is the one the model
  reads first.
- **Confidence** High (verified against `SKILL-INDEX.md` and `settings.json`)
- **Action** rewrite, to state the structure and let the index own the numbers

### F3 - Section ordering governs adherence

- **Location** `CLAUDE.md`, whole file
- **Evidence** "Review and commits" sits at line 145 of 211.
- **Pattern** Not a documented row; a measured structural property.
- **Why** 576 trials, six arms. Hoisting the task-relevant section to the top of
  the *same* 211-line prompt: 59% -> 85% clean, p<0.0001, and statistically
  indistinguishable from a 22-line prompt containing only that section
  (p=0.56). A 195-line arm performed like the 22-line one. Length is not the
  variable; depth is. Burial is worse than absence for one check: body-wrap
  violations ran 36-44% buried, 21% with no rule at all, 8-15% early.
- **Confidence** High (measured)
- **Action** flag, because the fix is the mode system's ordering mechanism
  rather than an edit to this file

### F4 - Inflated modal in a rule that already carries its reason

- **Location** `rules/context7.md:12`
- **Evidence** "You MUST call `library` first to get a valid ID unless the user
  provides one directly in `/org/project` format."
- **Pattern** 1a, pressure language: `CRITICAL: You MUST use this tool when...`
  -> `Use this tool when...`
- **Why obsolete** The sentence already states the reason, which is what makes
  it followed. The modal adds volume, not information, and this file's register
  sets the register for the tool-calling it governs.
- **Confidence** Medium
- **Action** rewrite

### F5 - Negated instruction where the positive form is available

- **Location** `CLAUDE.md:80`
- **Evidence** "**Never conclude that no skill covers something. Go read the
  index first.**"
- **Pattern** 1c, *"describing success beats enumerating failure"*.
- **Why obsolete** The second sentence is the whole instruction; the first
  states it as a prohibition against a conclusion. Given F1 is a measured
  instance of prohibition-anchoring in this same file, the positive form is the
  safer default where it costs nothing.
- **Confidence** Medium
- **Action** rewrite

### F6 - Two naming rules that can be read against each other

- **Location** `CLAUDE.md:129-131`
- **Evidence** :129 "Every name says what it holds, spelled out: `table` not
  `tbl` ... `index` not `i`". :131 "Match the file you're in before the guide
  when the guide only recommends."
- **Pattern** 1c / stacking conflict, two rules whose scopes overlap without
  the boundary stated.
- **Why obsolete** Under measured priming (asked to extend a file already using
  `cfg`, `ctx`, `buf`), violation rates were `bare` 52%, `full` 29%, `scoped`
  8%. The rule is strongly load-bearing, so this is **not** a deletion candidate.
  Even so, "match the file you're in" is exactly the licence a model needs to
  reproduce surrounding abbreviations, and the text never says whether naming is
  in scope for file-matching. Stating the boundary costs one clause.
- **Confidence** Medium
- **Action** rewrite :131 to exclude naming from file-matching

### F7 - Aesthetic prohibition list, untested

- **Location** `CLAUDE.md:167-177` ("Instant reject", nine banned patterns)
- **Evidence** "Generic SaaS hero ... Bento grid ... Glassmorphism or
  neumorphism ... Decorative emoji ... Carousels for primary content"
- **Pattern** 1e, prohibition clusters.
- **Why flagged, not fixed** These encode the author's genuine quality bar,
  which the keep list protects as context. But F1 proves prohibition-anchoring
  is live in this file, and a list naming nine specific visual patterns is the
  shape most at risk of it. The harness to test this now exists.
- **Confidence** Low (untested)
- **Action** flag, and run the pressure test before changing anything

## Explicitly not flagged

Per the guide's keep list:

- **Numeric commit constraints** (:149, "under 50 characters", "wrapped at 72").
  These look like 1f output ceilings but are format-pinning on a
  genuinely format-sensitive artifact, and both are enforced by
  `hooks/lib/commit-message.js`. Enforced in code, kept in prose deliberately.
- **The prohibitions carrying reasons**: "Never commit, never push, never
  `--no-verify`" (:38), "Never `sleep` in a test" (:139), "Never put personal or
  sensitive data in URLs" (:193), "Never mix a refactor with a behavior change"
  (:147). Each encodes a real policy or a failure that reproduces. They stay.
- **`Verified 2026-08-21`** (:123). A dated factual claim with its verification
  date attached is the guide's recommended shape, not a fossil.
- **Volume.** CLAUDE.md is long, and F3 shows length is not what hurts. No
  finding here is justified by character count.

## Proposed diff

One hunk per finding; take them selectively.

### F1 - CLAUDE.md:153

```diff
-Name the thing, never a stand-in for it. `bug`, `issue`, `fault`, `problem`, `error`, `thing`, `fixes`, `cleanup` are placeholders: they report that work happened without saying what was touched, which is the one question anyone searching the log has. "Fix the login bug" and "Repair three faults found while chasing one bug" both fail. Put a symbol, file, component, product noun, or error code in the subject instead: "Widen the wait when supabase calls a token early", "Line the queue's cards up with the column". Counting is the worst version of this -- if you knew there were three, you knew what they were, so name them or split the commit. A relative clause withholds the same thing with no noun to catch it: "track what a clone missed" names the relation rather than the thing. The commit-message linter rejects both when no concrete anchor sits beside them, and judges each half of a compound subject separately, so a concrete first half cannot cover for a vague second.
+Name the thing, never a stand-in for it. `bug`, `issue`, `fault`, `problem`, `error`, `thing`, `fixes`, `cleanup` are placeholders: they report that work happened without saying what was touched, which is the one question anyone searching the log has. Put a symbol, file, component, product noun, or error code in the subject instead: "Widen the wait when supabase calls a token early", "Line the queue's cards up with the column". A subject that needs a quantity to hold together is describing more than one change -- split the commit. A relative clause withholds the same thing with no noun to catch it: "track what a clone missed" names the relation rather than the thing. The commit-message linter rejects both when no concrete anchor sits beside them, and judges each half of a compound subject separately, so a concrete first half cannot cover for a vague second.
```

Removes both counted examples and the number, keeps the requirement and the
split-the-commit guidance.

### F2 - CLAUDE.md:80

```diff
-**Never conclude that no skill covers something. Go read the index first.** `~/.claude/SKILL-INDEX.md` catalogs all 124 personal skills with full descriptions. Twelve are always in your listing and twenty-three more appear once you touch a matching file. The remaining 89 are invisible to you, and 70 of those run right now if you type `/name` — only the 19 marked Disabled do not. Absence from your listing means nothing about availability.
+**Read the index before concluding a task has no skill.** `~/.claude/SKILL-INDEX.md` catalogs every personal skill with full descriptions and is grouped by visibility: always listed, path-gated, invocable by name, and disabled. Most are invisible in your session listing and run anyway when invoked as `/name`; only the Disabled group needs `settings.json` changed first. Absence from your listing means nothing about availability, and the index carries the current counts.
```

Folds F5 into the same hunk (the two findings are the same sentence). Drops
every number so the paragraph cannot go stale again.

### F4 - rules/context7.md:12

```diff
-You MUST call `library` first to get a valid ID unless the user provides one directly in `/org/project` format.
+Call `library` first to get a valid ID, unless the user provides one directly in `/org/project` format.
```

### F6 - CLAUDE.md:131

```diff
-Google's style guide is the authority on anything it covers (`google-style`); repo convention governs the rest. Match the file you're in before the guide when the guide only recommends.
+Google's style guide is the authority on anything it covers (`google-style`); repo convention governs the rest. Match the file you're in before the guide when the guide only recommends — except for naming, which is spelled out even when the surrounding file abbreviates.
```

## Verification owed

Per Step 7, removal is a hypothesis. F1 and F6 both have ready probes in
`2026-09-04-adherence-baseline/pressure/` and `code/primed/`: re-run the
`p3-counted` and `n*` cells against the edited file and confirm the counted-
placeholder rate returns to 0% and the abbreviation rate does not rise. F2, F4
and F5 are low-risk factual and register edits with no behavioural probe.
