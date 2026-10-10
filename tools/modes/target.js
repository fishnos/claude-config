"use strict";

// Where a switch writes.
//
// The machine target is the set of paths a switch has always used. A
// repository target keeps the record and the rules on the machine side, under
// modes/repos/<key>/, and puts into the repository's own .claude/ directory
// only what the harness has to read from there at session start.

const path = require("path");

const modeLock = require("../../hooks/lib/mode-lock.js");

function machineTarget(configDir) {
  return {
    scope: "machine",
    root: null,
    directory: configDir,
    lockFile: path.join(configDir, "mode.lock"),
    rulesFile: path.join(configDir, "rules", "_active.md"),
    settingsFile: path.join(configDir, "settings.json"),
    settingsBackup: null,
    commandsDirectory: path.join(configDir, "commands"),
    agentsDirectory: path.join(configDir, "agents"),
  };
}

function repoTarget(configDir, root) {
  const realRoot = modeLock.realPath(root);
  const directory = modeLock.repoDirectory(configDir, realRoot);
  return {
    scope: "repo",
    root: realRoot,
    directory,
    lockFile: path.join(directory, "mode.lock"),
    rulesFile: path.join(directory, "rules.md"),
    settingsFile: path.join(realRoot, ".claude", "settings.local.json"),
    settingsBackup: path.join(directory, "settings.backup"),
    commandsDirectory: path.join(realRoot, ".claude", "commands"),
    agentsDirectory: path.join(realRoot, ".claude", "agents"),
  };
}

module.exports = { machineTarget, repoTarget };
