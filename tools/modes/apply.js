"use strict";

// Putting a mode into force, and taking it back out.
//
// The order of operations is the whole module. A switch that removed the commit
// guard and then failed halfway would leave the operator unprotected and
// believing otherwise, which is the worst outcome this system can produce. So
// the protected-hook check runs before anything touches disk, and the undo
// target is a byte copy of the settings file rather than a list of differences:
// restoring a copy cannot half-apply, and a diff can.

const fs = require("fs");
const path = require("path");

const settings = require("./settings.js");
const modes = require("./modes.js");
const render = require("./render.js");
const glitch = require("./glitch.js");
const modeCommands = require("./commands.js");

const LOCK_NAME = "mode.lock";
const ACTIVE_RULES = path.join("rules", "_active.md");

/** Every skill installed, by directory name. */
function installedSkills(configDir) {
  try {
    return fs
      .readdirSync(path.join(configDir, "skills"))
      .filter((name) =>
        fs.existsSync(path.join(configDir, "skills", name, "SKILL.md")),
      );
  } catch {
    return [];
  }
}

function lockPath(configDir) {
  return path.join(configDir, LOCK_NAME);
}

function settingsPath(configDir) {
  return path.join(configDir, "settings.json");
}

function readLock(configDir) {
  try {
    return JSON.parse(fs.readFileSync(lockPath(configDir), "utf8"));
  } catch {
    return null;
  }
}

/** A byte copy of the settings file, kept as the undo target. */
function backupSettings(configDir) {
  const source = settingsPath(configDir);
  if (!fs.existsSync(source)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(configDir, "backups");
  fs.mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, `settings.${stamp}.json`);
  fs.copyFileSync(source, destination);
  return destination;
}

/** Every hook entry whose command names one of the given files, removed. */
function stripHooks(hooks, disabled) {
  if (!hooks || disabled.length === 0) return hooks;
  const kept = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      kept[event] = groups;
      continue;
    }
    const survivors = groups
      .map((group) => ({
        ...group,
        hooks: (group.hooks || []).filter(
          (entry) =>
            !disabled.some((file) =>
              String(entry.command || "").includes(file),
            ),
        ),
      }))
      .filter((group) => group.hooks.length > 0);
    if (survivors.length > 0) kept[event] = survivors;
  }
  return kept;
}

function writeSettings(configDir, value) {
  fs.writeFileSync(
    settingsPath(configDir),
    JSON.stringify(value, null, 2) + "\n",
  );
}

function renderTo(configDir, corpusRules, resolvedSettings, modeName) {
  const destination = path.join(configDir, ACTIVE_RULES);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(
    destination,
    render.renderActive(corpusRules, resolvedSettings, modeName),
  );
}

/**
 * Put a mode into force.
 *
 * Throws before writing anything if the mode tries to disable a protected hook,
 * so a refused switch leaves the configuration exactly as it found it.
 */
