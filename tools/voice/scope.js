"use strict";

// Which voice is in force, and where a choice is written.
//
// The lookup is layered the way git's config is, and the way `ccfg mode` is:
// a repository's own value wins inside that repository, and the machine's
// value is the default everywhere else. A choice needs no record of its own,
// because it is undone by making another.

const fs = require("fs");
const path = require("path");

const registry = require("./registry.js");
const repoFiles = require("../modes/repo-files.js");
const targets = require("../modes/target.js");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function overridesIn(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return isPlainObject(parsed) && isPlainObject(parsed.skillOverrides)
      ? parsed.skillOverrides
      : {};
  } catch {
    return {};
  }
}

function voiceStates(configDir, root, voices) {
  const layers = [];
  if (root !== null) {
    layers.push({
      source: "repository",
      overrides: overridesIn(path.join(root, ".claude", "settings.local.json")),
    });
    layers.push({
      source: "project",
      overrides: overridesIn(path.join(root, ".claude", "settings.json")),
    });
  }
  layers.push({
    source: "machine",
    overrides: overridesIn(path.join(configDir, "settings.json")),
  });

  return voices.map((voice) => {
    const layer = layers.find(
      (candidate) => voice.skill in candidate.overrides,
    );
    const value = layer === undefined ? "on" : layer.overrides[voice.skill];
    return {
      ...voice,
      value,
      source: layer === undefined ? "default" : layer.source,
      active: value === "on",
    };
  });
}

/**
 * The chosen voice is written as "on" and never merely left unmentioned: in a
 * repository file an absent key falls through to the machine's value, which
 * may be "off".
 */
function withChoice(overrides, voices, chosenSkill) {
  const result = { ...overrides };
  for (const voice of voices)
    result[voice.skill] = voice.skill === chosenSkill ? "on" : "off";
  return result;
}

/** The settings a choice merges into. Throws on a file it must not replace. */
function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `${file} is not valid JSON (${error.message}). A voice choice merges ` +
        `into that file and will not replace one it cannot read`,
    );
  }
  const misshapen = repoFiles.unmergeableShape(parsed);
  if (misshapen !== null)
    throw new Error(
      `${file}: ${misshapen}. A voice choice merges into that file and will ` +
        `not replace one whose shape it does not expect`,
    );
  return parsed;
}

function writeSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
}

function findChosen(configDir, name, voices) {
  const skill = registry.skillName(name);
  const chosen = voices.find((voice) => voice.skill === skill);
  if (chosen !== undefined) return chosen;
  if (registry.unregisteredVoices(configDir).includes(skill))
    throw new Error(
      `${skill} exists but is not registered as a voice. Register it: ` +
        `ccfg voice register ${registry.shortName(skill)} --owner "Full Name"`,
    );
  throw new Error(
    `no voice named ${registry.shortName(skill)}. ` +
      (voices.length === 0
        ? `None is registered yet: ccfg voice new NAME --owner "Full Name"`
        : `Registered: ${voices.map((voice) => voice.name).join(", ")}`),
  );
}

function readModeRecord(lockFile) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    return isPlainObject(lock) ? lock : null;
  } catch {
    return null;
  }
}

function modeNameOf(lock) {
  return typeof lock.mode === "string" ? lock.mode : "";
}

/**
 * Write the choice into the machine mode's record as well.
 *
 * A mode switch keeps a copy of settings.json and puts it back on revert, and
 * at the next switch reads any "off" its recorded baseline does not hold as
 * its own hiding. A choice written to the live file alone would therefore be
 * undone by a revert, and the voices it turned off would come back on at the
 * next switch.
 */
function carryIntoMachineRecord(configDir, voices, chosenSkill) {
  const lockFile = path.join(configDir, "mode.lock");
  const lock = readModeRecord(lockFile);
  if (lock === null) return null;

  const touched = [];
  if (typeof lock.settingsBackup === "string") {
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(lock.settingsBackup, "utf8"));
    } catch {
      saved = null;
    }
    if (isPlainObject(saved)) {
      saved.skillOverrides = withChoice(
        isPlainObject(saved.skillOverrides) ? saved.skillOverrides : {},
        voices,
        chosenSkill,
      );
      writeSettings(lock.settingsBackup, saved);
      touched.push(lock.settingsBackup);
    }
  }
  if (isPlainObject(lock.baseSkillOverrides)) {
    lock.baseSkillOverrides = withChoice(
      lock.baseSkillOverrides,
      voices,
      chosenSkill,
    );
    writeSettings(lockFile, lock);
    touched.push(lockFile);
  }
  return { mode: modeNameOf(lock), touched };
}

