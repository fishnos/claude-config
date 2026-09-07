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
  "verify runs none, tested, proven",
  settings.SETTINGS.verify.values.join(","),
  "none,tested,proven",
);

check(
  "a value at the threshold counts as at or above it",
  settings.atOrAbove("verify", "tested", "tested"),
  true,
);

check(
  "a value past the threshold counts as at or above it",
  settings.atOrAbove("verify", "proven", "tested"),
  true,
);

check(
  "a value below the threshold does not",
  settings.atOrAbove("verify", "none", "tested"),
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
    "---\nid: x\nsetting: verify\nonly_at: tested\n---\nb\n",
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
    primary_at: "proven",
    body: "Prove it.",
    file: "a.md",
  },
  {
    id: "run",
    setting: "verify",
    primary_at: "tested",
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

const strict = render.band(CORPUS, { verify: "proven", claims: "loose" });
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
  repo: { name: "spike", settings: { verify: "proven" } },
  adhoc: { voice: "prose" },
});
check(
  "a repo mode overrides the personal mode of the same name",
  layered.settings.verify,
  "proven",
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
// not sit there. Only the single generated render belongs there, which is the
// sorted copy.
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
// test once a setting is categorical, because the caveman rules are correctly
// not primary under ship, which speaks normal prose. What must hold is that no rule
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
// nothing and reports (none) while showing the applied posture, a display
// that contradicts itself and hides which mode is live.
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

// A session that starts with no mode still runs with a model, an effort level
// and every skill visible. Recording that as "nothing" made the first switch of
// any session compare a real hash against null and always report CORRUPTED --
// the loudest warning in the system firing on the most ordinary action.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-baseline-"));
  fs.writeFileSync(
    path.join(root, "settings.json"),
    JSON.stringify({ model: "claude-opus-5", effortLevel: "high" }),
  );
  require("child_process").spawnSync(
    process.execPath,
    [path.join(__dirname, "..", "hooks", "mode-session.js")],
    {
      input: JSON.stringify({ session_id: "baseline" }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: root },
    },
  );
  const recorded = JSON.parse(
    fs.readFileSync(path.join(root, "cache", "mode-session", "baseline"), "utf8"),
  );
  const bare = glitch.parseGlitch(undefined, "none");
  check(
    "a session with no mode records its baseline, not nothing",
    recorded.hardHash,
    glitch.hardHash(bare, { model: "claude-opus-5", effortLevel: "high" }),
  );
}

// The warning has to stay loud for the case it was built for.
{
  const bare = glitch.parseGlitch(undefined, "none");
  const hidesSkills = glitch.parseGlitch({ skills: { off: ["graphify"] } }, "m");
  check(
    "a mode that hides a skill still differs from the baseline",
    glitch.hardHash(hidesSkills, {}) === glitch.hardHash(bare, {}),
    false,
  );
  check(
    "a mode that changes no hard field matches the baseline",
    glitch.hardHash(bare, { model: "x", effortLevel: "y" }) ===
      glitch.hardHash(bare, { model: "x", effortLevel: "y" }),
    true,
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
    verify: "tested",
    claims: "labeled",
    process: "light",
    asking: "sometimes",
    code: "polished",
    subagents: "few",
    voice: "caveman",
  },
  toSettings: {
    verify: "none",
    claims: "labeled",
    process: "skip",
    asking: "never",
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
  /verify\s+tested -> none/.test(drawn),
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

// The banner is painted in the mode's own hue, so a switch is recognised by
// colour before a word of it is read.
{
  const lit = banner.renderBanner({ ...SWITCH, plain: false, color: 226, icon: "\u25b2" });
  check(
    "a switch is painted in the mode's colour",
    lit.includes("\u001b[38;5;226m"),
    true,
  );
  check("the arrow carries the mode's glyph", lit.includes("\u25b2 SPIKE"), true);
  check(
    "a mode with no colour still renders",
    banner
      .renderBanner({ ...SWITCH, plain: false, color: null })
      .includes("CARTRIDGE SWAP"),
    true,
  );
  check(
    "plain suppresses the colour too",
    /\u001b\[/.test(banner.renderBanner({ ...SWITCH, plain: true, color: 226 })),
    false,
  );
}

// A mode pins an effort level, never a model.
check(
  "the banner labels the effort row for what it is",
  /effort\s+low/.test(drawn) && !/^\s*model/m.test(drawn),
  true,
);
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
    JSON.stringify({ mode, settings: { verify: "proven" }, appliedAt: stamp }),
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
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, NO_COLOR: "1" },
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
    codename: "FIXER",
    icon: "\u25c6",
    settings: { verify: "proven", asking: "always", voice: "normal" },
    adhoc: {},
  }),
);
const shipStatus = runStatusHook(statusSandbox).stdout.trim();
check("the status line names the mode", shipStatus.includes("FIXER"), true);
// The line carries the glyph and the name and stops. Everything else about a
// mode is one keystroke away in `/mode`, and a status line long enough to
// skim past stops being read, which is the only job it has.
check(
  "the status line leads with the mode's own glyph",
  shipStatus.startsWith("\u25c6"),
  true,
);
check(
  "the status line spends no room on the dials",
  shipStatus.includes("proven") || shipStatus.includes("always"),
  false,
);

