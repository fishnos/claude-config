# Skill index

Generated. Do not edit by hand. Rerun `node ~/.claude/scripts/build-skill-index.js`,
or start a session and the SessionStart hook rebuilds it when it goes stale.

Every skill on this machine and whether Claude can see it: 209 in all,
81 of them from enabled plugins, named the way they are invoked
(`plugin:skill`). 74 of these
are invisible in the session listing but run right now when invoked by name. Only the
**Disabled** section needs settings.json changed before use.

Read this before concluding that no skill covers a task, and before falling back to
web search or find-docs for a named framework, language, platform, or SDK.

## Invocable by name only (74)

Hidden from the session listing by `user-invocable-only`. Invoke with `/name`.

### `/adapt`

Adapt designs to work across different screen sizes, devices, contexts, or platforms. Implements breakpoints, fluid layouts, and touch targets. Use when the user mentions responsive design, mobile layouts, breakpoints, viewport adaptation, or cross-device compatibility.

### `/animate`

Review a feature and enhance it with purposeful animations, micro-interactions, and motion effects that improve usability and delight. Use when the user mentions adding animation, transitions, micro-interactions, motion design, hover effects, or making the UI feel more alive.

### `/audit`

Run technical quality checks across accessibility, performance, theming, responsive design, and anti-patterns. Generates a scored report with P0-P3 severity ratings and actionable plan. Use when the user wants an accessibility check, performance audit, or technical quality review.

### `/bolder`

Amplify safe or boring designs to make them more visually interesting and stimulating. Increases impact while maintaining usability. Use when the user says the design looks bland, generic, too safe, lacks personality, or wants more visual impact and character.

### `/brandkit`

Premium brand-kit image generation skill for creating high-end brand-guidelines boards, logo systems, identity decks, and visual-world presentations. Trained for minimalist, cinematic, editorial, dark-tech, luxury, cultural, security, gaming, developer-tool, and consumer-app brand systems. Optimized for intentional logo concepting, refined composition, sparse typography, strong symbolic meaning, premium mockups, art-directed imagery, and flexible grid layouts.

### `/clarify`

Improve unclear UX copy, error messages, microcopy, labels, and instructions to make interfaces easier to understand. Use when the user mentions confusing text, unclear labels, bad error messages, hard-to-follow instructions, or wanting better UX writing.

### `/colorize`

Add strategic color to features that are too monochromatic or lack visual interest, making interfaces more engaging and expressive. Use when the user mentions the design looking gray, dull, lacking warmth, needing more color, or wanting a more vibrant or expressive palette.

### `/critique`

Evaluate design from a UX perspective, assessing visual hierarchy, information architecture, emotional resonance, cognitive load, and overall quality with quantitative scoring, persona-based testing, automated anti-pattern detection, and actionable feedback. Use when the user asks to review, critique, evaluate, or give feedback on a design or component.

### `/delight`

Add moments of joy, personality, and unexpected touches that make interfaces memorable and enjoyable to use. Elevates functional to delightful. Use when the user asks to add polish, personality, animations, micro-interactions, delight, or make an interface feel fun or memorable.

### `/design-taste-frontend`

Senior UI/UX Engineer. Architect digital interfaces overriding default LLM biases. Enforces metric-based rules, strict component architecture, CSS hardware acceleration, and balanced design engineering.

### `/distill`

Strip designs to their essence by removing unnecessary complexity. Great design is simple, powerful, and clean. Use when the user asks to simplify, declutter, reduce noise, remove elements, or make a UI cleaner and more focused.

### `/emil-design-eng`

This skill encodes Emil Kowalski's philosophy on UI polish, component design, animation decisions, and the invisible details that make software feel great.

### `/find-skills`

Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill.

### `/full-output-enforcement`

Overrides default LLM truncation behavior. Enforces complete code generation, bans placeholder patterns, and handles token-limit splits cleanly. Apply to any task requiring exhaustive, unabridged output.

### `/gpt-taste`

Elite UX/UI & Advanced GSAP Motion Engineer. Enforces Python-driven true randomization for layout variance, strict AIDA page structure, wide editorial typography (bans 6-line wraps), gapless bento grids, strict GSAP ScrollTriggers (pinning, stacking, scrubbing), inline micro-images, and massive section spacing.

### `/graphify`

Use for any question about a codebase, its architecture, file relationships, or project content — especially when graphify-out/ exists, where the question should be treated as a graphify query first. Turns any input (code, docs, papers, images, videos) into a persistent knowledge graph with god nodes, community detection, and query/path/explain tools.

### `/high-end-visual-design`

Teaches the AI to design like a high-end agency. Defines the exact fonts, spacing, shadows, card structures, and animations that make a website feel expensive. Blocks all the common defaults that make AI designs look cheap or generic.

### `/image-to-code`

Elite website image-to-code skill for Codex. For visually important web tasks, it must first generate the design image(s) itself, deeply analyze them, then implement the website to match them as closely as possible. In Codex, it must prefer large, readable, section-specific images instead of tiny compressed boards, generate fresh standalone images for sections or detail views instead of cropping old ones, avoid lazy under-generation, avoid cards-inside-cards-inside-cards UI, and keep the hero clean, spacious, readable, and visible on a small laptop.

### `/imagegen-frontend-mobile`

Elite mobile app image-generation skill for creating premium, app-native screen concepts and flows. Designed for iOS, Android, and cross-platform mobile products. Prioritizes clean hierarchy, comfortably readable text, strong multi-screen consistency, controlled color palettes, non-generic creative direction, textured surfaces, image-led composition, tasteful custom iconography, and clean phone mockup framing. By default, screens should be shown inside a subtle premium iPhone or similar phone mockup with a visible frame, while the main focus stays on the app content itself. This skill generates images only. It does not write code.

### `/imagegen-frontend-web`

Elite frontend image-direction skill for generating premium, conversion-aware website design references. CRITICAL OUTPUT RULE — generate ONE separate horizontal image FOR EVERY section. A landing page with 8 sections produces 8 images. Never compress multiple sections into one image. Enforces composition variety (not always left-text / right-image), background-image freedom, varied CTAs, varied hero scales (giant / mid / mini minimalist), narrative concept spine, second-read moments, and a single consistent palette across all images. Optimized for landing pages, marketing sites, and product comps that developers or coding models can accurately recreate.

### `/industrial-brutalist-ui`

Raw mechanical interfaces fusing Swiss typographic print with military terminal aesthetics. Rigid grids, extreme type scale contrast, utilitarian color, analog degradation effects. For data-heavy dashboards, portfolios, or editorial sites that need to feel like declassified blueprints.

### `/layout`

Improve layout, spacing, and visual rhythm. Fixes monotonous grids, inconsistent spacing, and weak visual hierarchy. Use when the user mentions layout feeling off, spacing issues, visual hierarchy, crowded UI, alignment problems, or wanting better composition.

### `/lesson-generator`

Generate lesson content following 4-Layer Teaching Framework with standardized metadata and Docusaurus conventions

### `/minimalist-ui`

Clean editorial-style interfaces. Warm monochrome palette, typographic contrast, flat bento grids, muted pastels. No gradients, no heavy shadows.

### `/motion-advanced`

Advanced motion patterns for React / Next.js — drag & drop, gestures, text animations, SVG path drawing, custom hooks, imperative sequences (useAnimate), loaders, and the full API decision tree. Requires motion-foundations.

### `/motion-patterns`

Production-ready animation patterns for React / Next.js — button, modal, toast, stagger, page transitions, exit animations, scroll, and layout — built on motion-foundations tokens and springs.

### `/notion-design`

Design system skill for notion. Activate when building UI components, pages, or any visual elements. Provides exact color tokens, typography scale, spacing grid, component patterns, and craft rules. Read references/DESIGN.md before writing any CSS or JSX.

### `/optimize`

Diagnoses and fixes UI performance across loading speed, rendering, animations, images, and bundle size. Use when the user mentions slow, laggy, janky, performance, bundle size, load time, or wants a faster, smoother experience.

### `/overdrive`

Pushes interfaces past conventional limits with technically ambitious implementations — shaders, spring physics, scroll-driven reveals, 60fps animations. Use when the user wants to wow, impress, go all-out, or make something that feels extraordinary.

### `/polish`

Performs a final quality pass fixing alignment, spacing, consistency, and micro-detail issues before shipping. Use when the user mentions polish, finishing touches, pre-launch review, something looks off, or wants to go from good to great.

### `/quieter`

Tones down visually aggressive or overstimulating designs, reducing intensity while preserving quality. Use when the user mentions too bold, too loud, overwhelming, aggressive, garish, or wants a calmer, more refined aesthetic.

### `/redesign-existing-projects`

Upgrades existing websites and apps to premium quality. Audits current design, identifies generic AI patterns, and applies high-end design standards without breaking functionality. Works with any CSS framework or vanilla CSS.

### `/repo-schedule`

