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
const roles = require("./roles.js");
const crew = require("./crew.js");
const targets = require("./target.js");
const repoFiles = require("./repo-files.js");

const LOCK_NAME = "mode.lock";

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

function readRecord(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
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

/**
 * Whether a hook entry names one of the files an older switch deleted.
 *
 * Kept, with restoreHooks below, for one job: putting back the entries a switch
 * made before the runner took over (see `hooksInRunner` in applyMode). Both go
 * once no record written by that code can still be in force.
 */
function namesDisabledHook(entry, disabled) {
  return disabled.some((file) => String(entry.command || "").includes(file));
}

/**
 * Put back the hook entries a mode removed, and touch nothing else.
 *
 * An entry goes back at the index it held in the operator's own file, so a
 * guardrail that ran first before a mode turned it off runs first again.
 *
 * The group and the event may both be gone rather than merely thinner, because
 * the older switch dropped a group once its last hook was removed and dropped
 * an event once its last group was, so both are rebuilt here when needed.
 *
 * An event whose shape is not the array of groups the settings format describes
 * is left exactly as found, because there is nothing safe to merge into. A hook
 * the operator deletes by hand while the mode that turned it off is in force
 * cannot be told apart from one the mode removed, so it comes back.
 */
function restoreHooks(live, backup, disabled) {
  if (!backup || disabled.length === 0) return live;

  const merged = {};
  for (const [event, groups] of Object.entries(live || {}))
    merged[event] = Array.isArray(groups)
      ? groups.map((group) => ({ ...group, hooks: [...(group.hooks || [])] }))
      : groups;

  for (const [event, groups] of Object.entries(backup)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const entries = group.hooks || [];
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!namesDisabledHook(entry, disabled)) continue;

        if (merged[event] === undefined) merged[event] = [];
        if (!Array.isArray(merged[event])) continue;
        let targetGroup = merged[event].find(
          (candidate) => candidate.matcher === group.matcher,
        );
        if (targetGroup === undefined) {
          targetGroup = { ...group, hooks: [] };
          merged[event].push(targetGroup);
        }
        if (targetGroup.hooks.some((have) => have.command === entry.command))
          continue;
        targetGroup.hooks.splice(
          Math.min(index, targetGroup.hooks.length),
          0,
          entry,
        );
      }
    }
  }
  return merged;
}

function writeSettings(configDir, value) {
  fs.writeFileSync(
    settingsPath(configDir),
    JSON.stringify(value, null, 2) + "\n",
  );
}

function renderTo(destination, corpusRules, resolvedSettings, modeName) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(
    destination,
    render.renderActive(corpusRules, resolvedSettings, modeName),
  );
}

/**
 * The roles that load. A malformed role is skipped here rather than failing
 * the switch; `ccfg crew` is where its error is shown.
 */
function loadRoleCorpus(configDir) {
  return roles.loadRoles(path.join(configDir, "modes", "roles")).roles;
}

/**
 * Put a mode into force.
 *
 * Throws before writing anything if the mode tries to disable a protected hook,
 * so a refused switch leaves the configuration exactly as it found it.
 */
