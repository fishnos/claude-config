# Global Instructions

## Communication Style

At the start of every session, invoke the `caveman:caveman` skill (full mode) using the Skill tool before responding to anything. Never respond without it active.

---

## Frontend Mission Brief

When building, redesigning, polishing, or auditing any UI (web or mobile), the standard is **Forbes-top-10 / Awwwards SOTD tier** — distinctive, editorial, technically ambitious, performant, accessible. Generic AI aesthetic (vague gradients, plain bento, rounded-2xl-everywhere, lorem-ipsum hero) is unacceptable output. If a draft would feel at home in a free Tailwind kit, throw it out and start again.

Treat every frontend task as an **orchestra of skills, not single-shot tool calls.** A page is the result of a deliberate pipeline running several skills in order. Reaching for one skill in isolation is the failure mode — you must consider all relevant skills, MCPs, and plugin tools at every phase and select the right combination.

---

## The Frontend Pipeline (mandatory order)

Run these phases for any non-trivial UI work. Skip a phase only with explicit justification.

### 1. Discover & Shape

Establish intent, audience, constraints, and aesthetic direction before any code.

- `superpowers:brainstorming` — surface real requirements, kill assumptions
- `shape` — structured UX/UI discovery interview, produces a brief
- `ui-ux-pro-max` — pick a style family (67), palette (96), font pairing (57), tech stack defaults
- `emil-design-eng` — invoke for taste/philosophy on what makes software feel great

Output of this phase: a written design brief + chosen style + palette + type system. Do not skip to code.

### 2. Architect

- `frontend-design:frontend-design` — distinctive component/page generation that avoids generic AI patterns
- `vercel:nextjs` / `vercel:next-cache-components` / `vercel:routing-middleware` — App Router, PPR, cacheLife/cacheTag, middleware patterns
- `vercel:shadcn` — shadcn/ui composition, custom registries, theming
- `superpowers:writing-plans` — for any multi-file change, write the plan first

### 3. Build

- `mcp__magic__21st_magic_component_builder` — high-quality component scaffolds from natural language
- `mcp__magic__21st_magic_component_inspiration` — pull reference components when stuck on direction
- `mcp__magic__logo_search` — real brand assets, never fake logos
- `mcp__stitch__*` — design system + screen generation when starting from zero
- `vercel:ai-sdk` — AI features (streaming chat, structured output, tool calling)
- `supabase:supabase` — auth, data, realtime, storage, RLS

### 4. Refine (run iteratively, not once)

Pick the right skill for the symptom — never blanket-apply.

| Symptom                                | Skill       |
| -------------------------------------- | ----------- |
| Bland, generic, too safe               | `bolder`    |
| Loud, overstimulating, garish          | `quieter`   |
| Cluttered, busy, low signal            | `distill`   |
| Monochromatic, flat                    | `colorize`  |
| Weak rhythm, crowded, misaligned       | `layout`    |
| Type feels off, weak hierarchy         | `typeset`   |
| Confusing copy, bad errors             | `clarify`   |
| Static, lifeless                       | `animate`   |
| Wants to wow / shaders / scroll-driven | `overdrive` |
| Functional but joyless                 | `delight`   |
| Doesn't fit other screens              | `adapt`     |
| Slow, janky, heavy bundle              | `optimize`  |
| Prose has AI tells                     | `stop-slop` |

### 5. Audit & Polish (mandatory before "done")

- `audit` — a11y / perf / responsive / anti-patterns scored report
- `critique` — UX scoring, persona testing, anti-pattern detection
- `polish` — final micro-detail pass on alignment, spacing, consistency
- `vercel:react-best-practices` — TSX hygiene
- `vercel:verification` — full-story end-to-end check (browser → API → data → response)

### 6. Ship

- `superpowers:verification-before-completion` — never claim done without evidence
- `vercel:deployments-cicd` / `vercel:deploy` — preview / production
- `vercel:env-vars` — env hygiene

The umbrella skill `impeccable` orchestrates many of these and is appropriate when the user says "design", "redesign", "polish", "improve", or anything ambiguous about UI quality.

---

## Default Stack (use unless project says otherwise)

- **Framework:** Next.js 16 App Router (RSC, Server Actions, Cache Components, PPR)
- **Bundler:** Turbopack
- **Styling:** Tailwind CSS v4 + CSS variables for theming
- **Components:** shadcn/ui composed with Radix primitives — never raw HTML for complex controls
- **Motion:** Framer Motion / Motion One for UI transitions; GSAP for scroll-driven cinematic sequences; Lenis for smooth scroll
- **3D / canvas (when called for):** React Three Fiber, drei, OGL for shaders
- **Icons:** Lucide as default; Phosphor for variety; never emoji-as-icon
- **Type:** Variable fonts via `next/font`; pair display + text (refer `ui-ux-pro-max`)
- **Forms:** React Hook Form + Zod
- **Data viz:** Recharts for product UI, D3 for custom; Tremor for dashboards
- **AI:** Vercel AI SDK; AI Gateway when multi-provider
- **Backend:** Supabase (Postgres + Auth + Realtime + Storage)
- **Deploy:** Vercel; Edge runtime where latency-sensitive

