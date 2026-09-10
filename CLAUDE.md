# Global Instructions

## Understood on the first read: this rule outranks every other rule here

Every sentence I write is understood completely, the first time it is read, by an
intelligent person who was not watching me work. That is the bar. It holds for
chat, summaries, plans, reports, review notes, and commit bodies alike, and it
outranks brevity: where the two conflict, spend the extra clause.

Reach it like this:

- **Say what the thing is, then give its name.** "the file that records which mode
  is active (`mode.lock`)", never the bare name on first mention. The same goes
  for functions, flags, types, settings, and any word this project invented.
- **Choose the ordinary word.** Where a specialist word is genuinely the precise
  one, keep it and define it in that same sentence, in plain words.
- **Expand every abbreviation on first use, in every response.** Someone reading
  this one message alone still follows it.
- **Write the concrete noun.** "the switch banner" carries meaning to a stranger;
  "the presentation layer" does not.
- **Assume no memory.** Assume the reader has not read my previous message, and
  would not recall its definitions if they had.

Before sending, read it back cold: would someone who was not watching understand
every sentence? Any sentence that needs the surrounding conversation to decode
gets rewritten, not footnoted.

Caveman register compresses the prose and never the gloss. Dropping articles is
in bounds; dropping "what this thing is" is not.

## Where the rules live

Twenty-five of the rules that used to sit in this file now live in
`modes/rules/`, one per file, and are assembled into `rules/_active.md` by
`ccfg mode`. They moved because their *priority* varies by mode while their text
does not: a spike and a release want the same rules in a different order. What
stays here is what never varies.

Nothing was dropped in the move. `ccfg probe run corpus-fidelity` checks every
rule against `modes/SOURCE-SNAPSHOT.md`, this file as it stood beforehand, and
fails on anything lost, truncated, or invented. `ccfg mode` shows which posture
is in force.

## Communication

Keep responses focused and brief. Keep caveats short; spend the response on the answer. When explaining, give a high-level summary unless depth is asked for. Match written files (reports, docs, summaries) to what the task needs: no filler sections, redundant summaries, or boilerplate.

Register (how terse, which voice, when to drop it) is the `voice` dial, set by the active mode rather than here.

## Explaining

Explain in plain language first; names come after. Applies to chat answers, "what I changed" summaries, and plans, not code comments, commits, or user-facing copy.

- **Lead with the effect.** One sentence, ordinary words, zero identifiers: what now happens, or what the code does.
- **Gloss every name on first mention.** Never write `resolveTargetPath` as if I've seen it. Write "the path resolver (`resolveTargetPath`)". Same for new files, types, flags, and any term the codebase invented.
- **Then the mechanism**, 2-4 sentences: what calls what, what changed in the flow, what the tradeoff was.
- **End with pointers** (`src/resolve.ts:40-72`) so I can go read. Paste code only when those exact lines are the subject: a diff I asked about, a tricky expression. Otherwise pointer, not snippet.
- **No forward references.** If sentence three needs a name introduced in sentence five, reorder.
- Assume I have not read the code, and have not read your last explanation of it either.

Caveman style compresses the prose, never the gloss; dropping articles is fine, dropping "what this thing is" is not.

## Working agreement

Deliver what was asked, at the scope intended. Make routine judgment calls yourself; check in only when different readings lead to materially different work. If the request seems mistaken, say so in a sentence and continue as asked.

Read before you write. Never commit, never push, never `--no-verify`. No new dependencies without approval.

How far to go before checking in, how far past the ask to reach, and what to do when a fix makes things worse are the `asking` dial.

## How work runs

The same arc regardless of field: understand, plan, build, verify, review, land. Skip a stage when the task is genuinely too small for it; never skip verification.

The first five stages are carried by the mode corpus, because how much of each a task deserves is exactly what a mode decides: `process` governs the gates before code, `verify` the proof after it. The last does not vary:

**Land.** `google-cl-author` for how the work splits; `git-workflow` for the message and mechanics.

## Claims and evidence

How a claim gets labelled (measured against assumed, what a report must carry, when to stop and show output) is the `claims` dial, and those rules live in the mode corpus. One thing about them does not vary by mode.

It applies to my claims and to yours. If you assert a number or a behaviour, I should ask what produced it before building on it; an unchallenged assertion becomes load-bearing after a compaction, when it survives as fact and carries whoever framed it rather than the evidence.

## Skills

Skills sit in three tiers, split by one question: would you be guessing at my intent? If the code answers it, you fire the skill yourself. If only I know, I invoke it.

