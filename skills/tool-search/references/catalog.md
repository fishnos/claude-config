# Resource catalog

The curated sources `/tool-search` draws from. Each entry says what the
resource is, when it fits, and the deepest entry point an agent can read
(machine-readable where one exists). Entry points were checked with `curl`
on 2026-09-28; re-check anything you hand back, since sites move.

To add a resource: append an entry under the right heading with the same
five fields, then run `bash scripts/check-links.sh` on its URLs.

## Contents

- UI components: React Bits, Aceternity UI, 21st, Bklit UI, Lucide
- Generative visuals and graphics: vgpu, Book of Shapes, ASCII
- Motion: Motion
- Frameworks and build tools: Next.js, Vite, Vue.js
- Design and prototyping: Figma, v0
- Backend, database and auth: Supabase, Neon, Firebase, MongoDB, Clerk
- Hosting and deploy: Vercel, Railway, Render
- Voice AI: Vapi
- Learning: Kaggle Learn

## UI components

### React Bits

- **URL:** https://reactbits.dev
- **What:** free animated React components: text animations, cursor and scroll animations, UI components (galleries, cards, docks), micro-interactions, and 90+ animated backgrounds.
- **Fits:** hero text effects, animated backgrounds, image galleries, playful micro-interactions.
- **Search:** read https://reactbits.dev/llms.txt for the full list. Component pages are `https://www.reactbits.dev/<category>/<kebab-name>`, categories `text-animations`, `animations`, `components`, `micro`, `backgrounds`. Example: https://www.reactbits.dev/text-animations/split-text
- **Install:** `npx shadcn@latest add @react-bits/<PascalName>-<JS|TS>-<CSS|TW>`, e.g. `@react-bits/SplitText-TS-TW` (registry file `https://reactbits.dev/r/SplitText-TS-TW.json`).

### Aceternity UI

- **URL:** https://ui.aceternity.com
- **What:** 110+ Tailwind + Motion components and 170+ blocks: backgrounds, 3D cards, parallax, navbars, docks, timelines, globes, bento layouts, forms.
- **Fits:** landing-page sections, scroll effects, navigation, timelines, contact forms.
- **Search:** https://ui.aceternity.com/llms.txt, full corpus at https://ui.aceternity.com/llms-full.txt, JSON catalog at https://ui.aceternity.com/api/components. Pages are `https://ui.aceternity.com/components/<name>`.
- **Install:** `npx shadcn@latest add @aceternity/<name>` (namespace is in the official shadcn registry index).

### 21st

- **URL:** https://21st.dev
- **What:** community registry of 12,000+ React + Tailwind components, templates, themes, and icons, hosting many libraries (Magic UI among them).
- **Fits:** anything not covered above; comparing several takes on one pattern (pricing tables, hero sections, sidebars).
- **Search:** append `.md` to pages for an agent-readable version: tag listings at `https://21st.dev/community/components/s/<tag>.md`, components at `https://21st.dev/@<author>/components/<slug>.md`. Index: https://21st.dev/llms.txt. The 21st MCP server (`search`, `get_component`) is set up via https://21st.dev/mcp.md; use it when it is connected.
- **Install:** copy from the component page, or through the 21st MCP.

### Bklit UI

- **URL:** https://bklit.com (docs at https://bklit.com/docs/components)
- **What:** chart and data-visualization components on shadcn/ui: area, bar, line, pie, radar, gauge, heatmap, sankey, funnel, choropleth, candlestick and more.
- **Fits:** stats sections, dashboards, any chart in a shadcn project.
- **Search:** `https://bklit.com/docs/components/<type>-chart`, e.g. https://bklit.com/docs/components/area-chart
- **Install:** `npx shadcn@latest add @bklit/<name>` (registry `https://ui.bklit.com/r/<name>.json`, e.g. `area-chart`).

### Lucide

- **URL:** https://lucide.dev
- **What:** open-source icon set, one React component per icon.
- **Fits:** every site; the default icon set in shadcn/ui.
- **Search:** `https://lucide.dev/icons/?search=<term>`; React guide at https://lucide.dev/guide/react/
- **Install:** `npm install lucide-react`

## Generative visuals and graphics

### vgpu

- **URL:** https://vgpu.sh
- **What:** a small WebGPU library built for agents; runs in browser canvases, headless Node.js, and serverless. Not React-specific.
- **Fits:** GPU shader backgrounds, generative hero art, rendering images server-side.
- **Search:** https://vgpu.sh/llms.txt, docs at https://vgpu.sh/docs, examples at https://vgpu.sh/examples (also `npx vgpu examples`). Has a CLI and an MCP reference under `/docs`.
- **Install:** `pnpm add vgpu`

### Book of Shapes

- **URL:** https://bookofshapes.com
- **What:** curated gallery of generative patterns (truchet tiles, flow fields, arcs, grids) you customize and download.
- **Fits:** section backgrounds, textures, dividers, brand art.
- **Search:** patterns at `https://bookofshapes.com/patterns/<slug>`, e.g. https://bookofshapes.com/patterns/flow_lines. Check https://bookofshapes.com/license before shipping one.
- **Install:** none; download the asset.