function applyMode(
  configDir,
  mode,
  corpusRules,
  adhoc = {},
  target = targets.machineTarget(configDir),
) {
  const violation = modes.coreHookViolation(mode);
  if (violation !== null)
    throw new Error(
      `${mode.name} tries to disable ${violation}, which no mode may turn off`,
    );

  // The undo target must be the configuration as it stood BEFORE any mode was
  // applied. Backing up on every switch would make the second switch snapshot
  // the first mode's output, and revert would then restore a mode rather than
  // the operator's own settings, leaving skills hidden with no way back.
  const existing = readRecord(target.lockFile);
  const layer = mode.glitch || glitch.parseGlitch(undefined, mode.name);
  const roster = crew.crewRoster(loadRoleCorpus(configDir), layer.subagents);

  // Checked here, before a byte is written, for the same reason the hook check
  // above is: a mode whose commands turn out to be unusable must fail while the
  // configuration is still whole, rather than halfway into the switch.
  const priorCommands = (existing && existing.installedCommands) || [];
  const plannedCommands = modeCommands.plan(
    configDir,
    mode.name,
    layer.commands,
    priorCommands,
    target.commandsDirectory,
  );
  if (target.scope === "repo")
    repoFiles.refuseUnsafe(
      target,
      plannedCommands.map((file) => file.name),
      roster
        .filter((role) => crew.allowedTools(role, layer.tools).length > 0)
        .map((role) => role.id),
    );

  const settingsBackup =
    target.scope === "repo"
      ? null
      : existing &&
          existing.settingsBackup &&
          fs.existsSync(existing.settingsBackup)
        ? existing.settingsBackup
        : backupSettings(configDir);
  const resolved = modes.resolve({ personal: mode, adhoc });
  renderTo(target.rulesFile, corpusRules, resolved.settings, mode.name);

  const disabledHooks = mode.disableHooks || [];
  // The worker's brief is built from the same band the rules file leads with,
  // so a worker reads the rules this posture makes primary and not whichever
  // five rules sort first by filename.
  const primaryBand = render.band(corpusRules, resolved.settings).primary;
  const writtenRoles = crew.writeCrew(
    configDir,
    roster,
    resolved.settings,
    layer.tools,
    crew.briefBand(primaryBand),
    target.agentsDirectory,
  );
  let skillsHidden = 0;
  let hadSettings = false;
  let baseSkillOverrides = {};

  if (target.scope === "repo") {
    const written = repoFiles.writeRepoSettings(
      configDir,
      target,
      mode,
      layer,
      existing,
      installedSkills(configDir),
    );
    skillsHidden = written.skillsHidden;
    baseSkillOverrides = written.baseSkillOverrides;
    hadSettings = written.hadSettings;
  } else if (fs.existsSync(settingsPath(configDir))) {
    const current = JSON.parse(
      fs.readFileSync(settingsPath(configDir), "utf8"),
    );
    // Settings a mode pins (the model, the effort level) are handed back to the
    // operator's own values when the next mode does not pin them. Overlaying
    // mode.projects onto `current` alone only overwrites, never clears, so
    // RUNNER's model survived a switch to NOMAD, a mode that pins nothing and
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
    // A hook a mode turns off is skipped by the shared runner (io.run in
    // hooks/lib/hook-io.js), so `hooks` is left exactly as found. A record
    // written before that may have left entries deleted from this file; they
    // are put back here, once, from the byte copy that record points at.
    const deletedByOlderSwitch =
      existing && existing.hooksInRunner !== true
        ? existing.disabledHooks || []
        : [];
    if (deletedByOlderSwitch.length > 0)
      next.hooks = restoreHooks(
        current.hooks,
        operatorSettings.hooks,
        deletedByOlderSwitch,
      );

    // The operator's own skill overrides, recovered from the file as it stands:
    // what is on disk now, minus the skills the mode in force hid.
    //
    // Taking the live overrides whole would compound, because mode A's hiding
    // becomes mode B's baseline and the skill then stays hidden under every
    // mode after it. Taking the recorded baseline whole loses whatever the
    // operator set by hand since. Subtracting only this mode's own hiding does
    // neither, and keeps skill visibility subtract-only: a mode can never leave
    // a skill hidden once it is taken off.
    //
    // A skill the operator hides by hand while a mode is in force reads as one
    // the mode hid, so it is treated as the mode's and comes back at the next
    // switch. Setting it in the operator's own settings before a switch is the
    // way to make it stick.
    const recordedBase = existing && existing.baseSkillOverrides;
    const liveOverrides = current.skillOverrides || {};
    const base = recordedBase
      ? Object.fromEntries(
          Object.entries(liveOverrides).filter(
            ([name, value]) => value !== "off" || recordedBase[name] === "off",
          ),
        )
      : liveOverrides;
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
    target.commandsDirectory,
  );

  const lock = {
    mode: mode.name,
    codename: mode.codename || mode.name.toUpperCase(),
    // Carried in the lock so the status line renders from one small file
    // instead of parsing every mode on every prompt.
    icon: mode.icon || "\u25a0",
    color: mode.color === undefined ? null : mode.color,
    settings: resolved.settings,
    adhoc,
    appliedAt: new Date().toISOString(),
    settingsBackup,
    disabledHooks,
    // Says the hooks above are skipped by the runner and were never deleted
    // from settings.json, so the next switch has nothing to put back.
    hooksInRunner: true,
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
  if (target.scope === "repo") {
    // The root is what lets the lookup tell this record from one that merely
    // shares its sixteen-character key.
    lock.scope = "repo";
    lock.root = target.root;
    lock.hadSettings = hadSettings;
    lock.settingsBackup = hadSettings ? target.settingsBackup : null;
  }
  fs.mkdirSync(path.dirname(target.lockFile), { recursive: true });
  fs.writeFileSync(target.lockFile, JSON.stringify(lock, null, 2) + "\n");

  if (target.scope === "repo")
    repoFiles.addToExclude(target, [
      target.settingsFile,
      ...installedCommands.map((name) =>
        path.join(target.commandsDirectory, `${name}.md`),
      ),
      ...writtenRoles,
    ]);

  return { lock };
}

/** Undo the applied mode. False when nothing is applied. */
function revert(configDir, target = targets.machineTarget(configDir)) {
  const lock = readRecord(target.lockFile);
  if (lock === null) return false;

  if (target.scope === "repo") {
    repoFiles.restoreRepoSettings(target, lock);
    modeCommands.remove(configDir, lock.installedCommands, target.commandsDirectory);
    crew.writeCrew(configDir, [], {}, [], "", target.agentsDirectory);
    // The record, its rules and its byte copy go together. The repository then
    // has no record of its own and the lookup answers with the machine's.
    fs.rmSync(target.directory, { recursive: true, force: true });
    return true;
  }

  if (lock.settingsBackup && fs.existsSync(lock.settingsBackup))
    fs.copyFileSync(lock.settingsBackup, settingsPath(configDir));

  modeCommands.remove(configDir, lock.installedCommands);
  // An empty crew removes every file the renderer wrote and nothing else.
  crew.writeCrew(configDir, [], {}, [], "");

  fs.rmSync(lockPath(configDir), { force: true });

  // The generated file is regenerated at the defaults rather than deleted: the
  // harness loads whatever sits in rules/, and a stale file left behind would go
  // on shaping every session with a posture nobody chose.
  const corpus = require("./rules.js").loadCorpus(
    path.join(configDir, "modes", "rules"),
  );
  renderTo(target.rulesFile, corpus.rules, { ...settings.DEFAULTS }, "(none)");
  return true;
}

module.exports = { applyMode, revert, readLock };