Declare a repository's scheduled cloud agents (Claude Code routines) as committed files under .claude/routines/, then reconcile them against the account so the repo is the source of truth. Use when asked what should run on a schedule for a repo, to add or change a recurring or GitHub-triggered agent for a project, to check whether a repo's declared routines are actually live, or when /repo-setup reports the routines check. For a personal one-off reminder unattached to a repository, use /schedule instead.

### `/repo-setup`

Audit and fix a repository's agent infrastructure — CLAUDE.md presence and whether git actually tracks it, the .claude/state.md working record and its ignore line, the graphify knowledge graph and its freshness, an origin remote for cloud routines, declared routines and their .mcp.json, and skills the stack needs that nothing can route to automatically. Use when the SessionStart notice says "Repo setup:", when someone asks whether a repo is set up for agents, when onboarding an unfamiliar repo, or when asked to snooze or dismiss one of those notices, or to set a repo up for early clears (the context action). Not for writing CLAUDE.md content itself — that is /init — and not for scheduling, which is /repo-schedule.

### `/roblox-engineer`

[production-grade internal] Builds Roblox experiences — Luau scripting, Roblox Studio tooling, experience design, DataStore persistence, avatar systems, monetization, and moderation. Routed via the production-grade orchestrator (Game Build mode).

### `/sentry-android-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for Android. Use when asked to "add Sentry to Android", "install sentry-android", "setup Sentry in Android", or configure error monitoring, tracing, profiling, session replay, or logging for Android applications. Supports Kotlin and Java codebases.

### `/sentry-browser-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for browser JavaScript. Use when asked to "add Sentry to a website", "install @sentry/browser", or configure error monitoring, tracing, session replay, or logging for vanilla JavaScript, jQuery, static sites, or WordPress.

### `/sentry-cloudflare-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for Cloudflare Workers and Pages. Use when asked to "add Sentry to Cloudflare Workers", "install @sentry/cloudflare", or configure error monitoring, tracing, logging, crons, or AI monitoring for Cloudflare Workers, Pages, Durable Objects, Queues, Workflows, or Hono on Cloudflare.

### `/sentry-cocoa-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for Apple platforms (iOS, macOS, tvOS, watchOS, visionOS). Use when asked to "add Sentry to iOS", "add Sentry to Swift", "install sentry-cocoa", or configure error monitoring, tracing, profiling, session replay, logging, or metrics for Apple applications. Supports SwiftUI and UIKit.

### `/sentry-code-review`
Child of `/sentry-workflow`.

Analyze and resolve Sentry comments on GitHub Pull Requests. Use this when asked to review or fix issues identified by Sentry in PR comments. Can review specific PRs by number or automatically find recent PRs with Sentry feedback.

### `/sentry-create-alert`
Child of `/sentry-feature-setup`.

Create Sentry alerts using the workflow engine API. Use when asked to create alerts, set up notifications, configure issue priority alerts, or build workflow automations. Supports email, Slack, PagerDuty, Discord, and other notification actions.

### `/sentry-dotnet-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for .NET. Use when asked to "add Sentry to .NET", "install Sentry for C#", or configure error monitoring, tracing, profiling, logging, or crons for ASP.NET Core, MAUI, WPF, WinForms, Blazor, Azure Functions, or any other .NET application.

### `/sentry-elixir-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for Elixir. Use when asked to "add Sentry to Elixir", "install sentry for Elixir", or configure error monitoring, tracing, logging, or crons for Elixir, Phoenix, or Plug applications. Supports Phoenix, Plug, LiveView, Oban, and Quantum.

### `/sentry-fix-issues`
Child of `/sentry-workflow`.

Find and fix issues from Sentry using MCP. Use when asked to fix Sentry errors, debug production issues, investigate exceptions, or resolve bugs reported in Sentry. Methodically analyzes stack traces, breadcrumbs, traces, and context to identify root causes.

### `/sentry-flutter-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for Flutter and Dart. Use when asked to "add Sentry to Flutter", "install sentry_flutter", "setup Sentry in Dart", or configure error monitoring, tracing, profiling, session replay, or logging for Flutter applications. Supports Android, iOS, macOS, Linux, Windows, and Web.

### `/sentry-go-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for Go. Use when asked to "add Sentry to Go", "install sentry-go", "setup Sentry in Go", or configure error monitoring, tracing, logging, metrics, or crons for Go applications. Supports net/http, Gin, Echo, Fiber, FastHTTP, Iris, Negroni, and gRPC.

### `/sentry-instrumentation-guide`
Child of `/sentry-feature-setup`.

Decide which Sentry signal to reach for when instrumenting code — error, span, span attribute, log, or metric. Use when adding instrumentation and unsure whether something should be a log vs a span vs a metric, when deciding "what to instrument where", when reviewing instrumentation for gaps, or when a coding agent needs a rule for choosing between errors, traces, logs, and metrics. This skill decides WHAT to emit; the sentry-*-sdk skills handle HOW to set each pillar up.

### `/sentry-nestjs-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for NestJS. Use when asked to "add Sentry to NestJS", "install @sentry/nestjs", "setup Sentry in NestJS", or configure error monitoring, tracing, profiling, logging, metrics, crons, or AI monitoring for NestJS applications. Supports Express and Fastify adapters, GraphQL, microservices, WebSockets, and background jobs.

### `/sentry-nextjs-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for Next.js. Use when asked to "add Sentry to Next.js", "install @sentry/nextjs", or configure error monitoring, tracing, session replay, logging, profiling, AI monitoring, or crons for Next.js applications. Supports Next.js 13+ with App Router and Pages Router.

### `/sentry-node-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for Node.js, Bun, and Deno. Use when asked to "add Sentry to Node.js", "add Sentry to Bun", "add Sentry to Deno", "install @sentry/node", "@sentry/bun", or "@sentry/deno", or configure error monitoring, tracing, logging, profiling, metrics, crons, or AI monitoring for server-side JavaScript/TypeScript runtimes.

### `/sentry-otel-exporter-setup`
Child of `/sentry-feature-setup`.

Configure the OpenTelemetry Collector with Sentry Exporter for multi-project routing and automatic project creation. Use when setting up OTel with Sentry, configuring collector pipelines for traces and logs, or routing telemetry from multiple services to Sentry projects.

### `/sentry-php-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for PHP. Use when asked to "add Sentry to PHP", "install sentry/sentry", "setup Sentry in PHP", or configure error monitoring, tracing, profiling, logging, metrics, or crons for PHP applications. Supports plain PHP, Laravel, and Symfony.

### `/sentry-pr-code-review`
Child of `/sentry-workflow`.

Review a project's PRs to check for issues detected in code review by Seer Bug Prediction. Use when asked to review or fix issues identified by Sentry in PR comments, or to find recent PRs with Sentry feedback.

### `/sentry-python-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for Python. Use when asked to "add Sentry to Python", "install sentry-sdk", "setup Sentry in Python", or configure error monitoring, tracing, profiling, logging, metrics, crons, or AI monitoring for Python applications. Supports Django, Flask, FastAPI, Celery, Starlette, AIOHTTP, Tornado, and more.

### `/sentry-react-native-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for React Native and Expo. Use when asked to "add Sentry to React Native", "install @sentry/react-native", "setup Sentry in Expo", or configure error monitoring, tracing, profiling, session replay, or logging for React Native applications. Supports Expo managed, Expo bare, and vanilla React Native.

### `/sentry-react-router-framework-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for React Router Framework mode. Use when asked to "add Sentry to React Router Framework", "install @sentry/react-router", or configure error monitoring, tracing, profiling, session replay, logs, or user feedback for a React Router v7 framework app.

### `/sentry-react-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for React. Use when asked to "add Sentry to React", "install @sentry/react", or configure error monitoring, tracing, session replay, profiling, or logging for React applications. Supports React 16+, React Router v5-v7 non-framework mode, TanStack Router, Redux, Vite, and webpack.

### `/sentry-ruby-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for Ruby. Use when asked to add Sentry to Ruby, install sentry-ruby, setup Sentry in Rails/Sinatra/Rack, or configure error monitoring, tracing, logging, metrics, profiling, or crons for Ruby applications. Also handles migration from AppSignal, Honeybadger, Bugsnag, Rollbar, or Airbrake. Supports Rails, Sinatra, Rack, Sidekiq, and Resque.

### `/sentry-sdk-setup`

Set up Sentry in any language or framework. Detects the user's platform and loads the right SDK skill. Use when asked to add Sentry, install an SDK, or set up error monitoring in a project.

### `/sentry-sdk-skill-creator`

Create a complete Sentry SDK skill bundle for any platform. Use when asked to "create an SDK skill", "add a new platform skill", "write a Sentry skill for X", or build a new sentry-<platform>-sdk skill bundle with wizard flow and feature reference files.

### `/sentry-sdk-upgrade`
Child of `/sentry-workflow`.

Upgrade the Sentry JavaScript SDK across major versions. Use when asked to upgrade Sentry, migrate to a newer version, fix deprecated Sentry APIs, or resolve breaking changes after a Sentry version bump.

