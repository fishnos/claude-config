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
const rules = require("./modes/rules.js");
const render = require("./modes/render.js");
const modes = require("./modes/modes.js");

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

// ---------------------------------------------------------------- settings

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

// ------------------------------------------------------------------- rules

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

const CATEGORICAL = `---
id: voice-caveman
setting: voice
only_at: caveman
---
Drop the articles.
`;
const categorical = rules.parseRule(CATEGORICAL, "corpus/voice.md");
check("a categorical rule yields only_at", categorical.only_at, "caveman");
check("a categorical rule has no threshold", categorical.primary_at, null);

check(
  "a rule with neither placement is refused",
  rules.parseRule("---\nid: x\nsetting: voice\n---\nbody\n", "corpus/x.md").error,
  "corpus/x.md: no primary_at or only_at",
);
check(
  "a rule claiming both placements is refused",
  rules.parseRule(
    "---\nid: x\nsetting: voice\nprimary_at: caveman\nonly_at: caveman\n---\nb\n",
    "corpus/x.md",
  ).error,
  "corpus/x.md: both primary_at and only_at",
);

check(
  "a threshold on a categorical setting is refused",
  rules.parseRule(
    "---\nid: x\nsetting: voice\nprimary_at: caveman\n---\nb\n",
    "corpus/x.md",
  ).error,
  "corpus/x.md: voice is categorical, use only_at",
);
check(
  "a category on an ordered setting is refused",
  rules.parseRule(
    "---\nid: x\nsetting: verify\nonly_at: run-it\n---\nb\n",
    "corpus/x.md",
  ).error,
  "corpus/x.md: verify is ordered, use primary_at",
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

// ------------------------------------------------------------------ render

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

const VOICED = [
  { id: "cave", setting: "voice", primary_at: null, only_at: "caveman", body: "Cave.", file: "v.md" },
];
check(
  "a categorical rule is primary at its own value",
  render.band(VOICED, { voice: "caveman" }).primary.length,
  1,
);
check(
  "a categorical rule is not primary at a higher value",
  render.band(VOICED, { voice: "prose" }).primary.length,
  0,
);
check(
  "a categorical rule that is not primary is still kept",
  render.band(VOICED, { voice: "prose" }).standing.length,
  1,
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

// ------------------------------------------------------------------- modes

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

// -------------------------------------------- the real corpus and real modes

const REAL_CONFIG = path.join(os.homedir(), ".claude");
const realCorpus = rules.loadCorpus(path.join(REAL_CONFIG, "modes", "rules"));

check("the real corpus loads with no malformed rules", realCorpus.errors.length, 0);
check("the real corpus is not empty", realCorpus.rules.length > 0, true);
check(
  "every rule id is unique",
  new Set(realCorpus.rules.map((rule) => rule.id)).size,
  realCorpus.rules.length,
);
// The harness loads every .md in rules/ wholesale, so the 25 source files must
// not sit there -- only the single generated render, which is the sorted copy.
// Asserted by name rather than by counting files, because a count breaks the
// moment anything legitimate is added and says nothing about what went wrong.
{
  const loaded = fs
    .readdirSync(path.join(REAL_CONFIG, "rules"))
    .filter((name) => name.endsWith(".md"));
  const corpusNames = new Set(
    fs.readdirSync(path.join(REAL_CONFIG, "modes", "rules")),
  );
  check(
    "no corpus source file sits in rules/, which the harness auto-loads wholesale",
    loaded.filter((name) => corpusNames.has(name)).length,
    0,
  );
  check(
    "the generated render is the one mode file the harness loads",
    loaded.includes("_active.md"),
    true,
  );
}

const MODE_NAMES = [
  "spike", "build", "ship", "paper", "research",
  "review", "debug", "design", "unattended", "pair", "nomad",
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
  "every mode file parses",
  realModes.filter((mode) => mode.error === undefined).length,
  MODE_NAMES.length,
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
  MODE_NAMES.length,
);

// The reachability invariant. "Primary under the strictest mode" cannot be the
// test once a setting is categorical -- the caveman rules are correctly not
// primary under ship, which speaks normal prose. What must hold is that no rule
// is dead weight: every one of them leads in at least one mode.
const unreachable = realCorpus.rules.filter(
  (rule) =>
    !realModes.some((mode) =>
      render
        .band([rule], { ...settings.DEFAULTS, ...mode.settings })
        .primary.includes(rule),
    ),
);
check(
  `no rule is unreachable in all ten modes (${unreachable.map((r) => r.id).join(", ")})`,
  unreachable.length,
  0,
);

check(
  "every mode makes at least one rule primary",
  realModes.every(
    (mode) =>
      render.band(realCorpus.rules, { ...settings.DEFAULTS, ...mode.settings })
        .primary.length > 0,
  ),
  true,
);

// ------------------------------------------------------- applying a mode

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
  "the generated rules file is written",
  fs.existsSync(path.join(applySandbox, "rules", "_active.md")),
  true,
);
check(
  "the lock file is written",
  fs.existsSync(path.join(applySandbox, "mode.lock")),
  true,
);
check(
  "every corpus rule survives the switch",
  CORPUS.every((rule) =>
    fs
      .readFileSync(path.join(applySandbox, "rules", "_active.md"), "utf8")
      .includes(rule.body),
  ),
  true,
);

const afterSwitch = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
check(
  "the mode's projected keys land in the settings file",
  afterSwitch.effortLevel,
  "low",
);
check(
  "the git guard survives the switch",
  JSON.stringify(afterSwitch.hooks.PreToolUse).includes("git-guard.js"),
  true,
);
check(
  "the hook the mode disables is gone",
  JSON.stringify(afterSwitch.hooks.Stop || []).includes("review-reminder.js"),
  false,
);

check("reading the lock back names the mode", apply.readLock(applySandbox).mode, "spike");

// The lock records the name under `mode`; a reader looking for `name` finds
// nothing and reports (none) while showing the applied posture -- a display that
// contradicts itself and hides which mode is live.
{
  const { activeMode } = require("./modes/command.js");
  check(
    "the active posture reports the applied mode by name",
    activeMode(applySandbox).name,
    "spike",
  );
  check(
    "the active posture carries the applied settings",
    activeMode(applySandbox).settings.verify,
    "none",
  );
}

// Switching twice then reverting must land on the operator's own settings, not
// on the first mode's output. Backing up on every switch made the second switch
// snapshot the first mode's result, so revert restored a mode and left its
// skill gating in place permanently.
{
  const chain = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-chain-"));
  fs.mkdirSync(path.join(chain, "rules"), { recursive: true });
  const original =
    JSON.stringify({ effortLevel: "high", skillOverrides: { keep: "user-invocable-only" } }, null, 2) + "\n";
  fs.writeFileSync(path.join(chain, "settings.json"), original);

  apply.applyMode(chain, modes.parseMode(SPIKE, "spike.json"), CORPUS, {});
  apply.applyMode(
    chain,
    modes.parseMode(
      { name: "second", settings: {}, projects: { effortLevel: "low" } },
      "second.json",
    ),
    CORPUS,
    {},
  );
  apply.revert(chain);

  check(
    "reverting after two switches restores the original settings, not the first mode",
    fs.readFileSync(path.join(chain, "settings.json"), "utf8"),
    original,
  );
  fs.rmSync(chain, { recursive: true, force: true });
}

// Skill gating must be computed from the operator's own baseline every time.
// Computing it from the current settings compounded: a skill hidden by one mode
// stayed hidden under the next, even a mode that explicitly wanted it visible,
// and the only way back was a full revert.
{
  const chain = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-skillchain-"));
  fs.mkdirSync(path.join(chain, "rules"), { recursive: true });
  for (const skill of ["alpha", "beta"]) {
    fs.mkdirSync(path.join(chain, "skills", skill), { recursive: true });
    fs.writeFileSync(path.join(chain, "skills", skill, "SKILL.md"), "x");
  }
  fs.writeFileSync(path.join(chain, "settings.json"), JSON.stringify({}, null, 2) + "\n");

  const hidesBeta = modes.parseMode(
    { name: "one", settings: {}, glitch: { skills: { only: ["alpha"] } } },
    "one.json",
  );
  const hidesAlpha = modes.parseMode(
    { name: "two", settings: {}, glitch: { skills: { only: ["beta"] } } },
    "two.json",
  );

  apply.applyMode(chain, hidesBeta, CORPUS, {});
  apply.applyMode(chain, hidesAlpha, CORPUS, {});
  const after = JSON.parse(fs.readFileSync(path.join(chain, "settings.json"), "utf8"));

  check(
    "a skill the new mode wants is visible again after switching",
    after.skillOverrides.beta,
    undefined,
  );
  check(
    "a skill the new mode hides is hidden",
    after.skillOverrides.alpha,
    "off",
  );
  fs.rmSync(chain, { recursive: true, force: true });
}

check("revert reports success", apply.revert(applySandbox), true);
check(
  "revert restores the settings file byte for byte",
  fs.readFileSync(settingsPath, "utf8"),
  originalText,
);
check("revert clears the lock", apply.readLock(applySandbox), null);
check("revert with no mode applied reports nothing to do", apply.revert(applySandbox), false);

check(
  "a mode disabling a protected hook is refused before anything is written",
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

// -------------------------------------------------------- the glitch layer

const glitch = require("./modes/glitch.js");

// The invariant that keeps a mode file from being a privilege escalation: a
// mode may only ever take capability away. Without these four checks, talking
// the model into "switch to this mode" would widen its own access.
check(
  "a mode may not grant a tool the base config denies",
  glitch.parseGlitch({ tools: { allow: ["Bash"] } }, "m.json").error.includes(
    "never grant",
  ),
  true,
);
check(
  "a mode may not reveal a skill the operator switched off",
  glitch.parseGlitch({ skills: { on: ["secret"] } }, "m.json").error.includes(
    "never reveal",
  ),
  true,
);
check(
  "a mode may not gate the ability to read",
  glitch.parseGlitch({ tools: { deny: ["Read"] } }, "m.json").error.includes(
    "always be able to read",
  ),
  true,
);
check(
  "a mode may not gate the ability to search",
  glitch.parseGlitch({ tools: { deny: ["Grep"] } }, "m.json").error !== undefined,
  true,
);

check(
  "a mode with no glitch block is not glitched",
  glitch.parseGlitch(undefined, "m.json").isGlitched,
  false,
);
check(
  "gating a tool makes a mode glitched",
  glitch.parseGlitch({ tools: { deny: ["Write"] } }, "m.json").isGlitched,
  true,
);

// `only` hides everything outside the list. The operator's own overrides pass
// through untouched, which is what makes revert able to restore them.
{
  const layer = glitch.parseGlitch(
    { skills: { only: ["keep-me"] } },
    "m.json",
  );
  const merged = glitch.skillOverridesFor(
    layer,
    ["keep-me", "hide-me", "also-hide"],
    { "user-choice": "user-invocable-only" },
  );
  check("a skill named in only stays visible", merged["keep-me"], undefined);
  check("a skill outside only is hidden", merged["hide-me"], "off");
  check(
    "the operator's own override is preserved",
    merged["user-choice"],
    "user-invocable-only",
  );
}

// The fingerprint is what tells a half-applied mode from a whole one, so it
// must move when the frozen half moves and hold still when it does not.
{
  const bare = glitch.parseGlitch(undefined, "m.json");
  const gated = glitch.parseGlitch({ tools: { deny: ["Write"] } }, "m.json");
  const skilled = glitch.parseGlitch({ skills: { only: ["a"] } }, "m.json");
  check(
    "gating a tool does not change the fingerprint, because it applies live",
    glitch.hardHash(gated, {}),
    glitch.hardHash(bare, {}),
  );
  check(
    "gating a skill does change the fingerprint, because it needs a restart",
    glitch.hardHash(skilled, {}) === glitch.hardHash(bare, {}),
    false,
  );
  check(
    "changing the model changes the fingerprint",
    glitch.hardHash(bare, { model: "claude-opus-5" }) ===
      glitch.hardHash(bare, {}),
    false,
  );
}

// ---------------------------------------------------------- the tool gate

function runGuardHook(payload, configDir) {
  return require("child_process").spawnSync(
    process.execPath,
    [path.join(__dirname, "..", "hooks", "mode-guard.js")],
    {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    },
  );
}

const guardSandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-guard-"));

check(
  "with no mode applied nothing is gated",
  runGuardHook({ tool_name: "Write" }, guardSandbox).stdout.trim(),
  "",
);

fs.writeFileSync(
  path.join(guardSandbox, "mode.lock"),
  JSON.stringify({
    mode: "review",
    codename: "APPRAISER",
    deniedTools: ["Write", "Edit"],
    subagents: "none",
  }),
);

check(
  "a tool the mode does not carry is refused",
  JSON.parse(runGuardHook({ tool_name: "Write" }, guardSandbox).stdout)
    .hookSpecificOutput.permissionDecision,
  "deny",
);
check(
  "the refusal names the mode so the model knows why",
  JSON.parse(runGuardHook({ tool_name: "Write" }, guardSandbox).stdout)
    .hookSpecificOutput.permissionDecisionReason.includes("APPRAISER"),
  true,
);
// A bare refusal invites the model to reach the same end by another route,
// which is worse than no gate at all. Measured behaviour: told not to route
// around it, the model stopped instead of falling back to a shell command.
check(
  "the refusal tells the model not to route around it",
  JSON.parse(runGuardHook({ tool_name: "Write" }, guardSandbox).stdout)
    .hookSpecificOutput.permissionDecisionReason.includes("another"),
  true,
);
check(
  "a tool the mode does carry passes",
  runGuardHook({ tool_name: "Bash" }, guardSandbox).stdout.trim(),
  "",
);
check(
  "reading is never gated, whatever the lock says",
  runGuardHook({ tool_name: "Read" }, guardSandbox).stdout.trim(),
  "",
);
check(
  "a solo mode refuses subagents",
  JSON.parse(runGuardHook({ tool_name: "Agent" }, guardSandbox).stdout)
    .hookSpecificOutput.permissionDecision,
  "deny",
);

fs.rmSync(guardSandbox, { recursive: true, force: true });

// ------------------------------------------------------ corruption detection

const { integrity } = require("./modes/command.js");
const healthSandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-health-"));
fs.mkdirSync(path.join(healthSandbox, "cache", "mode-session"), {
  recursive: true,
});

check(
  "with no mode applied the posture is clean",
  integrity(healthSandbox, "s1").state,
  "clean",
);

fs.writeFileSync(
  path.join(healthSandbox, "mode.lock"),
  JSON.stringify({ mode: "review", codename: "APPRAISER", hardHash: "aaaa" }),
);
check(
  "a mode with no session on record cannot be judged",
  integrity(healthSandbox, "s1").state,
  "unknown",
);

fs.writeFileSync(
  path.join(healthSandbox, "cache", "mode-session", "s1"),
  JSON.stringify({ hardHash: "aaaa", mode: "review" }),
);
check(
  "a session that loaded this exact posture is clean",
  integrity(healthSandbox, "s1").state,
  "clean",
);

// The failure this whole mechanism exists for: switch mid-session and the
// frozen half stays behind, with nothing on screen saying so.
fs.writeFileSync(
  path.join(healthSandbox, "mode.lock"),
  JSON.stringify({ mode: "debug", codename: "TRACE", hardHash: "bbbb" }),
);
check(
  "switching mid-session leaves the posture corrupted",
  integrity(healthSandbox, "s1").state,
  "corrupted",
);
check(
  "the corrupted report names the mode the session actually loaded",
  integrity(healthSandbox, "s1").loadedMode,
  "review",
);
check(
  "the corrupted report says which parts are stale",
  integrity(healthSandbox, "s1").stale.includes("skills"),
  true,
);

fs.rmSync(healthSandbox, { recursive: true, force: true });

// ----------------------------------------------------------- switch banner

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

// ------------------------------------------------- injection on mode change

// The hook's whole contract is when it stays silent. Injecting the active rules
// on every message was measured to buy nothing (0/36 either way), so anything
// that makes it chatty is a regression, not a nicety.
function runInjectHook(payload, configDir) {
  return require("child_process").spawnSync(
    process.execPath,
    [path.join(__dirname, "..", "hooks", "mode-inject.js")],
    {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    },
  );
}

const hookSandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-hook-"));
fs.mkdirSync(path.join(hookSandbox, "rules"), { recursive: true });

const noLock = runInjectHook({ session_id: "s1" }, hookSandbox);
check("with no mode applied the hook exits clean", noLock.status, 0);
check("with no mode applied the hook injects nothing", noLock.stdout.trim(), "");

fs.writeFileSync(
  path.join(hookSandbox, "rules", "_active.md"),
  "## Rules for this mode\n\nProve it before you say it works.\n",
);
function writeLockFor(mode, stamp) {
  fs.writeFileSync(
    path.join(hookSandbox, "mode.lock"),
    JSON.stringify({ mode, settings: { verify: "prove-it" }, appliedAt: stamp }),
  );
}
writeLockFor("ship", "2026-09-07T00:00:00Z");

const firstTurn = runInjectHook({ session_id: "s1" }, hookSandbox);
check(
  "the first message of a session injects nothing, since the file already loaded",
  firstTurn.stdout.trim(),
  "",
);

const sameMode = runInjectHook({ session_id: "s1" }, hookSandbox);
check(
  "a later message under an unchanged mode injects nothing",
  sameMode.stdout.trim(),
  "",
);

writeLockFor("spike", "2026-09-07T01:00:00Z");
const afterModeChange = runInjectHook({ session_id: "s1" }, hookSandbox);
check("a mode change exits clean", afterModeChange.status, 0);
const emitted = JSON.parse(afterModeChange.stdout);
check(
  "the injection is attached to the user's message",
  emitted.hookSpecificOutput.hookEventName,
  "UserPromptSubmit",
);
check(
  "the injection names the mode now in force",
  emitted.hookSpecificOutput.additionalContext.includes("spike"),
  true,
);
check(
  "the injection says it replaces the earlier posture",
  emitted.hookSpecificOutput.additionalContext.includes("replace"),
  true,
);
check(
  "the injection carries the rendered rules",
  emitted.hookSpecificOutput.additionalContext.includes(
    "Prove it before you say it works.",
  ),
  true,
);

const settled = runInjectHook({ session_id: "s1" }, hookSandbox);
check(
  "the message after a change goes quiet again",
  settled.stdout.trim(),
  "",
);

const otherSession = runInjectHook({ session_id: "s2" }, hookSandbox);
check(
  "a different session starts its own history and injects nothing",
  otherSession.stdout.trim(),
  "",
);

fs.writeFileSync(
  path.join(hookSandbox, "rules", "_active.md"),
  "x".repeat(200000),
);
writeLockFor("ship", "2026-09-07T02:00:00Z");
const huge = runInjectHook({ session_id: "s1" }, hookSandbox);
check(
  "an oversized render is truncated rather than injected whole",
  huge.stdout.length < 100000,
  true,
);

fs.rmSync(hookSandbox, { recursive: true, force: true });

// ----------------------------------------------------------- status line

function runStatusHook(configDir) {
  return require("child_process").spawnSync(
    process.execPath,
    [path.join(__dirname, "..", "hooks", "mode-status.js")],
    {
      input: "{}",
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    },
  );
}

const statusSandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-status-"));

check(
  "with no mode applied the status line says so",
  runStatusHook(statusSandbox).stdout.trim(),
  "no mode",
);

fs.writeFileSync(
  path.join(statusSandbox, "mode.lock"),
  JSON.stringify({
    mode: "ship",
    settings: { verify: "prove-it", autonomy: "ask-first", voice: "normal" },
    adhoc: {},
  }),
);
const shipStatus = runStatusHook(statusSandbox).stdout.trim();
check("the status line names the mode", shipStatus.includes("ship"), true);
check(
  "the status line shows the posture in words, not codes",
  shipStatus.includes("prove-it") && shipStatus.includes("ask-first"),
  true,
);

fs.writeFileSync(
  path.join(statusSandbox, "mode.lock"),
  JSON.stringify({
    mode: "ship",
    settings: { verify: "none", autonomy: "just-go", voice: "normal" },
    adhoc: { verify: "none" },
  }),
);
check(
  "the status line flags that a setting was overridden by hand",
  runStatusHook(statusSandbox).stdout.includes("+1 adhoc"),
  true,
);

fs.rmSync(statusSandbox, { recursive: true, force: true });

// ----------------------------------------------- recording what a session got

function runSessionHook(payload, configDir) {
  return require("child_process").spawnSync(
    process.execPath,
    [path.join(__dirname, "..", "hooks", "mode-session.js")],
    {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    },
  );
}

const sessionSandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-sess-"));

const noMode = runSessionHook({ session_id: "s9" }, sessionSandbox);
check("with no mode applied the session hook exits clean", noMode.status, 0);
check("with no mode applied it announces nothing", noMode.stdout.trim(), "");

fs.writeFileSync(
  path.join(sessionSandbox, "mode.lock"),
  JSON.stringify({
    mode: "review",
    codename: "APPRAISER",
    hardHash: "cafe1234",
    deniedTools: ["Write", "Edit"],
    skillsHidden: 40,
    subagents: "none",
  }),
);

const announced = runSessionHook({ session_id: "s9" }, sessionSandbox);
const context = JSON.parse(announced.stdout).hookSpecificOutput.additionalContext;
check("the session hook announces the mode by codename", context.includes("APPRAISER"), true);
check("it says what is gated", context.includes("2 tools gated"), true);
check("it says how many skills are hidden", context.includes("40 skills hidden"), true);
// Being told the frozen half is frozen is the whole point: a model that thinks
// a mid-session switch took hold completely will report work as done under a
// posture that was never fully in force.
check("it warns that the frozen half needs a new session", context.includes("CORRUPTED"), true);

check(
  "the session records the posture it actually loaded",
  JSON.parse(
    fs.readFileSync(path.join(sessionSandbox, "cache", "mode-session", "s9"), "utf8"),
  ).hardHash,
  "cafe1234",
);

fs.rmSync(sessionSandbox, { recursive: true, force: true });

// ------------------------------------------------------------- ccfg mode

// Driven through the real binary rather than by calling commandMode directly:
// a command that works when required but is not in the dispatch table is the
// exact regression this catches.
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

// ------------------------------------------------- mode-scoped commands

const commands = require("./modes/commands.js");

function commandSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-cmds-"));
  fs.mkdirSync(path.join(root, "commands"), { recursive: true });
  fs.mkdirSync(path.join(root, "modes", "commands", "trace"), {
    recursive: true,
  });
  return root;
}

function writeModeCommand(root, mode, name, body) {
  fs.mkdirSync(path.join(root, "modes", "commands", mode), { recursive: true });
  fs.writeFileSync(path.join(root, "modes", "commands", mode, `${name}.md`), body);
}

const PLAIN_COMMAND = "---\ndescription: Narrow the repro\n---\n\nShrink it.\n";

{
  const root = commandSandbox();
  writeModeCommand(root, "trace", "narrow", PLAIN_COMMAND);
  const installed = commands.install(root, "trace", ["narrow"], []);
  check("a mode command is written into commands/", installed.length, 1);
  check(
    "the installed file carries the mode command body",
    fs.readFileSync(path.join(root, "commands", "narrow.md"), "utf8").includes("Shrink it."),
    true,
  );
}

{
  const root = commandSandbox();
  writeModeCommand(root, "trace", "narrow", PLAIN_COMMAND);
  commands.install(root, "trace", ["narrow"], []);
  commands.remove(root, ["narrow"]);
  check(
    "taking the mode off removes its command again",
    fs.existsSync(path.join(root, "commands", "narrow.md")),
    false,
  );
}

// A slash command's frontmatter can grant tool access, so an unchecked mode
// command would be a way around the rule that a mode may only subtract.
{
  const root = commandSandbox();
  writeModeCommand(
    root,
    "trace",
    "escalate",
    "---\ndescription: x\nallowed-tools: Bash(*)\n---\n\nrun it\n",
  );
  let message = "";
  try {
    commands.install(root, "trace", ["escalate"], []);
  } catch (error) {
    message = error.message;
  }
  check(
    "a mode command that grants tools is refused",
    message.includes("allowed-tools"),
    true,
  );
  check(
    "the refused command is not written",
    fs.existsSync(path.join(root, "commands", "escalate.md")),
    false,
  );
}

{
  const root = commandSandbox();
  fs.writeFileSync(path.join(root, "commands", "commit.md"), "mine\n");
  writeModeCommand(root, "trace", "commit", PLAIN_COMMAND);
  let message = "";
  try {
    commands.install(root, "trace", ["commit"], []);
  } catch (error) {
    message = error.message;
  }
  check(
    "a mode may not replace a command the operator already has",
    message.includes("already"),
    true,
  );
  check(
    "the operator's own command is left untouched",
    fs.readFileSync(path.join(root, "commands", "commit.md"), "utf8"),
    "mine\n",
  );
}

// A declared name is used to build a path, so it must never be able to leave
// the mode's own command directory.
{
  const root = commandSandbox();
  let message = "";
  try {
    commands.install(root, "trace", ["../../../etc/passwd"], []);
  } catch (error) {
    message = error.message;
  }
  check(
    "a command name that escapes its directory is refused",
    message.includes("name"),
    true,
  );
}

{
  const root = commandSandbox();
  writeModeCommand(root, "trace", "narrow", PLAIN_COMMAND);
  let message = "";
  try {
    commands.install(root, "trace", ["missing"], []);
  } catch (error) {
    message = error.message;
  }
  check(
    "a declared command with no file is refused",
    message.includes("missing"),
    true,
  );
}

// Switching modes must clear the previous mode's commands before installing
// its own, or a command outlives the mode that carried it.
{
  const root = commandSandbox();
  writeModeCommand(root, "trace", "narrow", PLAIN_COMMAND);
  writeModeCommand(root, "review", "verdict", PLAIN_COMMAND);
  const first = commands.install(root, "trace", ["narrow"], []);
  const second = commands.install(root, "review", ["verdict"], first);
  check("switching installs the new mode's command", second.includes("verdict"), true);
  check(
    "switching removes the previous mode's command",
    fs.existsSync(path.join(root, "commands", "narrow.md")),
    false,
  );
}

// The session banner is the only place a mode's commands are announced, and a
// command nobody knows about is one nobody types.
{
  const root = commandSandbox();
  fs.writeFileSync(
    path.join(root, "mode.lock"),
    JSON.stringify({
      mode: "debug",
      codename: "TRACE",
      deniedTools: [],
      installedCommands: ["narrow"],
    }),
  );
  const out = require("child_process").spawnSync(
    process.execPath,
    [path.join(__dirname, "..", "hooks", "mode-session.js")],
    {
      input: JSON.stringify({ session_id: "cmd-banner" }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: root },
    },
  ).stdout;
  check(
    "the session banner names the commands the mode carries",
    out.includes("/narrow"),
    true,
  );
}

fs.rmSync(SANDBOX_CONFIG, { recursive: true, force: true });

console.log(`\nPASS ${passed}  FAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
