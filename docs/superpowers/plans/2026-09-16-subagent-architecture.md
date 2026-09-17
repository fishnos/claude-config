# Subagent architecture implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a dispatched subagent carry the active mode's rules, tool limits
and proof requirements, enforced by hooks rather than by asking the worker
nicely.

**Architecture:** `ccfg mode` gains a second output beside `rules/_active.md`: it
renders one agent definition file per role into `~/.claude/agents/` from a role
corpus plus the mode in force. A hook on dispatch staples a scope line and a run
token onto the prompt; hooks inside the worker record which files that worker
touched, keyed on the `agent_id` the payload carries; a hook wherever the
worker's report arrives (its last message, or in auto mode its
`SubagentHandback` call) runs a directory of gates and refuses the report with a
reason the worker gets to act on.

**Tech Stack:** Plain Node, no dependencies, CommonJS. Hooks read a JSON payload
on standard input and answer on standard output through `hooks/lib/hook-io.js`.
Tests are `tools/test-hooks.js`, a hand-rolled harness that spawns each hook with
`process.execPath`.

**Spec:** `docs/superpowers/specs/2026-09-15-subagent-architecture-design.md`.
Read it alongside this plan; the plan argues from it and does not restate its
reasoning.

## Global Constraints

- **Never commit and never push.** The operator runs `/commit` themselves.
  `CLAUDE_ALLOW_COMMIT=1` is forbidden. This plan marks commit boundaries and
  stops at them; it never runs `git commit`.
- **Never stage `settings.json`.** It carries the operator's own uncommitted
  edits (an `autoMode` block naming a storage bucket).
- **No new dependencies.** `tools/ccfg.js` spawns only `security`, `node --check`
  and its own suites today. Keep it that way.
- **Every test is watched red before its code exists.** A test that has never
  been seen to fail is unproven. If a case passes on arrival, break the code
  deliberately, watch it fail for the right reason, restore.
- **`docs/hooks.md` carries the suite's case count and the validator checks it.**
  Every task that adds cases updates that number in the same task. It has gone
  stale twice; the validator is what catches it.
- **Limit em dashes** in every file and every reply. Use a colon, a comma, a full
  stop or parentheses.
- **Naming is spelled out:** `index` not `i`, `config` not `c`, `position_weight`
  not `pos_w`. Loop counters `i` and `j` are the only exception.
- **Node floor is 14.14** (`fs.rmSync`), matching the rest of the configuration.
- **Platform neutral:** no shell invocation from a hook, no POSIX-only path
  assumptions, spawn through `process.execPath`.
- **Verification commands, run from `~/.claude`:** the full suite is
  `node tools/ccfg.js test` (five suites, 872 cases at the time of writing); the
  hooks suite alone is `node tools/test-hooks.js` (467 cases); the validator is
  `node hooks/validate-config.js`.

---

## File structure

**New, the role corpus (prose, one file per worker type):**

- `modes/roles/implementer.md` writes code against a brief.
- `modes/roles/investigator.md` reads and reports, never writes.
- `modes/roles/reviewer.md` reviews a diff, blind to the brief.

**New, the tools:**

- `tools/modes/roles.js` parses a role file. Mirrors `tools/modes/rules.js`.
- `tools/modes/crew.js` renders `~/.claude/agents/<id>.md` from a role plus the
  resolved mode settings.

**New, the hooks:**

- `hooks/agent-dispatch.js` (`PreToolUse` on `Agent` and `Task`) requires the
  scope line, mints the run token, staples the contract, opens the run record.
- `hooks/agent-guard.js` (`PreToolUse`, every tool) denies a worker any call
  targeting the evidence log or the run record.
- `hooks/subagent-trace.js` (`PostToolUse` on `Edit`, `Write`, `Bash`) records
  which paths this `agent_id` touched.
- `hooks/subagent-brief.js` (`SubagentStart`) injects the brief band.
- `hooks/subagent-gate.js` (`SubagentStop`, plus `PreToolUse` and `PostToolUse`
  on `SubagentHandback`) runs the gates wherever the report arrives, blocks or
  denies, and records a delivered hand-back.
- `hooks/subagent/gates/finish-shape.js`, `scope.js`, `evidence.js`, `review.js`,
  one gate per file, the directory is the registry.
- `hooks/lib/crew-record.js` reads and writes `cache/crew/<session>.jsonl`. Both
  the dispatch hook and the gate hook need it, so it lives on its own.

**Modified:**

- `tools/modes/apply.js` calls the crew renderer beside `renderTo`.
- `tools/modes/rules.js` accepts the new `worker:` header field.
- `hooks/lib/hook-io.js` gains a `rewrite()` emitter for `updatedInput`.
- `hooks/validate-config.js` checks every rule carries a `worker:` value.
- `tools/ccfg.js` gains `crew` and `conformance` subcommands.
- `modes/rules/*.md`, all 25, gain one header line.
- `settings.json` wires the five new hooks. **Never staged.**
- `docs/hooks.md` documents them and carries the case count.

---

## Task 1: The role parser

**Files:**

- Create: `tools/modes/roles.js`
- Create: `modes/roles/implementer.md`, `modes/roles/investigator.md`,
  `modes/roles/reviewer.md`
- Test: `tools/test-modes.js` (the existing mode suite, 285 cases)

**Interfaces:**

- Consumes: nothing.
- Produces: `parseRole(text, sourcePath)` returning
  `{ id, description, tools, skills, gates, body }` or `{ error }`; and
  `loadRoles(directory)` returning `{ roles, errors }`. `tools`, `skills` and
  `gates` are arrays of strings. Task 2 consumes both.

A role file's header is the same hand-rolled format `modes/rules/` uses: a `---`
block of fixed keys read by regular expression, not YAML. `tools/modes/rules.js`
lines 20 to 71 are the model to copy, including the rule that a malformed file is
collected as an error and skipped rather than thrown, because the renderer runs
on every mode switch and one bad file must not leave the operator with no crew.

- [x] **Step 1: Write the failing tests**

Append to `tools/test-modes.js`, matching its existing `check(label, actual,
expected)` idiom:

```js
const roles = require("./modes/roles.js");

const ROLE_FILE = [
  "---",
  "id: implementer",
  "description: Writes code against a written brief.",
  "tools: Read, Grep, Glob, Edit, Write, Bash, TodoWrite",
  "skills: superpowers:test-driven-development",
  "gates: finish-shape, scope, evidence",
  "---",
  "",
  "Work only inside the declared scope.",
].join("\n");

const parsed = roles.parseRole(ROLE_FILE, "implementer.md");
check("a role parses its id", parsed.id, "implementer");
check("a role splits its tools", parsed.tools.length, 7);
check("a role keeps Bash in its tools", parsed.tools.includes("Bash"), true);
check(
  "a role splits its gates",
  parsed.gates.join(","),
  "finish-shape,scope,evidence",
);
check(
  "a role keeps its body",
  parsed.body,
  "Work only inside the declared scope.",
);

const noId = roles.parseRole(
  "---\ndescription: x\ntools: Read\n---\nbody",
  "x.md",
);
check("a role with no id is an error", typeof noId.error, "string");
const noTools = roles.parseRole(
  "---\nid: x\ndescription: y\n---\nbody",
  "x.md",
);
check("a role with no tools is an error", typeof noTools.error, "string");
const noHeader = roles.parseRole("just a body", "x.md");
check("a role with no header is an error", typeof noHeader.error, "string");
const emptySkills = roles.parseRole(
  "---\nid: x\ndescription: y\ntools: Read\n---\nbody",
  "x.md",
);
check("skills defaults to empty", emptySkills.skills.length, 0);
check("gates defaults to empty", emptySkills.gates.length, 0);
```

- [x] **Step 2: Run the tests and watch them fail**

Run: `node tools/test-modes.js`
Expected: FAIL, `Cannot find module './modes/roles.js'`.

- [x] **Step 3: Write `tools/modes/roles.js`**

```js
"use strict";

// The role corpus: one worker type per file, declaring the tools it may use,
// the skills worth preloading into it, and the gates its finish must pass.
//
// The header is the same handful of fixed keys read by regex that
// tools/modes/rules.js uses, for the same reason: ccfg has no dependencies, and
// a hand-rolled YAML subset is a parser to maintain in exchange for syntax
// nobody asked for.
//
// A malformed role is collected as an error and skipped, never thrown. A mode
// switch renders the whole crew, and one bad file must not leave the operator
// with no workers at all.

const fs = require("fs");
const path = require("path");

const HEADER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function headerField(header, key) {
  const found = new RegExp(`^${key}:[ \\t]*(.+)$`, "m").exec(header);
  return found === null ? null : found[1].trim();
}

function commaList(value) {
  if (value === null) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseRole(text, sourcePath) {
  const matched = HEADER.exec(text);
  if (matched === null) return { error: `${sourcePath}: no --- header` };

  const header = matched[1];
  const id = headerField(header, "id");
  const description = headerField(header, "description");
  const tools = commaList(headerField(header, "tools"));

  if (id === null) return { error: `${sourcePath}: no id` };
  if (description === null) return { error: `${sourcePath}: no description` };
  if (tools.length === 0) return { error: `${sourcePath}: no tools` };

  return {
    id,
    description,
    tools,
    skills: commaList(headerField(header, "skills")),
    gates: commaList(headerField(header, "gates")),
    body: text.slice(matched[0].length).trim(),
  };
}

/** Every role in a directory, plus the reasons any file was skipped. */
function loadRoles(directory) {
  const roles = [];
  const errors = [];

  let entries;
  try {
    entries = fs.readdirSync(directory).sort();
  } catch {
    return { roles, errors };
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const file = path.join(directory, entry);
    const parsed = parseRole(fs.readFileSync(file, "utf8"), file);
    if (parsed.error !== undefined) {
      errors.push(parsed.error);
      continue;
    }
    roles.push({ ...parsed, file });
  }

  return { roles, errors };
}

module.exports = { parseRole, loadRoles };
```