### `/sentry-setup-ai-monitoring`
Child of `/sentry-feature-setup`.

Setup Sentry AI Agent Monitoring in any project. Use when asked to monitor LLM calls, track AI agents, track conversations, or instrument OpenAI/Anthropic/Vercel AI/LangChain/Google GenAI/Pydantic AI. Detects installed AI SDKs and configures appropriate integrations.

### `/sentry-span-streaming-js`
Child of `/sentry-feature-setup`.

Migrate JavaScript SDK to Sentry span streaming (span-first trace lifecycle). Use when asked to "enable span streaming", "migrate to span streaming", "use traceLifecycle stream", "add spanStreamingIntegration", or switch from transaction-based to streamed span delivery in a JavaScript project.

### `/sentry-span-streaming-python`
Child of `/sentry-feature-setup`.

Migrate Python SDK to Sentry span streaming (span-first trace lifecycle). Use when asked to "enable span streaming", "migrate to span streaming", "use trace_lifecycle stream", or switch from transaction-based to streamed span delivery in a Python project.

### `/sentry-svelte-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for Svelte and SvelteKit. Use when asked to "add Sentry to Svelte", "add Sentry to SvelteKit", "install @sentry/sveltekit", or configure error monitoring, tracing, session replay, or logging for Svelte or SvelteKit applications.

### `/sentry-tanstack-start-sdk`
Child of `/sentry-sdk-setup`.

Full Sentry SDK setup for TanStack Start React. Use when asked to "add Sentry to TanStack Start", "install @sentry/tanstackstart-react", or configure error monitoring, tracing, session replay, logs, or user feedback in a TanStack Start React app.

### `/shape`

Plan the UX and UI for a feature before writing code. Runs a structured discovery interview, then produces a design brief that guides implementation. Use during the planning phase to establish design direction, constraints, and strategy before any code is written.

### `/spacetimedb`

Use this skill first for any SpacetimeDB task; it routes to focused skills for modules, tables, reducers, procedures, views, clients, subscriptions, CLI commands, auth, RLS, HTTP APIs, SQL, deployment, serialization, tutorials, quickstarts, and upgrades. Triggers on: spacetime, spacetimedb, SpacetimeDB, stdb, module, reducer, table, procedure, view, subscription, DbConnection, spacetime generate, spacetime publish, spacetime sql, BSATN, SATS, row-level security, RLS, Maincloud, standalone, Unity, Unreal.

### `/stitch-design-taste`

Semantic Design System Skill for Google Stitch. Generates agent-friendly DESIGN.md files that enforce premium, anti-generic UI standards — strict typography, calibrated color, asymmetric layouts, perpetual micro-motion, and hardware-accelerated performance.

### `/stop-slop`

Remove AI writing patterns from prose. Use when drafting, editing, or reviewing text to eliminate predictable AI tells.

### `/typeset`

Improves typography by fixing font choices, hierarchy, sizing, weight, and readability so text feels intentional. Use when the user mentions fonts, type, readability, text hierarchy, sizing looks off, or wants more polished, intentional typography.

### `/ui-ux-pro-max`

UI/UX design intelligence. 67 styles, 96 palettes, 57 font pairings, 25 charts, 13 stacks (React, Next.js, Vue, Svelte, SwiftUI, React Native, Flutter, Tailwind, shadcn/ui). Actions: plan, build, create, design, implement, review, fix, improve, optimize, enhance, refactor, check UI/UX code. Projects: website, landing page, dashboard, admin panel, e-commerce, SaaS, portfolio, blog, mobile app, .html, .tsx, .vue, .svelte. Elements: button, modal, navbar, sidebar, card, table, form, chart. Styles: glassmorphism, claymorphism, minimalism, brutalism, neumorphism, bento grid, dark mode, responsive, skeuomorphism, flat design. Topics: color palette, accessibility, animation, layout, typography, font pairing, spacing, hover, shadow, gradient. Integrations: shadcn/ui MCP for component search and examples.

### `/upstash`

Work with any Upstash TypeScript/JavaScript SDK including Redis, Box, QStash, Workflow, Vector, Search and Ratelimit. Use when the user is working with any Upstash product or SDK.

### `/vapi-design`

Design system skill for vapi. Activate when building UI components, pages, or any visual elements. Provides exact color tokens, typography scale, spacing grid, component patterns, and craft rules. Read references/DESIGN.md before writing any CSS or JSX.

## Hidden children (0)

Their authors set `disable-model-invocation: true`, usually because a router skill picks between them. Never listed, but `/name` works.

_none_

## Path-gated (23)

Enter the listing on their own once a matching file is read or edited. Nothing to do.

### `/clerk-backend-api`
Activates on: `**/*clerk*,**/*Clerk*,**/sign-in/**,**/sign-up/**,**/middleware.ts,**/middleware.js`

Clerk Backend REST API explorer and executor. Browse tags, inspect endpoint schemas, and execute authenticated requests. Use when listing users, managing organizations, or calling any Clerk API endpoint.

### `/clerk-cli`
Activates on: `**/*clerk*,**/*Clerk*,**/sign-in/**,**/sign-up/**,**/middleware.ts,**/middleware.js`

Operate the Clerk CLI (`clerk` binary) for authentication, user/org/session management, impersonation, local webhook testing, deploy verification, instance config, env keys, feature toggles, and any Clerk Backend, Platform, or Frontend API call. Use when the user mentions Clerk management tasks, "list clerk users", "impersonate a user", "test webhooks locally", "enable orgs", "enable billing", "clerk env pull", "clerk doctor", "clerk deploy", "clerk api", or any ad-hoc Clerk API request. Prefer the CLI over raw HTTP: it handles auth, key resolution, app/instance targeting, and formatting automatically.

### `/clerk-custom-ui`
Activates on: `**/*clerk*,**/*Clerk*,**/sign-in/**,**/sign-up/**,**/middleware.ts,**/middleware.js`

Custom authentication flows and component appearance - hooks (useSignIn, useSignUp), themes, colors, fonts, CSS. Use for custom sign-in/sign-up flows, appearance styling, visual customization, branding.

### `/clerk-nextjs-patterns`
Activates on: `**/*clerk*,**/*Clerk*,**/sign-in/**,**/sign-up/**,**/middleware.ts,**/middleware.js`

Advanced Next.js patterns - middleware, Server Actions, caching with Clerk.

### `/clerk-orgs`
Activates on: `**/*clerk*,**/*Clerk*,**/sign-in/**,**/sign-up/**,**/middleware.ts,**/middleware.js`

Clerk Organizations for B2B SaaS - create multi-tenant apps with org switching, role-based access, verified domains, and enterprise SSO. Use for team workspaces, RBAC, org-based routing, member management.

### `/clerk-setup`
Activates on: `**/*clerk*,**/*Clerk*,**/sign-in/**,**/sign-up/**,**/middleware.ts,**/middleware.js`

Add Clerk authentication to any project by following the official quickstart guides.

### `/clerk-testing`
Activates on: `**/*clerk*,**/*Clerk*,**/sign-in/**,**/sign-up/**,**/middleware.ts,**/middleware.js`

E2E testing for Clerk apps. Use with Playwright or Cypress for auth flow tests.

### `/clerk-webhooks`
Activates on: `**/*clerk*,**/*Clerk*,**/sign-in/**,**/sign-up/**,**/middleware.ts,**/middleware.js`

Clerk webhooks for real-time events and data syncing. Verify with verifyWebhook from the framework-specific package. Handle user, session, organization, billing, and payment events. Build event-driven features like database sync, notifications, and integrations.

### `/contrast-master`
Activates on: `**/*.css,**/*.scss,**/*.tsx,**/*.jsx,**/*.vue,**/*.svelte`

Color contrast and visual accessibility specialist. Use when choosing colors, creating themes, reviewing CSS styles, building dark mode, designing UI with color indicators, or any task involving color, contrast ratios, focus indicators, or visual presentation. Ensures WCAG AA compliance for all color and visual decisions. Applies to any web framework or vanilla HTML/CSS/JS.

### `/gazebo-world-builder`
Activates on: `**/*.sdf,**/*.world`

Design simulation worlds using SDF with ground planes, models, physics configuration, and lighting

### `/matplotlib`
Activates on: `**/*.py,**/*.ipynb`

Foundational plotting library. Create line plots, scatter, bar, histograms, heatmaps, 3D, subplots, export PNG/PDF/SVG, for scientific visualization and publication figures.

### `/robotics-development`
Activates on: `**/*.urdf,**/*.xacro,**/*.sdf,**/*.world,**/package.xml,**/launch/**,**/*.msg,**/*.srv,**/*.action`

Use when developing robotics software, writing robot control logic, testing robot behavior, or working with ROS2, embedded microcontrollers, or Python simulation environments.

### `/ros2-custom-interfaces`
Activates on: `**/*.urdf,**/*.xacro,**/*.sdf,**/*.world,**/package.xml,**/launch/**,**/*.msg,**/*.srv,**/*.action`