/**
 * Take the voices out of what a repository's mode record says the mode wrote.
 *
 * The record lists every skill entry the switch wrote, and a revert or the next
 * switch removes each one that still holds the value the mode wrote. A choice
 * writes the same "off" for the voice it does not pick, so the mode would take
 * that entry for its own and remove it, leaving both voices in force. Dropped
 * from the record, the entries are the operator's.
 *
 * A record answers only for the repository whose root it carries: two roots
 * can share a record directory.
 */
function carryIntoRepositoryRecord(target, voices) {
  const lock = readModeRecord(target.lockFile);
  if (lock === null || lock.root !== target.root) return null;

  const recorded = isPlainObject(lock.settingsChanges)
    ? lock.settingsChanges.skills
    : null;
  const touched = [];
  if (isPlainObject(recorded)) {
    const claimed = voices.filter((voice) => voice.skill in recorded);
    for (const voice of claimed) delete recorded[voice.skill];
    if (claimed.length > 0) {
      writeSettings(target.lockFile, lock);
      touched.push(target.lockFile);
    }
  }
  return { mode: modeNameOf(lock), touched };
}

function turnedOffBy(before, voices, chosenSkill) {
  return voices
    .map((voice) => voice.skill)
    .filter((skill) => skill !== chosenSkill && before[skill] !== "off");
}

function useMachine(configDir, voices, chosen, backupFile) {
  const file = path.join(configDir, "settings.json");
  const settings = readSettings(file);
  const before = settings.skillOverrides || {};
  const backup = backupFile(file, "voice");
  settings.skillOverrides = withChoice(before, voices, chosen.skill);
  writeSettings(file, settings);
  return {
    scope: "machine",
    root: null,
    file,
    chosen,
    turnedOff: turnedOffBy(before, voices, chosen.skill),
    backup: typeof backup === "string" ? backup : null,
    modeRecord: carryIntoMachineRecord(configDir, voices, chosen.skill),
    excluded: [],
  };
}

/**
 * Throw, before anything is written, on a repository file a voice choice must
 * not write as it stands: one reached through a symbolic link, or one git
 * tracks.
 */
function refuseUnsafeRepository(target) {
  const link = repoFiles.linkOnTheWayTo(target, target.settingsFile);
  if (link !== null)
    throw new Error(
      `symbolic link at ${link}. A voice choice writes ${target.settingsFile} ` +
        `and will not write through a link to wherever it points. Put a real ` +
        `file or directory there, or choose with --global`,
    );
  const relative = repoFiles.generatedPaths(target, [], []);
  const tracked = repoFiles.trackedPaths(target.root, relative);
  if (tracked.length > 0)
    throw new Error(
      `${tracked.join(", ")} is tracked by git in ${target.root}. A voice ` +
        `choice writes that path and will not overwrite a committed file. ` +
        `Untrack it (git rm --cached) or choose with --global`,
    );
}

function useRepository(configDir, root, voices, chosen, report) {
  const target = targets.repoTarget(configDir, root);
  refuseUnsafeRepository(target);
  const settings = readSettings(target.settingsFile);
  const before = settings.skillOverrides || {};
  settings.skillOverrides = withChoice(before, voices, chosen.skill);
  writeSettings(target.settingsFile, settings);
  return {
    scope: "repository",
    root: target.root,
    file: target.settingsFile,
    chosen,
    turnedOff: turnedOffBy(before, voices, chosen.skill),
    backup: null,
    modeRecord: carryIntoRepositoryRecord(target, voices),
    excluded: repoFiles.addToExclude(target, [target.settingsFile], report),
  };
}

function useVoice({ configDir, root, name, voices, backupFile, report }) {
  const chosen = findChosen(configDir, name, voices);
  return root === null
    ? useMachine(configDir, voices, chosen, backupFile)
    : useRepository(configDir, root, voices, chosen, report);
}

function dropRepositoryChoice({ configDir, root, voices }) {
  if (root === null)
    throw new Error(
      `--none drops a repository's own voice choice, and this is not inside ` +
        `a git repository. To change the machine-wide voice: ` +
        `ccfg voice use NAME --global`,
    );
  const target = targets.repoTarget(configDir, root);
  refuseUnsafeRepository(target);
  const settings = readSettings(target.settingsFile);
  const overrides = settings.skillOverrides || {};
  const dropped = voices
    .map((voice) => voice.skill)
    .filter((skill) => skill in overrides);
  if (dropped.length === 0)
    return { root: target.root, file: target.settingsFile, dropped };

  for (const skill of dropped) delete overrides[skill];
  if (Object.keys(overrides).length === 0) delete settings.skillOverrides;
  writeSettings(target.settingsFile, settings);
  return { root: target.root, file: target.settingsFile, dropped };
}

module.exports = { voiceStates, useVoice, dropRepositoryChoice };