- [x] **Step 4: Run the tests and watch them pass**

Run: `node tools/test-modes.js`
Expected: PASS, 285 + 10 = 295 cases.

- [x] **Step 5: Write the three role files**

`modes/roles/implementer.md`:

```markdown
---
id: implementer
description: Writes code against a written brief. Picked for build tasks.
tools: Read, Grep, Glob, Edit, Write, Bash, TodoWrite
skills: superpowers:test-driven-development
gates: finish-shape, scope, evidence
---

You are implementing one task from a written brief, in someone else's
repository, and you will not be here to answer questions about it afterwards.

Change only the files the scope line names. If the task cannot be finished
without touching something outside it, say so in the finish block with a
deviation line rather than doing it quietly.

Write the test before the code and watch it fail before you make it pass. A test
that has never been red proves nothing.

Every claim you make about behaviour needs a command behind it that you actually
ran. If you did not run it, say you did not.
```

`modes/roles/investigator.md`:

```markdown
---
id: investigator
description: Reads and reports. Picked for wide multi-file questions.
tools: Read, Grep, Glob
gates: finish-shape
---

You are answering a question about a repository you did not write, for someone
who will act on your answer without re-reading the files.

Report what the files say, not what you expect them to say. Quote the path and
line for anything load-bearing.

Say plainly when you did not find something, rather than reporting the nearest
thing you did find as though it were the answer.
```

`modes/roles/reviewer.md`:

```markdown
---
id: reviewer
description: Reviews a diff, deliberately blind to the task brief.
tools: Read, Grep, Glob
gates: finish-shape
---

You are reviewing a change. You have not been told what it was supposed to do,
and that is on purpose: a reviewer who knows the goal argues toward it.

Judge whether the change improves the overall health of this code, not whether
it is perfect. Design first, then correctness, complexity, tests, naming,
comments, style.

Label severity so nothing optional reads as mandatory: `Nit:`, `Optional:`,
`FYI:`. Say what is good, not only what is wrong. Name explicitly any area you
did not cover.

You cannot verify that a command was run. Do not try; another gate does that.
```

- [x] **Step 6: Check the corpus loads**

Run: `node -e "console.log(require('./tools/modes/roles.js').loadRoles('modes/roles'))"`
Expected: three roles, `errors: []`.

---

## Task 2: The crew renderer

**Files:**

- Create: `tools/modes/crew.js`
- Modify: `tools/modes/apply.js` (around line 217, where `renderTo` is called)
- Modify: `tools/ccfg.js` (add the `crew` subcommand)
- Test: `tools/test-modes.js`

**Interfaces:**

- Consumes: `loadRoles(directory)` from Task 1; the resolved mode settings object
  `{verify, claims, process, asking, code, subagents, voice}` that
  `modes.resolve()` already produces; and the glitch layer's `tools` array of
  denied tool names, parsed at `tools/modes/glitch.js` lines 82 to 97.
- Produces: `renderAgent(role, resolvedSettings, deniedTools, briefBand)`
  returning the agent file's text; and
  `writeCrew(configDir, roles, resolvedSettings, deniedTools, briefBand)`
  returning the array of paths written. Task 3 supplies `briefBand`; until then
  pass the empty string.

- [x] **Step 1: Write the failing tests**

```js
const crew = require("./modes/crew.js");

const role = {
  id: "implementer",
  description: "Writes code.",
  tools: ["Read", "Edit", "Write", "Bash"],
  skills: ["superpowers:test-driven-development"],
  gates: ["finish-shape", "scope"],
  body: "Work inside the scope.",
};
const shipSettings = { verify: "proven", claims: "sourced", code: "polished" };

const rendered = crew.renderAgent(role, shipSettings, ["Bash"], "RULE ONE");
check(
  "a rendered agent names itself",
  /^name: implementer$/m.test(rendered),
  true,
);
check(
  "a rendered agent drops a denied tool",
  /^tools: Read, Edit, Write$/m.test(rendered),
  true,
);
check(
  "a rendered agent keeps its skills",
  /^skills: superpowers/m.test(rendered),
  true,
);
check(
  "a rendered agent carries the brief band",
  rendered.includes("RULE ONE"),
  true,
);
check(
  "a rendered agent carries its body",
  rendered.includes("Work inside the scope."),
  true,
);
check(
  "a rendered agent says it is generated",
  rendered.includes("ccfg mode"),
  true,
);

const noSkills = crew.renderAgent(
  { ...role, skills: [] },
  shipSettings,
  [],
  "",
);
check("no skills means no skills line", /^skills:/m.test(noSkills), false);

const capped = crew.renderAgent(
  { ...role, skills: ["a", "b", "c"] },
  shipSettings,
  [],
  "",
);
check("skills are capped at two", /^skills: a, b$/m.test(capped), true);

const allDenied = crew.renderAgent(
  role,
  shipSettings,
  ["Read", "Edit", "Write", "Bash"],
  "",
);
check("a role with every tool denied renders nothing", allDenied, null);
```

- [x] **Step 2: Run and watch them fail**

Run: `node tools/test-modes.js`
Expected: FAIL, `Cannot find module './modes/crew.js'`.

- [x] **Step 3: Write `tools/modes/crew.js`**

```js
"use strict";

// Rendering the crew: one agent definition file per role, shaped by the mode.
//
// The tool list is an allowlist rather than a denylist because the allowlist is
// the form the 2026-09-15 feasibility spike actually exercised. `skills:` is
// capped at two entries because the documentation is explicit that it injects
// the full skill text and not the description, so a generous list would spend a
// worker's context before it reaches its brief.
//
// A role left with no tools renders nothing at all. An agent definition with an
// empty tool list is not a harmless no-op: it is a worker that can be dispatched
// and can do nothing, which reads to the dispatcher as a broken crew rather than
// as a mode that withheld a role on purpose.

const fs = require("fs");
const path = require("path");

const MAX_SKILLS = 2;

const GENERATED =
  "<!-- Generated by `ccfg mode`. Edit the role in modes/roles/, not this file. -->";

function renderAgent(role, resolvedSettings, deniedTools, briefBand) {
  const tools = role.tools.filter((tool) => !deniedTools.includes(tool));
  if (tools.length === 0) return null;

  const skills = role.skills.slice(0, MAX_SKILLS);
  const header = [
    "---",
    `name: ${role.id}`,
    `description: ${role.description}`,
    `tools: ${tools.join(", ")}`,
  ];
  if (skills.length > 0) header.push(`skills: ${skills.join(", ")}`);
  header.push("---");

  const posture = Object.entries(resolvedSettings)
    .map(([name, value]) => `${name}: ${value}`)
    .join(", ");

  const sections = [
    header.join("\n"),
    GENERATED,
    `<!-- mode posture: ${posture} -->`,
    role.body,
  ];
  if (briefBand.trim().length > 0) sections.push(briefBand.trim());

  return sections.join("\n\n").trimEnd() + "\n";
}

/**
 * Write the whole crew, and remove the agent files a previous mode wrote that
 * this one does not.
 *
 * Removal is by the generated marker, never by name: a file in agents/ that
 * this renderer did not write is the operator's own and is left alone.
 */
function writeCrew(configDir, roles, resolvedSettings, deniedTools, briefBand) {
  const directory = path.join(configDir, "agents");
  fs.mkdirSync(directory, { recursive: true });

  const written = [];
  const keep = new Set();
  for (const role of roles) {
    const text = renderAgent(role, resolvedSettings, deniedTools, briefBand);
    if (text === null) continue;
    const destination = path.join(directory, `${role.id}.md`);
    fs.writeFileSync(destination, text);
    written.push(destination);
    keep.add(`${role.id}.md`);
  }

  for (const entry of fs.readdirSync(directory)) {
    if (!entry.endsWith(".md") || keep.has(entry)) continue;
    const file = path.join(directory, entry);
    let existing = "";
    try {
      existing = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (existing.includes(GENERATED)) fs.rmSync(file, { force: true });
  }

  return written;
}

module.exports = { renderAgent, writeCrew, GENERATED };
```

- [x] **Step 4: Run and watch them pass**

Run: `node tools/test-modes.js`
Expected: PASS, 295 + 9 = 304 cases.

- [x] **Step 5: Write the failing test for the mode-switch wiring**