Generate ROS 2 custom message (.msg) and service (.srv) interface definitions for educational content. This skill should be used when creating lessons that teach interface design, writing exercises involving custom data types, or generating worked examples for robotics communication protocols.

### `/ros2-gazebo-bridge`
Activates on: `**/*.urdf,**/*.xacro,**/*.sdf,**/*.world,**/package.xml,**/launch/**,**/*.msg,**/*.srv,**/*.action`

Configure ros_gz_bridge to connect Gazebo topics with ROS 2 for closed-loop control

### `/ros2-launch-system`
Activates on: `**/*.urdf,**/*.xacro,**/*.sdf,**/*.world,**/package.xml,**/launch/**,**/*.msg,**/*.srv,**/*.action`

Generate ROS 2 Python launch files and multi-node system configurations for educational content. This skill should be used when creating lessons that teach launch file syntax, writing exercises involving multi-node startup, parameter configuration, or generating worked examples for robot system deployment.

### `/ros2-publisher-subscriber`
Activates on: `**/*.urdf,**/*.xacro,**/*.sdf,**/*.world,**/package.xml,**/launch/**,**/*.msg,**/*.srv,**/*.action`

Generate ROS 2 publisher and subscriber code examples for educational content. This skill should be used when creating lessons that teach ROS 2 pub/sub patterns, writing exercises involving topic-based communication, or generating worked examples for rclpy nodes.

### `/ros2-service-pattern`
Activates on: `**/*.urdf,**/*.xacro,**/*.sdf,**/*.world,**/package.xml,**/launch/**,**/*.msg,**/*.srv,**/*.action`

Generate ROS 2 service server and client code examples for educational content. This skill should be used when creating lessons that teach request/response communication, writing exercises involving services, or generating worked examples for synchronous robot commands.

### `/ros2-testing`
Activates on: `**/*.urdf,**/*.xacro,**/*.sdf,**/*.world,**/package.xml,**/launch/**,**/*.msg,**/*.srv,**/*.action`

Testing robotics code in ROS 2 — unit tests with gtest and pytest, node-level tests, multi-node integration tests with launch_testing, simulation tests in Gazebo, hardware-in-the-loop, and CI. Use when writing or reviewing any ROS 2 test, deciding what to test at which layer, setting up colcon test in a package, debugging a flaky robotics test, testing timing or sim-time behavior, or building CI for a robot workspace.

### `/rust-patterns`
Activates on: `**/*.rs,**/Cargo.toml`

Idiomatic Rust patterns, ownership, error handling, traits, concurrency, and best practices for building safe, performant applications.

### `/rust-testing`
Activates on: `**/*.rs,**/Cargo.toml`

Rust testing patterns including unit tests, integration tests, async testing, property-based testing, mocking, and coverage. Follows TDD methodology.

### `/sentry-feature-setup`
Activates on: `**/sentry.*.config.*,**/instrumentation.ts,**/instrumentation-client.ts,**/.sentryclirc`

Configure specific Sentry features beyond basic SDK setup. Use when asked to monitor AI/LLM calls, set up OpenTelemetry pipelines, create alerts and notifications, or enable span streaming.

### `/sentry-workflow`
Activates on: `**/sentry.*.config.*,**/instrumentation.ts,**/instrumentation-client.ts,**/.sentryclirc`

Fix production issues and review code with Sentry context. Use when asked to fix Sentry errors, debug issues, triage exceptions, review PR comments from Sentry, or resolve bugs.

### `/urdf-robot-model`
Activates on: `**/*.urdf,**/*.xacro`

Create robot models using URDF with proper links, joints, visual geometry, collision shapes, and physical properties

## Always listed (93)

Already in the session listing with descriptions.

### `/academic-paper-composer`

Systematic writing framework taking an optimized outline to a submission-ready manuscript, for philosophy and interdisciplinary papers and for IEEE robotics conference submissions (ICRA, IROS, RA-L). Use when users want to: (1) write a paper from a detailed outline, (2) ensure quality control during writing, (3) maintain consistency across chapters, (4) prepare a submission-ready manuscript, or (5) systematically execute a planned paper. Triggered by phrases like 'write the paper from this outline,' 'compose the full manuscript,' 'execute the outline,' or when users have completed strategic planning (academic-paper-strategist skill) and are ready to write. Takes optimized outline as input; outputs complete manuscript with iterative quality checks. Owns structure and quality gates only, so load daniel-voice for sentence-level prose, and references/venue_icra.md in the strategist skill for IEEE robotics word budgets and anonymization rules.

### `/academic-paper-strategist`

Systematic strategic planning framework for academic papers, covering philosophy and interdisciplinary preprints (PhilArchive, arXiv, PhilSci-Archive) and IEEE robotics conference submissions (ICRA, IROS, RA-L) via references/venue_icra.md. Use when users want to: (1) plan a paper on a specific topic, (2) identify research gaps and assess originality, (3) develop optimized paper outlines, (4) prepare for preprint submission, or (5) understand platform requirements and writing standards. Triggered by phrases like 'plan a paper on,' 'help me design a paper about,' 'identify research gaps in,' 'is this idea original,' or when users need structured research planning. The skill guides through three phases: Platform Analysis (identifying target venue and studying sample papers), Theoretical Framework (AI-driven literature search and gap identification), and Outline Optimization (structured design with reviewer-perspective self-assessment). Each phase includes quality evaluation standards and validation checkpoints. Output: optimized detailed outline ready for systematic writing (use with academic-paper-composer skill; daniel-voice governs sentence-level prose in both).

### `/agent-reach`

MUST USE when user wants to research/search/look up/find anything on the internet — e.g. "research this topic", "do a deep dive on X", "search the web for X", "see what people say about X", "look this up". Also MUST USE when user mentions any platform or shares any URL/link: Twitter/X, Reddit, Facebook, Instagram, YouTube, GitHub, Bilibili, XiaoHongShu, Xiaoyuzhou Podcast, LinkedIn/jobs/recruiting, V2EX, Xueqiu (stocks), RSS. 15 platforms, multi-backend routing (OpenCLI / per-platform CLIs / APIs). Zero config for 6 channels. Run `agent-reach doctor --json` to see which backend serves each platform right now. NOT for: writing reports/analysis/translation (this skill only FETCHES internet content); posting/commenting/liking (write operations); platforms that already have a dedicated skill installed (prefer that skill).

### `/daniel-voice`

Writes in Daniel Kosukhin's voice for any prose task, including academic essays, reading reflections, personal narrative, college supplements, scholarship applications, cover letters, and any draft he wants polished or rewritten. Use this skill whenever Daniel asks for help writing, drafting, editing, polishing, restructuring, or giving feedback on prose, even when he does not say "in my voice" and even when the request sounds like ordinary editing. Do NOT use for code comments or technical documentation. Commit message bodies use it as a constraint, through the /commit command.

### `/find-docs`

Retrieves up-to-date documentation, API references, and code examples for any developer technology. Use this skill whenever the user asks about a specific library, framework, SDK, CLI tool, or cloud service -- even for well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. Your training data may not reflect recent API changes or version updates. Always use for: API syntax questions, configuration options, version migration issues, "how do I" questions mentioning a library name, debugging that involves library-specific behavior, setup instructions, and CLI tool usage. Use even when you think you know the answer -- do not rely on training data for API details, signatures, or configuration options as they are frequently outdated. Always verify against current docs. Prefer this over web search for library documentation and API details.

### `/git-workflow`

Industry-standard version control — atomic commits, commit message anatomy, Conventional Commits, git trailers, branching models, rebase vs merge, PR hygiene, SemVer, changelogs, tags, signing, and history-recovery. Use before writing any commit message, when splitting work into commits, when choosing a branch strategy or merge method, when versioning or releasing, when a rebase/merge/force-push decision comes up, or when history needs repairing. Carries the Conventional Commits, SemVer, and Keep a Changelog specs in references/.

### `/google-cl-author`

Author changes the way Google expects them — one self-contained change per commit/PR, tests in the same change, a description that says what and why, and collaborative responses to review feedback. Use when planning how to split work into commits or PRs, writing a commit message or PR description, deciding whether a change is too big, or responding to review comments. Encodes google/eng-practices CL author guide.

### `/google-code-review`

Review code the way Google reviews a CL — design first, then functionality, complexity, tests, naming, comments, style, consistency, documentation, every line. Use whenever reviewing a diff, PR, branch, or file someone (including you) just wrote; whenever asked to "review", "check", "look over", "critique", or "audit" code; and as a self-review pass before reporting any implementation as done. Encodes google/eng-practices reviewer guide.

### `/google-style`

Google's language style guides — TypeScript, JavaScript, HTML/CSS, Python, Shell, Go, Java, C++, C#, Objective-C — as the authority on formatting, naming, comments, and language-feature use. Use before writing or editing code in any of these languages, when reviewing style in a diff, when naming things, when deciding whether a language feature is allowed, or when a style disagreement needs an authority. Carries the full text of each guide in references/.