---

## Quality Bar (non-negotiable)

- **Performance:** LCP < 2.0s, CLS < 0.05, INP < 200ms on mid-tier mobile. Image optimization via `next/image`. Self-host fonts. Code-split aggressively.
- **Accessibility:** WCAG 2.2 AA minimum. Real focus states, semantic landmarks, ARIA only when semantics aren't enough, motion-reduced fallbacks, color contrast verified.
- **Responsive:** Fluid type, container queries where relevant, touch targets ≥44px, no fixed-px breakpoints chained without a fluid spine.
- **Motion:** Every interaction has feedback. Easing curves intentional (not linear, not default `ease`). Respect `prefers-reduced-motion`. Never animate properties that trigger layout.
- **Detail:** Hover, focus, active, disabled, loading, empty, error states all designed — not skipped.
- **Copy:** No lorem ipsum past first draft. Microcopy reviewed via `clarify` and `stop-slop`.
- **Theming:** Light + dark from day one, both visually intentional, not auto-inverted.

---

## Anti-Patterns (instant reject)

- Generic SaaS hero: huge centered headline + gradient + faded screenshot
- Bento grid used as a substitute for hierarchy
- "Glassmorphism on everything" or "neumorphism on everything"
- Default shadcn theme shipped as final
- Tailwind defaults visible in production (`text-gray-500`, `rounded-2xl`, `shadow-lg` everywhere)
- Emoji used decoratively unless the user asks
- Carousels for primary content
- Hover-only interactions (breaks touch)
- Animating `top`/`left`/`width`/`height` instead of transforms
- Lighthouse score below 90 on any audited category in the final pass

---

## Workflow Rules

- **Plan before edit** for any change touching >1 file. Use `superpowers:writing-plans` for multi-step work.
- **Brainstorm before build** — `superpowers:brainstorming` is mandatory before creative work.
- **Discover before design** — `shape` produces the brief; do not invent direction.
- **Read before write** — open the existing file before editing; match conventions.
- **Never commit** unless explicitly asked. Never push. Never `--no-verify`.
- **No new dependencies** without approval. Justify when adding.
- **Verify before claiming done** — `superpowers:verification-before-completion`. Run lint, typecheck, build, and visually test in browser for UI work.
- **Test in browser** — for any UI change, start the dev server and use the feature. Type-check passes ≠ feature works.
- **No decorative comments** — no banner comments, no obvious `// what` comments. Only non-obvious _why_.
- **Clear variable names** — every name must say what it holds, spelled out. Never abbreviate to save keystrokes: write `table` not `tbl`, `quaternion` not `q`, `position_weight` not `pos_w`, `entry`/`config` not `e`, `index` not `i` (loop counters `i`/`j` are the only accepted exception). Prefer a named record (dataclass/NamedTuple) over positional tuples so fields are `thing.position` not `thing[2]`. A reader should never have to guess what a name means.

---

## Reference Skills Quick Index

**Always-on for UI work:** `impeccable`, `ui-ux-pro-max`, `emil-design-eng`, `frontend-design:frontend-design`
**Discovery:** `shape`, `superpowers:brainstorming`
**Building blocks:** `mcp__magic__*`, `mcp__stitch__*`, `vercel:shadcn`
**Refinement (pick by symptom):** `bolder` `quieter` `distill` `colorize` `layout` `typeset` `clarify` `animate` `overdrive` `delight` `adapt` `optimize`
**Audit:** `audit`, `critique`, `polish`, `vercel:react-best-practices`, `vercel:verification`
**Stack:** `vercel:nextjs`, `vercel:next-cache-components`, `vercel:shadcn`, `vercel:ai-sdk`, `vercel:routing-middleware`, `vercel:turbopack`, `supabase:supabase`
**Process:** `superpowers:writing-plans`, `superpowers:verification-before-completion`, `superpowers:test-driven-development`

When unsure which skill applies — default to `impeccable` for UI quality questions, `shape` for new feature direction, `audit` for "is this good?" questions.

---

## Gotchas

- Supabase client must be created server-side; client-side breaks RLS.
- Tailwind v4 uses `@import "tailwindcss"` and CSS-based config — no `tailwind.config.js` required.
- Next.js 16 cache components: prefer `use cache` + `cacheLife`/`cacheTag` over `unstable_cache`.
- Variable fonts: load only the axes you use; full font with all axes balloons bundle.
- Framer Motion `layout` prop is expensive on long lists — use `LayoutGroup` and key strategies, or switch to CSS view transitions.
- shadcn components are starting points, not final UI — restyle, don't ship raw.
- If something does not make sense or is unclear, please clarify with a question so that you don't implement without knowing exactly what I am asking for.
