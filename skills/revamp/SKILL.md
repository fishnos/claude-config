---
name: revamp
description: Rebuilds an existing club or personal website so it looks hand-crafted rather than AI-generated, running the whole process end to end (read the site, set a direction, source library components, build, review its own screenshots until clean, prepare the commit). Use when the user runs /revamp with a repo, or asks to revamp, redesign or rebuild a GNS club site or similar small site.
argument-hint: "<repo path or name> [polish]"
---

# Revamp

The bar is gns-astronomy, daniel-eng-portfolio and Stedo: sites that look made by
a person who cared about this one subject. What gets there is a process,
not a template: an identity drawn from the subject, real content, a few
well-chosen library components, and someone looking hard at the rendered
page and fixing what is off. This skill makes you do all four, including
the looking, so the user is not the one finding the faults.

**Target:** $ARGUMENTS. With `polish`, keep the existing identity and
structure: skip phase 2's new direction and go from phase 1 to phase 5.

Before anything else, read all three references:

- `references/standard.md`: what the reference sites do, as principles.
- `references/checklist.md`: the review every round must pass.
- `references/lessons.md`: every correction the user has made before.
  These are not suggestions; each one cost a feedback round.

## Phase 1: understand

1. Read the repo: pages, styles, content, README, `git log --oneline -30`.
   Run it locally (background the dev server on a free port).
2. Collect the facts and photos the site has, and find what it lacks from
   public sources (school clubs sheet, The Southerner, district pages).
   Every fact gets a source. Ask for nothing you can look up.
3. Run `shoot.js` on the current site (see phase 5) and run `/critique`
   on it. Write down what reads as machine-made.

## Phase 2: direction (the one stop)

Load `superpowers:brainstorming` only to sharpen the brief, not to quiz
the user; then `impeccable` (`shape`), `frontend-design`, and
`design-taste-frontend` for the direction itself.

Write a brief of at most 25 lines:

- **Scene:** one sentence: who visits, on what device, looking for what.
- **Identity:** the one idea from this club's subject the site is built
  around, and the one signature moment that carries it. It must not be
  guessable from the category alone (impeccable's category-reflex check).
- **References:** two or three real sites, with links, and what to take
  from each. Never a sibling club site.
- **Type:** a display face and a text face, with why they fit the subject.
- **Colour:** the palette and its real source (lessons: colours are never
  invented).
- **Structure:** each page and its sections, one line each.
- **Components:** one library component per section, from phase 3.

Show the brief and stop. This is the only approval stop. Everything after
it runs without check-ins unless something forces a choice only the user
can make.

## Phase 3: source components

Run `/tool-search` with the brief's structure. For each section, pick one
component from React Bits, Aceternity, Magic UI, ScrollX UI or 21st.dev.
When a registry needs a sign-in, take the source from the component's
GitHub repository with `gh search code` and `gh api`. Check every package
a component imports against `package.json`; a new dependency needs the
user's approval, so collect them and ask once, in the brief.

## Phase 4: build

- The user's default stack (CLAUDE.md), unless the repo has a working one
  worth keeping.
- All copy and photo data in one content file; pages read from it.
- Copied components keep a header comment naming the source and listing
  what changed. Changes to their layout go in the global stylesheet.
- Fonts self-hosted with `next/font/local`, only the weights used. No
  monospace or typewriter display type, no italic ledes, none of the
  overused faces listed in `lessons.md`.
- Delete what the new build replaces; leave nothing unused behind.
- Rewrite the README's design, facts and credits sections to match.

## Phase 5: review loop

Run up to three rounds. Each round:

1. `npx tsc --noEmit`, `npx eslint .`: zero errors.
2. Screenshots and measurements of every page:
   ```bash
   NODE_PATH=<dir with playwright installed>/node_modules \
     node ~/.claude/skills/revamp/scripts/shoot.js http://localhost:<port> <scratchpad>/shots-<round> / /page ...
   ```
   Install Playwright once in the scratchpad (`npm i playwright` there)
   if no copy exists. Every reported fault gets fixed.
3. Read every screenshot yourself, phone first. Go through
   `references/checklist.md` item by item against what you see, not what
   the code says should be there.
4. Run `/audit` and `contrast-master` on the result.
5. Fix everything found, then start the next round.

A round is clean when `shoot.js` exits 0, every checklist item passes on
the screenshots, and the audit has no high-severity finding. If round
three is still not clean, stop and report what remains.

## Phase 6: ship-ready

1. `next build` passes (in the background).
2. The Vercel project's framework preset matches the build
   (`vercel project inspect <name> --scope daniel-kosukhins-projects`). If
   it doesn't, give the user the command to change it; don't change it.
3. Prepare the commit with `/commit`. The user commits and pushes.

## Report

Lead with the result and the phone and desktop screenshots of the home
page. Then the brief as built, what the review rounds caught, and the
verified/not-verified split.

## When the user corrects something

The correction goes into `references/lessons.md` the same session, with a
check that would have caught it, and into `shoot.js` if a measurement can
catch it. A correction made once is never needed twice.