### `/google-testing`

Google's testing discipline — test sizes and scopes, the 80/15/5 mix, testing behaviors not methods, DAMP over DRY, preferring real implementations over mocks, and avoiding brittle change-detector tests. Use when writing or reviewing any test, deciding what to test or at what level, choosing between a real object, a fake, and a mock, debugging a flaky or brittle test, or judging whether a change has adequate test coverage. From Software Engineering at Google and Testing on the Toilet.

### `/impeccable`

Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize, extract, or otherwise improve a frontend interface. Covers websites, landing pages, dashboards, product UI, app shells, components, forms, settings, onboarding, and empty states. Handles UX review, visual hierarchy, information architecture, cognitive load, accessibility, performance, responsive behavior, theming, anti-patterns, typography, fonts, spacing, layout, alignment, color, motion, micro-interactions, UX copy, error states, edge cases, i18n, and reusable design systems or tokens. Also use for bland designs that need to become bolder or more delightful, loud designs that should become quieter, live browser iteration on UI elements, or ambitious visual effects that should feel technically extraordinary. Not for backend-only or non-UI tasks.

### `/react-testing`

Testing React with Testing Library the way it's meant to be used — query priority, user-event, integration over unit, testing custom hooks, and mocking the network with MSW instead of fetch. Use when writing or reviewing React/Next.js tests, testing a component, custom hook, form, or async data flow, choosing between unit/integration/E2E for a frontend change, or fixing tests that break on every refactor.

### `/superpowers:brainstorming`

You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation.

### `/superpowers:dispatching-parallel-agents`

Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies

### `/superpowers:executing-plans`

Use when you have a written implementation plan to execute in a separate session with review checkpoints

### `/superpowers:finishing-a-development-branch`

Use when implementation is complete, all tests pass, and you need to decide how to integrate the work

### `/superpowers:receiving-code-review`

Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or technically questionable - requires technical rigor and verification, not performative agreement or blind implementation

### `/superpowers:requesting-code-review`

Use when completing tasks, implementing major features, or before merging to verify work meets requirements

### `/superpowers:subagent-driven-development`

Use when executing implementation plans with independent tasks in the current session

### `/superpowers:systematic-debugging`

Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes

### `/superpowers:test-driven-development`

Use when implementing any feature or bugfix, before writing implementation code

### `/superpowers:using-git-worktrees`

Use when starting feature work that needs isolation from current workspace or before executing implementation plans - ensures an isolated workspace exists via native tools or git worktree fallback

### `/superpowers:using-superpowers`

Use when starting any conversation - establishes how to find and use skills, requiring skill invocation before ANY response including clarifying questions

### `/superpowers:verification-before-completion`

Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always

### `/superpowers:writing-plans`

Use when you have a spec or requirements for a multi-step task, before touching code

### `/superpowers:writing-skills`

Use when creating new skills, editing existing skills, or verifying skills work before deployment

### `/frontend-design:frontend-design`

Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don't read as templated defaults.

### `/skill-creator:skill-creator`

Create new skills, modify and improve existing skills, and measure skill performance. Use when users want to create a skill from scratch, edit, or optimize an existing skill, run evals to test a skill, benchmark skill performance with variance analysis, or optimize a skill's description for better triggering accuracy.

### `/supabase:supabase`

Use when doing ANY task involving Supabase. Triggers: Supabase products (Database, Auth, Edge Functions, Realtime, Storage, Vectors, Cron, Queues); client libraries and SSR integrations (supabase-js, @supabase/ssr) in Next.js, React, SvelteKit, Astro, Remix; auth issues (login, logout, sessions, JWT, cookies, getSession, getUser, getClaims, RLS); Supabase CLI or MCP server; schema changes, migrations, declarative schemas, security audits, Postgres extensions (pg_graphql, pg_cron, pg_vector); debugging and troubleshooting errors or unexpected behavior on Supabase projects (HTTP errors, Postgres errors, RLS surprises, permission denied, schema cache issues, timeouts, Edge Function crashes, Realtime drops, Storage failures) and reading or querying logs (Logs Explorer, ClickHouse).

### `/supabase:supabase-postgres-best-practices`

Postgres best practices maintained by Supabase, for Postgres running anywhere. Load this skill BEFORE writing or changing anything that lives in a Postgres database: creating or altering tables and columns (including choosing column types), schema design, migrations and declarative schema files, RLS policies and the tests that verify them, indexes, triggers, database functions, queues and scheduled jobs (pg_cron, pgmq), vector/semantic search (pgvector), and restoring dumps (pg_restore) or importing data. Also load it when diagnosing slow queries, high CPU, timeouts, EXPLAIN plans, connection exhaustion, locking, bloat, or rows visible to the wrong user or tenant. This is not just a performance guide — schema, migration, security, and SQL authoring tasks need these rules too, even for a one-column change or a single query.

### `/claude-code-setup:claude-automation-recommender`

Analyze a codebase and recommend Claude Code automations (hooks, subagents, skills, plugins, MCP servers). Use when user asks for automation recommendations, wants to optimize their Claude Code setup, mentions improving Claude Code workflows, asks how to first set up Claude Code for a project, or wants to know what Claude Code features they should use.

### `/vercel:access-protected-vercel-deployment`

Access and test Vercel deployments protected by Vercel Authentication, SSO, or Deployment Protection. Use when curl, agent-browser, Playwright, or another automated request reaches a Vercel login or protection page; when a protected preview or production URL returns 401 or 403; when TRUSTED_SOURCES_ENVIRONMENT_MISMATCH appears; or when choosing between `vercel curl` and the `x-vercel-trusted-oidc-idp-token` header.

### `/vercel:ai-gateway`

Vercel AI Gateway guidance for setup, model discovery, authentication, routing, fallbacks, BYOK, budgets, spend reporting, observability, compatible APIs, and coding-agent configuration. Use when adding AI Gateway to an app, migrating provider calls, choosing models or providers, debugging gateway requests, or running `vercel ai-gateway` commands.

### `/vercel:ai-sdk`

Vercel AI SDK expert guidance. Use when building AI-powered features — chat interfaces, text generation, structured output, tool calling, agents, MCP integration, streaming, embeddings, reranking, image generation, or working with any LLM provider.

### `/vercel:auth`

Authentication integration guidance — Clerk (native Vercel Marketplace), Descope, and Auth0 setup for Next.js applications. Covers middleware auth patterns, sign-in/sign-up flows, and Marketplace provisioning. Use when implementing user authentication.

### `/vercel:bootstrap`

Project bootstrapping orchestrator for repos that depend on Vercel-linked resources (databases, auth, and managed integrations). Use when setting up or repairing a repository so linking, environment provisioning, env pulls, and first-run db/dev commands happen in the correct safe order.

### `/vercel:build-agents`

Default guidance for building AI agents. Use for generic requests to build, create, scaffold, design, architect, or implement an AI agent, agent app, tool-calling agent, durable agent, multi-agent system, or scheduled agent.

### `/vercel:cdn-caching`

Debug Vercel CDN caching — cache hit rate, stale content, revalidation behavior, ISR + PPR, per-request cache reasons (cacheReason) and PPR state (ppr_state), and costs.

### `/vercel:chat-sdk`

Vercel Chat SDK expert guidance. Use when building multi-platform chat bots — Slack, Telegram, Microsoft Teams, Discord, Google Chat, GitHub, Linear — with a single codebase. Covers the Chat class, adapters, threads, messages, cards, modals, streaming, state management, and webhook setup.

### `/vercel:create-a-backend`

Backend architecture guidance. Use when planning, building, or migrating an API or backend; choosing between Functions, Services, containers, Workflow, Queues, and Marketplace databases; or selecting a supported backend framework or runtime.

### `/vercel:deployments-cicd`

Vercel deployment and CI/CD expert guidance. Use when deploying, promoting, rolling back, inspecting deployments, building with --prebuilt, or configuring CI workflow files for Vercel.

### `/vercel:env-vars`

Vercel environment variable expert guidance. Use when working with .env files, vercel env commands, OIDC tokens, or managing environment-specific configuration.

### `/vercel:eve`

eve framework guidance for durable AI agents and agent-powered applications. Use when creating, editing, or debugging an eve project, when the user explicitly asks for eve, or when the build-agents skill has selected eve as the default framework. Covers eve's filesystem-first runtime, durable sessions, tools, skills, connections, channels, sandboxes, subagents, schedules, evals, frontend clients, and Agent Runs observability. Do not use for incidental agent mentions, generic agent-building prompts, or established non-eve stacks unless the user asks for comparison or migration.

### `/vercel:flags-sdk`

