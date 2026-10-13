"use strict";

// What only a repository switch does: merge into the repository's own
// settings.local.json, refuse a path git already tracks or a symbolic link
// stands on, and keep the files it writes out of the repository's status
// through the local ignore list.
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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** lstat and never stat: the question is what stands at the path itself. */
function isLink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * The symbolic link a write to `file` would pass through, or null.
 *
 * Only the repository root is resolved to a real path. A link at .claude, or
 * at the path itself, sends a write or a delete to wherever the link points,
 * which need not be inside the repository at all.
 */
function linkOnTheWayTo(target, file) {
  const claudeDirectory = path.dirname(target.settingsFile);
  return [claudeDirectory, file].find(isLink) ?? null;
}

function relativeToRoot(target, file) {
  return path.relative(target.root, file).split(path.sep).join("/");
}

/** The paths among `relativePaths` that git tracks in the repository. */
function trackedPaths(root, relativePaths) {
  return git(root, ["ls-files", "--", ...relativePaths])
    .split("\n")
    .filter(Boolean);
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
 * A symbolic link is checked first, because every later check reads through
 * one. A path git tracks is a committed file, and overwriting one is not this
 * command's call. A settings file that does not parse, or that parses to a
 * shape this module does not merge into, cannot be added to, and replacing it
 * would lose whatever the operator meant it to say.
 */
function refuseUnsafe(target, commandNames, roleIds) {
  const generated = generatedPaths(target, commandNames, roleIds);
  const linked = [
    path.dirname(target.settingsFile),
    target.commandsDirectory,
    target.agentsDirectory,
    ...generated.map((relative) => path.join(target.root, relative)),
  ].filter(isLink);
  if (linked.length > 0)
    throw new Error(
      `symbolic link at ${linked.join(", ")}. A mode switch writes that path ` +
        `and will not write through a link to wherever it points. Put a real ` +
        `file or directory there, or switch with --global`,
    );

  const tracked = trackedPaths(target.root, generated);
  if (tracked.length > 0)
    throw new Error(
      `${tracked.join(", ")} is tracked by git in ${target.root}. A mode ` +
        `switch writes that path and will not overwrite a committed file. ` +
        `Untrack it (git rm --cached) or switch with --global`,
    );

  if (!fs.existsSync(target.settingsFile)) return;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(target.settingsFile, "utf8"));
  } catch (error) {
    throw new Error(
      `${target.settingsFile} is not valid JSON (${error.message}). A mode ` +
        `switch merges into that file and will not replace one it cannot read`,
    );
  }
  const misshapen = unmergeableShape(parsed);
  if (misshapen !== null)
    throw new Error(
      `${target.settingsFile}: ${misshapen}. A mode switch merges into that ` +
        `file and will not replace one whose shape it does not expect`,
    );
}

