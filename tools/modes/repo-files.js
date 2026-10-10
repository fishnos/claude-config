"use strict";

// What only a repository switch does: merge into the repository's own
// settings.local.json, refuse a path git already tracks, and keep the files it
// writes out of the repository's status through the local ignore list.
//
// The local ignore list (.git/info/exclude) and never the tracked .gitignore:
// a mode is the operator's own posture on this machine, and a line added to
// .gitignore would be a change to the project made on the project's behalf.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const glitch = require("./glitch.js");

function git(root, args) {
  try {
    const result = spawnSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
    return result.status === 0 && result.stdout ? result.stdout : "";
  } catch {
    return "";
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function relativeToRoot(target, file) {
  return path.relative(target.root, file).split(path.sep).join("/");
}

/** Every path a switch would write inside the repository, relative to its root. */
function generatedPaths(target, commandNames, roleIds) {
  return [
    relativeToRoot(target, target.settingsFile),
    ...commandNames.map((name) =>
      relativeToRoot(target, path.join(target.commandsDirectory, `${name}.md`)),
    ),
    ...roleIds.map((id) =>
      relativeToRoot(target, path.join(target.agentsDirectory, `${id}.md`)),
    ),
  ];
}

/**
 * Throw, before anything is written, on a repository this switch must not
 * write into as it stands.
 *
 * A path git tracks is a committed file, and overwriting one is not this
 * command's call. A settings file that does not parse cannot be merged into,
 * and replacing it would lose whatever the operator meant it to say.
 */
function refuseUnsafe(target, commandNames, roleIds) {
  const tracked = git(target.root, [
    "ls-files",
    "--",
    ...generatedPaths(target, commandNames, roleIds),
  ])
    .split("\n")
    .filter(Boolean);
  if (tracked.length > 0)
    throw new Error(
      `${tracked.join(", ")} is tracked by git in ${target.root}. A mode ` +
        `switch writes that path and will not overwrite a committed file. ` +
        `Untrack it (git rm --cached) or switch with --global`,
    );

  if (!fs.existsSync(target.settingsFile)) return;
  try {
    JSON.parse(fs.readFileSync(target.settingsFile, "utf8"));
  } catch (error) {
    throw new Error(
      `${target.settingsFile} is not valid JSON (${error.message}). A mode ` +
        `switch merges into that file and will not replace one it cannot read`,
    );
  }
}

/**
 * The skill values a repository states for itself.
 *
 * A repository file overrides the machine file skill by skill, so a skill the
 * machine mode hid stays hidden here unless this file says otherwise. Every
 * skill the machine mode hid is therefore written with the operator's own
 * value ("on" when they set none), and then this mode's own hiding is applied.
 * An "off" the operator wrote, here or machine-wide, is never loosened.
 */
function repoSkillOverrides({
  layer,
  installedSkills,
  ownOverrides,
  machineBase,
  machineLive,
}) {
  const result = { ...ownOverrides };
  for (const [skill, value] of Object.entries(machineLive)) {
    if (value !== "off" || machineBase[skill] === "off") continue;
    result[skill] = ownOverrides[skill] ?? machineBase[skill] ?? "on";
  }
  for (const skill of Object.keys(
    glitch.skillOverridesFor(layer, installedSkills, {}),
  ))
    result[skill] = "off";
  return result;
}

/**
 * Merge a mode into the repository's settings.local.json.
 *
 * `existing` is the repository's record from the last switch, or null on the
 * first. The byte copy is taken on the first switch only: taken on every
 * switch, the second would copy the first mode's output and revert would
 * restore a mode rather than the operator's own file.
 */
function writeRepoSettings(configDir, target, mode, layer, existing, installedSkills) {
  const firstSwitch = existing === null;
  const fileExists = fs.existsSync(target.settingsFile);
  const hadSettings = firstSwitch ? fileExists : existing.hadSettings === true;

  fs.mkdirSync(target.directory, { recursive: true });
  if (firstSwitch) {
    if (fileExists) fs.copyFileSync(target.settingsFile, target.settingsBackup);
    else fs.rmSync(target.settingsBackup, { force: true });
  }

  const current = readJson(target.settingsFile, {});
  const own = hadSettings ? readJson(target.settingsBackup, {}) : {};
  const machineLock = readJson(path.join(configDir, "mode.lock"), null);
  const machineLive = readJson(path.join(configDir, "settings.json"), {});
  const machineOwn =
    machineLock && machineLock.settingsBackup
      ? readJson(machineLock.settingsBackup, machineLive)
      : machineLive;

  const pinning = mode.projects || {};
  const next = { ...current };
  for (const key of (existing && existing.pinnedKeys) || []) {
    if (key in pinning || key === "permissions") continue;
    if (key in own) next[key] = own[key];
    else delete next[key];
  }
  for (const [key, value] of Object.entries(pinning))
    if (key !== "permissions") next[key] = value;

  // Always stated, so the repository's effort does not follow whichever
  // machine mode happens to be in force when a session starts here.
  const effort = pinning.effortLevel ?? own.effortLevel ?? machineOwn.effortLevel;
  if (effort === undefined) delete next.effortLevel;
  else next.effortLevel = effort;

  const ownDeny = (own.permissions && own.permissions.deny) || [];
  const modeDeny = (pinning.permissions && pinning.permissions.deny) || [];
  const deny = [...new Set([...ownDeny, ...modeDeny])];
  const permissions = { ...(current.permissions || {}) };
  if (deny.length > 0) permissions.deny = deny;
  else delete permissions.deny;
  if (Object.keys(permissions).length > 0) next.permissions = permissions;
  else delete next.permissions;

  const ownOverrides = own.skillOverrides || {};
  const skillOverrides = repoSkillOverrides({
    layer,
    installedSkills,
    ownOverrides,
    machineBase:
      (machineLock && machineLock.baseSkillOverrides) ||
      machineLive.skillOverrides ||
      {},
    machineLive: machineLive.skillOverrides || {},
  });
  if (Object.keys(skillOverrides).length > 0) next.skillOverrides = skillOverrides;
  else delete next.skillOverrides;

  fs.mkdirSync(path.dirname(target.settingsFile), { recursive: true });
  fs.writeFileSync(target.settingsFile, JSON.stringify(next, null, 2) + "\n");

  return {
    hadSettings,
    baseSkillOverrides: ownOverrides,
    skillsHidden: Object.keys(skillOverrides).filter(
      (name) => skillOverrides[name] === "off" && ownOverrides[name] !== "off",
    ).length,
  };
}

/** Put the repository's settings file back as it stood before the first switch. */
function restoreRepoSettings(target, lock) {
  if (lock.hadSettings === true) {
    if (fs.existsSync(target.settingsBackup))
      fs.copyFileSync(target.settingsBackup, target.settingsFile);
    return;
  }
  fs.rmSync(target.settingsFile, { force: true });
}

/** Add paths to the repository's local ignore list, each once. */
function addToExclude(target, files) {
  const reported = git(target.root, [
    "rev-parse",
    "--git-path",
    "info/exclude",
  ]).trim();
  if (reported === "") return [];
  const excludeFile = path.resolve(target.root, reported);

  let text = "";
  try {
    text = fs.readFileSync(excludeFile, "utf8");
  } catch {
    text = "";
  }
  const present = new Set(text.split("\n").map((line) => line.trim()));
  const missing = files
    .map((file) => `/${relativeToRoot(target, file)}`)
    .filter((line) => !present.has(line));
  if (missing.length === 0) return [];

  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  fs.writeFileSync(
    excludeFile,
    text + (text === "" || text.endsWith("\n") ? "" : "\n") + missing.join("\n") + "\n",
  );
  return missing;
}

module.exports = {
  generatedPaths,
  refuseUnsafe,
  repoSkillOverrides,
  writeRepoSettings,
  restoreRepoSettings,
  addToExclude,
};