Set up and use feature flags and A/B tests with the Flags SDK (`flags` npm package) and Vercel Flags. Use when installing or configuring the SDK, adding a new or existing flag, wiring `vercelAdapter` (OIDC or SDK keys), declaring flags with `flag()`, using the `vercel flags` CLI (create, inspect, list, enable, disable, set, update, split, rollout, rules, segments, use-targeting, evaluations, versions, open, archive, unarchive, rm, sdk-keys, override, prepare), setting up providers/adapters (Vercel, Statsig, LaunchDarkly, PostHog, GrowthBook, Global Config, OpenFeature, Split, Flagsmith, Reflag, Optimizely, or custom), precompute, `identify`/`dedupe`, Flags Explorer/Toolbar, Next.js or SvelteKit, or encrypting flag values. Triggers: feature flags, feature gates, A/B testing, experimentation, gradual rollout, traffic split, targeting rules, flag overrides, precompute, Flags Explorer, Vercel Flags, vercel flags CLI, `flags/next`, `flags/sveltekit`, `flags/react`, `@flags-sdk/*`.

### `/vercel:knowledge-update`

Corrects outdated LLM knowledge about the Vercel platform and introduces new products. Injected at session start.

### `/vercel:marketplace`

Vercel Marketplace expert guidance — discovering, installing, and managing third-party integrations via the `vercel integration` CLI. Use when building any app that needs an external capability without a dedicated skill — commerce (stores, storefronts, selling products), payments (checkout, subscriptions, billing), observability/monitoring, messaging/email, search, or CMS — or when discovering, installing, or managing integrations.

### `/vercel:microfrontends`

Guide for building, configuring, and deploying microfrontends on Vercel. Use this skill when the user mentions microfrontends, multi-zones, splitting an app across teams, independent deployments, cross-app routing, incremental migration, composing multiple frontends under one domain, microfrontends.json, @vercel/microfrontends, the microfrontends local proxy, or path-based routing between Vercel projects. Also use when the user asks about shared layouts across projects, navigation between microfrontends, fallback environments, asset prefixes, or feature flag controlled routing.

### `/vercel:next-cache-components`

Next.js 16 Cache Components guidance — PPR, use cache directive, cacheLife, cacheTag, updateTag, and migration from unstable_cache. Use when implementing partial prerendering, caching strategies, or migrating from older Next.js cache patterns.

### `/vercel:next-forge`