```js
// A mode switch writes the crew as well as the rules file.
const scratch = makeScratchConfig();
applyModeForTest(scratch, "ship");
check(
  "a mode switch writes an agent file",
  fs.existsSync(path.join(scratch, "agents", "implementer.md")),
  true,
);
applyModeForTest(scratch, "spike");
check(
  "a subagents-none mode writes no crew",
  fs.existsSync(path.join(scratch, "agents", "implementer.md")),
  false,
);
```

Reuse whatever throwaway-config helper `tools/test-modes.js` already has for
mode switching. If it has none, copy the pattern from the mode-switch cases
proved on 2026-09-14, which applied three modes against a throwaway copy of the
configuration.

- [x] **Step 6: Run and watch it fail**

Run: `node tools/test-modes.js`
Expected: FAIL, the agents directory does not exist.

- [x] **Step 7: Wire the renderer into `applyMode`**

In `tools/modes/apply.js`, beside the existing `renderTo(configDir, corpusRules,
resolved.settings, mode.name)` call:

```js
const crew = require("./crew.js");
const roleCorpus = require("./roles.js").loadRoles(
  path.join(configDir, "modes", "roles"),
);
// A mode that runs alone renders no crew: hooks/mode-guard.js already denies
// the Agent and Task tools outright in that posture, so agent files would be
// definitions for workers nothing can dispatch.
const crewRoles = layer.subagents === "none" ? [] : roleCorpus.roles;
crew.writeCrew(configDir, crewRoles, resolved.settings, layer.tools, "");
```

Place it after `const layer = mode.glitch || glitch.parseGlitch(...)` is
assigned, since it reads `layer`. Record the written paths in the lock under a
new `crewFiles` key, so `revert()` can remove exactly those.

- [x] **Step 8: Run and watch it pass**

Run: `node tools/test-modes.js`
Expected: PASS, 304 + 2 = 306 cases.

- [x] **Step 9: Add `ccfg crew`**

A subcommand that prints, for the mode in force, each role's name, its rendered
tool list and its gates, without dispatching anything. This is the operator's
window onto the whole system and is the reason they can trust it without running
a worker.

- [x] **Step 10: Verify the whole suite and the real crew**

Run: `node tools/ccfg.js test` (expect exit 0)
Run: `node hooks/validate-config.js` (expect ALL CHECKS PASSED)
Run: `node tools/ccfg.js crew` (expect three roles under RUNNER)
Run: `ls ~/.claude/agents/` (expect three files)

**COMMIT BOUNDARY.** Stop. Tell the operator the role corpus and renderer are
ready and hand them `/commit`. Suggested subject: `Render a crew of agent files
from the active mode`.

---

## Task 3: Classify every rule for workers

**Files:**

- Modify: `tools/modes/rules.js` (the parser, lines 27 to 71)
- Modify: all 25 files in `modes/rules/`
- Modify: `hooks/validate-config.js`
- Modify: `tools/modes/crew.js` (assemble the brief band)
- Test: `tools/test-modes.js`

**Interfaces:**

- Consumes: `parseRule()` from `tools/modes/rules.js`, which currently returns
  `{ id, setting, primary_at, only_at, body }`.
- Produces: the same object with a `worker` field holding `"brief"`, `"n/a"`, or
  `"gate:<id>"`; and `briefBand(corpusRules)` in `tools/modes/crew.js` returning
  the prose block of every `worker: brief` rule, which Task 2's `writeCrew` now
  receives instead of the empty string.

The spec's principle: a rule leaves a worker's prose brief only when a gate has
taken it over. This task is what makes that checkable instead of a promise.

- [ ] **Step 1: Write the failing tests**

```js
const rules = require("./modes/rules.js");

const briefRule = rules.parseRule(
  "---\nid: x\nsetting: code\nprimary_at: rough\nworker: brief\n---\nbody",
  "x.md",
);
check("a rule parses worker: brief", briefRule.worker, "brief");

const gateRule = rules.parseRule(
  "---\nid: x\nsetting: code\nprimary_at: rough\nworker: gate:scope\n---\nbody",
  "x.md",
);
check("a rule parses a gate classification", gateRule.worker, "gate:scope");

const missing = rules.parseRule(
  "---\nid: x\nsetting: code\nprimary_at: rough\n---\nbody",
  "x.md",
);
check(
  "a rule with no worker field is an error",
  typeof missing.error,
  "string",
);

const bogus = rules.parseRule(
  "---\nid: x\nsetting: code\nprimary_at: rough\nworker: maybe\n---\nbody",
  "x.md",
);
check("an unknown worker value is an error", typeof bogus.error, "string");

const band = crew.briefBand([
  { worker: "brief", body: "ONE" },
  { worker: "gate:scope", body: "TWO" },
  { worker: "n/a", body: "THREE" },
]);
check("the brief band keeps brief rules", band.includes("ONE"), true);
check("the brief band drops gated rules", band.includes("TWO"), false);
check("the brief band drops n/a rules", band.includes("THREE"), false);

const overCap = crew.briefBand(
  Array.from({ length: 7 }, (_, index) => ({
    worker: "brief",
    body: `R${index}`,
  })),
);
check("the brief band caps at five", (overCap.match(/R\d/g) || []).length, 5);
```

- [ ] **Step 2: Run and watch them fail**

Run: `node tools/test-modes.js`
Expected: FAIL. The first case fails because `worker` is `undefined`, and the
`missing` case fails because a rule with no `worker` field currently parses fine.

- [ ] **Step 3: Teach the rule parser the field**

In `tools/modes/rules.js`, after the existing `primary_at` and `only_at`
validation:

```js
const worker = headerField(header, "worker");
if (worker === null)
  return { error: `${sourcePath}: no worker classification` };
const workerIsGate = worker.startsWith("gate:");
if (worker !== "brief" && worker !== "n/a" && !workerIsGate)
  return {
    error: `${sourcePath}: worker must be 'brief', 'n/a' or 'gate:<id>', got '${worker}'`,
  };
```

and add `worker` to the returned object.

- [ ] **Step 4: Add `briefBand` to `tools/modes/crew.js`**

```js
// Five is a ceiling read off the measurement literature, not a taste call:
// adherence approaches zero past roughly five guardrails, and across 707 real
// agent prompts the rate at which EVERY constraint held was 27.2%. A sixth rule
// in a worker's brief does not add a sixth rule, it makes all six less likely.
const MAX_BRIEF_RULES = 5;

function briefBand(corpusRules) {
  const chosen = corpusRules
    .filter((rule) => rule.worker === "brief")
    .slice(0, MAX_BRIEF_RULES);
  if (chosen.length === 0) return "";
  return (
    "## Rules for this run\n\n" + chosen.map((rule) => rule.body).join("\n\n")
  );
}
```

Export it, and pass `briefBand(corpusRules)` from `applyMode` into `writeCrew`
in place of the empty string Task 2 left there.

- [ ] **Step 5: Run and watch them pass**

Run: `node tools/test-modes.js`
Expected: PASS, but every OTHER mode case now fails, because all 25 rule files
lack the new field. That is the intended red.

- [ ] **Step 6: Classify all 25 rules**

Add one `worker:` line to each file in `modes/rules/`. The starting split from
the spec, to be argued file by file rather than pasted:

| Rule file                              | `worker:`       | Why                                        |
| -------------------------------------- | --------------- | ------------------------------------------ |
| `asking-touch-only-what-was-named.md`  | `gate:scope`    | the scope gate enforces it                 |
| `claims-end-with-the-split.md`         | `gate:evidence` | the evidence gate enforces it              |
| `verify-evidence-before-assertions.md` | `gate:evidence` | same gate                                  |
| `verify-not-delegable.md`              | `n/a`           | a worker dispatches nothing                |
| `subagents-never-self-verify.md`       | `n/a`           | same                                       |
| `subagents-delegate-sparingly.md`      | `n/a`           | same                                       |
| `process-tdd.md`                       | `brief`         | no gate reads whether a test was red first |
| `code-test-behaviors.md`               | `brief`         | no gate reads test naming                  |
| `voice-caveman.md`                     | `brief`         | no gate reads prose register               |

Every rule not in that table still needs a line. A rule you cannot classify is a
finding worth reporting, not a `brief` by default: `brief` is the band with a
budget of five.

- [ ] **Step 7: Add the validator check**

In `hooks/validate-config.js`, a check that walks `modes/rules/`, parses each
file, fails on any missing or malformed `worker:` value, and fails when a
`gate:<id>` names a file absent from `hooks/subagent/gates/`. Until Task 8
creates that directory the gate-existence half will fail, so write the check now
and gate it on the directory existing, with a case pinning that.

- [ ] **Step 8: Verify**

Run: `node tools/ccfg.js test` (expect exit 0)
Run: `node hooks/validate-config.js` (expect ALL CHECKS PASSED)
Run: `node tools/ccfg.js mode` (expect 25 rules, none dropped)
Run: `head -40 ~/.claude/agents/implementer.md` (expect at most five rules under
"Rules for this run")

**COMMIT BOUNDARY.** Suggested subject: `Classify each rule for a worker's brief`.

---

## Task 4: The dispatch hook

**Files:**