### ASCII

- **URL:** https://ascii.krackeddevs.com
- **What:** text-native generative art instrument: animated scenes rendered as characters on a green-terminal look.
- **Fits:** retro or terminal-themed heroes, developer portfolios.
- **Search:** scenes load by hash, e.g. https://ascii.krackeddevs.com/#c=donut. The app is interactive; open it in a browser to pick a scene.
- **Install:** none; export from the instrument.

## Motion

### Motion

- **URL:** https://motion.dev
- **What:** animation library for React, JavaScript and Vue (formerly Framer Motion). Aceternity components depend on it.
- **Fits:** page and element transitions, layout animation, scroll-linked animation, gestures.
- **Search:** https://motion.dev/llms.txt; React docs at https://motion.dev/docs/react
- **Install:** `npm install motion`

## Frameworks and build tools

### Next.js

- **URL:** https://nextjs.org
- **What:** full-stack React framework (App Router, Server Components). The most common choice for React sites.
- **Fits:** any site that uses the React component libraries above, or needs server-side forms and rendering.
- **Search:** https://nextjs.org/docs/llms.txt, docs at https://nextjs.org/docs
- **Install:** `npx create-next-app@latest`

### Vite

- **URL:** https://vite.dev
- **What:** frontend build tool and dev server for single-page apps and libraries.
- **Fits:** a client-only site or app that does not need server rendering.
- **Search:** https://vite.dev/guide/
- **Install:** `npm create vite@latest`

### Vue.js

- **URL:** https://vuejs.org
- **What:** progressive JavaScript framework; the alternative to React. Most components above are React-only, so say so when Vue is chosen.
- **Fits:** only when the user asks for Vue or has an existing Vue codebase.
- **Search:** https://vuejs.org/guide/introduction
- **Install:** `npm create vue@latest`

## Design and prototyping

### Figma

- **URL:** https://www.figma.com
- **What:** collaborative design canvas; community files hold UI kits and wireframes.
- **Fits:** designing before building, handing designs to code. Developer docs at https://www.figma.com/developers
- **Search:** blocks scripted fetches (403); link https://www.figma.com/community and let the user browse.

### v0

- **URL:** https://v0.app
- **What:** Vercel's AI app builder that generates Next.js + shadcn UI from a prompt.
- **Fits:** fast first drafts of a page to borrow structure from.
- **Search:** templates at https://v0.app/templates

## Backend, database and auth

### Supabase

- **URL:** https://supabase.com
- **What:** Postgres with auth, instant APIs, realtime, storage, edge functions, vector search.
- **Fits:** contact-form storage, auth, any data the site keeps; database, auth and storage in one service.
- **Search:** https://supabase.com/llms.txt, docs at https://supabase.com/docs

### Neon

- **URL:** https://neon.com (neon.tech still resolves)
- **What:** serverless, branchable Postgres with auth, functions, storage and an AI gateway.
- **Fits:** Postgres without a full platform; database branches per preview deploy.
- **Search:** https://neon.com/docs

### Firebase

- **URL:** https://firebase.google.com
- **What:** Google's app platform: document database (Firestore), auth, hosting, functions.
- **Fits:** mobile-first or Google-ecosystem projects.
- **Search:** https://firebase.google.com/docs

### MongoDB

- **URL:** https://www.mongodb.com
- **What:** document database, hosted as Atlas.
- **Fits:** schemaless document data; otherwise prefer Postgres (Supabase or Neon).
- **Search:** https://www.mongodb.com/docs/

### Clerk

- **URL:** https://clerk.com
- **What:** drop-in authentication and user management with prebuilt sign-in components.
- **Fits:** sites with accounts, when auth should not live in the database platform.
- **Search:** https://clerk.com/docs

## Hosting and deploy

### Vercel

- **URL:** https://vercel.com
- **What:** hosting for Next.js and frontend apps with preview deploys, functions and storage.
- **Fits:** deploying Next.js and other frontend sites. Starter projects at https://vercel.com/templates
- **Search:** https://vercel.com/docs

### Railway

- **URL:** https://railway.com
- **What:** full-stack cloud for servers, workers and databases.
- **Fits:** long-running backends, websockets, anything that is not serverless.
- **Search:** https://docs.railway.com

### Render

- **URL:** https://render.com
- **What:** cloud for web services, workers, cron jobs and Postgres.
- **Fits:** same niche as Railway.
- **Search:** https://render.com/docs

## Voice AI

### Vapi

- **URL:** https://vapi.ai
- **What:** platform for building and deploying voice AI agents.
- **Fits:** a talk-to-the-site assistant or phone agent.
- **Search:** https://docs.vapi.ai

## Learning

### Kaggle Learn

- **URL:** https://www.kaggle.com/learn
- **What:** free short courses in Python, pandas, data visualization, machine learning.
- **Fits:** only when the task involves learning data skills; rarely a site-building answer.