/** Why a parsed settings file cannot be merged into, or null when it can. */
function unmergeableShape(parsed) {
  if (!isPlainObject(parsed)) return "the file does not hold a JSON object";
  if ("permissions" in parsed && !isPlainObject(parsed.permissions))
    return '"permissions" is not an object';
  if (
    isPlainObject(parsed.permissions) &&
    "deny" in parsed.permissions &&
    !Array.isArray(parsed.permissions.deny)
  )
    return '"permissions.deny" is not a list';
  if ("skillOverrides" in parsed && !isPlainObject(parsed.skillOverrides))
    return '"skillOverrides" is not an object';
  return null;
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

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The settings file with one mode's own additions taken back out.
 *
 * `changes` is what the record says the switch wrote: for each key and each
 * skill, the value it wrote and what stood there before, and the deny entries
 * it added. A key or skill is taken back only while it still holds the value
 * the mode wrote, because one the operator has changed since is the
 * operator's. Everything the record does not name is returned as found:
 * Claude Code appends permission entries to this file on its own, and a
 * revert that restored an earlier copy would throw those away.
 */
function withoutModeChanges(live, changes) {
  const result = structuredClone(live);
  if (!isPlainObject(changes)) return result;

  const takeBack = (holder, recorded) => {
    for (const [name, change] of Object.entries(recorded || {})) {
      if (!(name in holder) || !sameValue(holder[name], change.wrote)) continue;
      if (change.present) holder[name] = change.value;
      else delete holder[name];
    }
  };
  const created = changes.created || {};

  takeBack(result, changes.keys);

  if (isPlainObject(result.permissions)) {
    const permissions = result.permissions;
    if (Array.isArray(permissions.deny)) {
      const added = new Set(changes.denyAdded || []);
      permissions.deny = permissions.deny.filter((entry) => !added.has(entry));
      if (permissions.deny.length === 0 && created.deny) delete permissions.deny;
    }
    if (Object.keys(permissions).length === 0 && created.permissions)
      delete result.permissions;
  }

  if (isPlainObject(result.skillOverrides)) {
    takeBack(result.skillOverrides, changes.skills);
    if (Object.keys(result.skillOverrides).length === 0 && created.skillOverrides)
      delete result.skillOverrides;
  }

  return result;
}

/**
 * Merge a mode into the repository's settings.local.json.
 *
 * `existing` is the repository's record from the last switch, or null on the
 * first. The merge starts from the file as it stands with the last mode's own
 * additions taken back out, so whatever was added by hand since is carried
 * into this mode, and what the returned `settingsChanges` calls "before" is
 * the operator's value and never the last mode's.
 *
 * The byte copy is kept as a safety net for the operator and is no longer
 * what revert restores. It is taken on the first switch only: taken on every
 * switch, the second would copy the first mode's output.
 */
function writeRepoSettings(
  configDir,
  target,
  mode,
  layer,
  existing,
  installedSkills,
) {
  const firstSwitch = existing === null;
  const fileExists = fs.existsSync(target.settingsFile);
  const hadSettings = firstSwitch ? fileExists : existing.hadSettings === true;

  fs.mkdirSync(target.directory, { recursive: true });
  if (firstSwitch) {
    if (fileExists) fs.copyFileSync(target.settingsFile, target.settingsBackup);
    else fs.rmSync(target.settingsBackup, { force: true });
  }

  const own = withoutModeChanges(
    readJson(target.settingsFile, {}),
    existing && existing.settingsChanges,
  );
  const machineLock = readJson(path.join(configDir, "mode.lock"), null);
  const machineLive = readJson(path.join(configDir, "settings.json"), {});
  const machineOwn =
    machineLock && machineLock.settingsBackup
      ? readJson(machineLock.settingsBackup, machineLive)
      : machineLive;

  const next = structuredClone(own);
  const settingsChanges = {
    keys: {},
    denyAdded: [],
    skills: {},
    created: { permissions: false, deny: false, skillOverrides: false },
  };
  const write = (holder, recorded, name, value) => {
    if (name in holder && sameValue(holder[name], value)) return;
    recorded[name] = { present: name in holder, value: holder[name], wrote: value };
    holder[name] = value;
  };

  const pinning = mode.projects || {};
  for (const [key, value] of Object.entries(pinning))
    if (key !== "permissions") write(next, settingsChanges.keys, key, value);

  // Always stated, so the repository's effort does not follow whichever
  // machine mode happens to be in force when a session starts here.
  const effort = pinning.effortLevel ?? own.effortLevel ?? machineOwn.effortLevel;
  if (effort !== undefined)
    write(next, settingsChanges.keys, "effortLevel", effort);

  const ownDeny = (own.permissions && own.permissions.deny) || [];
  const modeDeny = (pinning.permissions && pinning.permissions.deny) || [];
  settingsChanges.denyAdded = [...new Set(modeDeny)].filter(
    (entry) => !ownDeny.includes(entry),
  );
  if (settingsChanges.denyAdded.length > 0) {
    settingsChanges.created.permissions = !("permissions" in own);
    settingsChanges.created.deny = !(own.permissions && "deny" in own.permissions);
    next.permissions = {
      ...(own.permissions || {}),
      deny: [...ownDeny, ...settingsChanges.denyAdded],
    };
  }

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
  if (Object.keys(skillOverrides).length > 0) {
    settingsChanges.created.skillOverrides = !("skillOverrides" in own);
    next.skillOverrides = { ...ownOverrides };
    for (const [skill, value] of Object.entries(skillOverrides))
      write(next.skillOverrides, settingsChanges.skills, skill, value);
  }

  fs.mkdirSync(path.dirname(target.settingsFile), { recursive: true });
  fs.writeFileSync(target.settingsFile, JSON.stringify(next, null, 2) + "\n");

  return {
    hadSettings,
    settingsChanges,
    baseSkillOverrides: ownOverrides,
    skillsHidden: Object.keys(skillOverrides).filter(
      (name) => skillOverrides[name] === "off" && ownOverrides[name] !== "off",
    ).length,
  };
}

/**
 * Take the mode's own additions back out of the repository's settings file.
 *
 * The file is removed only when the switch created it and nothing but the
 * mode's additions was ever in it. `report` is told when the file is left as
 * found: behind a symbolic link, or no longer something this can read.
 */
function restoreRepoSettings(target, lock, report) {
  const link = linkOnTheWayTo(target, target.settingsFile);
  if (link !== null) {
    report(
      `${link} is a symbolic link, so ${target.settingsFile} was left as found`,
    );
    return;
  }
  if (!fs.existsSync(target.settingsFile)) return;

  const live = readJson(target.settingsFile, undefined);
  if (!isPlainObject(live)) {
    report(
      `${target.settingsFile} no longer holds a JSON object, so it was left ` +
        `as found. What the mode added to it is still in it`,
    );
    return;
  }

  const restored = withoutModeChanges(live, lock.settingsChanges);
  if (Object.keys(restored).length === 0 && lock.hadSettings !== true) {
    fs.rmSync(target.settingsFile, { force: true });
    return;
  }
  fs.writeFileSync(target.settingsFile, JSON.stringify(restored, null, 2) + "\n");
}

/**
 * Add paths to the repository's local ignore list, each once.
 *
 * A list that is a symbolic link is left as found and `report` is told: the
 * write would land wherever the link points, which can be a file shared with
 * other checkouts or one outside the repository altogether.
 */
function addToExclude(
  target,
  files,
  report = (message) => console.error(message),
) {
  const reported = git(target.root, [
    "rev-parse",
    "--git-path",
    "info/exclude",
  ]).trim();
  if (reported === "") return [];
  const excludeFile = path.resolve(target.root, reported);
  if (isLink(excludeFile)) {
    report(
      `${excludeFile} is a symbolic link, so the files this mode wrote were ` +
        `not added to it and will show in git status`,
    );
    return [];
  }

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
  linkOnTheWayTo,
  generatedPaths,
  refuseUnsafe,
  trackedPaths,
  unmergeableShape,
  repoSkillOverrides,
  writeRepoSettings,
  restoreRepoSettings,
  addToExclude,
};