- Create: `hooks/agent-dispatch.js`
- Create: `hooks/lib/crew-record.js`
- Modify: `hooks/lib/hook-io.js` (add `rewrite`)
- Test: `tools/test-hooks.js`

**Interfaces:**

- Consumes: `io.readPayload()`, `io.deny()`, `io.warn()`, `io.configDir()`.
- Produces: `io.rewrite(hookEventName, updatedInput)`; and in
  `hooks/lib/crew-record.js`, `openRun({sessionId, token, role, scope, head})`,
  `appendPath(sessionId, agentId, filePath)`, `findRun(sessionId, token)`,
  `recordFile(sessionId)`. Tasks 5, 6 and 8 all consume the record module.

- [ ] **Step 1: Write the failing tests**

```js
const DISPATCH = path.join(HOOKS, "agent-dispatch.js");

const dispatch = (prompt, subagentType, env) => ({
  tool_name: "Agent",
  session_id: "s1",
  cwd: repo,
  tool_input: { prompt, subagent_type: subagentType || "implementer" },
});

// A dispatch with no scope line is refused where proof is required.
check(
  "a dispatch with no scope line is denied at verify: tested",
  run(DISPATCH, dispatch("Go fix the parser."), {
    CLAUDE_CONFIG_DIR: testedConfig,
  }).verdict,
  "DENY",
);
check(
  "a dispatch with no scope line is allowed at verify: none",
  run(DISPATCH, dispatch("Go fix the parser."), {
    CLAUDE_CONFIG_DIR: noneConfig,
  }).verdict,
  "allow",
);
check(
  "a dispatch with a scope line is allowed",
  run(DISPATCH, dispatch("Scope: src/a.js\nGo fix the parser."), {
    CLAUDE_CONFIG_DIR: testedConfig,
  }).verdict,
  "allow",
);

// The rewritten prompt carries a token the original did not.
const rewritten = runJson(DISPATCH, dispatch("Scope: src/a.js\nFix it."), {
  CLAUDE_CONFIG_DIR: testedConfig,
});
const updated = (rewritten.hookSpecificOutput || {}).updatedInput || {};
check("the dispatch is rewritten", typeof updated.prompt, "string");
check(
  "the rewritten prompt carries a run token",
  /RUN [0-9a-f]{8}/.test(updated.prompt || ""),
  true,
);
check(
  "the rewritten prompt keeps the original",
  (updated.prompt || "").includes("Fix it."),
  true,
);
check(
  "the rewritten prompt carries the contract",
  (updated.prompt || "").includes("STATE"),
  true,
);

// The run record is opened with the declared scope.
const record = JSON.parse(
  fs
    .readFileSync(path.join(testedConfig, "cache", "crew", "s1.jsonl"), "utf8")
    .trim()
    .split("\n")[0],
);
check(
  "the run record keeps the declared scope",
  record.scope.join(","),
  "src/a.js",
);
check("the run record keeps the role", record.role, "implementer");
check(
  "the run record token matches the prompt",
  updated.prompt.includes(record.token),
  true,
);

// The denial says what to add, because a bare refusal invites a second attempt
// by another route.
const denial = run(DISPATCH, dispatch("Go fix the parser."), {
  CLAUDE_CONFIG_DIR: testedConfig,
});
check(
  "the denial shows the scope line format",
  denial.reason.includes("Scope:"),
  true,
);

// A non-dispatch tool call is not this hook's business.
check(
  "a Bash call passes through the dispatch hook",
  run(DISPATCH, bash("ls", repo), { CLAUDE_CONFIG_DIR: testedConfig }).verdict,
  "allow",
);
```

Build `testedConfig` and `noneConfig` as throwaway configuration directories
each holding a `mode.lock` with the relevant `settings.verify` value, using the
temporary-directory pattern the suite already uses for the hand-run checks. Tasks
5 to 8 pass them as `workerEnv = { CLAUDE_CONFIG_DIR: testedConfig }` and
`noneEnv = { CLAUDE_CONFIG_DIR: noneConfig }`; define both here, beside the
directories.

- [ ] **Step 2: Run and watch them fail**

Run: `node tools/test-hooks.js`
Expected: FAIL, `Cannot find module` for `agent-dispatch.js`.

- [ ] **Step 3: Add `rewrite` to `hooks/lib/hook-io.js`**

```js
/**
 * Let the call through with different arguments.
 *
 * Measured working on the Agent tool on build 2.1.270 by the 2026-09-15 spike,
 * against a five-month-old closed issue claiming it was silently ignored there.
 * It is the only channel that can put anything into a dispatch prompt, because
 * SubagentStart can inject context but never sees the brief.
 */
function rewrite(hookEventName, updatedInput) {
  emit({
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "allow",
      updatedInput,
    },
  });
  process.exit(0);
}
```

Export it beside `deny`, `warn`, `announce` and `block`.

- [ ] **Step 4: Write `hooks/lib/crew-record.js`**

One JSON object per line under `cache/crew/<session>.jsonl`: a `run` line per
dispatch, a `path` line per traced write. Append-only, because two hooks write
it concurrently and a read-modify-write would lose lines. Cap the file the way
`hooks/evidence-log.js` caps its own at 512 kilobytes.

- [ ] **Step 5: Write `hooks/agent-dispatch.js`**

Refuse a dispatch with no `Scope:` line when the lock's `settings.verify` is
`tested` or `proven`; otherwise mint an eight-character token, staple the
contract onto the prompt through `io.rewrite`, and open the run record. The
contract text, kept to four lines because format restriction measurably degrades
reasoning and this is the smallest structure that still joins:

```
RUN <token>  (repeat this line unchanged at the end of your report)
End the report you return (your final message, or the message you hand back) with that RUN line,
then STATE <done|blocked|rejected|input-required>, TOUCHED <paths you changed>, EVIDENCE <commands you actually ran>, each on its own line.
Change only what the Scope line names. Name anything else on a Deviation line with a reason.
```

The report can arrive in either place because auto mode hands it back through a
tool call (measured on 2.1.273). The gate parser in Task 8 also accepts the four
fields on one line separated by commas: the spike asked for them in one sentence,
and the one auto-mode worker measured answered on one line.

- [ ] **Step 6: Run and watch them pass**

Run: `node tools/test-hooks.js`
Expected: PASS, 467 + 12 = 479 cases.

- [ ] **Step 7: Prove the cases can fail**

Delete the scope check and watch the two denial cases go red. Restore. Then hard
code the token to a constant and watch the "token matches the record" case stay
green, which shows it is too weak: strengthen it to assert two dispatches mint
different tokens, and watch that new case go red against the constant before
restoring.

- [ ] **Step 8: Update the case count and verify**

Set `docs/hooks.md`'s count to 479. Run `node tools/ccfg.js test` and
`node hooks/validate-config.js`.

---

## Task 5: The guard that keeps a worker out of the record

**Files:**

- Create: `hooks/agent-guard.js`
- Test: `tools/test-hooks.js`

**Interfaces:**

- Consumes: `io.readPayload()`, `io.deny()`, `io.evidenceDir()`,
  `recordFile(sessionId)` from Task 4.
- Produces: nothing other tasks consume.

This is the task that keeps the evidence gate from being theatre. The
`implementer` role carries `Bash` and `Write`, so a tool allowlist does not keep
it out of `cache/evidence/`: a redirect, a heredoc or a node one-liner all reach
it. The denial keys on `agent_id`, which the spike measured arriving in a
worker's `PreToolUse` payload and which the main session's payloads do not carry.

- [ ] **Step 1: Write the failing tests**

```js
const AGENT_GUARD = path.join(HOOKS, "agent-guard.js");
const evidenceFile = path.join(testedConfig, "cache", "evidence", "s1.jsonl");

const asWorker = (payload) => ({
  ...payload,
  agent_id: "a6e0a6f2",
  agent_type: "implementer",
});

check(
  "a worker writing the evidence log is denied",
  run(
    AGENT_GUARD,
    asWorker({
      tool_name: "Write",
      session_id: "s1",
      tool_input: { file_path: evidenceFile },
    }),
    workerEnv,
  ).verdict,
  "DENY",
);
check(
  "the main session writing the evidence log is allowed",
  run(
    AGENT_GUARD,
    {
      tool_name: "Write",
      session_id: "s1",
      tool_input: { file_path: evidenceFile },
    },
    workerEnv,
  ).verdict,
  "allow",
);
check(
  "a worker redirecting into the evidence log is denied",
  run(AGENT_GUARD, asWorker(bash(`echo x > ${evidenceFile}`, repo)), workerEnv)
    .verdict,
  "DENY",
);
check(
  "a worker heredoc into the evidence log is denied",
  run(
    AGENT_GUARD,
    asWorker(bash(`cat <<'EOF' > ${evidenceFile}\nx\nEOF`, repo)),
    workerEnv,
  ).verdict,
  "DENY",
);
check(
  "a worker node one-liner into the evidence log is denied",
  run(
    AGENT_GUARD,
    asWorker(
      bash(
        `node -e "require('fs').writeFileSync('${evidenceFile}','x')"`,
        repo,
      ),
    ),
    workerEnv,
  ).verdict,
  "DENY",
);
check(
  "a worker writing the run record is denied",
  run(
    AGENT_GUARD,
    asWorker({
      tool_name: "Write",
      session_id: "s1",
      tool_input: {
        file_path: path.join(testedConfig, "cache", "crew", "s1.jsonl"),
      },
    }),
    workerEnv,
  ).verdict,
  "DENY",
);
check(
  "a worker READING the evidence log is allowed",
  run(
    AGENT_GUARD,
    asWorker({
      tool_name: "Read",
      session_id: "s1",
      tool_input: { file_path: evidenceFile },
    }),
    workerEnv,
  ).verdict,
  "allow",
);
check(
  "a worker writing its own repository is allowed",
  run(
    AGENT_GUARD,
    asWorker({
      tool_name: "Write",
      session_id: "s1",
      tool_input: { file_path: path.join(repo, "src", "a.js") },
    }),
    workerEnv,
  ).verdict,
  "allow",
);
```