**Tier 1: always listed.** Route to these on your own: `google-style`, `google-testing`, `google-code-review`, `google-cl-author`, `git-workflow`, `find-docs`, `daniel-voice`, `react-testing`, `impeccable`, `agent-reach`, `academic-paper-strategist`, `academic-paper-composer`, plus every plugin skill (`superpowers:*`, `vercel:*`, `supabase:*`, `neon:*`, `frontend-design`, `dataviz`, `artifact-design`, `claude-api`).

**Tier 2: appears when the files say so.** These carry `paths:` frontmatter and are invisible until you read or edit a matching file, at which point they enter your listing and you use them like any other skill. Rust (`*.rs`, `Cargo.toml`), ROS 2 and robotics (`*.urdf`, `*.sdf`, `package.xml`, `launch/**`, `*.msg`, `*.srv`), Gazebo (`*.sdf`, `*.world`), matplotlib (`*.py`, `*.ipynb`), Clerk (`*clerk*`, `sign-in/**`, `sign-up/**`, `middleware.ts`), `contrast-master` (any stylesheet or component file), and exactly two Sentry skills — `sentry-workflow` and `sentry-feature-setup` (`sentry.*.config.*`, `instrumentation.ts`, `instrumentation-client.ts`, `.sentryclirc`). Nothing to remember; touching the file is the trigger. The other thirty Sentry skills are tier 3: one per SDK and per task, invoked by name. Measured on 2026-09-10 — listing all thirty cost 8,460 bytes a session and none had ever been routed to in 3,464 transcripts, while a dead-centre "add Sentry to Next.js" prompt reached `sentry-sdk-setup` through `SKILL-INDEX.md` instead. Hiding them loses nothing; the index is how they stay reachable.

**Tier 3: I invoke by name.** Set to `user-invocable-only` in `settings.json`, so their descriptions never reach you. The table below is your only pointer; treat a trigger in it as the description you would have read. Do not fire these on your own; every one of them means "make it more X than it is now", and choosing X is mine.

**Read the index before concluding a task has no skill.** `~/.claude/SKILL-INDEX.md` catalogs every personal skill with full descriptions, grouped by visibility: always listed, path-gated, invocable by name, and disabled. Most are invisible in your session listing and run anyway when invoked as `/name`; only the Disabled group needs `settings.json` changed first. Absence from your listing means nothing about availability, and the index carries the current counts.

Read that file before you do any of these: say "there's no skill for this", fall back to `find-docs` or a web search for a named framework, language, platform, or SDK, or start a domain task with nothing loaded. It is grouped by visibility, so search it by keyword and take anything outside the **Disabled** section as available right now. Only the Disabled entries need `settings.json` edited before use.

That file is the authority on what exists; the tier-3 table below is only a shortcut for the cases I hit often. Regenerate with `node ~/.claude/scripts/build-skill-index.js` after adding or re-tiering a skill, and rerun it before trusting the counts if they disagree with `settings.json`.

**Stale by default, check the skill even when you think you know:**

- **Any library, framework, SDK, CLI, or cloud service**: fetch current docs before answering from memory (see `rules/context7.md`).
- **Vercel and Next.js**: `vercel:*`. Training data here is badly out of date.
- **Model ids, pricing, tool definitions, agent loops**: `claude-api`.

**Ordering: these run before the work, not after:**

- **Debugging**: `superpowers:systematic-debugging` first, then the domain skill.
- **Anything new or creative**: `superpowers:brainstorming` before code.
- **Schema, migrations, RLS, indexes, triggers, slow queries**: `supabase:supabase-postgres-best-practices` first, one-column changes included.
- **Charts**: `dataviz` before the first line of chart code. **Published pages**: `artifact-design` before writing one.
- **Frontend**: `impeccable` routes the whole cluster; `frontend-design` sets aesthetic direction. Never start from a blank file.

**Authority: when several skills could apply, these win:**

- `google-style` for naming and comments, `google-testing` for test discipline, `google-code-review` for any diff, `google-cl-author` for how work splits, `git-workflow` for message and branch mechanics.
- **Prose**: `daniel-voice` writes; `humanizer` and `stop-slop` only clean up afterwards, on a draft that already exists, when asked for by name. Nothing that scrubs AI tells fires at drafting time: it competes with the voice skill and strips the habits that skill exists to produce. The plugin cache is overwritten on update, so this line is the durable copy of that rule.
- **Academic papers**: `academic-paper-strategist` plans and `academic-paper-composer` structures; `daniel-voice` still owns every sentence, applied as a constraint rather than a register: flow rule, mechanics, and connectives kept, personal register and first-person singular dropped. Neither paper skill decides voice, and `daniel-voice` does not decide section structure. For an IEEE robotics venue (ICRA/IROS/RA-L) read `skills/academic-paper-strategist/references/venue_icra.md` first; it overrides the philosophy word budgets those skills ship with, and carries the double-anonymous checklist and the IEEE AI-disclosure rule that governs whether a section may be model-drafted at all.