next-forge expert guidance — production-grade Turborepo monorepo SaaS starter by Vercel. Use when working in a next-forge project, scaffolding with `npx next-forge init`, or editing @repo/* workspace packages.

### `/vercel:next-upgrade`

Upgrade Next.js to the latest version following official migration guides and codemods. Use when upgrading Next.js versions, running codemods, or migrating between major releases.

### `/vercel:nextjs`

Next.js App Router expert guidance. Use when building, debugging, or architecting Next.js applications — routing, Server Components, Server Actions, Cache Components, layouts, middleware/proxy, data fetching, rendering strategies, and deployment on Vercel.

### `/vercel:react-best-practices`

React best-practices reviewer for TSX files. Triggers after editing multiple TSX components to run a condensed quality checklist covering component structure, hooks usage, accessibility, performance, and TypeScript patterns.

### `/vercel:routing-middleware`

Vercel Routing Middleware guidance — request interception before cache, rewrites, redirects, personalization. Works with any framework. Supports Edge, Node.js, and Bun runtimes. Use when intercepting requests at the platform level.

### `/vercel:runtime-cache`

Vercel Runtime Cache API guidance — ephemeral per-region key-value cache with tag-based invalidation. Shared across Functions, Routing Middleware, and Builds. Use when implementing caching strategies beyond framework-level caching.

### `/vercel:shadcn`

shadcn/ui expert guidance — CLI, component installation, composition patterns, custom registries, theming, Tailwind CSS integration, and high-quality interface design. Use when initializing shadcn, adding components, composing product UI, building custom registries, configuring themes, or troubleshooting component issues.

### `/vercel:turbopack`

Turbopack expert guidance. Use when configuring the Next.js bundler, optimizing HMR, debugging build issues, or understanding the Turbopack vs Webpack differences.

### `/vercel:vercel-agent`

Vercel Agent guidance — AI-powered code review, incident investigation, and SDK installation. Automates PR analysis and anomaly debugging. Use when configuring or understanding Vercel's AI development tools.

### `/vercel:vercel-cli`

Vercel CLI expert guidance. Use when deploying, managing environment variables, linking projects, viewing logs, querying metrics, managing domains, managing feature flags with vercel flags, or interacting with the Vercel platform from the command line.

### `/vercel:vercel-connect`

Vercel Connect expert guidance — securely obtain scoped OAuth tokens for third-party services (Slack, GitHub, MCP servers, OAuth, Snowflake) on behalf of apps or users via Vercel OIDC. Use when wiring up third-party API access, connecting to MCP servers, sending Slack messages, accessing GitHub APIs, receiving webhook events from Slack/Linear/GitHub and forwarding them to your agents and apps, or building eve agent connections.

### `/vercel:vercel-firewall`

Vercel Firewall expert guidance — automatic DDoS mitigation, the Vercel WAF (custom rules, IP blocking, managed rulesets, rate limiting), Attack Mode, system bypass, bot management, and the `vercel firewall` CLI. Use when configuring platform-level security, responding to attacks, or staging firewall rules.

### `/vercel:vercel-functions`

Vercel Functions expert guidance — Node.js/Bun/Python runtimes, Fluid Compute, long-duration (30 min) functions, large functions (5 GB bundles), Docker/OCI container images, plan limits, streaming, WebSockets, and Cron Jobs. Use when configuring, debugging, or optimizing server-side code running on Vercel.

### `/vercel:vercel-sandbox`

Vercel Sandbox guidance — ephemeral Firecracker microVMs for running untrusted code safely. Supports AI agents, code generation, and experimentation. Use when executing user-generated or AI-generated code in isolation.

### `/vercel:vercel-services`

Configure and troubleshoot Vercel Services for multiple frontends and backends in one project. Use when composing a polyglot or multi-service application on one Vercel deployment; defining the `services` key, service-targeted rewrites, or service bindings in `vercel.json`; or running all services with `vercel dev`.

### `/vercel:vercel-storage`

Vercel storage expert guidance — Blob, Global Config (formerly Edge Config), and Marketplace storage (Neon Postgres, Upstash Redis). Use when choosing, configuring, or using data storage with Vercel applications.

### `/vercel:verification`

Full-story verification — infers what the user is building, then verifies the complete flow end-to-end: browser → API → data → response. Triggers on dev server start and 'why isn't this working' signals.

### `/vercel:workflow`

Vercel Workflow SDK expert guidance. Use when building durable workflows, long-running tasks, API routes or agents that need pause/resume, retries, step-based execution, or crash-safe orchestration with Vercel Workflow.

### `/hookify:writing-rules`

This skill should be used when the user asks to "create a hookify rule", "write a hook rule", "configure hookify", "add a hookify rule", or needs guidance on hookify rule syntax and patterns.

### `/caveman:caveman`

Ultra-compressed communication mode. Cuts token usage ~75% by speaking like caveman while keeping full technical accuracy. Supports intensity levels: lite, full (default), ultra. Use when user says "caveman mode", "talk like caveman", "use caveman", "less tokens", "be brief", or invokes /caveman. Also auto-triggers when token efficiency is requested.

### `/skills:agent-context-audit`

Audit a repo's agent context — CLAUDE.md files, codebase docs, skills, and tool/MCP designs — against Anthropic's Claude 5 context-engineering guidance ("unhobbling": Anthropic cut ~80% of Claude Code's system prompt with no eval loss). Finds overconstraint, conflicting instructions, redundancy, stale facts, and missing "unknown knowns"; produces a scored findings report with concrete rewrites, then applies approved fixes. Use when someone says "audit my CLAUDE.md", "context audit", "unhobble this repo", "review our agent docs/skills/tools", or after upgrading to Claude 5-generation models.

### `/skills:crabbox-setup`

Scaffold an isolated CLOUD dev box per agent (via crabbox + Daytona) for any codebase — the parallel-safe counterpart to dev-local-setup. Each agent gets its own full stack (own DB + dev server) and an in-box browser for e2e, so concurrent loops never collide on ports/state. Sets up the snapshot image, .crabbox.yaml, an idempotent setup.sh (also boots the stack locally), and a cbx.sh wrapper. Use when the user says "set up crabbox", "give each agent its own box", "add cloud testing", "make this repo testable in the cloud / on Daytona", "parallel-test this", or when setup-codebase-harness needs true per-agent isolation.

### `/skills:dev-local-setup`

Scaffold a one-command `dev-local` launcher for ANY codebase. Investigates the repo to find its services, ports, and infra dependencies, then generates a single `scripts/dev-local.sh` (up/down/status/logs/restart) that runs every dev server in one tmux session, plus a short skill doc describing it. Use when someone says "set up dev-local", "make a one-command dev launcher", "I want one script to start this repo", "scaffold dev-local for this project".

### `/skills:e2e-setup`

Set up an end-to-end test suite in any repo, following practices that make e2e a reliable per-PR gate: real flows over bypass, layered assertions, a reusable auth/session helper, video+trace evidence, and a compounding suite. Use when a repo has no e2e (or weak e2e) and you want system-level tests — "set up e2e", "add end-to-end tests", "scaffold a test gate".

### `/skills:new-loop`

Spin up a new loop (domain) in a file-based knowledge base — bootstrap the substrate if it's missing, gather the loop's charter, scaffold domains/<loop>/README.md, then do ONE real test run and record it in the loop's Timeline and LOG.md. Use when the user says "set up a new loop", "create a domain", "start a new beat/workstream", or names a recurring job they want the agent to own.

### `/skills:open-agent-teams`

Delegate tasks to ANY CLI agent (claude, codex, aider, ...) running in a detached tmux session, with a race-safe done-signal protocol and multi-turn iteration. Use when delegating work to a non-Claude CLI agent, when the user says "tmux delegate", "run agent in tmux", "delegate to codex/aider", or when executor work should run in an observable background terminal instead of the Agent tool.

### `/skills:seo-growth`

Use when deciding WHERE to point SEO effort, not how to write a page. Triggers: a new site or brand with no rankings and no authority ("cold start", "starting from zero", "nobody knows us"), deciding what to double down on, a page or cluster that ranks but earns nothing, hunting emerging or newly-coined keywords before competitors arrive, "should we build a cluster or one page", "what do we write next", "we get impressions but no clicks", "our traffic plateaued despite publishing", whether to chase a head term at all, or turning any of it into recurring automation. Also use when asked why an SEO effort stalled despite consistent output. NOT for writing an article, keyword expansion mechanics, or auditing a single tactic for penalty risk.

### `/skills:setup-codebase-harness`

Master skill — set up the full agent harness for any repo so an agent can work it reliably: legible (map-not-manual docs + custom lints), executable (one-command dev stack), verifiable (e2e gate + a verify-before-ship loop), plus commit hygiene and entropy control. Use when onboarding a new/unfamiliar codebase to agent-driven development — "set up the harness", "make this repo agent-ready", "harness this codebase".

### `/skills:verifier-setup`

Set a repo up to prove engineering-task work actually works before it ships. Investigates the repo, ensures a one-command dev stack (`dev-local`) exists, asks whether verification runs locally or in a sandbox (crabbox), confirms/installs the driver (the `playwright-cli` skill for web by default). Outputs three artifacts: a committed `/verify` skill (per-task verification SOP — spawn a verifier sub-agent → drive the app → screenshot/video proof → open a PR with the proof embedded), the `/dev-local` skill + script, and the installed driver skill. Use when someone says "set up verification", "make this repo verifiable", "scaffold a verify skill", "set up the verifier".

### `/skills:visual-flow-gif`

Create animated flow diagrams from articles, workflow notes, architecture sketches, or process descriptions using a JSON specification and a local Python/Pillow renderer. Use when the user wants to turn source material into a static PNG + animated GIF diagram.

### `/mcp-server-dev:build-mcp-app`

This skill should be used when the user wants to build an "MCP app", add "interactive UI" or "widgets" to an MCP server, "render components in chat", build "MCP UI resources", make a tool that shows a "form", "picker", "dashboard" or "confirmation dialog" inline in the conversation, or mentions "apps SDK" in the context of MCP. Use AFTER the build-mcp-server skill has settled the deployment model, or when the user already knows they want UI widgets.

### `/mcp-server-dev:build-mcp-server`

This skill should be used when the user asks to "build an MCP server", "create an MCP", "make an MCP integration", "wrap an API for Claude", "expose tools to Claude", "make an MCP app", or discusses building something with the Model Context Protocol. It is the entry point for MCP server development — it interrogates the user about their use case, determines the right deployment model (remote HTTP, MCPB, local stdio), picks a tool-design pattern, and hands off to specialized skills.

### `/mcp-server-dev:build-mcpb`

This skill should be used when the user wants to "package an MCP server", "bundle an MCP", "make an MCPB", "ship a local MCP server", "distribute a local MCP", discusses ".mcpb files", mentions bundling a Node or Python runtime with their MCP server, or needs an MCP server that interacts with the local filesystem, desktop apps, or OS and must be installable without the user having Node/Python set up.

### `/neon:neon`

Overview of Neon, a complete set of cloud backend primitives for apps and agents, spanning Lakebase Postgres, Auth, the Data API, Object Storage, Compute Functions, and the AI Gateway. Start here to route to the right Neon skill, set up the CLI or MCP server, and follow the branch-first workflow. Use when "Neon" or "Lakebase Postgres" is mentioned, or when any of its individual capabilities are the trigger: "object storage" or "S3", "buckets", "serverless functions", "AI gateway", "call an LLM", "logs", "branch logs", "query logs", "log export", "Loki", "Grafana", "observability", "telemetry", "postgres", "database", or "backend". Also use when there is no Neon account yet, the user cannot sign in or provide an API key right now and needs a project they can claim later, or the user asks for a throwaway DATABASE_URL, Claimable Neon, Claimable Postgres, neon.new, claimable.neon.tech, instant Postgres, a no-signup database, temporary postgres, quick postgres, a no credit card database, or npx neon-new.

### `/neon:neon-ai-gateway`

One API and one credential for frontier and open-source LLMs, built into your Neon branch and powered by Databricks. Use when a user wants to call an LLM, add AI/chat/an agent to their app, route between model providers (OpenAI, Anthropic, Google/Gemini, Meta, Alibaba, and more), or avoid juggling separate provider API keys and accounts — especially when they already use Neon and want AI requests to branch with their project. Works with the OpenAI SDK, Anthropic SDK, google-genai, the Vercel AI SDK, and Mastra by changing only the base URL. Triggers include "call an LLM", "add AI to my app", "chat completion", "model routing", "LLM proxy/gateway", "one API for all models", "use Claude/GPT/Gemini", "AI SDK", "Mastra agent", "Neon AI Gateway", and "log/rate-limit AI calls".

### `/neon:neon-functions`

Long-running, serverless Node.js HTTP functions deployed onto your Neon branch, with DATABASE_URL injected automatically and compute that runs next to your data. Use when a user wants to host an API, an AI agent with long streaming responses, a WebSocket or server-sent-events (SSE) server, a webhook handler, a Discord bot, an MCP server, or any request/response workload that risks timing out on short, lambda-style serverless functions — and wants it to branch with their database. Triggers include "serverless function", "deploy an API", "long-running function", "streaming agent", "SSE server", "WebSocket server", "webhook handler", "MCP server", "run code next to my database", "function that won't time out", "function logs", "Neon Functions", and "Neon Compute".

### `/neon:neon-object-storage`

S3-compatible object storage that branches with your Neon project, so files and the database stay in sync across every branch. Use when a user wants object storage, a bucket, blob/file storage, or somewhere to put uploads, images, documents, avatars, or user-generated files for their app or agent — especially when they already use (or are setting up) Lakebase Postgres and don't want to add a separate storage provider like AWS S3, Cloudflare R2, or Supabase Storage. Triggers include "object storage", "bucket", "blob storage", "file storage", "store uploads/images/files", "S3-compatible storage", "presigned URL", "where do I put files", "storage logs", "bucket logs", "CDN in front of object storage", "Neon Object Storage", "Neon Storage", and "storage that branches with my database".

### `/neon:neon-postgres`

Guides and best practices for working with Lakebase Postgres, the database behind Neon. Covers setup, connection methods and drivers, pooled vs direct connections, branching, schema migrations, autoscaling, scale-to-zero, instant restore, read replicas, connection pooling, IP allow lists, and logical replication. Also covers Lakebase Search: semantic vector search, full-text search with BM25 ranking, and hybrid search. Use when users ask about "Lakebase Postgres", "Neon setup", "connect to Neon", "Neon project", "DATABASE_URL", "serverless Postgres", "Neon CLI", "neon", "Neon MCP", "Neon Auth", "@neondatabase/serverless", "@neondatabase/neon-js", "scale to zero", "Neon autoscaling", "Neon read replica", "Neon connection pooling", "schema migrations", "semantic search", "vector search", "full-text search", "BM25", or "hybrid search".

### `/neon:neon-postgres-branches`

Choose and create the right Neon branch type for testing and development. Use when users ask about Neon branching, migration testing with real data, isolated test environments, schema-only branch workflows for sensitive data, resetting a branch from its parent, branch expiration and CI/CD branch lifecycles, or branch creation via Neon CLI or Neon MCP. Triggers include "Neon branch", "test migrations safely", "branch production data", "schema-only branch", "reset branch", "branch per PR" and "sensitive data testing".

### `/neon:neon-postgres-egress-optimizer`

Diagnose and fix excessive Postgres egress (network data transfer) in a codebase. Use when a user mentions high database bills, unexpected data transfer costs, network transfer charges, egress spikes, "why is my Neon bill so high", "database costs jumped", SELECT * optimization, query overfetching, reduce Neon costs, optimize database usage, or wants to reduce data sent from their database to their application. Also use when reviewing query patterns for cost efficiency, even if the user doesn't explicitly mention egress or data transfer.

### `/google-engineering:git-workflow`

Industry-standard version control — atomic commits, commit message anatomy, Conventional Commits, git trailers, branching models, rebase vs merge, PR hygiene, SemVer, changelogs, tags, signing, and history-recovery. Use before writing any commit message, when splitting work into commits, when choosing a branch strategy or merge method, when versioning or releasing, when a rebase/merge/force-push decision comes up, or when history needs repairing. Carries the Conventional Commits, SemVer, and Keep a Changelog specs in references/.

### `/google-engineering:google-cl-author`

Author changes the way Google expects them — one self-contained change per commit/PR, tests in the same change, a description that says what and why, and collaborative responses to review feedback. Use when planning how to split work into commits or PRs, writing a commit message or PR description, deciding whether a change is too big, or responding to review comments. Encodes google/eng-practices CL author guide.

### `/google-engineering:google-code-review`

Review code the way Google reviews a CL — design first, then functionality, complexity, tests, naming, comments, style, consistency, documentation, every line. Use whenever reviewing a diff, PR, branch, or file someone (including you) just wrote; whenever asked to "review", "check", "look over", "critique", or "audit" code; and as a self-review pass before reporting any implementation as done. Encodes google/eng-practices reviewer guide.

### `/google-engineering:google-style`

Google's language style guides — TypeScript, JavaScript, HTML/CSS, Python, Shell, Go, Java, C++, C#, Objective-C — as the authority on formatting, naming, comments, and language-feature use. Use before writing or editing code in any of these languages, when reviewing style in a diff, when naming things, when deciding whether a language feature is allowed, or when a style disagreement needs an authority. Carries the full text of each guide in references/.

### `/google-engineering:google-testing`

Google's testing discipline — test sizes and scopes, the 80/15/5 mix, testing behaviors not methods, DAMP over DRY, preferring real implementations over mocks, and avoiding brittle change-detector tests. Use when writing or reviewing any test, deciding what to test or at what level, choosing between a real object, a fake, and a mock, debugging a flaky or brittle test, or judging whether a change has adequate test coverage. From Software Engineering at Google and Testing on the Toilet.

## Disabled (19)

Set to `off` in settings.json. NOT invocable until that changes.

### `/spacetimedb-auth`

Use when implementing SpacetimeDB authentication or authorization, including SpacetimeAuth, Auth0, Clerk, OIDC, auth claims, subject/issuer checks, custom claims, roles, row-level security, and rejecting client connections. Triggers on: auth, authentication, authorization, SpacetimeAuth, Auth0, Clerk, OIDC, claims, RLS, row-level security.

### `/spacetimedb-cli`

Use when running or explaining SpacetimeDB CLI commands and standalone configuration. Covers `spacetime init`, `build`, `publish`, `generate`, `call`, `sql`, `logs`, `describe`, `dev`, `server`, `start`, login/logout, and `config.toml`. Triggers on: spacetime CLI, spacetime publish, spacetime generate, spacetime sql, spacetime logs, spacetime server.

### `/spacetimedb-client-c-sharp`

Use when writing SpacetimeDB C# or Unity clients, generated C# bindings, connection setup, subscriptions, cache access, reducer invocation, callbacks, or identity handling. Triggers on: C#, CSharp, Unity, C# SDK, generated C# bindings, Unity SDK, C# subscription, C# reducer call.

### `/spacetimedb-client-rust`

Use when writing SpacetimeDB Rust clients, generated Rust bindings, connection code, subscriptions, cache access, reducer invocation, callbacks, or identity handling. Triggers on: Rust client, Rust SDK, generated Rust bindings, Rust subscription, Rust reducer call, Rust callbacks.

### `/spacetimedb-client-typescript`

Use when writing SpacetimeDB TypeScript or JavaScript clients, generated TS bindings, `DbConnection`, `DbContext`, query builders, subscriptions, reducer events, cache callbacks, React provider/hooks, Vue, Svelte, browser, Node, Bun, Deno, Next.js, Nuxt, Remix, TanStack, or Angular integrations. Triggers on: TypeScript SDK, JavaScript SDK, useSpacetimeDB, useTable.

### `/spacetimedb-client-unreal`

Use when writing SpacetimeDB Unreal Engine clients, generated Unreal bindings, Unreal plugin setup, `DbConnection`, ticking the connection, cache access, subscriptions, reducer invocation, or identity handling. Triggers on: Unreal, Unreal Engine, UE, Unreal SDK, URemoteTable, USubscriptionBuilder.

### `/spacetimedb-clients`

Use when working with general SpacetimeDB client SDK concepts: generated bindings, connection lifecycle, identity, local cache, subscriptions, subscription semantics, reducer invocation, and update callbacks. Triggers on: client SDK, codegen, generated bindings, DbConnection, subscribe, local cache, reducer invocation, update callback.

### `/spacetimedb-databases`

Use when creating, developing, building, publishing, migrating, or reasoning about SpacetimeDB database modules. Covers local development, module build/publish flow, transactions, automatic migrations, incremental migrations, and the database cheat sheet. Triggers on: database module, spacetime publish, build module, migration, transaction, atomicity, developing module.

### `/spacetimedb-deploy`

Use when deploying or operating SpacetimeDB on Maincloud or self-hosted infrastructure, configuring standalone services, rotating keys, viewing logs, filtering logs, or using PGWire. Triggers on: deploy, Maincloud, self-host, standalone, systemd, Nginx, key rotation, logging, spacetime logs, PGWire, psql.

### `/spacetimedb-http`

Use when calling SpacetimeDB HTTP endpoints for identity, database operations, reducer calls, SQL execution, schema metadata, logs, energy endpoints, or authorization headers. Triggers on: HTTP API, REST, Authorization header, bearer token, /v1/identity, /v1/database, HTTP reducer call, HTTP SQL.

### `/spacetimedb-procedures`

Use when writing SpacetimeDB procedures, returning values, making HTTP requests from server code, accessing the database from procedures, calling reducers from procedures, or integrating external APIs. Triggers on: procedure, procedures, HTTP request, return value, external API, AI API, call reducer from procedure.

### `/spacetimedb-quickstarts`

Use when starting a SpacetimeDB project, installing the CLI, logging in, understanding architecture, or following quickstarts for TypeScript, React, Angular, Vue, Svelte, Next.js, Nuxt, Remix, TanStack, Browser, Node.js, Bun, Deno, Rust, C#, or C++. Triggers on: install SpacetimeDB, quickstart, getting started, architecture, state mirroring, FAQ, new app.

### `/spacetimedb-reducers`

Use when writing SpacetimeDB reducers, lifecycle reducers, scheduled reducers, reducer context code, table mutations, indexed lookups, reducer isolation logic, or reducer error handling. Triggers on: reducer, ReducerContext, ctx, sender, client_connected, client_disconnected, init, scheduled reducer, insert row, delete row, update row.

### `/spacetimedb-serialization`

Use when working with SpacetimeDB low-level formats and ABI details: BSATN, SATS JSON, AlgebraicValue, AlgebraicType, WebAssembly module ABI, host calls, buffers, reducer scheduling, table mutation, querying, or `bindings.h`. Triggers on: BSATN, SATS, AlgebraicValue, AlgebraicType, wasm ABI, module ABI, host calls.

### `/spacetimedb-sql`

Use when writing SpacetimeDB SQL for subscriptions, CLI queries, HTTP SQL, SELECT/FROM/WHERE, DML, system variables, data types, literals, identifiers, or performance. Triggers on: SQL, spacetime sql, subscription query, SELECT, WHERE, INSERT, DELETE, UPDATE, SHOW, identifier, literal.

### `/spacetimedb-tables`

Use when defining or changing SpacetimeDB tables, columns, constraints, primary keys, unique constraints, indexes, auto-increment fields, default values, event tables, schedule tables, access permissions, file storage, or table performance. Triggers on: table, column, primary key, unique, index, btree, direct index, event table, schedule table.

### `/spacetimedb-tutorials`

Use when following, adapting, or debugging complete SpacetimeDB tutorials, including the chat app tutorial, Unity Blackhol.io tutorial, Unreal Blackhol.io tutorial, multiplayer examples, and game tutorial code. Triggers on: tutorial, chat app, Unity tutorial, Unreal tutorial, Blackhol.io, multiplayer example, game tutorial.

### `/spacetimedb-upgrade`

Use when migrating from SpacetimeDB 1.0 to 2.0 or fixing code affected by 2.0 breaking changes. Covers reducer callbacks, event tables, event type changes, subscription API, table accessor naming, database-name connections, `sender()` method, update methods, scheduled functions, private codegen, light mode, `CallReducerFlags`, and confirmed reads. Triggers on: upgrade, migrate, 1.0, 2.0, breaking changes.

### `/spacetimedb-views`

Use when defining SpacetimeDB views, SQL-backed projections, derived client-facing data, view arguments, or view performance. Triggers on: view, views, derived data, SQL view, view argument, projection, client query.