The read case is deliberate: the survey's mechanism 4 keeps writes out and leaves
reads open, because a worker that cannot read the record cannot be told why it
was refused.

- [ ] **Step 2: Run and watch them fail**

Run: `node tools/test-hooks.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `hooks/agent-guard.js`**

Resolve `tool_input.file_path` (or `edits[].file_path`) to an absolute path and
deny when it sits under the evidence directory or the crew record directory.
For `Bash`, match the command text against both directory names. State in the
header comment that the `Bash` half is the weaker check, and why it is still
worth having.

- [ ] **Step 4: Run and watch them pass**

Run: `node tools/test-hooks.js`
Expected: PASS, 479 + 8 = 487 cases.

- [ ] **Step 5: Prove the cases can fail**

Drop the `agent_id` condition and watch the "main session is allowed" case go
red. Restore. Drop the `Bash` matching and watch the three shell cases go red.
Restore.

- [ ] **Step 6: Update the case count and verify**

Set `docs/hooks.md` to 487. Run the full suite and the validator.

---

## Task 6: The trace hook

**Files:**

- Create: `hooks/subagent-trace.js`
- Test: `tools/test-hooks.js`

**Interfaces:**

- Consumes: `appendPath(sessionId, agentId, filePath)` from Task 4.
- Produces: `path` lines in the run record, which Task 9's scope gate reads.

Attribution is per `agent_id` rather than by diffing the repository, so two
workers in one checkout do not inherit each other's changes.

- [ ] **Step 1: Write the failing tests**

```js
const TRACE = path.join(HOOKS, "subagent-trace.js");

run(
  TRACE,
  asWorker({
    tool_name: "Write",
    session_id: "s2",
    tool_input: { file_path: path.join(repo, "src", "a.js") },
  }),
  workerEnv,
);
run(
  TRACE,
  {
    tool_name: "Write",
    session_id: "s2",
    tool_input: { file_path: path.join(repo, "src", "b.js") },
  },
  workerEnv,
);

const traced = readRecordLines(testedConfig, "s2").filter(
  (line) => line.kind === "path",
);
check("a worker write is traced", traced.length, 1);
check(
  "the traced path is the file written",
  traced[0].path.endsWith("a.js"),
  true,
);
check("the traced path carries its agent", traced[0].agentId, "a6e0a6f2");
check(
  "a main-session write is not traced",
  traced.some((line) => line.path.endsWith("b.js")),
  false,
);

run(TRACE, { ...asWorker(bash("echo hi", repo)), session_id: "s2" }, workerEnv);
const afterBash = readRecordLines(testedConfig, "s2").filter(
  (line) => line.kind === "path",
);
check("a Bash call that writes nothing traces nothing", afterBash.length, 1);

const secondWorker = {
  ...asWorker({
    tool_name: "Write",
    session_id: "s2",
    tool_input: { file_path: path.join(repo, "src", "c.js") },
  }),
  agent_id: "b111",
};
run(TRACE, secondWorker, workerEnv);
const byAgent = readRecordLines(testedConfig, "s2").filter(
  (line) => line.kind === "path",
);
check(
  "two workers keep separate traces",
  new Set(byAgent.map((line) => line.agentId)).size,
  2,
);
```

- [ ] **Step 2: Run and watch them fail**

Run: `node tools/test-hooks.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `hooks/subagent-trace.js`**

Return immediately when the payload carries no `agent_id`. Record the file path
for `Edit` and `Write` (`MultiEdit` is not a tool on 2.1.273). For `Bash`, record
nothing: a command's written paths are not knowable from its text, and guessing
would put files in a worker's trace it never touched, which fails the scope gate
for the wrong reason.
Say that in the header comment.

- [ ] **Step 4: Run and watch them pass**

Run: `node tools/test-hooks.js`
Expected: PASS, 487 + 6 = 493 cases.

- [ ] **Step 5: Prove they can fail, update the count, verify**

Remove the `agent_id` guard and watch "a main-session write is not traced" go
red. Restore. Set `docs/hooks.md` to 493, run the full suite and the validator.

**COMMIT BOUNDARY.** Suggested subject: `Trace a worker's writes by agent id`.
The dispatch hook, the guard and the trace hook land together: each is useless
without the record the other two keep.

---

## Task 7: The brief hook

**Files:**

- Create: `hooks/subagent-brief.js`
- Test: `tools/test-hooks.js`

**Interfaces:**

- Consumes: `io.warn()` (the `SubagentStart` reply shape is the same
  `additionalContext` one), `io.configDir()`, the brief band from Task 3.
- Produces: nothing other tasks consume.

Injecting the same rules a worker's agent file already carries would say them
twice. This hook exists for what the agent file cannot carry: the rules as the
mode has them right now, for a worker dispatched after a mode switch.

- [ ] **Step 1: Write the failing tests**

```js
const BRIEF = path.join(HOOKS, "subagent-brief.js");
const started = {
  agent_id: "a1",
  agent_type: "implementer",
  session_id: "s3",
  cwd: repo,
};

const reply = run(BRIEF, started, workerEnv);
check("the brief hook injects context", reply.verdict, "warn");
check("the brief names the mode", reply.reason.includes("RUNNER"), true);
check(
  "the brief carries the rule band",
  reply.reason.includes("Rules for this run"),
  true,
);
check("the brief is capped", reply.reason.length < 8000, true);
check(
  "an unknown agent type still gets the band",
  run(
    BRIEF,
    { ...started, agent_type: "general-purpose" },
    workerEnv,
  ).reason.includes("Rules for this run"),
  true,
);
```

The last case matters: built-in agent types (`Explore`, `general-purpose`,
`code-simplifier`) cannot be given an agent file, and the operator's decision on
2026-09-15 was that they are briefed at spawn anyway and gated at finish.

- [ ] **Step 2 to 5: red, implement, green, prove failure**

Cap the injected text at 8000 characters, the same cap and for the same reason as
`hooks/mode-inject.js`: an oversized render means the corpus grew wrong, and
truncating keeps that from flooding a worker's context while staying visible.

- [ ] **Step 6: Update the count to 498 and verify**

---

## Task 8: The gate runner at both report points, and the finish-shape gate

**Files:**

- Create: `hooks/subagent-gate.js`
- Create: `hooks/subagent/gates/finish-shape.js`
- Modify: `hooks/lib/crew-record.js` (add `appendMark` and `marksFor`)
- Test: `tools/test-hooks.js`

**Interfaces:**