fs.writeFileSync(
  path.join(statusSandbox, "mode.lock"),
  JSON.stringify({
    mode: "ship",
    codename: "FIXER",
    icon: "\u25c6",
    settings: { verify: "none", asking: "never", voice: "normal" },
    adhoc: { verify: "none" },
  }),
);
check(
  "the status line shows the codename, not the file name",
  runStatusHook(statusSandbox).stdout.trim(),
  "\u25c6 FIXER",
);

// A mode file written before icons existed still has to render.
fs.writeFileSync(
  path.join(statusSandbox, "mode.lock"),
  JSON.stringify({ mode: "ship", codename: "FIXER", settings: {}, adhoc: {} }),
);
check(
  "a lock with no glyph falls back rather than rendering undefined",
  runStatusHook(statusSandbox).stdout.trim(),
  "\u25a0 FIXER",
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
  /verify\s+none\s*->\s*proven/.test(diffed.stdout),
  true,
);

const unknown = runCcfg(["mode", "nonexistent"]);
check("an unknown mode exits non-zero", unknown.status !== 0, true);
check(
  "an unknown mode says so on stderr",
  unknown.stderr.includes("nonexistent"),
  true,
);

// `mode list` prints codenames in the first column, so a codename is what
// someone types. Driven through `diff`, which resolves both names and writes
// nothing, since applying a mode here would change the real configuration.
check(
  "a codename resolves",
  runCcfg(["mode", "diff", "NETRUNNER", "ship"]).status,
  0,
);
check(
  "a codename resolves whatever the case",
  runCcfg(["mode", "diff", "netrunner", "ship"]).status,
  0,
);
check(
  "the plain name still resolves",
  runCcfg(["mode", "diff", "research", "ship"]).status,
  0,
);
check(
  "a codename and its plain name are the same mode",
  runCcfg(["mode", "diff", "NETRUNNER", "ship"]).stdout,
  runCcfg(["mode", "diff", "research", "ship"]).stdout,
);

// A name nobody can act on is worth less than the list of names they can.
{
  const missed = runCcfg(["mode", "diff", "EDGERUNNER", "ship"]);
  check("an unknown name exits non-zero", missed.status, 2);
  check(
    "an unknown name is answered with the ones that work",
    missed.stderr.includes("NETRUNNER") && missed.stderr.includes("research"),
    true,
  );
}

// The name becomes a path, so it must not be able to leave modes/.
{
  const escaped = runCcfg(["mode", "diff", "../../../etc/passwd", "ship"]);
  check("a mode name cannot escape the modes directory", escaped.status, 2);
}

