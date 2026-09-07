# Mode System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a mode system for this config where switching a mode reorders which rules the model reads first, projects a posture onto `settings.json`, and stays visible at all times -- driven by `ccfg mode`.

**Architecture:** Seven ordinal settings (`verify`, `claims`, `process`, `autonomy`, `code`, `subagents`, `voice`) describe a posture. Ten named modes are points in that space. A rule corpus of atomic markdown files each declare which setting governs them and at which value they become primary. Switching a mode re-sorts the corpus into `rules/_active.md` -- primary band first, everything else below, **nothing ever dropped** -- and projects the mode's `settings.json` keys. A `UserPromptSubmit` hook re-injects the rendered rules every turn, so a switch takes effect without a restart and the primary band lands at the freshest context position on every prompt.

**Tech Stack:** Node (whatever `/opt/homebrew/bin/node` is; currently 26.7.0), zero third-party dependencies, CommonJS. New modules under `tools/modes/`, tests in `tools/test-modes.js` mirroring the assertion style of `tools/test-ccfg.js`.

**Spec:** `docs/superpowers/specs/2026-09-05-mode-system-design-v2.md`

## Global Constraints

- **The corpus lives under `modes/`, never in `rules/`.** The harness auto-loads
  every `~/.claude/rules/*.md` as a global instruction, so a corpus placed there
  would load in full, in fixed order, every session, regardless of mode -- and
  would double against the hook's injection. Found by running Task 5, not by
  reading.
- **`autonomy` is ordered `just-go` -> `check-in` -> `ask-first`**, the same
  direction as every other setting: least of the thing, then most. Ordered the
  other way, `ship` sat at the bottom of the scale and three rules were
  unreachable in every mode.
- **`voice` is categorical, not ordinal.** Its rules use `only_at`, not
  `primary_at`. Under a threshold, `voice: normal` still made the caveman rules
  primary.

- **Zero dependencies.** `ccfg` must run on a machine where nothing is installed. No `npm install`, no YAML library, no argument parser. Node stdlib only.
- **Mode files are JSON, not YAML** -- a deliberate deviation from the spec, which said `.yaml`. Hand-rolling a YAML subset is a new failure surface for no gain, and every other config file here (`settings.json`, `~/.claude.json`) is JSON. Rule frontmatter is a fixed three-key header parsed by regex, not YAML.
- **Never delete a rule.** The renderer sorts; it never filters. `primary.length + standing.length === corpus.length` is an invariant with a test.
- **Core hooks are untouchable.** `git-guard.js` (enforces never-commit / never-push / no `--no-verify`) and `config-sentinel.js` (config drift) are active in every mode. A mode that disables one is refused by `ccfg mode` and flagged by `ccfg doctor`.
- **No new vocabulary.** One word for the concept: **mode**. Setting values are plain English (`prove-it`, `just-go`, `ask-first`). No numeric levels, no coined nouns.
- **No emoji anywhere**, including the banner -- the config's own frontend rule forbids emoji-as-icon and this config publishes to a public repo.
- **Naming is spelled out**: `configuration` not `cfg`, `settings` not `s`, `index` not `i` except as a loop counter. This is measured -- the F6 probe put the violation rate at 0% when this rule is read early and 46% when absent.
- **Every module honours `CLAUDE_CONFIG_DIR`.** Tests run against a temp directory; a suite that edits the operator's real config to prove it can edit config is not a test.
- **No commit steps in this plan.** The operator's working agreement is "Never commit, never push." Each task ends by running the suite; landing the work is theirs.

---

## File Structure

| File                      | Responsibility                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/modes/settings.js` | The seven settings, their ordered values, and ordinal comparison. Pure data plus two functions. No I/O.                                        |
| `tools/modes/rules.js`    | Read the rule corpus off disk: parse a rule's header, load a directory, report a malformed rule by path.                                       |
| `tools/modes/render.js`   | Sort a corpus against resolved settings into the primary and standing bands, and serialise `rules/_active.md`.                                 |
| `tools/modes/modes.js`    | Load mode files, apply layer precedence (core -> personal -> repo -> ad-hoc), validate against the settings vocabulary and the core-hook list. |
| `tools/modes/apply.js`    | The only module that writes: project a resolved mode onto `settings.json`, write `mode.lock`, back up, revert.                                 |
| `tools/modes/banner.js`   | Render the switch diff, styled or `--plain`. Pure string building.                                                                             |
| `tools/modes/command.js`  | `ccfg mode <subcommand>` dispatch and output.                                                                                                  |
| `tools/test-modes.js`     | Regression suite for all of the above.                                                                                                         |
| `hooks/mode-inject.js`    | `UserPromptSubmit`: inject the rendered rules and name the active mode.                                                                        |
| `hooks/mode-status.js`    | `statusLine`: print the active mode, then delegate to the existing status line.                                                                |
| `hooks/mode-guard.js`     | `PreToolUse`: deny a subagent write to `modes/`, `rules/`, or `settings.json`.                                                                 |
| `rules/<id>.md`           | One rule, with a three-key header. Corpus.                                                                                                     |
| `modes/<name>.json`       | One mode. Ten of them.                                                                                                                         |
| `rules/_active.md`        | Generated. Never hand-edited.                                                                                                                  |
| `mode.lock`               | Generated. Active mode, resolved settings, backup reference.                                                                                   |

`settings.js` has no I/O so it can be required from a hook without touching disk. `apply.js` is the only writer, so "what can change my `settings.json`" has one answer.

---

### Task 1: Settings vocabulary

**Files:**

- Create: `tools/modes/settings.js`
- Test: `tools/test-modes.js`

**Interfaces:**

- Consumes: nothing.
- Produces: `SETTINGS` (object: name -> `{values: string[], question: string}`), `atOrAbove(setting, actual, threshold) -> boolean`, `isValid(setting, value) -> boolean`, `DEFAULTS` (object: name -> value).

- [ ] **Step 1: Write the failing test**

Create `tools/test-modes.js`:

```js
"use strict";

// Regression suite for the mode system.
//
// Everything here runs against a temp config directory. The renderer's
// never-drop invariant is the load-bearing test: a mode that silently omitted a
// rule would be a guardrail disabled with no signal, which is the failure this
// design exists to prevent.
//
// Usage: node ~/.claude/tools/test-modes.js

const fs = require("fs");
const os = require("os");
const path = require("path");

const SANDBOX_CONFIG = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-modes-"));
process.env.CLAUDE_CONFIG_DIR = SANDBOX_CONFIG;

const settings = require("./modes/settings.js");

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  if (actual === expected) {
    passed += 1;
    console.log(`[PASS] ${label}`);
    return;
  }
  failed += 1;
  console.log(`[FAIL] ${label}`);
  console.log(`       expected: ${JSON.stringify(expected)}`);
  console.log(`       actual:   ${JSON.stringify(actual)}`);
}

check(
  "the vocabulary has exactly seven settings",
  Object.keys(settings.SETTINGS).length,
  7,
);

check(
  "verify runs none, run-it, prove-it",
  settings.SETTINGS.verify.values.join(","),
  "none,run-it,prove-it",
);

check(
  "a value at the threshold counts as at or above it",
  settings.atOrAbove("verify", "run-it", "run-it"),
  true,
);

check(
  "a value past the threshold counts as at or above it",
  settings.atOrAbove("verify", "prove-it", "run-it"),
  true,
);

check(
  "a value below the threshold does not",
  settings.atOrAbove("verify", "none", "run-it"),
  false,
);

check(
  "an unknown value is rejected rather than ranked",
  settings.isValid("verify", "maybe"),
  false,
);

check(
  "an unknown setting name is rejected",
  settings.isValid("vibes", "none"),
  false,
);

check(
  "every setting has a default drawn from its own values",
  Object.entries(settings.DEFAULTS).every(([name, value]) =>
    settings.isValid(name, value),
  ),
  true,
);