- Consumes: `io.block()`, `io.deny()`, `findRun(sessionId, token)` from Task 4,
  and three payload shapes, each measured on 2.1.273 (spec, "What is already
  measured"):
  - `SubagentStop`: `agent_id`, `agent_type`, `session_id`,
    `last_assistant_message`, `agent_transcript_path`, `stop_hook_active`.
  - `PreToolUse` with `tool_name: "SubagentHandback"`: `agent_id`, `agent_type`,
    `session_id`, `tool_input.message`, and a `transcript_path` that is the
    parent's, not the worker's.
  - `PostToolUse` with `tool_name: "SubagentHandback"`: `agent_id`, `session_id`,
    `tool_response.success`.
- Produces: in `hooks/lib/crew-record.js`, `appendMark(sessionId, mark)` and
  `marksFor(sessionId, agentId)` for `refusal` and `delivered` lines, which Task
  12 also reads; and the gate module contract, which Tasks 9, 10 and 11
  implement:

```js
module.exports = {
  id: "finish-shape",
  minimumVerify: "tested", // "none" | "tested" | "proven"
  check(run) {
    // run: {token, role, scope, touched, finish, settings}
    return { ok: true }; // or { ok: false, reason: "..." }
  },
};
```

The runner answers wherever the report arrives, which the operator chose on
2026-09-16 after the re-run on 2.1.273 measured the break: in auto mode the report
reaches the parent at the `SubagentHandback` call, before `SubagentStop` fires,
and a block at `SubagentStop` sends the worker back to a second hand-back the
harness refuses. A deny at the hand-back withholds the report, and the retry was
measured delivering the corrected one.

- [ ] **Step 1: Write the failing tests**

```js
const GATE = path.join(HOOKS, "subagent-gate.js");

// A dispatched run for the reports below to join.
const gateRecord = path.join(testedConfig, "cache", "crew", "s4.jsonl");
fs.mkdirSync(path.dirname(gateRecord), { recursive: true });
fs.appendFileSync(
  gateRecord,
  JSON.stringify({
    kind: "run",
    token: "abcd1234",
    role: "implementer",
    scope: ["src/a.js"],
  }) + "\n",
);

// A worker transcript whose first user line is the dispatch prompt, the layout
// measured on 2.1.273. The second refusal quotes its RUN line from here.
const parentTranscript = path.join(testedConfig, "projects", "s4.jsonl");
const workerTranscript = (agentId) =>
  path.join(
    testedConfig,
    "projects",
    "s4",
    "subagents",
    `agent-${agentId}.jsonl`,
  );
const writeWorkerTranscript = (agentId) => {
  fs.mkdirSync(path.dirname(workerTranscript(agentId)), { recursive: true });
  fs.writeFileSync(
    workerTranscript(agentId),
    JSON.stringify({
      type: "user",
      version: "2.1.273",
      message: {
        role: "user",
        content: "Scope: src/a.js\nFix it.\n\nRUN abcd1234",
      },
    }) + "\n",
  );
};

const SHAPED =
  "Did it.\n\nRUN abcd1234\nSTATE done\nTOUCHED src/a.js\nEVIDENCE node tools/test-hooks.js";

// Each scenario uses its own agent id, because refusals are counted per agent.
const stopped = (agentId, message) => ({
  hook_event_name: "SubagentStop",
  agent_id: agentId,
  agent_type: "implementer",
  session_id: "s4",
  last_assistant_message: message,
  agent_transcript_path: workerTranscript(agentId),
  stop_hook_active: false,
});
const handingBack = (agentId, message) => ({
  hook_event_name: "PreToolUse",
  tool_name: "SubagentHandback",
  agent_id: agentId,
  agent_type: "implementer",
  session_id: "s4",
  transcript_path: parentTranscript,
  tool_input: { message },
});
const handedBack = (agentId, success) => ({
  hook_event_name: "PostToolUse",
  tool_name: "SubagentHandback",
  agent_id: agentId,
  agent_type: "implementer",
  session_id: "s4",
  transcript_path: parentTranscript,
  tool_input: { message: SHAPED },
  tool_response: { success },
});

// Outside auto mode the report is the worker's last message.
check(
  "a prose-only finish is blocked",
  run(GATE, stopped("stop-prose", "All done, everything works."), workerEnv)
    .verdict,
  "BLOCK",
);
check(
  "the block shows the template",
  run(GATE, stopped("stop-template", "All done."), workerEnv).reason.includes(
    "STATE",
  ),
  true,
);
check(
  "a finish with the shape is allowed",
  run(GATE, stopped("stop-shaped", SHAPED), workerEnv).verdict,
  "allow",
);
check(
  "a finish block on one comma-separated line is allowed",
  run(
    GATE,
    stopped(
      "stop-one-line",
      "Did it.\n\nRUN abcd1234, STATE done, TOUCHED src/a.js, EVIDENCE node tools/test-hooks.js",
    ),
    workerEnv,
  ).verdict,
  "allow",
);
check(
  "a finish with an unknown STATE word is blocked",
  run(
    GATE,
    stopped("stop-state", "RUN abcd1234\nSTATE finished\nTOUCHED src/a.js"),
    workerEnv,
  ).verdict,
  "BLOCK",
);
check(
  "a finish whose token matches no run is blocked",
  run(
    GATE,
    stopped("stop-token", "RUN ffffffff\nSTATE done\nTOUCHED src/a.js"),
    workerEnv,
  ).verdict,
  "BLOCK",
);

// The bound: the second refusal quotes the RUN line, and there is no third.
writeWorkerTranscript("stop-twice");
run(GATE, stopped("stop-twice", "All done."), workerEnv);
check(
  "the second block quotes the exact RUN line",
  run(GATE, stopped("stop-twice", "All done."), workerEnv).reason.includes(
    "RUN abcd1234",
  ),
  true,
);
check(
  "there is no third block",
  run(GATE, stopped("stop-twice", "All done."), workerEnv).verdict,
  "allow",
);
run(GATE, stopped("stop-no-transcript", "All done."), workerEnv);
check(
  "a missing transcript leaves the second block on the template",
  run(
    GATE,
    stopped("stop-no-transcript", "All done."),
    workerEnv,
  ).reason.includes("STATE"),
  true,
);

// In auto mode the report is the hand-back message, and a refusal is a deny
// that withholds it from the parent.
check(
  "a hand-back with no finish block is denied",
  run(GATE, handingBack("back-prose", "All done."), workerEnv).verdict,
  "DENY",
);
check(
  "the hand-back denial shows the template",
  run(
    GATE,
    handingBack("back-template", "All done."),
    workerEnv,
  ).reason.includes("STATE"),
  true,
);
check(
  "a hand-back with the finish block is allowed",
  run(GATE, handingBack("back-shaped", SHAPED), workerEnv).verdict,
  "allow",
);
writeWorkerTranscript("back-twice");
run(GATE, handingBack("back-twice", "All done."), workerEnv);
check(
  "the second hand-back denial quotes the exact RUN line",
  run(GATE, handingBack("back-twice", "All done."), workerEnv).reason.includes(
    "RUN abcd1234",
  ),
  true,
);

// A delivered report is not gated again at the stop that follows it.
run(GATE, handedBack("back-delivered", true), workerEnv);
check(
  "a delivered hand-back excuses the stop that follows",
  run(
    GATE,
    stopped("back-delivered", "Task complete and handed back to caller."),
    workerEnv,
  ).verdict,
  "allow",
);
run(GATE, handedBack("back-refused", false), workerEnv);
check(
  "a hand-back that was not delivered does not excuse the stop",
  run(
    GATE,
    stopped("back-refused", "Task complete and handed back to caller."),
    workerEnv,
  ).verdict,
  "BLOCK",
);

// Denials at the hand-back and blocks at the stop share one count.
run(GATE, handingBack("back-shared", "All done."), workerEnv);
run(GATE, handingBack("back-shared", "All done."), workerEnv);
check(
  "a worker denied twice at hand-back is not blocked at stop",
  run(GATE, stopped("back-shared", "All done."), workerEnv).verdict,
  "allow",
);

check(
  "a call with no agent_id passes through",
  run(
    GATE,
    { ...handingBack("unused", "All done."), agent_id: undefined },
    workerEnv,
  ).verdict,
  "allow",
);
check(
  "a tool other than the hand-back passes through",
  run(
    GATE,
    { ...handingBack("back-other", "All done."), tool_name: "Write" },
    workerEnv,
  ).verdict,
  "allow",
);
check(
  "at verify: none no finish is blocked",
  run(GATE, stopped("none-stop", "All done."), noneEnv).verdict,
  "allow",
);
check(
  "at verify: none no hand-back is denied",
  run(GATE, handingBack("none-back", "All done."), noneEnv).verdict,
  "allow",
);
```

- [ ] **Step 2 to 5: red, implement, green, prove failure**

The runner reads the event from `hook_event_name`. At `PreToolUse` it acts only
when `tool_name` is `SubagentHandback`, and refuses with `io.deny`. At
`SubagentStop` it refuses with `io.block`. At `PostToolUse` on `SubagentHandback`
it appends a `delivered` mark when `tool_response.success` is true and emits
nothing. A payload with no `agent_id` is the main session and passes through at
every point.

It loads every module in `hooks/subagent/gates/`, keeps the ones the role's
`gates:` list names, drops the ones whose `minimumVerify` is above the mode's
`verify` setting, and runs the rest in directory order, refusing on the first
failure. A built-in agent type such as `general-purpose` has no role file, so it
runs `finish-shape` alone: the operator decided on 2026-09-15 that built-in types
are still gated at finish. A gate module that throws is reported as a gate
failure naming the module, never swallowed: a gate that silently stops running
is the failure this whole design exists to prevent.

The finish parser splits the report on the four field names (`RUN`, `STATE`,
`TOUCHED`, `EVIDENCE`), takes the last occurrence of each, and trims the comma
the one-line form leaves after a value, so the four-line form and the one-line
form a measured worker wrote both parse. It splits on field
names rather than commas because `TOUCHED` itself lists paths separated by
commas.

The two-refusal bound is counted from `refusal` marks in the run record for this
`agent_id`, across both points. `stop_hook_active` cannot count it: it only says
a stop hook is already running, and a hand-back denial never sets it. A
`SubagentStop` for an `agent_id` holding a `delivered` mark is allowed before any
gate runs.

The second refusal quotes the exact `RUN` line. When the report left the token
out, read it from the first `type: "user"` line of the worker's transcript,
whose `message.content` was a plain string on 2.1.273: `agent_transcript_path` at
`SubagentStop`, and at the hand-back
`<directory of transcript_path>/<session_id>/subagents/agent-<agent_id>.jsonl`,
an observed layout rather than a documented one. When that file is missing or
holds no token, fall back to the template, and never throw.

To prove the cases can fail: remove the `delivered` check and watch "a delivered
hand-back excuses the stop that follows" go red; count only `SubagentStop` blocks
and watch "a worker denied twice at hand-back is not blocked at stop" go red.
Restore both.

- [ ] **Step 6: Update the count to 518 and verify**

---

## Task 9: The scope gate

**Files:**

- Create: `hooks/subagent/gates/scope.js`
- Test: `tools/test-hooks.js`

**Interfaces:**

- Consumes: the gate contract from Task 8; `run.scope` (the dispatcher's declared
  patterns) and `run.touched` (the traced paths) from the run record.
- Produces: nothing.

- [ ] **Step 1: Write the failing tests**

```js
check(
  "a worker inside its scope passes",
  scopeGate.check({
    scope: ["src/a.js"],
    touched: ["src/a.js"],
    finish: { deviations: [] },
  }).ok,
  true,
);

check(
  "a worker outside its scope fails",
  scopeGate.check({
    scope: ["src/a.js"],
    touched: ["src/a.js", "src/b.js"],
    finish: { deviations: [] },
  }).ok,
  false,
);

check(
  "the failure names the offending path",
  scopeGate
    .check({
      scope: ["src/a.js"],
      touched: ["src/b.js"],
      finish: { deviations: [] },
    })
    .reason.includes("src/b.js"),
  true,
);

check(
  "a named deviation passes",
  scopeGate.check({
    scope: ["src/a.js"],
    touched: ["src/a.js", "src/b.js"],
    finish: { deviations: ["src/b.js: the import had to move with it"] },
  }).ok,
  true,
);

check(
  "a deviation with no reason fails",
  scopeGate.check({
    scope: ["src/a.js"],
    touched: ["src/b.js"],
    finish: { deviations: ["src/b.js"] },
  }).ok,
  false,
);

check(
  "a directory scope covers its files",
  scopeGate.check({
    scope: ["hooks/"],
    touched: ["hooks/a.js", "hooks/lib/b.js"],
    finish: { deviations: [] },
  }).ok,
  true,
);

check(
  "a glob scope covers its matches",
  scopeGate.check({
    scope: ["hooks/*.js"],
    touched: ["hooks/a.js"],
    finish: { deviations: [] },
  }).ok,
  true,
);

check(
  "a glob does not cross a directory boundary",
  scopeGate.check({
    scope: ["hooks/*.js"],
    touched: ["hooks/lib/b.js"],
    finish: { deviations: [] },
  }).ok,
  false,
);

check(
  "touching nothing passes",
  scopeGate.check({
    scope: ["src/a.js"],
    touched: [],
    finish: { deviations: [] },
  }).ok,
  true,
);
```

The last case is deliberate: an investigator that writes nothing must not be
blocked for it.

- [ ] **Step 2 to 5: red, implement, green, prove failure**

Match by path segment, never by string prefix, so `src/ab.js` is not inside
`src/a`. Convert a glob to a regular expression that stops at a path separator.

- [ ] **Step 6: Update the count to 527 and verify**

---

## Task 10: The evidence gate

**Files:**

- Create: `hooks/subagent/gates/evidence.js`
- Test: `tools/test-hooks.js`

**Interfaces:**

- Consumes: the gate contract; `run.finish.evidence` (the commands the worker
  cited); `io.evidenceDir()` and the JSON-lines format
  `hooks/evidence-log.js` already writes, one object per executed `Bash` call.
- Produces: nothing.

This gate is the answer to "claimed a verification it never ran". The log it
reads is written by a hook from commands that really executed, and Task 5 keeps
the worker out of it.

- [ ] **Step 1: Write the failing tests**

```js
check(
  "a cited command that ran passes at claims: sourced",
  evidenceGate.check({
    settings: { claims: "sourced" },
    touched: ["hooks/a.js"],
    finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
    log: [{ command: "node tools/test-hooks.js", at: 200 }],
    lastWriteAt: 100,
  }).ok,
  true,
);

check(
  "a cited command absent from the log fails at claims: sourced",
  evidenceGate.check({
    settings: { claims: "sourced" },
    touched: ["hooks/a.js"],
    finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
    log: [],
    lastWriteAt: 100,
  }).ok,
  false,
);

check(
  "the same case passes at claims: labeled",
  evidenceGate.check({
    settings: { claims: "labeled" },
    touched: ["hooks/a.js"],
    finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
    log: [],
    lastWriteAt: 100,
  }).ok,
  true,
);

check(
  "a command that ran BEFORE the last write fails",
  evidenceGate.check({
    settings: { claims: "sourced" },
    touched: ["hooks/a.js"],
    finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
    log: [{ command: "node tools/test-hooks.js", at: 50 }],
    lastWriteAt: 100,
  }).ok,
  false,
);

check(
  "STATE done with no evidence fails at claims: labeled",
  evidenceGate.check({
    settings: { claims: "labeled" },
    touched: ["hooks/a.js"],
    finish: { state: "done", evidence: [] },
    log: [],
    lastWriteAt: 100,
  }).ok,
  false,
);

check(
  "STATE blocked with no evidence passes",
  evidenceGate.check({
    settings: { claims: "labeled" },
    touched: ["hooks/a.js"],
    finish: { state: "blocked", evidence: [] },
    log: [],
    lastWriteAt: 100,
  }).ok,
  true,
);

check(
  "a docs-only change needs no command",
  evidenceGate.check({
    settings: { claims: "sourced" },
    touched: ["docs/hooks.md"],
    finish: { state: "done", evidence: [] },
    log: [],
    lastWriteAt: 100,
  }).ok,
  true,
);

check(
  "the failure quotes the command it could not find",
  evidenceGate
    .check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
      log: [],
      lastWriteAt: 100,
    })
    .reason.includes("node tools/test-hooks.js"),
  true,
);
```

The "command ran before the last write" case is the one that carries the gate:
running the suite and then editing the code is exactly the shape of a false
completion claim that is not a lie, and only the ordering catches it.

- [ ] **Step 2 to 5: red, implement, green, prove failure**

"Runtime code" means a touched path outside `docs/`, `*.md` and `modes/`. Write
that list in one named constant, not inline.

- [ ] **Step 6: Update the count to 535 and verify**

---

## Task 11: The blind review gate

**Files:**

- Create: `hooks/subagent/gates/review.js`
- Test: `tools/test-hooks.js`

**Interfaces:**

- Consumes: the gate contract; the `reviewer` role from Task 1.
- Produces: nothing.

`minimumVerify: "proven"`, so it runs under FIXER and nowhere else.

**What this gate is not for, and the test must pin it:** on false completion
claims no model-judge configuration exceeded AUROC 0.65, because judges anchor on
confident closing language. The reviewer judges code quality. Claims are Task
10's job.

- [ ] **Step 1: Write the failing tests**

```js
check(
  "the review gate is off at verify: tested",
  reviewGate.minimumVerify,
  "proven",
);
check(
  "the review gate asks for a diff and nothing else",
  reviewGate
    .buildPrompt({
      diff: "--- a/src/a.js\n+++ b/src/a.js\n+const x = 1;",
      brief: "SECRET BRIEF TEXT",
    })
    .includes("SECRET BRIEF TEXT"),
  false,
);
check(
  "the review prompt carries the diff",
  reviewGate
    .buildPrompt({
      diff: "+const x = 1;",
      brief: "b",
    })
    .includes("+const x = 1;"),
  true,
);
check(
  "a review finding does not block on its own",
  reviewGate.interpret({
    findings: [{ severity: "Nit", text: "name it better" }],
  }).ok,
  true,
);
check(
  "a blocking severity blocks",
  reviewGate.interpret({
    findings: [{ severity: "Blocking", text: "this drops the error" }],
  }).ok,
  false,
);
check(
  "no reviewer available is a gate failure, not a pass",
  reviewGate.interpret(null).ok,
  false,
);
```

The last case is from the survey's mechanism 3: a guardrail that silently
degrades to "no reviewer, therefore fine" is worse than no guardrail.

- [ ] **Step 2 to 6: red, implement, green, prove failure, count 541, verify**

---

## Task 12: The conformance log

**Files:**

- Modify: `hooks/subagent-gate.js` (append a `finish` mark for every report it
  reads)
- Create: `tools/conformance.js`
- Modify: `tools/ccfg.js` (add the `conformance` subcommand)
- Test: `tools/test-hooks.js`

**Interfaces:**

- Consumes: the run record: `run` lines from Task 4, `path` lines from Task 6,
  `refusal` and `delivered` marks from Task 8.
- Produces: `ccfg conformance` printing each assumption as **confirmed**,
  **contradicted** or **not yet observed**, with the build it was last seen on.

The `finish` mark the runner appends is
`{kind: "finish", agentId, at: "stop" | "handback", token, tokenSource, transcriptFound, build}`.
`tokenSource` is `"report"`, `"transcript"` or `null`. The runner reads the
first line of the worker's transcript at every finish: for `build`, the
`version` field every line carried on 2.1.273, and for the token when the report
left it out. `transcriptFound` records whether that file existed, and `build` is
`null` when it did not.

The assumptions to track, each re-measured on 2.1.273 on 2026-09-16:

| Id                  | Assumption                                     | Confirmed when                                                                | Contradicted when                                                   |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `updated-input`     | `updatedInput` reaches the worker              | a finish carries a token the dispatcher minted, from its report or transcript | a finish found no token in its report, and its transcript held none |
| `agent-id`          | inner payloads carry `agent_id`                | a `path` line was ever written                                                | never                                                               |
| `report-arrives`    | a report reaches a gate at one of its points   | a finish parsed a token from its report                                       | never                                                               |
| `handback-retry`    | a denied hand-back is retried and delivered    | a `delivered` mark follows a hand-back `refusal` mark for the same `agent_id` | never                                                               |
| `transcript-layout` | the worker transcript sits at the derived path | a hand-back finish found the transcript at the derived path                   | a hand-back finish found no transcript at the derived path          |

Whether `tools:` restricts a worker is not tracked. A `path` line records neither
the tool that wrote it nor the worker's role, so nothing in the record could show
a worker using a tool its role leaves out; spec section 10 keeps it open.

- [ ] **Step 1: Write the failing tests**

```js
check(
  "an unobserved assumption reads not yet observed",
  conformance.summarise([])[0].state,
  "not yet observed",
);
check(
  "a token returned in the report confirms updatedInput",
  conformance
    .summarise([
      { kind: "run", token: "abcd1234" },
      {
        kind: "finish",
        at: "stop",
        token: "abcd1234",
        tokenSource: "report",
        build: "2.1.273",
      },
    ])
    .find((row) => row.id === "updated-input").state,
  "confirmed",
);
check(
  "a token read from the transcript also confirms updatedInput",
  conformance
    .summarise([
      { kind: "run", token: "abcd1234" },
      {
        kind: "finish",
        at: "handback",
        token: "abcd1234",
        tokenSource: "transcript",
        transcriptFound: true,
        build: "2.1.273",
      },
    ])
    .find((row) => row.id === "updated-input").state,
  "confirmed",
);
check(
  "a finish with no token anywhere contradicts updatedInput",
  conformance
    .summarise([
      { kind: "run", token: "abcd1234" },
      {
        kind: "finish",
        at: "stop",
        token: null,
        tokenSource: null,
        transcriptFound: true,
        build: "2.1.273",
      },
    ])
    .find((row) => row.id === "updated-input").state,
  "contradicted",
);
check(
  "the build is carried through",
  conformance
    .summarise([
      { kind: "run", token: "a" },
      {
        kind: "finish",
        at: "stop",
        token: "a",
        tokenSource: "report",
        build: "2.1.273",
      },
    ])
    .find((row) => row.id === "updated-input").build,
  "2.1.273",
);
check(
  "a path line confirms agent_id",
  conformance
    .summarise([{ kind: "path", agentId: "a1" }])
    .find((row) => row.id === "agent-id").state,
  "confirmed",
);
check(
  "a token parsed from a hand-back report confirms the report arrives",
  conformance
    .summarise([
      { kind: "finish", at: "handback", token: "a", tokenSource: "report" },
    ])
    .find((row) => row.id === "report-arrives").state,
  "confirmed",
);
check(
  "a delivery after a hand-back refusal confirms the retry",
  conformance
    .summarise([
      { kind: "refusal", agentId: "a1", at: "handback" },
      { kind: "delivered", agentId: "a1" },
    ])
    .find((row) => row.id === "handback-retry").state,
  "confirmed",
);
check(
  "a missing derived transcript contradicts the layout",
  conformance
    .summarise([
      {
        kind: "finish",
        at: "handback",
        token: null,
        tokenSource: null,
        transcriptFound: false,
      },
    ])
    .find((row) => row.id === "transcript-layout").state,
  "contradicted",
);
```

- [ ] **Step 2 to 6: red, implement, green, prove failure, count 550, verify**

---

## Task 13: Wire it up, document it, and read the log

**Files:**

- Modify: `settings.json` (**never staged**)
- Modify: `docs/hooks.md`
- Test: the live check below

- [ ] **Step 1: Wire the five hooks into `settings.json`**

`PreToolUse`: `agent-dispatch.js`, then `agent-guard.js`, after the existing
`git-guard.js` and `mode-guard.js`, plus a separate entry with matcher
`SubagentHandback` running `subagent-gate.js`. `PostToolUse`:
`subagent-trace.js`, plus a separate entry with matcher `SubagentHandback`
running `subagent-gate.js`. `SubagentStart`: `subagent-brief.js`.
`SubagentStop`: `subagent-gate.js`. The gate runner is wired three times on
purpose: it refuses at whichever point the report arrives and takes note of a
delivered hand-back. Use the same `node -e` wrapper every existing entry uses,
which honours `CLAUDE_CONFIG_DIR`.

- [ ] **Step 2: Document all five in `docs/hooks.md`**

Each hook gets what the existing entries get: the event, what it refuses, and
why. Confirm the case count matches what the suite prints.

- [ ] **Step 3: Verify the configuration is whole**

Run: `node tools/ccfg.js test` (expect exit 0)
Run: `node hooks/validate-config.js` (expect ALL CHECKS PASSED)
Run: `node tools/ccfg.js mode` (expect CLEAN, no rules dropped)
Run: `node tools/ccfg.js crew` (expect three roles)

- [ ] **Step 4: The live check, one dispatch**

First render the crew for real: `node tools/ccfg.js mode build` re-applies the
mode in force, which is the check Task 2 Step 10 never ran. On a copy of this
configuration on 2026-09-16 that command also moved `settings.json`
`effortLevel` from `xhigh` to `high`, so say so to the operator before running
it.

Then dispatch one real `investigator` worker at a small question, from a session
in auto mode on a model that supports it (Haiku does not), so the report arrives
through `SubagentHandback` and the runner's hand-back point is the one exercised.
It writes nothing, so it exercises the dispatch hook, the brief hook and the
finish-shape gate without risking a repository. It is also the first run that
loads a crew agent from `~/.claude/agents/`, which no measurement has covered;
if the dispatch reports the agent type as not available, stop and report that.

- [ ] **Step 5: Read the conformance log**

Run: `node tools/ccfg.js conformance`

What this dispatch can reach should read **confirmed**: `updated-input`,
`report-arrives` and `transcript-layout`. An investigator that writes nothing
and finishes cleanly leaves `agent-id` (needs a traced write) and
`handback-retry` (needs a refusal) at **not yet observed**, which is expected
rather than a finding. Anything reading **contradicted** is a finding that
outranks the rest of this plan: the mechanism it names was re-measured on
2.1.273 on 2026-09-16 and has moved. Stop and report it rather than working
around it.

- [ ] **Step 6: Self-review before reporting**

Use `google-code-review` over the whole change. Then report with the split: what
was verified, naming the command, and what was not.

**COMMIT BOUNDARY.** The gates and the wiring land as their own commits. Suggested
subjects: `Gate a worker's finish on its declared scope`, `Read the evidence log
before accepting a finish`, `Wire the subagent hooks into settings`.

---

## Self-review of this plan against the spec

**Spec coverage.** Section 1 (the crew) is Tasks 1 and 2. Section 2 (dispatch,
scope line, run token) is Task 4. Section 3 (the run record) is Task 6. Section 4
(the gates, including the guard the self-review added and the two report points
added on 2026-09-16) is Tasks 5, 8, 9, 10, 11.
Section 5 (strictness from the dials) is carried inside each gate's
`minimumVerify` and the `claims` checks in Task 10, with no separate task,
because a task whose whole deliverable is reading a setting has nothing to
review. Section 6 (the `worker:` field) is Task 3. Section 7 (the conformance
log) is Task 12. Section 8's component table is the file structure above.
Section 9's test list is distributed across the tasks that own each case.
Section 12's build order is this task order, with its phase 4 split into Tasks 5
and 6 because the guard and the trace are separately reviewable.

**One gap, named rather than fixed.** The spec's `investigator` role has no
gates beyond `finish-shape`, so nothing checks that a read-only worker reported
truthfully. That is not an oversight in the plan, it is the spec's position: the
evidence gate reads a log of commands, and a worker that ran no commands leaves
nothing to read. Worth revisiting only if investigators start being wrong.

**Placeholder scan.** No step says "add error handling", "handle edge cases" or
"similar to Task N". Every code step carries the code. Tasks 7, 9, 10, 11 and 12
collapse their red/green/prove-failure steps into one line each, because those
four steps are identical in every task and spelling them out five more times
would bury the part that differs.

**Type consistency.** `parseRole` returns `{id, description, tools, skills,
gates, body}` in Task 1 and is consumed with those names in Task 2.
`renderAgent(role, resolvedSettings, deniedTools, briefBand)` keeps its signature
between Tasks 2 and 3, where `briefBand` changes from the empty string to
`briefBand(corpusRules)`. The gate contract `{id, minimumVerify, check(run)}` is
defined in Task 8 and implemented unchanged in Tasks 9, 10 and 11. The run record
functions `openRun`, `appendPath`, `findRun`, `recordFile` are defined in Task 4
and consumed in Tasks 5, 6 and 8. `appendMark` and `marksFor` are defined in
Task 8 and consumed in Task 12.

**Case counts.** 467 at the start, then 479, 487, 493, 498, 518, 527, 535,
541, 550. Each task sets `docs/hooks.md` to its own number in its own task, because
the validator checks it and it has gone stale twice before.