// A mode that pins no model must hand the operator's own back, not inherit the
// last mode's. Same shape as the skill-override leak: computing from the
// current settings instead of the operator's baseline makes every mode after
// the first inherit its predecessor's output.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-pins-"));
  fs.mkdirSync(path.join(root, "rules"), { recursive: true });
  for (const directory of ["modes", "tools", "hooks"])
    fs.cpSync(path.join(__dirname, "..", directory), path.join(root, directory), {
      recursive: true,
    });
  fs.writeFileSync(
    path.join(root, "settings.json"),
    JSON.stringify({ model: "claude-sonnet-5", effortLevel: "low" }, null, 2),
  );

  const ccfg = (...args) =>
    require("child_process").spawnSync(
      process.execPath,
      [path.join(root, "tools", "ccfg.js"), "mode", ...args],
      { encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: root } },
    );
  const settingsNow = () =>
    JSON.parse(fs.readFileSync(path.join(root, "settings.json"), "utf8"));

  ccfg("build");
  check(
    "a mode that pins an effort level applies it",
    settingsNow().effortLevel,
    "high",
  );
  check(
    "applying a mode leaves the operator's model alone",
    settingsNow().model,
    "claude-sonnet-5",
  );

  ccfg("nomad");
  check(
    "a mode pinning no effort restores the operator's",
    settingsNow().effortLevel,
    "low",
  );

  ccfg("build");
  ccfg("revert");
  check(
    "revert restores the operator's effort level",
    settingsNow().effortLevel,
    "low",
  );
  check(
    "revert leaves the operator's model as it found it",
    settingsNow().model,
    "claude-sonnet-5",
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// A mode tunes how the work is done, never which model does it. Ten modes once
// pinned "claude-opus-5", which silently dropped an operator running opus[1m]
// off the 1M-context model every time any mode was applied, a downgrade
// nothing in the banner or the status line mentioned.
{
  const shipped = path.join(__dirname, "..", "modes");
  for (const file of fs.readdirSync(shipped).filter((n) => n.endsWith(".json"))) {
    const mode = JSON.parse(fs.readFileSync(path.join(shipped, file), "utf8"));
    check(
      `${path.basename(file, ".json")} leaves the model to the operator`,
      "model" in (mode.projects || {}),
      false,
    );
  }
}

// Two chats open at once are two sessions, each with its own startup snapshot.
// Reading "the newest marker" instead of "this session's marker" made one chat
// report the other's state, so a chat that really was half-applied showed
// clean because a newer chat had started since.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-two-chats-"));
  const markers = path.join(root, "cache", "mode-session");
  fs.mkdirSync(markers, { recursive: true });
  fs.writeFileSync(
    path.join(root, "mode.lock"),
    JSON.stringify({ mode: "review", codename: "APPRAISER", hardHash: "newhash" }),
  );
  // Chat A started before the switch and is genuinely half-applied.
  fs.writeFileSync(
    path.join(markers, "chat-a"),
    JSON.stringify({ hardHash: "oldhash", mode: null }),
  );
  // Chat B started after it and is whole. Written second, so it is newest.
  fs.writeFileSync(
    path.join(markers, "chat-b"),
    JSON.stringify({ hardHash: "newhash", mode: "review" }),
  );

  const { integrity } = require("./modes/command.js");
  check(
    "the chat that is half-applied says so",
    integrity(root, "chat-a").state,
    "corrupted",
  );
  check(
    "the chat that is whole says so",
    integrity(root, "chat-b").state,
    "clean",
  );
  check(
    "a session with no marker borrows no other chat's verdict",
    integrity(root, "chat-never-started").state,
    "unknown",
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// The status line is told which session it is drawing for on stdin. Reading the
// environment instead found nothing, which is what sent it to the newest marker.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-status-session-"));
  const markers = path.join(root, "cache", "mode-session");
  fs.mkdirSync(markers, { recursive: true });
  fs.writeFileSync(
    path.join(root, "mode.lock"),
    JSON.stringify({
      mode: "review",
      codename: "APPRAISER",
      icon: "\u25c8",
      hardHash: "newhash",
    }),
  );
  fs.writeFileSync(
    path.join(markers, "chat-a"),
    JSON.stringify({ hardHash: "oldhash" }),
  );
  fs.writeFileSync(
    path.join(markers, "chat-b"),
    JSON.stringify({ hardHash: "newhash" }),
  );
  const drawFor = (sessionId) =>
    require("child_process").spawnSync(
      process.execPath,
      [path.join(__dirname, "..", "hooks", "mode-status.js")],
      {
        input: JSON.stringify({ session_id: sessionId }),
        encoding: "utf8",
        env: {
          ...process.env,
          CLAUDE_CONFIG_DIR: root,
          CLAUDE_SESSION_ID: "",
          NO_COLOR: "1",
        },
      },
    ).stdout.trim();

  check(
    "the status line marks the half-applied chat",
    drawFor("chat-a"),
    "\u25c8 APPRAISER ~CORRUPTED",
  );
  check(
    "the status line leaves the whole chat unmarked",
    drawFor("chat-b"),
    "\u25c8 APPRAISER",
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// A session-start notice written only as additionalContext reaches the model
// and nobody else, because Claude Code delivers it as a system reminder rather
// than showing it. From the outside that is indistinguishable from a hook
// that never ran, which is exactly how it looked. systemMessage is the half
// the operator actually sees.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-announce-"));
  fs.writeFileSync(
    path.join(root, "mode.lock"),
    JSON.stringify({
      mode: "review",
      codename: "APPRAISER",
      icon: "\u25c8",
      deniedTools: ["Edit", "Write"],
      skillsHidden: 3,
      hardHash: "h",
    }),
  );
  const out = require("child_process").spawnSync(
    process.execPath,
    [path.join(__dirname, "..", "hooks", "mode-session.js")],
    {
      input: JSON.stringify({ session_id: "announce-1" }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: root },
    },
  ).stdout;
  const emitted = JSON.parse(out);
  // Read through a string that is never undefined: a hook that emits no visible
  // message should fail all four checks below, not throw on the second one and
  // hide the other three.
  const visible = typeof emitted.systemMessage === "string" ? emitted.systemMessage : "";

  check(
    "the session start is announced where the operator can see it",
    visible.includes("APPRAISER"),
    true,
  );
  check(
    "the visible notice carries the mode's glyph",
    visible.includes("\u25c8"),
    true,
  );
  check(
    "the visible notice says what the mode took away",
    /2 tools/.test(visible) && /3 skills/.test(visible),
    true,
  );
  check(
    "the model still gets its own context",
    emitted.hookSpecificOutput.additionalContext.includes("APPRAISER"),
    true,
  );

  // No mode, nothing to announce. A banner on every plain session is noise.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-announce-bare-"));
  const quiet = require("child_process").spawnSync(
    process.execPath,
    [path.join(__dirname, "..", "hooks", "mode-session.js")],
    {
      input: JSON.stringify({ session_id: "announce-2" }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: bare },
    },
  ).stdout.trim();
  check("a session with no mode announces nothing", quiet, "");
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
}

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

// Every command a shipped mode declares must have a file behind it. A mode
// naming a command it does not carry cannot be applied at all, so this is the
// difference between a working clone and one where `ccfg mode debug` throws.
{
  const shipped = path.join(__dirname, "..", "modes");
  for (const file of fs.readdirSync(shipped).filter((n) => n.endsWith(".json"))) {
    const mode = JSON.parse(fs.readFileSync(path.join(shipped, file), "utf8"));
    for (const name of ((mode.glitch || {}).commands) || []) {
      check(
        `${path.basename(file, ".json")} carries the file for /${name}`,
        fs.existsSync(
          path.join(shipped, "commands", path.basename(file, ".json"), `${name}.md`),
        ),
        true,
      );
    }
  }
}

// ------------------------------------------------- the shared cartridge look

const ink = require("./modes/ink.js");

// The escape byte every colour code starts with, built rather than typed so
// this file stays free of control characters.
const ESC = String.fromCharCode(27);

// The inherited environment, aliased once so a spawn below reads as a list of
// overrides rather than a wall of spread syntax.
const ENVIRONMENT = process.env;

{
  const flat = ink.painter(true, null);
  const scale = ["rough", "decent", "polished"];

  check(
    "a dial at the bottom of its scale fills one step",
    ink.gauge(scale, "rough", flat),
    "[#--]",
  );
  check(
    "a dial at the top of its scale fills every step",
    ink.gauge(scale, "polished", flat),
    "[###]",
  );
  check(
    "a value that is not on the scale draws no bar",
    ink.gauge(scale, "immaculate", flat),
    "[???]",
  );

  const framed = ink
    .frame({
      title: "CARTRIDGE RACK",
      rows: [{ left: "11 SLOTS", right: "LOADED: NOMAD" }],
      ink: flat,
    })
    .split("\n");
  check(
    "the frame carries its title in the top rule",
    framed[0].includes("- CARTRIDGE RACK -"),
    true,
  );
  check(
    "the frame pins a tag to its right edge",
    framed[1].endsWith("LOADED: NOMAD |"),
    true,
  );

  // Padding counts cells, not bytes. Counting bytes would run a coloured row
  // long and walk the frame's right border off the edge.
  const lit = ink
    .frame({
      title: "CARTRIDGE RACK",
      rows: [{ left: "11 SLOTS", right: "LOADED: NOMAD" }],
      ink: ink.painter(false, 45),
    })
    .split("\n");
  check(
    "colour does not change how wide a row is",
    ink.visibleWidth(lit[1]),
    ink.visibleWidth(framed[1]),
  );
}

// ------------------------------------------------------------------- the rack

{
  const racked = runCcfg(["mode", "list"]);
  check("the rack frames the list", racked.stdout.includes("CARTRIDGE RACK"), true);
  check(
    "the rack marks exactly one cartridge as loaded",
    racked.stdout.split("\n").filter((line) => line.startsWith("  > ")).length,
    1,
  );
  check(
    "the rack carries every mode's glyph",
    ["▚", "⣤", "▨", "⣿"].every((glyph) =>
      racked.stdout.includes(glyph),
    ),
    true,
  );
  check("the rack still says what a mode gates", /tools gated/.test(racked.stdout), true);
}

// ------------------------------------------------------------ the status view

{
  const view = runCcfg(["mode"]);
  check(
    "the status view frames the active cartridge",
    view.stdout.includes("ACTIVE CARTRIDGE"),
    true,
  );
  check(
    "the status view reports whether the mode is whole",
    /\[(CLEAN|CORRUPTED|UNKNOWN)\]/.test(view.stdout),
    true,
  );
  check("an ordered dial gets a gauge", /verify\s+\[[#-]{3}\]/.test(view.stdout), true);
  // voice is a set of registers with no ladder between them, so a bar would
  // claim a ranking that does not exist.
  check("the register gets no gauge", /voice\s+\[[#-]/.test(view.stdout), false);
  check(
    "the status view says why the register has no gauge",
    view.stdout.includes("not a level"),
    true,
  );
  check(
    "the status view still counts both rule bands",
    /\d+ primary, \d+ standing/.test(view.stdout),
    true,
  );
}

// ----------------------------------------------------------------- the paint

// `ccfg mode` inside Claude Code writes to a pipe, not a terminal, so the
// automatic answer there is always "no colour". --color is how the paint is
// seen anywhere but a bare shell.
{
  check(
    "--color paints the rack through a pipe",
    runCcfg(["mode", "list", "--color"]).stdout.includes(ESC + "[38;5;"),
    true,
  );
  check(
    "--plain leaves no escape codes",
    runCcfg(["mode", "list", "--plain"]).stdout.includes(ESC),
    false,
  );
  check(
    "--color paints the status view too",
    runCcfg(["mode", "--color"]).stdout.includes(ESC + "[38;5;"),
    true,
  );
}

// ------------------------------------------------------------ the status line

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-statusline-"));
  const writeLock = (extra) =>
    fs.writeFileSync(
      path.join(root, "mode.lock"),
      JSON.stringify({
        mode: "build",
        codename: "RUNNER",
        icon: "▶",
        hardHash: "h",
        ...extra,
      }),
    );
  const drawLine = (overrides) =>
    require("child_process").spawnSync(
      process.execPath,
      [path.join(__dirname, "..", "hooks", "mode-status.js")],
      {
        input: JSON.stringify({ session_id: "statusline-1" }),
        encoding: "utf8",
        env: { ...ENVIRONMENT, CLAUDE_CONFIG_DIR: root, ...overrides },
      },
    ).stdout;

  writeLock({ color: 45 });
  const painted = drawLine({ NO_COLOR: "" });
  check(
    "the status line paints the mode in its own colour",
    painted.includes(ESC + "[38;5;45m"),
    true,
  );
  check("the status line still names the mode", painted.includes("RUNNER"), true);
  check(
    "the status line honours NO_COLOR",
    drawLine({ NO_COLOR: "1" }).includes(ESC),
    false,
  );

  writeLock({});
  check(
    "a lock with no colour still draws the status line",
    drawLine({ NO_COLOR: "1" }).includes("▶ RUNNER"),
    true,
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// The status line reads the colour off the lock, so applying a mode has to put
// it there: the mode file is never opened again at status-line time.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-lockcolour-"));
  fs.mkdirSync(path.join(root, "rules"), { recursive: true });
  fs.mkdirSync(path.join(root, "modes"), { recursive: true });
  fs.writeFileSync(path.join(root, "settings.json"), "{}\n");
  apply.applyMode(
    root,
    modes.parseMode({ ...SPIKE, color: 226 }, "spike.json"),
    CORPUS,
    {},
  );
  const lock = JSON.parse(fs.readFileSync(path.join(root, "mode.lock"), "utf8"));
  check("applying a mode records its colour in the lock", lock.color, 226);
  fs.rmSync(root, { recursive: true, force: true });
}

// One gated tool is one tool. The count reads back in the rack, the status view
// and the notice at session start, so a stray "1 tools" would show up three
// times over.
{
  const racked = runCcfg(["mode", "list"]).stdout;
  check("one gated tool is not pluralised", /\[1 tool gated/.test(racked), true);
  check("more than one still is", /\d+ tools gated/.test(racked), true);
}

// The dials say how a posture behaves; the description is the only line that
// says what it is for.
{
  const lockPath = path.join(REAL_CONFIG, "mode.lock");
  const lock = fs.existsSync(lockPath)
    ? JSON.parse(fs.readFileSync(lockPath, "utf8"))
    : null;
  const file =
    lock === null
      ? null
      : JSON.parse(
          fs.readFileSync(
            path.join(REAL_CONFIG, "modes", `${lock.mode}.json`),
            "utf8",
          ),
        );
  check(
    "the status view carries the active mode's description",
    file === null || runCcfg(["mode"]).stdout.includes(file.description),
    true,
  );
}

// What a mode took away, phrased once for every surface that says it.
{
  const { gatesOf } = require("./modes/command.js");

  check(
    "a mode that gates nothing lists nothing",
    gatesOf({ tools: [], skills: null, subagents: null, commands: [] }).length,
    0,
  );
  check(
    "the rack names a skill rule it cannot count",
    gatesOf({ tools: [], skills: ["design-*"], commands: [] }).join(", "),
    "skills gated",
  );
  check(
    "the status view counts the skills the lock actually hid",
    gatesOf({ tools: ["Edit", "Write"], skills: 3, commands: [] }).join(", "),
    "2 tools gated, 3 skills hidden",
  );
  check(
    "a solo mode says so",
    gatesOf({ tools: [], skills: null, subagents: "none", commands: [] }).join(", "),
    "solo",
  );
  check(
    "a mode's own slash commands are listed by name",
    gatesOf({ tools: [], skills: null, commands: ["narrow", "verdict"] }).join(", "),
    "/narrow /verdict",
  );
}

// Chrome recedes. Painting the border in the mode's hue put three more lines of
// one colour on a screen that already carried the name, every changed value and
// the closing line in it, and a strong hue came out as a flat wash.
{
  const lines = ink
    .frame({
      title: "ACTIVE CARTRIDGE",
      rows: [{ left: ink.painter(false, 45).accent("RUNNER"), right: "[CLEAN]" }],
      ink: ink.painter(false, 45),
    })
    .split("\n");
  check(
    "the frame border is not painted in the mode's hue",
    lines[0].includes(ESC + "[38;5;45m"),
    false,
  );
  check(
    "what sits inside the frame still is",
    lines[1].includes(ESC + "[38;5;45m"),
    true,
  );
}

// A glyph and a hue are how a mode is told apart at a glance on four different
// surfaces. Two modes sharing either one makes both unreadable.
{
  const shipped = fs
    .readdirSync(path.join(__dirname, "..", "modes"))
    .filter((name) => name.endsWith(".json"))
    .map((name) =>
      JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "modes", name), "utf8"),
      ),
    );
  check(
    "every shipped mode has its own glyph",
    new Set(shipped.map((mode) => mode.icon)).size,
    shipped.length,
  );
  check(
    "every shipped mode has its own colour",
    new Set(shipped.map((mode) => mode.color)).size,
    shipped.length,
  );
}

// The lock caches the glyph and hue so a surface can usually answer from one
// small file, but it is written at the last switch. Editing a mode's look and
// seeing nothing change until the next switch is the confusing case, so the
// mode file wins.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-stale-look-"));
  fs.mkdirSync(path.join(root, "modes"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "modes", "ship.json"),
    JSON.stringify({
      name: "ship",
      codename: "FIXER",
      icon: "█",
      color: 131,
      settings: {},
    }),
  );
  fs.writeFileSync(
    path.join(root, "mode.lock"),
    JSON.stringify({
      mode: "ship",
      codename: "FIXER",
      icon: "◆",
      color: 203,
      hardHash: "h",
    }),
  );
  const drawn = require("child_process").spawnSync(
    process.execPath,
    [path.join(__dirname, "..", "hooks", "mode-status.js")],
    {
      input: JSON.stringify({ session_id: "stale-1" }),
      encoding: "utf8",
      env: { ...ENVIRONMENT, CLAUDE_CONFIG_DIR: root },
    },
  ).stdout;

  check("an edited glyph reaches the status line without a switch", drawn.includes("█"), true);
  check("the lock's stale glyph is not drawn", drawn.includes("◆"), false);
  check(
    "an edited colour reaches it too",
    drawn.includes(ESC + "[38;5;131m"),
    true,
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// -------------------------------------------- a comparison is not a switch

// `ccfg mode diff` changes nothing, and used to print the same banner as a
// switch: the same CARTRIDGE SWAP heading, the same POWERING UP at the bottom.
// Reading that as "it swapped" is the obvious mistake, and the output invited
// it.
{
  const LOOK = { icon: "▘", fromIcon: "▚" };
  const swapped = banner.renderBanner({ ...SWITCH, ...LOOK, plain: true });
  const compared = banner.renderBanner({
    ...SWITCH,
    ...LOOK,
    plain: true,
    applied: false,
  });

  check("a switch still says it swapped", swapped.includes("CARTRIDGE SWAP"), true);
  check("a switch still says it came up", swapped.includes("POWERING UP"), true);

  check(
    "a comparison does not claim a swap",
    compared.includes("CARTRIDGE SWAP") || compared.includes("POWERING UP"),
    false,
  );
  check("a comparison says what it is", compared.includes("COMPARE"), true);
  check(
    "a comparison says outright that nothing happened",
    compared.includes("nothing applied"),
    true,
  );
  check(
    "a comparison names the command that would apply it",
    compared.includes("ccfg mode spike"),
    true,
  );

  // The heading used to read BREACH PROTOCOL, which named nothing that was
  // happening in either case.
  check(
    "neither heading is decoration",
    swapped.includes("BREACH") || compared.includes("BREACH"),
    false,
  );

  // Five of the seven dials move between build and spike; claims and voice hold.
  check("the frame counts the dials that moved", /5 of 7 dials/.test(swapped), true);
  check("and the ones that differ", /5 of 7 dials/.test(compared), true);

  check(
    "both modes sit in the frame with their glyphs",
    compared.includes("▚ BUILD") && compared.includes("▘ SPIKE"),
    true,
  );
}

// An unchanged dial recedes so the reader lands on the ones that moved, which
// is what anyone wants at the moment of a switch.
{
  const lit = banner.renderBanner({ ...SWITCH, plain: false, color: 107 });
  const claims = lit.split("\n").find((line) => line.includes("claims"));
  const verify = lit.split("\n").find((line) => line.includes("verify"));
  check("a dial that held is dimmed", claims.includes(ESC + "[2m"), true);
  check("a dial that moved is not", verify.includes(ESC + "[38;5;107m"), true);
}

// The comparison the operator actually runs, through the real binary.
{
  const compared = runCcfg(["mode", "diff", "spike", "ship"]).stdout;
  check("the real comparison says nothing happened", compared.includes("nothing applied"), true);
  check("the real comparison does not say POWERING UP", compared.includes("POWERING UP"), false);
}

// A real switch, driven through the binary in a throwaway config.
//
// The arrow has two sides and they come from different places: the mode being
// left is read off the lock, the mode being loaded off its file. Reading the
// lock after the switch had already rewritten it put the arriving glyph on both
// sides, and no unit test could see that because both sides were correct in
// isolation.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-switch-"));
  fs.symlinkSync(path.join(__dirname, "..", "modes"), path.join(root, "modes"));
  fs.mkdirSync(path.join(root, "rules"), { recursive: true });
  fs.mkdirSync(path.join(root, "commands"), { recursive: true });
  fs.writeFileSync(path.join(root, "settings.json"), "{}\n");

  const switchTo = (name) =>
    require("child_process").spawnSync(
      process.execPath,
      [path.join(__dirname, "ccfg.js"), "mode", name],
      {
        encoding: "utf8",
        env: { ...ENVIRONMENT, CLAUDE_CONFIG_DIR: root, NO_COLOR: "1" },
      },
    ).stdout;

  switchTo("spike");
  const landed = switchTo("ship");

  check("the switch names the mode being left", landed.includes("▘ RECON"), true);
  check("and the one being loaded", landed.includes("█ FIXER"), true);
  check(
    "the arriving glyph is not on both sides",
    landed.split("█ FIXER").length - 1,
    1,
  );
  check("a real switch says it powered up", landed.includes("POWERING UP"), true);
  fs.rmSync(root, { recursive: true, force: true });
}

// A hook a mode turned off comes back when a mode that does not turn it off is
// applied.
//
// Hooks used to be stripped from the live settings rather than rebuilt from the
// operator's own, so the removal compounded: RECON turns off the self-review
// reminder, and every mode applied afterwards inherited a config with the hook
// already gone. Nothing ever put it back. A guardrail silently missing is the
// exact failure the subtract-only design exists to prevent, and it survived a
// switch, a revert and a restart.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-hook-restore-"));
  fs.mkdirSync(path.join(root, "rules"), { recursive: true });
  fs.mkdirSync(path.join(root, "modes"), { recursive: true });
  const reminder = {
    matcher: "*",
    hooks: [{ type: "command", command: "node hooks/review-reminder.js" }],
  };
  fs.writeFileSync(
    path.join(root, "settings.json"),
    JSON.stringify({ hooks: { Stop: [reminder] } }, null, 2) + "\n",
  );

  const silencer = modes.parseMode(
    { name: "quiet", settings: {}, disableHooks: ["review-reminder.js"] },
    "quiet.json",
  );
  const plain = modes.parseMode({ name: "plain", settings: {} }, "plain.json");

  apply.applyMode(root, silencer, CORPUS, {});
  const gagged = JSON.parse(
    fs.readFileSync(path.join(root, "settings.json"), "utf8"),
  );
  check(
    "a mode that turns a hook off takes it out of settings",
    JSON.stringify(gagged.hooks).includes("review-reminder"),
    false,
  );

  apply.applyMode(root, plain, CORPUS, {});
  const restored = JSON.parse(
    fs.readFileSync(path.join(root, "settings.json"), "utf8"),
  );
  check(
    "the next mode puts the hook back",
    JSON.stringify(restored.hooks).includes("review-reminder"),
    true,
  );

  fs.rmSync(root, { recursive: true, force: true });
}

fs.rmSync(SANDBOX_CONFIG, { recursive: true, force: true });

console.log(`\nPASS ${passed}  FAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