function applyMode(configDir, mode, corpusRules, adhoc = {}) {
  const violation = modes.coreHookViolation(mode);
  if (violation !== null)
    throw new Error(
      `${mode.name} tries to disable ${violation}, which no mode may turn off`,
    );

  // The undo target must be the configuration as it stood BEFORE any mode was
  // applied. Backing up on every switch would make the second switch snapshot
  // the first mode's output, and revert would then restore a mode rather than
  // the operator's own settings -- leaving skills hidden with no way back.
  const existing = readLock(configDir);

  // Checked here, before a byte is written, for the same reason the hook check
  // above is: a mode whose commands turn out to be unusable must fail while the
  // configuration is still whole, rather than halfway into the switch.
  const priorCommands = (existing && existing.installedCommands) || [];
  const plannedCommands = modeCommands.plan(
    configDir,
    mode.name,
    (mode.glitch || glitch.parseGlitch(undefined, mode.name)).commands,
    priorCommands,
  );

  const settingsBackup =
    existing &&
    existing.settingsBackup &&
    fs.existsSync(existing.settingsBackup)
      ? existing.settingsBackup
      : backupSettings(configDir);
  const resolved = modes.resolve({ personal: mode, adhoc });
  renderTo(configDir, corpusRules, resolved.settings, mode.name);

  const disabledHooks = mode.disableHooks || [];
  const layer = mode.glitch || glitch.parseGlitch(undefined, mode.name);
  let skillsHidden = 0;
  let baseSkillOverrides = {};

  if (fs.existsSync(settingsPath(configDir))) {
    const current = JSON.parse(
      fs.readFileSync(settingsPath(configDir), "utf8"),
    );
    // Settings a mode pins (the model, the effort level) are handed back to the
    // operator's own values when the next mode does not pin them. Overlaying
    // mode.projects onto `current` alone only overwrites, never clears, so
    // RUNNER's model survived a switch to NOMAD -- a mode that pins nothing and
    // is meant to read as an unmodified session.
    const operatorSettings =
      settingsBackup && fs.existsSync(settingsBackup)
        ? JSON.parse(fs.readFileSync(settingsBackup, "utf8"))
        : current;
    const pinning = mode.projects || {};
    const next = { ...current };
    for (const key of (existing && existing.pinnedKeys) || []) {
      if (key in pinning) continue;
      if (key in operatorSettings) next[key] = operatorSettings[key];
      else delete next[key];
    }
    Object.assign(next, pinning);
    if (current.hooks) next.hooks = stripHooks(current.hooks, disabledHooks);

    // Skill visibility is computed subtract-only from the operator's own
    // overrides. baseSkillOverrides in the lock is what revert puts back, so a
    // mode can never leave a skill hidden after it is taken off.
    // The operator's own overrides, from before any mode was applied. Computing
    // from `current` instead would compound: mode A hides a skill, mode B
    // inherits that as its baseline, and the skill stays hidden under every
    // mode after it regardless of what they ask for.
    const base =
      existing && existing.baseSkillOverrides
        ? existing.baseSkillOverrides
        : current.skillOverrides || {};
    baseSkillOverrides = base;
    const merged = glitch.skillOverridesFor(
      layer,
      installedSkills(configDir),
      base,
    );
    skillsHidden = Object.keys(merged).filter(
      (name) => merged[name] === "off" && base[name] !== "off",
    ).length;
    if (Object.keys(merged).length > 0) next.skillOverrides = merged;
    else delete next.skillOverrides;

    writeSettings(configDir, next);
  }

  const installedCommands = modeCommands.commit(
    configDir,
    plannedCommands,
    priorCommands,
  );

  const lock = {
    mode: mode.name,
    codename: mode.codename || mode.name.toUpperCase(),
    settings: resolved.settings,
    adhoc,
    appliedAt: new Date().toISOString(),
    settingsBackup,
    disabledHooks,
    // Read by hooks/mode-guard.js on every tool call, which is what makes tool
    // gating take effect without waiting for a new session.
    deniedTools: layer.tools,
    subagents: layer.subagents,
    skillsHidden,
    // Carried forward across switches so each mode gates from the operator's
    // own baseline rather than from the previous mode's output.
    baseSkillOverrides,
    // Which settings this mode pinned, so the next mode knows what to hand back.
    pinnedKeys: Object.keys(mode.projects || {}),
    // The slash commands this mode put into commands/. Recorded so that taking
    // the mode off removes exactly those and leaves the operator's own alone.
    installedCommands,
    // Compared against what a session recorded at startup, to detect a mode
    // that is only half in force. See hooks/mode-session.js.
    hardHash: glitch.hardHash(layer, mode.projects),
  };
  fs.writeFileSync(lockPath(configDir), JSON.stringify(lock, null, 2) + "\n");

  return { lock };
}

/** Undo the applied mode. False when nothing is applied. */
function revert(configDir) {
  const lock = readLock(configDir);
  if (lock === null) return false;

  if (lock.settingsBackup && fs.existsSync(lock.settingsBackup))
    fs.copyFileSync(lock.settingsBackup, settingsPath(configDir));

  modeCommands.remove(configDir, lock.installedCommands);

  fs.rmSync(lockPath(configDir), { force: true });

  // The generated file is regenerated at the defaults rather than deleted: the
  // harness loads whatever sits in rules/, and a stale file left behind would go
  // on shaping every session with a posture nobody chose.
  const corpus = require("./rules.js").loadCorpus(
    path.join(configDir, "modes", "rules"),
  );
  renderTo(configDir, corpus.rules, { ...settings.DEFAULTS }, "(none)");
  return true;
}

module.exports = { applyMode, revert, readLock, stripHooks };