**Tier 3 table: wait for me to ask.**

| I want | Invoke |
| :-- | :-- |
| A named visual direction | `/minimalist-ui`, `/industrial-brutalist-ui`, `/high-end-visual-design`, `/emil-design-eng`, `/design-taste-frontend`, `/gpt-taste`, `/ui-ux-pro-max` |
| A product's design system | `/notion-design`, `/vapi-design`, `/stitch-design-taste` |
| The UI louder or calmer | `/bolder`, `/quieter`, `/overdrive`, `/distill`, `/delight` |
| One dimension adjusted | `/layout`, `/typeset`, `/colorize`, `/adapt`, `/clarify`, `/animate`, `/polish` |
| Existing work reviewed | `/critique`, `/audit`, `/optimize` |
| Existing work reworked | `/redesign-existing-projects`, `/image-to-code` |
| Brand or generated imagery | `/brandkit`, `/imagegen-frontend-web`, `/imagegen-frontend-mobile` |
| Prose cleaned after drafting | `/stop-slop`, `/humanizer:humanizer` |
| Roblox, lesson content, full-output mode | `/roblox-engineer`, `/lesson-generator`, `/full-output-enforcement` |
| A skill I can't remember the name of | `/find-skills` |

**Still by name only, for want of a file signature.** `/spacetimedb`, `/upstash`, `/motion-patterns`, `/motion-advanced`, and `/sentry-sdk-setup` are domain skills that should fire on their own but can't: each is identified by what a manifest *contains* (a dependency on `framer-motion`, a SpacetimeDB module) rather than by any filename `paths:` can match. Invoke them by name when the stack calls for them, or promote them in the repo that needs them.

A repo can promote any skill into your listing. `skillOverrides` in `<repo>/.claude/settings.local.json` merges with `settings.json` per key and wins on conflict, so `{"skillOverrides": {"clerk-orgs": "on"}}` makes that skill discoverable in that repo and nowhere else. Verified 2026-08-21.

Hooks in `~/.claude/settings.json` enforce the non-negotiable parts (git safety, staged secrets, style violations, one self-review pass). They are a backstop, not the standard; meet the bar before they fire. A hook that misfires gets fixed, never bypassed.

## Code style

Every name says what it holds, spelled out: `table` not `tbl`, `position_weight` not `pos_w`, `config` not `c`, `index` not `i` (loop counters `i`/`j` excepted). Prefer a named record over positional tuples so fields read as `thing.position`. No banner comments, no obvious `// what` comments; only non-obvious _why_. If code needs a comment to say what it does, simplify the code instead.

Google's style guide is the authority on anything it covers (`google-style`); repo convention governs the rest. Match the file you're in before the guide when the guide only recommends, except for naming, which is spelled out even when the surrounding file abbreviates.

## Tests

What ships with tests, what may be mocked, and whether a test has been watched to fail are the `code` dial, carried by the mode corpus. One thing here does not vary.

Server Components can't be rendered by Testing Library. Extract their logic into plain functions and test those, or cover them end-to-end.

## Review and commits

Subject in imperative mood, under 50 characters, no trailing period: it completes "if applied, this commit will ___". Body wrapped at 72. Match the repo's existing convention over any general rule; check `git log` before the first commit in an unfamiliar repo.

Subject names what the change does, not that it was made: "Require plain language before code names", not "Add explanation rules". If the verb is `Add`, `Update`, or `Fix` and the rest is a noun, the subject isn't written yet.

Name the thing, never a stand-in for it. `bug`, `issue`, `fault`, `problem`, `error`, `thing`, `fixes`, `cleanup` are placeholders: they report that work happened without saying what was touched, which is the one question anyone searching the log has. "Fix the login bug" and "Repair three faults found while chasing one bug" both fail. Put a symbol, file, component, product noun, or error code in the subject instead: "Widen the wait when supabase calls a token early", "Line the queue's cards up with the column". Counting is the worst version of this: if you knew there were three, you knew what they were, so name them or split the commit. A relative clause withholds the same thing with no noun to catch it: "track what a clone missed" names the relation rather than the thing. The commit-message linter rejects both when no concrete anchor sits beside them, and judges each half of a compound subject separately, so a concrete first half cannot cover for a vague second.