console.log(`\nPASS ${passed}  FAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node ~/.claude/tools/test-modes.js`
Expected: FAIL -- `Cannot find module './modes/settings.js'`

- [ ] **Step 3: Write the implementation**

Create `tools/modes/settings.js`:

```js
"use strict";

// The seven questions a mode answers, and the answers each one allows.
//
// Values are ordered, least to most, because a rule declares the point at which
// it becomes primary rather than a set of modes it belongs to. Ordering is what
// lets a new rule slot in without editing ten mode files.
//
// The words are the interface. No numeric levels: "prove-it" says what it means
// at a glance and "3" does not.

const SETTINGS = {
  verify: {
    question: "How much proof before I say it works?",
    values: ["none", "run-it", "prove-it"],
  },
  claims: {
    question: "How do I label what I claim?",
    values: ["loose", "labeled", "sourced"],
  },
  process: {
    question: "How many gates before code?",
    values: ["skip", "light", "full"],
  },
  autonomy: {
    question: "How far do I go before asking?",
    values: ["ask-first", "check-in", "just-go"],
  },
  code: {
    question: "How good does the code have to be?",
    values: ["rough", "decent", "polished"],
  },
  subagents: {
    question: "How many subagents?",
    values: ["none", "few", "many"],
  },
  voice: {
    question: "How do I talk?",
    values: ["caveman", "normal", "prose"],
  },
};

// The posture in force when no mode is loaded. Deliberately the middle of every
// dial: a config with no mode selected should behave like the config did before
// modes existed, not like the most permissive mode.
const DEFAULTS = {
  verify: "run-it",
  claims: "labeled",
  process: "light",
  autonomy: "check-in",
  code: "decent",
  subagents: "few",
  voice: "caveman",
};

function isValid(setting, value) {
  const known = SETTINGS[setting];
  return known !== undefined && known.values.includes(value);
}

/**
 * True when `actual` sits at or past `threshold` on the setting's own scale.
 *
 * Returns false for anything unrecognised rather than throwing: a malformed
 * rule should fail to reach the primary band, never take down the renderer and
 * leave the model with no rules at all.
 */
function atOrAbove(setting, actual, threshold) {
  if (!isValid(setting, actual) || !isValid(setting, threshold)) return false;
  const scale = SETTINGS[setting].values;
  return scale.indexOf(actual) >= scale.indexOf(threshold);
}

module.exports = { SETTINGS, DEFAULTS, isValid, atOrAbove };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ~/.claude/tools/test-modes.js`
Expected: `PASS 8  FAIL 0`

---

### Task 2: Rule corpus loader

**Files:**

- Create: `tools/modes/rules.js`
- Modify: `tools/test-modes.js`

**Interfaces:**

- Consumes: `settings.isValid` from Task 1.
- Produces: `parseRule(text, sourcePath) -> {id, setting, primary_at, body} | {error: string}`, `loadCorpus(directory) -> {rules: Rule[], errors: string[]}`. A `Rule` is `{id, setting, primary_at, body, file}`.

- [ ] **Step 1: Write the failing test**

Insert before the final `console.log` in `tools/test-modes.js`:

```js
const rules = require("./modes/rules.js");

const WELL_FORMED = `---
id: claims-measured-vs-assumed
setting: claims
primary_at: labeled
---

A claim is worth exactly what produced it. Say measured or assumed.
`;

const parsed = rules.parseRule(WELL_FORMED, "corpus/claims.md");
check(
  "a well-formed rule yields its id",
  parsed.id,
  "claims-measured-vs-assumed",
);
check("a well-formed rule yields its setting", parsed.setting, "claims");
check("a well-formed rule yields its threshold", parsed.primary_at, "labeled");
check(
  "the body excludes the header and is trimmed",
  parsed.body,
  "A claim is worth exactly what produced it. Say measured or assumed.",
);

check(
  "a rule with no header is refused by path",
  rules.parseRule("just prose", "corpus/bare.md").error,
  "corpus/bare.md: no --- header",
);

const BAD_SETTING = `---
id: x
setting: vibes
primary_at: high
---
body
`;
check(
  "a rule naming an unknown setting is refused",
  rules.parseRule(BAD_SETTING, "corpus/x.md").error,
  "corpus/x.md: unknown setting 'vibes'",
);

const BAD_THRESHOLD = `---
id: x
setting: verify
primary_at: sometimes
---
body
`;
check(
  "a rule naming a threshold outside its setting's scale is refused",
  rules.parseRule(BAD_THRESHOLD, "corpus/x.md").error,
  "corpus/x.md: 'sometimes' is not a value of verify",
);

const corpusDirectory = path.join(SANDBOX_CONFIG, "rules");
fs.mkdirSync(corpusDirectory, { recursive: true });
fs.writeFileSync(path.join(corpusDirectory, "claims.md"), WELL_FORMED);
fs.writeFileSync(path.join(corpusDirectory, "broken.md"), "no header here");
fs.writeFileSync(path.join(corpusDirectory, "_active.md"), WELL_FORMED);
fs.writeFileSync(path.join(corpusDirectory, "notes.txt"), WELL_FORMED);

const loaded = rules.loadCorpus(corpusDirectory);
check("a valid rule is loaded", loaded.rules.length, 1);
check("a malformed rule is reported, not thrown", loaded.errors.length, 1);
check(
  "the generated _active.md is not read back in as a rule",
  loaded.rules.some((rule) => rule.file.endsWith("_active.md")),
  false,
);
check(
  "a non-markdown file is ignored entirely",
  loaded.errors.some((message) => message.includes("notes.txt")),
  false,
);
```

The exact-string assertions call `parseRule` directly, because `loadCorpus` reports the full sandbox path. Only the error _count_ is asserted for `loadCorpus`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node ~/.claude/tools/test-modes.js`
Expected: FAIL -- `Cannot find module './modes/rules.js'`

- [ ] **Step 3: Write the implementation**

Create `tools/modes/rules.js`:

```js
"use strict";

// The rule corpus: one rule per file, each declaring which setting governs it
// and the value at which it becomes primary.
//
// The header is three fixed keys read by regex, not YAML. ccfg has no
// dependencies by design, and a hand-rolled YAML subset is a parser to maintain
// in exchange for syntax nobody asked for.
//
// A malformed rule is collected as an error and skipped, never thrown. The
// renderer runs on every prompt; one bad file must not leave the model with no
// rules at all.

const fs = require("fs");
const path = require("path");

const settings = require("./settings.js");

const HEADER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function headerField(header, key) {
  const found = new RegExp(`^${key}:[ \\t]*(.+)$`, "m").exec(header);
  return found === null ? null : found[1].trim();
}

function parseRule(text, sourcePath) {
  const matched = HEADER.exec(text);
  if (matched === null) return { error: `${sourcePath}: no --- header` };

  const header = matched[1];
  const id = headerField(header, "id");
  const setting = headerField(header, "setting");
  const threshold = headerField(header, "primary_at");

  if (id === null) return { error: `${sourcePath}: no id` };
  if (setting === null) return { error: `${sourcePath}: no setting` };
  if (threshold === null) return { error: `${sourcePath}: no primary_at` };
  if (settings.SETTINGS[setting] === undefined)
    return { error: `${sourcePath}: unknown setting '${setting}'` };
  if (!settings.isValid(setting, threshold))
    return {
      error: `${sourcePath}: '${threshold}' is not a value of ${setting}`,
    };

  return {
    id,
    setting,
    primary_at: threshold,
    body: text.slice(matched[0].length).trim(),
  };
}

/**
 * Every rule in a directory, plus the reasons any file was skipped.
 *
 * `_active.md` is excluded by name because it is this system's own output.
 * Reading it back in would duplicate the entire corpus on the second render.
 */
function loadCorpus(directory) {
  const rules = [];
  const errors = [];

  let entries;
  try {
    entries = fs.readdirSync(directory).sort();
  } catch {
    return { rules, errors };
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    if (entry === "_active.md") continue;
    const file = path.join(directory, entry);
    const parsed = parseRule(fs.readFileSync(file, "utf8"), file);
    if (parsed.error !== undefined) {
      errors.push(parsed.error);
      continue;
    }
    rules.push({ ...parsed, file });
  }

  return { rules, errors };
}

module.exports = { parseRule, loadCorpus };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ~/.claude/tools/test-modes.js`
Expected: `PASS 18  FAIL 0`

---

### Task 3: Renderer -- sorts, never filters

**Files:**

- Create: `tools/modes/render.js`
- Modify: `tools/test-modes.js`

**Interfaces:**

- Consumes: `settings.atOrAbove` (Task 1), the `Rule` shape (Task 2).
- Produces: `band(corpusRules, resolvedSettings) -> {primary: Rule[], standing: Rule[]}`, `renderActive(corpusRules, resolvedSettings, modeName) -> string`.

- [ ] **Step 1: Write the failing test**

Insert before the final `console.log` in `tools/test-modes.js`:

```js
const render = require("./modes/render.js");

const CORPUS = [
  {
    id: "prove",
    setting: "verify",
    primary_at: "prove-it",
    body: "Prove it.",
    file: "a.md",
  },
  {
    id: "run",
    setting: "verify",
    primary_at: "run-it",
    body: "Run it.",
    file: "b.md",
  },
  {
    id: "loose",
    setting: "claims",
    primary_at: "loose",
    body: "Say things.",
    file: "c.md",
  },
];

const strict = render.band(CORPUS, { verify: "prove-it", claims: "loose" });
check("a rule at its threshold is primary", strict.primary.length, 3);
check(
  "nothing is standing when every threshold is met",
  strict.standing.length,
  0,
);

const relaxed = render.band(CORPUS, { verify: "none", claims: "loose" });
check(
  "a rule above the active value drops to standing",
  relaxed.primary.length,
  1,
);
check("the standing band holds the rest", relaxed.standing.length, 2);

check(
  "no rule is ever dropped, whatever the posture",
  relaxed.primary.length + relaxed.standing.length,
  CORPUS.length,
);

check(
  "a rule naming a setting the mode never resolved still survives, as standing",
  (() => {
    const orphan = render.band(CORPUS, {});
    return orphan.primary.length + orphan.standing.length;
  })(),
  CORPUS.length,
);

const rendered = render.renderActive(
  CORPUS,
  { verify: "none", claims: "loose" },
  "spike",
);
check(
  "the rendered file names the active mode",
  rendered.includes("mode: spike"),
  true,
);
check(
  "the rendered file carries every rule body",
  CORPUS.every((rule) => rendered.includes(rule.body)),
  true,
);
check(
  "the primary band is rendered above the standing band",
  rendered.indexOf("Say things.") < rendered.indexOf("Run it."),
  true,
);
check(
  "the file warns against hand-editing",
  rendered.includes("Generated by `ccfg mode`"),
  true,
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node ~/.claude/tools/test-modes.js`
Expected: FAIL -- `Cannot find module './modes/render.js'`

- [ ] **Step 3: Write the implementation**

Create `tools/modes/render.js`:

```js
"use strict";

// Ordering, not selection.
//
// 1,218 measured trials say position governs adherence and length does not: the
// same rule hoisted to the top of a 211-line prompt beat the same rule buried at
// line 145 by 26 percentage points, and matched a 22-line prompt containing
// nothing else. Burial was worse than absence for at least one rule.
//
// So a mode re-sorts the corpus and never removes from it. Nothing is dropped,
// which means a mode cannot quietly disable a guardrail -- the failure that
// would make this whole system a liability.

const settings = require("./settings.js");

/**
 * Split the corpus into the band the active posture makes primary and the rest.
 *
 * A rule whose setting the mode never resolved falls to standing rather than
 * disappearing, so an unrecognised setting name costs position and not the rule.
 */
function band(corpusRules, resolvedSettings) {
  const primary = [];
  const standing = [];

  for (const rule of corpusRules) {
    const active = resolvedSettings[rule.setting];
    const isPrimary =
      active !== undefined &&
      settings.atOrAbove(rule.setting, active, rule.primary_at);
    if (isPrimary) primary.push(rule);
    else standing.push(rule);
  }

  return { primary, standing };
}

function section(title, bandRules) {
  if (bandRules.length === 0) return "";
  return `## ${title}\n\n${bandRules.map((rule) => rule.body).join("\n\n")}\n\n`;
}

function renderActive(corpusRules, resolvedSettings, modeName) {
  const { primary, standing } = band(corpusRules, resolvedSettings);
  const posture = Object.entries(resolvedSettings)
    .map(([name, value]) => `${name}: ${value}`)
    .join(", ");

  const document =
    "<!-- Generated by `ccfg mode`. Edit the rules in rules/, not this file. -->\n" +
    `<!-- mode: ${modeName} -- ${posture} -->\n\n` +
    section("Rules for this mode", primary) +
    section("Standing rules", standing);

  return document.trimEnd() + "\n";
}

module.exports = { band, renderActive };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ~/.claude/tools/test-modes.js`
Expected: `PASS 29  FAIL 0`

- [ ] **Step 5: Confirm the never-drop test can actually fail**

Temporarily change `else standing.push(rule);` to `else if (rule.setting !== "verify") standing.push(rule);`. Run the suite. Expected: the never-drop checks FAIL. Restore the line and re-run to green. A test that has never been seen red is unproven, and this is the invariant the whole design rests on.

---

### Task 4: Mode files and layer resolution

**Files:**

- Create: `tools/modes/modes.js`
- Modify: `tools/test-modes.js`

**Interfaces:**

- Consumes: `settings.isValid`, `settings.DEFAULTS` (Task 1).
- Produces: `CORE_HOOKS` (string[]), `LAYER_ORDER` (string[]), `parseMode(value, sourcePath) -> Mode | {error}`, `resolve({personal, repo, adhoc}) -> {settings, name, layers}`, `coreHookViolation(mode) -> string | null`. A `Mode` is `{name, settings, projects, disableHooks}`.

- [ ] **Step 1: Write the failing test**

Insert before the final `console.log` in `tools/test-modes.js`:

```js
const modes = require("./modes/modes.js");

const SPIKE = {
  name: "spike",
  settings: { verify: "none", process: "skip", voice: "caveman" },
  projects: { model: "claude-opus-5", effortLevel: "low" },
  disableHooks: ["review-reminder.js"],
};

check(
  "a valid mode parses",
  modes.parseMode(SPIKE, "spike.json").name,
  "spike",
);

check(
  "a mode setting outside the vocabulary is refused",
  modes.parseMode(
    { name: "bad", settings: { verify: "eventually" } },
    "bad.json",
  ).error,
  "bad.json: 'eventually' is not a value of verify",
);

check(
  "a mode naming a setting that does not exist is refused",
  modes.parseMode({ name: "bad", settings: { vibes: "high" } }, "bad.json")
    .error,
  "bad.json: unknown setting 'vibes'",
);

check(
  "git-guard is a core hook",
  modes.CORE_HOOKS.includes("git-guard.js"),
  true,
);

check(
  "a mode disabling a core hook is named as the violation",
  modes.coreHookViolation({ name: "reckless", disableHooks: ["git-guard.js"] }),
  "git-guard.js",
);

check(
  "a mode disabling a non-core hook is allowed",
  modes.coreHookViolation(SPIKE),
  null,
);

const unset = modes.resolve({ personal: null, repo: null, adhoc: {} });
check(
  "with no mode loaded every setting falls back to its default",
  unset.settings.verify,
  settings.DEFAULTS.verify,
);
check("with no mode loaded the name says so", unset.name, "(none)");

const layered = modes.resolve({
  personal: modes.parseMode(SPIKE, "spike.json"),
  repo: { name: "spike", settings: { verify: "prove-it" } },
  adhoc: { voice: "prose" },
});
check(
  "a repo mode overrides the personal mode of the same name",
  layered.settings.verify,
  "prove-it",
);
check("an ad-hoc override beats both", layered.settings.voice, "prose");
check(
  "a setting neither layer touched keeps the personal value",
  layered.settings.process,
  "skip",
);
check(
  "a setting no layer touched keeps the default",
  layered.settings.code,
  settings.DEFAULTS.code,
);
check("the resolved name is the mode's", layered.name, "spike");
check(
  "the layers that contributed are reported, in precedence order",
  layered.layers.join(","),
  "personal,repo,adhoc",
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node ~/.claude/tools/test-modes.js`
Expected: FAIL -- `Cannot find module './modes/modes.js'`

- [ ] **Step 3: Write the implementation**

Create `tools/modes/modes.js`:

```js
"use strict";

// Modes, and the order in which layers win.
//
// Documented precedence rather than whatever falls out of file order: a posture
// that changes depending on which directory you launched from, with no way to
// ask why, is the mode-error failure this design is trying to avoid.
//
// Modes are JSON, though the design doc said YAML. ccfg has no dependencies on
// purpose, and hand-rolling a YAML subset buys syntax at the cost of a parser to
// maintain. Every other config file here is already JSON.

const settings = require("./settings.js");

// Hooks that belong to no mode and that no mode may switch off. git-guard is
// what enforces never-commit, never-push and no --no-verify; config-sentinel is
// what notices the config drifting out from under itself. A mode is a posture,
// not a permission to remove a safety rail -- so this list is checked before a
// switch, not after.
const CORE_HOOKS = ["git-guard.js", "config-sentinel.js"];

// Precedence, least to most. Later layers win.
const LAYER_ORDER = ["personal", "repo", "adhoc"];

function parseMode(value, sourcePath) {
  if (value === null || typeof value !== "object")
    return { error: `${sourcePath}: not an object` };
  if (typeof value.name !== "string" || value.name === "")
    return { error: `${sourcePath}: no name` };

  const declared = value.settings || {};
  for (const [setting, chosen] of Object.entries(declared)) {
    if (settings.SETTINGS[setting] === undefined)
      return { error: `${sourcePath}: unknown setting '${setting}'` };
    if (!settings.isValid(setting, chosen))
      return {
        error: `${sourcePath}: '${chosen}' is not a value of ${setting}`,
      };
  }

  return {
    name: value.name,
    settings: declared,
    projects: value.projects || {},
    disableHooks: value.disableHooks || [],
  };
}

/** The first core hook a mode tries to disable, or null when it disables none. */
function coreHookViolation(mode) {
  for (const hook of mode.disableHooks || []) {
    if (CORE_HOOKS.includes(hook)) return hook;
  }
  return null;
}

function resolve({ personal, repo, adhoc }) {
  const sources = { personal, repo, adhoc };
  const resolved = { ...settings.DEFAULTS };
  const layers = [];
  let name = "(none)";

  for (const layer of LAYER_ORDER) {
    const source = sources[layer];
    if (!source) continue;
    const declared = layer === "adhoc" ? source : source.settings || {};
    if (Object.keys(declared).length === 0) continue;
    Object.assign(resolved, declared);
    if (layer !== "adhoc" && source.name) name = source.name;
    layers.push(layer);
  }

  return { settings: resolved, name, layers };
}

module.exports = {
  CORE_HOOKS,
  LAYER_ORDER,
  parseMode,
  coreHookViolation,
  resolve,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ~/.claude/tools/test-modes.js`
Expected: `PASS 43  FAIL 0`

---

### Task 5: Author the corpus and the ten modes

**Files:**

- Create: `rules/*.md` (one per rule, extracted from `CLAUDE.md`)
- Create: `modes/spike.json`, `build.json`, `ship.json`, `paper.json`, `research.json`, `review.json`, `debug.json`, `design.json`, `unattended.json`, `pair.json`
- Modify: `tools/test-modes.js`

**Interfaces:**

- Consumes: the rule header format (Task 2), the mode file shape (Task 4).
- Produces: a corpus on disk and ten mode files, both loadable by the modules above.

- [ ] **Step 1: Write the failing test**

Insert before the final `console.log` in `tools/test-modes.js`:

```js
const REAL_CONFIG = path.join(os.homedir(), ".claude");
const realCorpus = rules.loadCorpus(path.join(REAL_CONFIG, "rules"));

check(
  "the real corpus loads with no malformed rules",
  realCorpus.errors.length,
  0,
);
check("the real corpus is not empty", realCorpus.rules.length > 0, true);

check(
  "every rule id is unique",
  new Set(realCorpus.rules.map((rule) => rule.id)).size,
  realCorpus.rules.length,
);

const MODE_NAMES = [
  "spike",
  "build",
  "ship",
  "paper",
  "research",
  "review",
  "debug",
  "design",
  "unattended",
  "pair",
];

const realModes = MODE_NAMES.map((name) =>
  modes.parseMode(
    JSON.parse(
      fs.readFileSync(path.join(REAL_CONFIG, "modes", `${name}.json`), "utf8"),
    ),
    `${name}.json`,
  ),
);

check(
  "all ten modes parse",
  realModes.filter((mode) => mode.error === undefined).length,
  10,
);

check(
  "every mode answers all seven settings",
  realModes.every((mode) => Object.keys(mode.settings).length === 7),
  true,
);

check(
  "no mode disables a core hook",
  realModes.every((mode) => modes.coreHookViolation(mode) === null),
  true,
);

check(
  "every mode's file name matches its declared name",
  MODE_NAMES.every((name, index) => realModes[index].name === name),
  true,
);

check(
  "no two modes are the same posture",
  new Set(realModes.map((mode) => JSON.stringify(mode.settings))).size,
  10,
);

check(
  "under ship every rule in the corpus is primary",
  (() => {
    const ship = realModes[MODE_NAMES.indexOf("ship")];
    return render.band(realCorpus.rules, {
      ...settings.DEFAULTS,
      ...ship.settings,
    }).standing.length;
  })(),
  0,
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node ~/.claude/tools/test-modes.js`
Expected: FAIL -- `ENOENT` on `~/.claude/modes/spike.json`, and the corpus is empty.

- [ ] **Step 3: Extract the corpus**

Split `CLAUDE.md`'s rule text into `~/.claude/rules/*.md`, one rule per file, each with the three-key header. Copy the text **verbatim** -- this task moves rules, it does not rewrite them.

Assign the ids, settings and thresholds exactly as follows. Nothing else goes in the corpus; universal rules (communication, explaining, code style, security, data access) stay in `CLAUDE.md`, because a mode must never be able to demote them.

| file                                    | setting   | primary_at | source in CLAUDE.md                                         |
| --------------------------------------- | --------- | ---------- | ----------------------------------------------------------- |
| `verify-ran-it.md`                      | verify    | run-it     | "Verify. Run it. Typecheck, lint, tests, build"             |
| `verify-not-delegable.md`               | verify    | run-it     | "Verification is not optional and not delegable."           |
| `verify-evidence-before-assertions.md`  | verify    | prove-it   | "Evidence before assertions, always"                        |
| `verify-test-can-fail.md`               | verify    | prove-it   | "Confirm a test can fail."                                  |
| `claims-measured-vs-assumed.md`         | claims    | labeled    | "Measured / Assumed", both bullets                          |
| `claims-end-with-the-split.md`          | claims    | labeled    | "End with the split."                                       |
| `claims-measure-before-ordering.md`     | claims    | sourced    | "Measure before ordering the work."                         |
| `claims-checkpoint-phases.md`           | claims    | sourced    | "Checkpoint multi-phase work."                              |
| `process-skills-first.md`               | process   | light      | "Skills are part of the process, not a fallback."           |
| `process-brainstorm-before-code.md`     | process   | full       | "Anything new or creative -- brainstorming before code"     |
| `process-written-plan.md`               | process   | full       | "Multi-step work gets a written plan"                       |
| `process-tdd.md`                        | process   | full       | "Tests first where the behavior is specifiable"             |
| `process-self-review.md`                | process   | full       | "google-code-review as a self-review pass"                  |
| `autonomy-touch-only-what-was-named.md` | autonomy  | ask-first  | "Touch only what was named."                                |
| `autonomy-ask-standalone-questions.md`  | autonomy  | check-in   | "Ask questions that stand on their own"                     |
| `autonomy-revert-when-worse.md`         | autonomy  | check-in   | "When a change makes things worse, revert"                  |
| `autonomy-dont-guess.md`                | autonomy  | check-in   | "Don't guess."                                              |
| `code-tests-ship-together.md`           | code      | decent     | "Logic ships with its tests in the same commit."            |
| `code-test-behaviors.md`                | code      | decent     | "Test behaviors, not methods"                               |
| `code-mocks-last-resort.md`             | code      | polished   | "Prefer the real implementation, then a fake, then a stub." |
| `code-commit-granularity.md`            | code      | polished   | "One commit is one self-contained change"                   |
| `subagents-delegate-sparingly.md`       | subagents | none       | "Delegate to a subagent only for large... work"             |
| `subagents-never-self-verify.md`        | subagents | none       | "Never use subagents to verify your own work."              |
| `voice-caveman.md`                      | voice     | caveman    | the Communication section's caveman paragraph               |
| `voice-lead-with-outcome.md`            | voice     | caveman    | "Before the first tool call... lead with the outcome."      |

The two `subagents` rules sit at `primary_at: none` on purpose. The scale reads "how many subagents", so `none` is its low end, and the rules that hold the line against spawning belong exactly there -- restraint matters most in the mode that says not to spawn any.

Each file follows this shape:

```markdown
---
id: claims-measured-vs-assumed
setting: claims
primary_at: labeled
---

A claim about performance, runtime behaviour, or what code does is worth exactly
what produced it. Two states, never a blur between them:

- **Measured** -- a command ran and its output is in this conversation. Name the command.
- **Assumed** -- read from code, inferred, or remembered. Say "assumed", and say what would settle it.
```

- [ ] **Step 4: Write the ten mode files**

`~/.claude/modes/spike.json`:

```json
{
  "name": "spike",
  "description": "Find out whether it works. Nothing here is kept.",
  "settings": {
    "verify": "none",
    "claims": "labeled",
    "process": "skip",
    "autonomy": "just-go",
    "code": "rough",
    "subagents": "none",
    "voice": "caveman"
  },
  "projects": { "model": "claude-opus-5", "effortLevel": "low" },
  "disableHooks": ["review-reminder.js", "style-check.js"]
}
```

`~/.claude/modes/ship.json`:

```json
{
  "name": "ship",
  "description": "It lands. Every gate, every claim sourced.",
  "settings": {
    "verify": "prove-it",
    "claims": "sourced",
    "process": "full",
    "autonomy": "ask-first",
    "code": "polished",
    "subagents": "few",
    "voice": "normal"
  },
  "projects": { "model": "claude-opus-5", "effortLevel": "high" },
  "disableHooks": []
}
```

Write the remaining eight the same way, taking each row verbatim from the spec's table and giving each a one-line `description`:

| name         | verify   | claims  | process | autonomy  | code     | subagents | voice   | effortLevel |
| ------------ | -------- | ------- | ------- | --------- | -------- | --------- | ------- | ----------- |
| `build`      | run-it   | labeled | light   | check-in  | polished | few       | caveman | high        |
| `paper`      | run-it   | sourced | full    | ask-first | rough    | few       | prose   | high        |
| `research`   | run-it   | sourced | light   | check-in  | rough    | many      | caveman | high        |
| `review`     | prove-it | sourced | skip    | ask-first | polished | none      | normal  | high        |
| `debug`      | prove-it | labeled | light   | check-in  | decent   | none      | caveman | high        |
| `design`     | none     | loose   | light   | check-in  | decent   | none      | caveman | medium      |
| `unattended` | prove-it | sourced | full    | just-go   | polished | few       | prose   | high        |
| `pair`       | run-it   | labeled | skip    | ask-first | decent   | none      | caveman | medium      |

`review` additionally projects a permission denial, since a review that edits the code is not a review:

```json
"projects": {
  "model": "claude-opus-5",
  "effortLevel": "high",
  "permissions": { "deny": ["Edit", "Write", "NotebookEdit"] }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node ~/.claude/tools/test-modes.js`
Expected: `PASS 53  FAIL 0`

If "under ship every rule is primary" fails, a rule's `primary_at` sits above the value `ship` sets for its setting. Lower the threshold or move the rule to a different setting -- do not weaken the assertion. `ship` is the maximum posture, so a rule it cannot reach is a rule no mode can reach.

---

### Task 6: `ccfg mode` -- show, list, diff

**Files:**

- Create: `tools/modes/command.js`
- Modify: `tools/ccfg.js` (`COMMANDS` table at :1332, `commandHelp()` at :1354)
- Modify: `tools/test-modes.js`

**Interfaces:**

- Consumes: everything from Tasks 1-5.
- Produces: `commandMode(argv, IO)`, and `activeMode(configDir) -> {name, settings, layers}` read from `mode.lock` or the defaults when no lock exists.

- [ ] **Step 1: Write the failing test**

Insert before the final `console.log` in `tools/test-modes.js`:

```js
const { spawnSync } = require("child_process");
const CCFG = path.join(__dirname, "ccfg.js");

function runCcfg(args) {
  return spawnSync(process.execPath, [CCFG, ...args], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: REAL_CONFIG, NO_COLOR: "1" },
  });
}

const listed = runCcfg(["mode", "list"]);
check("mode list exits clean", listed.status, 0);
check(
  "mode list names every mode",
  MODE_NAMES.every((name) => listed.stdout.includes(name)),
  true,
);

const shown = runCcfg(["mode"]);
check("bare mode shows the posture without switching", shown.status, 0);
check(
  "bare mode prints all seven settings",
  Object.keys(settings.SETTINGS).every((name) => shown.stdout.includes(name)),
  true,
);

const diffed = runCcfg(["mode", "diff", "spike", "ship"]);
check("mode diff exits clean", diffed.status, 0);
check(
  "mode diff shows a changed setting as an arrow",
  /verify\s+none\s*->\s*prove-it/.test(diffed.stdout),
  true,
);

const unknown = runCcfg(["mode", "nonexistent"]);
check("an unknown mode exits non-zero", unknown.status !== 0, true);
check(
  "an unknown mode says so on stderr",
  unknown.stderr.includes("nonexistent"),
  true,
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node ~/.claude/tools/test-modes.js`
Expected: FAIL -- `mode list exits clean` gets `2`, because `mode` is not in `COMMANDS`.

- [ ] **Step 3: Write the implementation**

Create `tools/modes/command.js` exporting `commandMode(argv, IO)`, dispatching on the first argument:

- no argument, or `show` -- print the active posture: the mode name, all seven settings with their values, the rule band counts, and any ad-hoc overrides on their own line.
- `list` -- every file in `modes/` with its `description`.
- `diff a b` -- the two postures side by side. For this task print a plain two-column table; Task 7 replaces it with the banner.
- a name matching a mode file -- a switch. For this task, exit 2 with `not yet implemented`; Task 8 fills it in.
- anything else -- exit 2 with `unknown mode: <name>` on stderr.

Read modes from `path.join(configDir, "modes")` and the active posture from `mode.lock`, falling back to `settings.DEFAULTS` under the name `(none)`.

- [ ] **Step 4: Wire it into ccfg**

In `tools/ccfg.js`, add to the `COMMANDS` table:

```js
  mode: (argv) => require("./modes/command.js").commandMode(argv, IO),
```

and to `commandHelp()`, directly under the `doctor` line:

```
  ${bold("mode")}                show the active mode and its seven settings
  ${bold("mode")} NAME           switch to a mode (list | diff A B | set k=v)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node ~/.claude/tools/test-modes.js`
Expected: `PASS 61  FAIL 0`

- [ ] **Step 6: Confirm ccfg still works end to end**

Run: `ccfg --help && ccfg mode list && node ~/.claude/tools/test-ccfg.js`
Expected: help lists `mode`, the ten modes print, and the existing suite is still green. A new command that broke the old suite is a regression, not a feature.

---

### Task 7: The switch banner

**Files:**

- Create: `tools/modes/banner.js`
- Modify: `tools/modes/command.js` (use it for `diff`)
- Modify: `tools/test-modes.js`

**Interfaces:**

- Consumes: `SETTINGS` (Task 1).
- Produces: `renderBanner({from, to, fromSettings, toSettings, ruleCounts, hooks, projects, plain}) -> string`.

- [ ] **Step 1: Write the failing test**

Insert before the final `console.log` in `tools/test-modes.js`:

```js
const banner = require("./modes/banner.js");

const SWITCH = {
  from: "build",
  to: "spike",
  fromSettings: {
    verify: "run-it",
    claims: "labeled",
    process: "light",
    autonomy: "check-in",
    code: "polished",
    subagents: "few",
    voice: "caveman",
  },
  toSettings: {
    verify: "none",
    claims: "labeled",
    process: "skip",
    autonomy: "just-go",
    code: "rough",
    subagents: "none",
    voice: "caveman",
  },
  ruleCounts: { primary: 9, standing: 16 },
  hooks: {
    core: ["git-guard.js", "config-sentinel.js"],
    disabled: ["review-reminder.js"],
  },
  projects: { model: "claude-opus-5", effortLevel: "low" },
  plain: true,
};

const drawn = banner.renderBanner(SWITCH);

check(
  "a changed setting renders with an arrow",
  /verify\s+run-it -> none/.test(drawn),
  true,
);
check(
  "an unchanged setting renders without an arrow",
  /claims\s+labeled\s*$/m.test(drawn),
  true,
);
check(
  "the banner states nothing was dropped",
  drawn.includes("none dropped"),
  true,
);
check(
  "the banner counts both bands",
  /9 primary, 16 standing/.test(drawn),
  true,
);
check(
  "the banner names the core hooks that stay on",
  drawn.includes("git-guard"),
  true,
);
check(
  "the banner names the hook this mode turns off",
  drawn.includes("review-reminder"),
  true,
);
check("plain output carries no escape codes", /\u001b\[/.test(drawn), false);
check("the banner is stable across calls", banner.renderBanner(SWITCH), drawn);
check(
  "no emoji in the banner",
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(drawn),
  false,
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node ~/.claude/tools/test-modes.js`
Expected: FAIL -- `Cannot find module './modes/banner.js'`

- [ ] **Step 3: Write the implementation**

Create `tools/modes/banner.js` rendering the layout below. The banner is a diff, so the flavour and the information are the same object: a row that did not change renders with no arrow, and the eye goes straight to the ones that did. ASCII box drawing only, ANSI colour when `plain` is false, no emoji.

```
+- BREACH PROTOCOL --------------------------------+
|  CARTRIDGE SWAP                                  |
+--------------------------------------------------+

     build -------------> SPIKE

     verify         run-it -> none
     claims                  labeled
     process         light -> skip
     autonomy     check-in -> just-go
     code         polished -> rough
     subagents         few -> none
     voice                   caveman

     rules    9 primary, 16 standing      (none dropped)
     hooks    git-guard, config-sentinel       [2 core]
              -review-reminder                  [1 off]
     model    opus-5    effort  high -> low

     POWERING UP
```

Settings render in the order `SETTINGS` declares them, so the banner never reshuffles between runs. Colour, when enabled: arrow and new value in cyan, old value dimmed, `POWERING UP` bold magenta, the core hook line green. Use the same `paint`/`bold`/`dim` approach `ccfg.js` already uses at :74-80 rather than inventing a second colour helper.

Then replace the plain table in `command.js`'s `diff` with `renderBanner`, passing the two named modes as `from`/`to`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ~/.claude/tools/test-modes.js`
Expected: `PASS 70  FAIL 0`

- [ ] **Step 5: Look at it**

Run: `ccfg mode diff build spike`
Expected: the banner, in colour, readable.
Then: `ccfg mode diff build spike --plain | cat -v | head -5`
Expected: no stray escapes survive `--plain`.

---

### Task 8: Switching -- apply, lock, revert

**Files:**

- Create: `tools/modes/apply.js`
- Modify: `tools/modes/command.js`
- Modify: `tools/test-modes.js`

**Interfaces:**

- Consumes: `render.renderActive` (Task 3), `modes.resolve` and `coreHookViolation` (Task 4), `banner.renderBanner` (Task 7).
- Produces: `applyMode(configDir, mode, corpusRules, adhoc) -> {lock, banner}`, `readLock(configDir) -> lock | null`, `revert(configDir) -> boolean`. The lock is `{mode, settings, adhoc, appliedAt, settingsBackup, disabledHooks}`.

- [ ] **Step 1: Write the failing test**

Insert before the final `console.log` in `tools/test-modes.js`:

```js
const apply = require("./modes/apply.js");

const applySandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-apply-"));
fs.mkdirSync(path.join(applySandbox, "rules"), { recursive: true });
fs.mkdirSync(path.join(applySandbox, "modes"), { recursive: true });

const ORIGINAL_SETTINGS = {
  model: "claude-opus-5",
  effortLevel: "high",
  hooks: {
    Stop: [
      {
        matcher: "*",
        hooks: [{ type: "command", command: "node hooks/review-reminder.js" }],
      },
    ],
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: "node hooks/git-guard.js" }],
      },
    ],
  },
};
const settingsPath = path.join(applySandbox, "settings.json");
const originalText = JSON.stringify(ORIGINAL_SETTINGS, null, 2) + "\n";
fs.writeFileSync(settingsPath, originalText);

const applied = apply.applyMode(
  applySandbox,
  modes.parseMode(SPIKE, "spike.json"),
  CORPUS,
  {},
);

check("the lock names the applied mode", applied.lock.mode, "spike");
check(
  "the lock records the resolved settings",
  applied.lock.settings.verify,
  "none",
);
check(
  "_active.md is written",
  fs.existsSync(path.join(applySandbox, "rules", "_active.md")),
  true,
);
check(
  "mode.lock is written",
  fs.existsSync(path.join(applySandbox, "mode.lock")),
  true,
);

const afterSwitch = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
check(
  "the mode's projected keys land in settings.json",
  afterSwitch.effortLevel,
  "low",
);
check(
  "git-guard survives the switch",
  JSON.stringify(afterSwitch.hooks.PreToolUse).includes("git-guard.js"),
  true,
);
check(
  "the hook the mode disables is gone",
  JSON.stringify(afterSwitch.hooks.Stop || []).includes("review-reminder.js"),
  false,
);

check("revert reports success", apply.revert(applySandbox), true);
check(
  "revert restores settings.json byte for byte",
  fs.readFileSync(settingsPath, "utf8"),
  originalText,
);

check(
  "a mode disabling a core hook is refused before anything is written",
  (() => {
    const before = fs.readFileSync(settingsPath, "utf8");
    let refused = false;
    try {
      apply.applyMode(
        applySandbox,
        {
          name: "reckless",
          settings: {},
          projects: {},
          disableHooks: ["git-guard.js"],
        },
        CORPUS,
        {},
      );
    } catch (error) {
      refused = /git-guard\.js/.test(error.message);
    }
    return refused && fs.readFileSync(settingsPath, "utf8") === before;
  })(),
  true,
);

fs.rmSync(applySandbox, { recursive: true, force: true });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node ~/.claude/tools/test-modes.js`
Expected: FAIL -- `Cannot find module './modes/apply.js'`

- [ ] **Step 3: Write the implementation**

Create `tools/modes/apply.js`. The order of operations matters and is the whole point of the module:

1. Check `coreHookViolation(mode)`. Throw before touching disk if it returns a hook name. A partial switch that removed the git guard and then failed would be the worst outcome this system can produce.
2. Copy `settings.json` to `backups/settings.<ISO timestamp>.json`, recording that path in the lock. This is the revert target, not a diff.
3. Resolve the posture through `modes.resolve`.
4. Render `rules/_active.md` from the corpus.
5. Merge `mode.projects` into `settings.json`, and strip any hook entry whose command names a file in `mode.disableHooks`. Preserve key order and two-space indentation, ending with a newline, so a switch-and-revert round trip is byte-identical.
6. Write `mode.lock`.

`revert(configDir)` reads the lock, restores the recorded backup over `settings.json`, deletes the lock, and re-renders `_active.md` at the defaults. It returns `false` when there is no lock.

Then in `command.js`, make a bare mode name call `applyMode` and print `renderBanner` with the previous lock's settings as `from`. Add `ccfg mode revert`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ~/.claude/tools/test-modes.js`
Expected: `PASS 81  FAIL 0`

- [ ] **Step 5: Confirm the core-hook refusal can fail**

Temporarily move the `coreHookViolation` check to the end of `applyMode`. Run the suite. Expected: the refusal check FAILS, because `settings.json` changed before the throw. Restore and re-run to green.

---

### Task 9: Ad-hoc overrides

**Files:**

- Modify: `tools/modes/command.js`, `tools/modes/apply.js`
- Modify: `tools/test-modes.js`

**Interfaces:**

- Consumes: `applyMode`'s fourth argument (Task 8), `settings.isValid` (Task 1).
- Produces: `parseOverrides(argv) -> {overrides} | {error}`, exported from `command.js`.

- [ ] **Step 1: Write the failing test**

```js
const command = require("./modes/command.js");

check(
  "a single override parses",
  command.parseOverrides(["verify=prove-it"]).overrides.verify,
  "prove-it",
);
check(
  "several overrides parse",
  Object.keys(
    command.parseOverrides(["verify=prove-it", "voice=prose"]).overrides,
  ).length,
  2,
);
check(
  "an unknown setting is refused",
  command.parseOverrides(["vibes=high"]).error,
  "unknown setting: vibes",
);
check(
  "an unknown value is refused",
  command.parseOverrides(["verify=maybe"]).error,
  "verify has no value 'maybe' (none, run-it, prove-it)",
);
check(
  "a malformed pair is refused",
  command.parseOverrides(["verify"]).error,
  "expected setting=value, got: verify",
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node ~/.claude/tools/test-modes.js`
Expected: FAIL -- `command.parseOverrides is not a function`

- [ ] **Step 3: Write the implementation**

Add `parseOverrides` to `command.js` and export it. Wire `ccfg mode set k=v ...` to re-apply the mode currently in the lock with the overrides merged in as the `adhoc` layer, recording them in the lock so they survive until the next switch.

`ccfg mode` with no argument reports the overrides on their own line, marked as overrides -- so a posture that is not any named mode never masquerades as one.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ~/.claude/tools/test-modes.js`
Expected: `PASS 86  FAIL 0`

---

### Task 10: Mid-session injection and standing visibility

**Files:**

- Create: `hooks/mode-inject.js`, `hooks/mode-status.js`
- Modify: `settings.json` (`hooks.UserPromptSubmit`, `statusLine`)
- Modify: `tools/test-modes.js`

**Interfaces:**

- Consumes: `readLock` (Task 8), `hooks/lib/hook-io.js` (`readPayload`, `warn`, `configDir`).
- Produces: a `UserPromptSubmit` hook emitting the rendered rules as `additionalContext`, and a status line that always names the mode.

- [ ] **Step 1: Write the failing test**

```js
function runHook(payload, configDir) {
  return spawnSync(
    process.execPath,
    [path.join(REAL_CONFIG, "hooks", "mode-inject.js")],
    {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    },
  );
}

const hookSandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-hook-"));
fs.mkdirSync(path.join(hookSandbox, "rules"), { recursive: true });

const noLock = runHook({ session_id: "s1", cwd: hookSandbox }, hookSandbox);
check("with no mode set the hook exits clean", noLock.status, 0);
check("with no mode set the hook injects nothing", noLock.stdout.trim(), "");

fs.writeFileSync(
  path.join(hookSandbox, "rules", "_active.md"),
  "## Rules for this mode\n\nProve it before you say it works.\n",
);
fs.writeFileSync(
  path.join(hookSandbox, "mode.lock"),
  JSON.stringify({ mode: "ship", settings: { verify: "prove-it" } }),
);

const withLock = runHook({ session_id: "s1", cwd: hookSandbox }, hookSandbox);
check("with a mode set the hook exits clean", withLock.status, 0);
const emitted = JSON.parse(withLock.stdout);
check(
  "the hook injects as UserPromptSubmit context",
  emitted.hookSpecificOutput.hookEventName,
  "UserPromptSubmit",
);
check(
  "the injected context names the mode",
  emitted.hookSpecificOutput.additionalContext.includes("ship"),
  true,
);
check(
  "the injected context carries the rendered rules",
  emitted.hookSpecificOutput.additionalContext.includes(
    "Prove it before you say it works.",
  ),
  true,
);

fs.writeFileSync(
  path.join(hookSandbox, "rules", "_active.md"),
  "x".repeat(200000),
);
const huge = runHook({ session_id: "s2", cwd: hookSandbox }, hookSandbox);
check(
  "an oversized render is truncated rather than injected whole",
  huge.stdout.length < 100000,
  true,
);

fs.rmSync(hookSandbox, { recursive: true, force: true });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node ~/.claude/tools/test-modes.js`
Expected: FAIL -- the hook file does not exist, so `status` is 1 and `JSON.parse` throws on empty stdout.

- [ ] **Step 3: Write the injection hook**

Create `hooks/mode-inject.js` following the shape of `hooks/repo-context.js`: `io.run(() => {...})`, `io.readPayload()`, `io.warn("UserPromptSubmit", context)`. It reads `mode.lock`; when there is none it returns without emitting. It reads `rules/_active.md`, caps it at 64 KB (a runaway corpus must not eat the context window -- truncate with a visible marker), and emits `Mode: <name>\n\n<rendered>`.

Unlike `repo-context.js`, this hook does **not** suppress repeat output. Re-asserting the primary band every turn is the mechanism: it is what makes a switch take effect without a restart, what carries the posture through compaction, and what keeps the primary band at the freshest context position -- the position effect the experiments measured.

- [ ] **Step 4: Wire it in**

Append to `hooks.UserPromptSubmit[0].hooks` in `settings.json`, matching the existing invocation form exactly:

```json
{
  "type": "command",
  "command": "node -e \"const p=require('path'),d=process.env.CLAUDE_CONFIG_DIR||p.join(require('os').homedir(),'.claude');require(p.join(d,'hooks','mode-inject.js'))\""
}
```

- [ ] **Step 5: Make the mode permanently visible**

The documented failure of every modal interface is a stale belief about which mode is active, and announcing the mode only at switch time is exactly that failure.

The current status line is `npx -y ccstatusline@2.2.27`. Replace it with a wrapper that prints the mode and then delegates, so the mode shows on every frame:

```json
"statusLine": {
  "type": "command",
  "command": "node -e \"const p=require('path'),d=process.env.CLAUDE_CONFIG_DIR||p.join(require('os').homedir(),'.claude');require(p.join(d,'hooks','mode-status.js'))\"",
  "padding": 0,
  "refreshInterval": 10
}
```

Create `hooks/mode-status.js`: read `mode.lock`, print `[<mode>] ` (nothing when there is no lock), then spawn `npx -y ccstatusline@2.2.27` with the same stdin payload and pass its stdout through. If the spawn fails, still print the mode -- a broken status line must not hide which mode is active.

- [ ] **Step 6: Run the tests**

Run: `node ~/.claude/tools/test-modes.js && node ~/.claude/hooks/test-hooks.js`
Expected: `PASS 92  FAIL 0` and the hook suite still green.

- [ ] **Step 7: Verify it end to end, by hand**

Run `ccfg mode ship`, start a session, and confirm the status line shows `[ship]`. Run `ccfg mode spike` in another terminal and confirm the running session picks the new posture up on the next prompt without a restart.

This is the claim the whole design rests on and it cannot be verified from the test suite. If it does not work, stop and say so rather than proceeding.

---

### Task 11: Per-mode hooks over a protected core

**Files:**

- Create: `hooks/review-freeze.js`, `hooks/ship-gate.js`
- Modify: `tools/modes/apply.js`, `modes/review.json`, `modes/ship.json`, `modes/spike.json`
- Modify: `tools/ccfg.js` (`commandDoctor`)
- Modify: `tools/test-modes.js`

**Interfaces:**

- Consumes: `CORE_HOOKS` (Task 4), `applyMode` (Task 8).
- Produces: `enableHooks` support in a mode file (the inverse of `disableHooks`), and a `ccfg doctor` section for modes.

- [ ] **Step 1: Write the failing test**

```js
const hookModeSandbox = fs.mkdtempSync(
  path.join(os.tmpdir(), "ccfg-hookmode-"),
);
fs.mkdirSync(path.join(hookModeSandbox, "rules"), { recursive: true });
fs.writeFileSync(
  path.join(hookModeSandbox, "settings.json"),
  JSON.stringify(ORIGINAL_SETTINGS, null, 2) + "\n",
);

apply.applyMode(
  hookModeSandbox,
  {
    name: "review",
    settings: {},
    projects: {},
    disableHooks: [],
    enableHooks: {
      PreToolUse: [
        { matcher: "Edit|Write", command: "hooks/review-freeze.js" },
      ],
    },
  },
  CORPUS,
  {},
);

const withHook = JSON.parse(
  fs.readFileSync(path.join(hookModeSandbox, "settings.json"), "utf8"),
);
check(
  "a mode-owned hook is added",
  JSON.stringify(withHook.hooks.PreToolUse).includes("review-freeze.js"),
  true,
);
check(
  "the core hook is still there beside it",
  JSON.stringify(withHook.hooks.PreToolUse).includes("git-guard.js"),
  true,
);

apply.revert(hookModeSandbox);
const reverted = JSON.parse(
  fs.readFileSync(path.join(hookModeSandbox, "settings.json"), "utf8"),
);
check(
  "reverting removes the mode-owned hook",
  JSON.stringify(reverted.hooks.PreToolUse).includes("review-freeze.js"),
  false,
);

fs.rmSync(hookModeSandbox, { recursive: true, force: true });

const doctored = runCcfg(["doctor"]);
check("doctor reports the active mode", /mode/i.test(doctored.stdout), true);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node ~/.claude/tools/test-modes.js`
Expected: FAIL -- `enableHooks` is ignored, so `review-freeze.js` is absent.

- [ ] **Step 3: Write the implementation**

Teach `applyMode` to read `enableHooks` (an object of event -> `{matcher, command}[]`) and splice those entries into `settings.json` alongside the existing ones, marked so `revert` removes exactly them and nothing else. Core hooks are never removed by either path.

Then give the modes their teeth -- this is what makes a mode more than a mood:

- `review` gains a `PreToolUse` hook on `Edit|Write` that denies the call. This doubles the `permissions.deny` from Task 5 on purpose: prose is guidance, a hook is the guarantee.
- `ship` gains a `Stop` hook that blocks a completion claim until a test command appears in the evidence log for this session.
- `spike` disables `review-reminder.js` and `style-check.js`. That is where its speed comes from, and the banner says so out loud rather than hiding it.

Create `hooks/review-freeze.js` and `hooks/ship-gate.js` following `hooks/git-guard.js`'s shape, using `io.deny` and `io.block` respectively.

Add a `ccfg doctor` section printing the active mode, its seven settings, the rule band counts, and a failure when `mode.lock` and `settings.json` disagree or a core hook is missing from `settings.json`.

- [ ] **Step 4: Run the tests**

Run: `node ~/.claude/tools/test-modes.js && node ~/.claude/tools/test-ccfg.js && node ~/.claude/hooks/test-hooks.js`
Expected: all three green, `PASS 96  FAIL 0` on the mode suite.

- [ ] **Step 5: Prove the review freeze actually fires**

Run `ccfg mode review`, then in a session try to edit a file. Expected: denied, with the hook's reason. Then `ccfg mode revert` and confirm editing works again. A guard that has never been seen to block is unproven.

---

### Task 12: Repo-level modes

**Files:**

- Modify: `tools/modes/modes.js`, `tools/modes/command.js`, `hooks/repo-setup.js`
- Modify: `tools/test-modes.js`

**Interfaces:**

- Consumes: `resolve`'s `repo` layer (Task 4).
- Produces: `loadRepoMode(cwd, name) -> Mode | null`, `repoDefault(cwd) -> string | null`.

- [ ] **Step 1: Write the failing test**

```js
const repoSandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-repo-"));
fs.mkdirSync(path.join(repoSandbox, ".git"), { recursive: true });
fs.mkdirSync(path.join(repoSandbox, ".claude", "modes"), { recursive: true });
fs.writeFileSync(
  path.join(repoSandbox, ".claude", "modes", "ship.json"),
  JSON.stringify({
    name: "ship",
    settings: { verify: "prove-it", subagents: "many" },
  }),
);
fs.writeFileSync(path.join(repoSandbox, ".claude", "mode"), "ship\n");

check(
  "a repo mode is found by name",
  modes.loadRepoMode(repoSandbox, "ship").name,
  "ship",
);
check(
  "a repo mode that does not exist is null",
  modes.loadRepoMode(repoSandbox, "spike"),
  null,
);
check("the repo default is read", modes.repoDefault(repoSandbox), "ship");

const nested = path.join(repoSandbox, "src", "deep");
fs.mkdirSync(nested, { recursive: true });
check(
  "the repo default is found from a subdirectory",
  modes.repoDefault(nested),
  "ship",
);

const noRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-norepo-"));
check(
  "a directory with no .claude has no default",
  modes.repoDefault(noRepo),
  null,
);

fs.rmSync(repoSandbox, { recursive: true, force: true });
fs.rmSync(noRepo, { recursive: true, force: true });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node ~/.claude/tools/test-modes.js`
Expected: FAIL -- `modes.loadRepoMode is not a function`

- [ ] **Step 3: Write the implementation**

Add both functions to `modes.js`, walking up from `cwd` and stopping at the directory holding `.git`. Bound the walk at 40 levels the way `repo-context.js` does at its `findPackageRoot` -- an unbounded walk escapes into the home directory and applies a stray repo's posture to everything.

Then make `command.js` consult the repo layer on every operation, and extend `hooks/repo-setup.js` (already a `SessionStart` hook) to apply the repo default when one exists and the lock holds no ad-hoc override.

- [ ] **Step 4: Run the tests**

Run: `node ~/.claude/tools/test-modes.js && node ~/.claude/hooks/test-hooks.js`
Expected: `PASS 101  FAIL 0`, hook suite green.

---

### Task 13: Per-agent modes

**Files:**

- Modify: `tools/modes/render.js`, `tools/modes/command.js`
- Create: `agents/README.md` section on modes
- Modify: `tools/test-modes.js`

**Interfaces:**

- Consumes: `band` (Task 3), `parseMode` (Task 4).
- Produces: `renderForAgent(corpusRules, modeName, configDir) -> string`, and `ccfg mode render <name>` printing it.

- [ ] **Step 1: Write the failing test**

```js
const agentRendered = render.renderForAgent(CORPUS, "spike", REAL_CONFIG);
check("an agent render is a string", typeof agentRendered, "string");
check(
  "an agent render names its own mode",
  agentRendered.includes("spike"),
  true,
);

const shipRendered = render.renderForAgent(CORPUS, "ship", REAL_CONFIG);
check(
  "a different mode renders differently",
  agentRendered === shipRendered,
  false,
);

check(
  "an agent render ignores the active lock entirely",
  (() => {
    const lockPath = path.join(REAL_CONFIG, "mode.lock");
    const had = fs.existsSync(lockPath);
    const saved = had ? fs.readFileSync(lockPath, "utf8") : null;
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ mode: "ship", settings: { verify: "prove-it" } }),
    );
    const underShipLock = render.renderForAgent(CORPUS, "spike", REAL_CONFIG);
    if (had) fs.writeFileSync(lockPath, saved);
    else fs.rmSync(lockPath);
    return underShipLock === agentRendered;
  })(),
  true,
);

const printed = runCcfg(["mode", "render", "spike"]);
check("ccfg mode render exits clean", printed.status, 0);
check(
  "ccfg mode render writes the rules to stdout",
  printed.stdout.includes("Rules for this mode"),
  true,
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node ~/.claude/tools/test-modes.js`
Expected: FAIL -- `render.renderForAgent is not a function`

- [ ] **Step 3: Write the implementation**

`renderForAgent` resolves the named mode **from the defaults**, never from the active lock. A subagent's rules are exactly its own mode's rules; nothing leaks from the parent. Inheritance is how a search agent ends up carrying commit-hygiene rules, which is a live defect in this config today.

Add `ccfg mode render <name>` so an agent definition can pull its own rule set, and document in `~/.claude/agents/README.md` that an agent declares `mode: research` in frontmatter and that a dispatching `Agent` call may override it.

- [ ] **Step 4: Run the test**

Run: `node ~/.claude/tools/test-modes.js`
Expected: `PASS 107  FAIL 0`

---

### Task 14: Proposals, and the boundary that makes them safe

**Files:**

- Create: `hooks/mode-guard.js`
- Modify: `settings.json` (`hooks.PreToolUse`), `tools/modes/command.js`
- Modify: `tools/test-modes.js`

**Interfaces:**

- Consumes: `parseMode` (Task 4).
- Produces: `ccfg mode proposals`, `ccfg mode accept <id>`, and a `PreToolUse` hook denying subagent writes to `modes/`, `rules/`, and `settings.json`.

- [ ] **Step 1: Write the failing test**

```js
function runGuard(payload) {
  return spawnSync(
    process.execPath,
    [path.join(REAL_CONFIG, "hooks", "mode-guard.js")],
    {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: REAL_CONFIG },
    },
  );
}

const agentWrite = runGuard({
  tool_name: "Write",
  tool_input: { file_path: path.join(REAL_CONFIG, "modes", "sneaky.json") },
  agent_type: "general-purpose",
});
check(
  "an agent write to modes/ is denied",
  JSON.parse(agentWrite.stdout).hookSpecificOutput.permissionDecision,
  "deny",
);

const proposalWrite = runGuard({
  tool_name: "Write",
  tool_input: {
    file_path: path.join(REAL_CONFIG, "modes", "proposed", "faster.json"),
  },
  agent_type: "general-purpose",
});
check(
  "an agent write to modes/proposed/ is allowed",
  proposalWrite.stdout.trim(),
  "",
);

const settingsWrite = runGuard({
  tool_name: "Edit",
  tool_input: { file_path: path.join(REAL_CONFIG, "settings.json") },
  agent_type: "general-purpose",
});
check(
  "an agent edit of settings.json is denied",
  JSON.parse(settingsWrite.stdout).hookSpecificOutput.permissionDecision,
  "deny",
);

const mainWrite = runGuard({
  tool_name: "Write",
  tool_input: { file_path: path.join(REAL_CONFIG, "modes", "spike.json") },
});
check("the main session is not blocked", mainWrite.stdout.trim(), "");

fs.mkdirSync(path.join(REAL_CONFIG, "modes", "proposed"), { recursive: true });
const noEval = path.join(REAL_CONFIG, "modes", "proposed", "test-noeval.json");
fs.writeFileSync(noEval, JSON.stringify({ name: "test-noeval", settings: {} }));
const rejected = runCcfg(["mode", "accept", "test-noeval"]);
check("a proposal with no eval case is refused", rejected.status !== 0, true);
check("the refusal says why", rejected.stderr.includes("eval"), true);
fs.rmSync(noEval);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node ~/.claude/tools/test-modes.js`
Expected: FAIL -- the guard does not exist, so `JSON.parse` throws on empty stdout.

- [ ] **Step 3: Write the implementation**

Create `hooks/mode-guard.js` on the shape of `hooks/git-guard.js`, using `io.deny("PreToolUse", reason)`. It denies `Write`, `Edit` and `NotebookEdit` to any path under `modes/`, `rules/`, or at `settings.json` **when the payload says a subagent is acting**, with the single exception of `modes/proposed/`.

The main session is untouched. This is a boundary on delegated work, not a lock on the operator.

Wire it into `hooks.PreToolUse` with matcher `Write|Edit|NotebookEdit`.

Add `ccfg mode proposals` (list what is in `modes/proposed/`, with the diff each would make against the nearest existing mode) and `ccfg mode accept <id>` (show that diff, require confirmation, then move the file into `modes/`).

`accept` refuses a proposal carrying no `eval` key naming a runnable case. An agent cannot propose a rule without proposing how to falsify it -- which is the same standard the audit behind this design had to meet, and failed to meet on its first attempt.

Self-switching follows the same boundary: an agent may propose a mode change and must not apply one.

- [ ] **Step 4: Run the tests**

Run: `node ~/.claude/tools/test-modes.js && node ~/.claude/hooks/test-hooks.js`
Expected: `PASS 115  FAIL 0`, hook suite green.

---

### Task 15: `ccfg mode prove`

**Files:**

- Modify: `tools/modes/command.js`
- Create: `modes/evals/ship.json`, `modes/evals/spike.json`
- Modify: `tools/test-modes.js`

**Interfaces:**

- Consumes: mode files (Task 5).
- Produces: `ccfg mode prove <name> [--dry-run]` wrapping `claude plugin eval`.

- [ ] **Step 1: Write the failing test**

```js
const proved = runCcfg(["mode", "prove", "spike", "--dry-run"]);
check("prove --dry-run exits clean", proved.status, 0);
check(
  "prove names the eval command it would run",
  proved.stdout.includes("claude plugin eval"),
  true,
);
check(
  "prove passes the ablation flag",
  proved.stdout.includes("--ablation with-without"),
  true,
);

const noSuite = runCcfg(["mode", "prove", "design", "--dry-run"]);
check("prove refuses a mode with no eval suite", noSuite.status !== 0, true);
check(
  "the refusal names the missing suite",
  noSuite.stderr.includes("design"),
  true,
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node ~/.claude/tools/test-modes.js`
Expected: FAIL -- `prove` is not a subcommand, so the status is 2.

- [ ] **Step 3: Write the implementation**

`ccfg mode prove <name>` builds and runs `claude plugin eval --ablation with-without --runs N` against `modes/evals/<name>.json`. `--dry-run` prints the command without running it, which is what the test exercises -- a suite that spends real API budget on every run is a suite nobody runs.

Two guards the harness must carry, both learned the hard way during the work that produced this design, and both non-negotiable:

- **A rate-limit notice is not a model response.** Discard any output matching `session limit|usage limit|rate limit` and exit non-zero, leaving the cell unfilled. An earlier run of exactly this kind was 99% contaminated by limit notices graded as data, and produced a confident finding that had to be retracted.
- **Read the raw output of the best and worst arms before trusting a result.** A grader that cannot recognise the correct answer produces inverted findings -- which is how the same work came to report that a rule was causing the behaviour it forbade, when the rule was working and the grader was misreading it.

Write eval suites for `ship` and `spike` first: they are the two extremes and the pair most likely to show a real delta. Because settings are ordinal, the informative run is a dose-response sweep across a setting's three values, not a two-arm A/B.

- [ ] **Step 4: Run the test**

Run: `node ~/.claude/tools/test-modes.js`
Expected: `PASS 119  FAIL 0`

- [ ] **Step 5: Run everything one last time**

Run: `node ~/.claude/tools/test-modes.js && node ~/.claude/tools/test-ccfg.js && node ~/.claude/hooks/test-hooks.js && ccfg doctor && ccfg validate`
Expected: all green; doctor reports the active mode and no core-hook failure.

---

## What this plan does not do

Stated so nobody assumes it was covered:

- **No measurement of whether the ten modes differ in outcome.** Task 15 builds the harness; running it is separate work. The evidence behind this design says ordering moves adherence -- it does not say `research` outperforms `build` at research. That is a hypothesis this system makes testable, not one it has tested.
- **No migration of `CLAUDE.md`.** Task 5 copies rule text into the corpus; it removes nothing from `CLAUDE.md`. Running both means those rules are stated twice. Deciding what leaves `CLAUDE.md` needs its own measurement, because burial was measured to be worse than absence and a wrong cut is a real regression.
- **Zotero is out of scope entirely**, despite being the origin of this thread. It belongs to the `research` mode's capability set and needs its own design.