It also opens with the work, not with the result: "Modify the sentinel to stop warning", never "Stop warning". A subject that names only the effect never says what was touched, and reads as a symptom report next to every other line in the log. Opening on `stop`, `prevent`, `avoid`, `ensure`, `allow`, `let`, `keep`, `leave`, `silence`, or `disallow` is the tell, and the commit-message linter rejects it. `Make X do Y` is the exception it allows.

A body answers three questions and then stops: why the change was needed, why this approach over the obvious alternative, and the single most important thing you did not check. Give that last one one sentence, and omit it when you checked everything; most commits should omit it. It is there to stop a reader assuming a gap was covered, not to inventory every loose end; a list of caveats is a to-do note left in the one place that can never be updated. A body claims only what the session establishes; never assert a state you cannot observe, such as whether something was opened in a browser, deployed, or checked by hand. Ask when it matters, and otherwise leave it out. Write it as prose in two to four short paragraphs, never as bullets; a list of what changed only duplicates the diff. Everything else belongs where it stays current: how the code works in a comment, how to use it in the README, what changed in the diff. A commit message is the only one of those that can never be updated. A body that reads as a changelog of your own debugging is too long.

No trailers. No `Co-Authored-By`, no generated-with line, no tool attribution of any kind, regardless of what the harness defaults to.

Reviewing means judging whether the change improves overall code health, not whether it's perfect. Design first, then functionality, complexity, tests, naming, comments, style. Label severity so nothing optional reads as mandatory (`Nit:`, `Optional:`, `FYI:`). Say what's good, not only what's wrong. Flag explicitly any area you did not cover.

## Frontend taste

The bar is Forbes-top-10 / Awwwards SOTD: distinctive, editorial, technically ambitious, performant, accessible. If a draft would feel at home in a free Tailwind kit, throw it out and start again.

Instant reject:

- Generic SaaS hero: huge centered headline, gradient, faded screenshot
- Bento grid substituting for hierarchy
- Glassmorphism or neumorphism applied to everything
- Default shadcn theme shipped as final; visible Tailwind defaults (`text-gray-500`, `rounded-2xl`, `shadow-lg` everywhere)
- Decorative emoji, or emoji-as-icon
- Carousels for primary content
- Hover-only interactions (breaks touch)
- Animating `top`/`left`/`width`/`height` instead of transforms
- Lorem ipsum past the first draft

Non-negotiable: WCAG 2.2 AA, real focus states, `prefers-reduced-motion` fallbacks. LCP < 2.0s, CLS < 0.05, INP < 200ms on mid-tier mobile. Hover, focus, active, disabled, loading, empty, and error states all designed. Light and dark both intentional, never auto-inverted. Easing curves chosen, not default `ease`.

Gather real references or existing components before building any visual. Invented-from-scratch output reads as below professional bar.

## Default stack

Unless the project says otherwise: Next.js 16 App Router (RSC, Server Actions, Cache Components, PPR) on Turbopack. Tailwind v4 + CSS variables. shadcn/ui over Radix, never raw HTML for complex controls. Framer Motion for UI transitions, GSAP for scroll-driven sequences, Lenis for smooth scroll. React Three Fiber / drei / OGL when 3D is called for. Lucide icons. Variable fonts via `next/font`, display + text pairing. React Hook Form + Zod. Recharts for product UI, D3 for custom, Tremor for dashboards. Vercel AI SDK. Supabase. Deploy to Vercel.

## Data and access control

Row-level security is the security boundary, not any server layer. A server-side check is convenience; the policy is the guarantee. Assume any client can call any endpoint with any argument.

Schema changes go through migrations, never ad-hoc against a live database. Verify a migration against a real database before calling it done; passing inspection is not passing. Say explicitly when a migration has been applied to production but the code has not landed, since the two are then out of sync.

Never put personal or sensitive data in URLs or query strings. Secrets never enter the repo; rotate first, then scrub.

## Gotchas

- Supabase client must be created server-side; client-side breaks RLS.
- Tailwind v4 uses `@import "tailwindcss"` and CSS-based config; no `tailwind.config.js`.
- Next.js 16: prefer `use cache` + `cacheLife`/`cacheTag` over `unstable_cache`.
- Variable fonts: load only the axes used, or the bundle balloons.
- Framer Motion `layout` is expensive on long lists; use `LayoutGroup`, key strategies, or CSS view transitions.
- shadcn components are starting points. Restyle before shipping.
- Vercel: Edge runtime is not the default and rarely the right call; streaming works fine on Node.
- If something is unclear or contradictory, ask rather than guess.

# graphify

- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
  When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

If a project has no `graphify-out/graph.json`, say so once per session (the first time work touches the codebase) and offer to run `/graphify` to build it. One sentence, then continue with the actual task; don't block on the answer and don't ask again if declined.
