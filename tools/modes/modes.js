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
const glitch = require("./glitch.js");

// Hooks that belong to no mode and that no mode may switch off. git-guard is
// what enforces never-commit, never-push and no --no-verify; config-sentinel is
// what notices the config drifting out from under itself. A mode is a posture
// rather than a permission to remove a safety rail, and so this list is
// checked before a switch rather than after one.
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

  const parsedGlitch = glitch.parseGlitch(value.glitch, sourcePath);
  if (parsedGlitch.error) return { error: parsedGlitch.error };

  return {
    name: value.name,
    // The name the operator types stays lowercase and boring; the codename is
    // what gets displayed. Keeping them separate means the theme is a display
    // concern and can be stripped without touching a lock, a hook or a test.
    codename:
      typeof value.codename === "string" && value.codename !== ""
        ? value.codename
        : value.name.toUpperCase(),
    // A single glyph, shown in the status line ahead of the codename, so the
    // shape says which mode is in force before the word is read. Display only,
    // like the codename, and defaulted rather than required so a mode file
    // without one still loads.
    icon:
      typeof value.icon === "string" && value.icon !== "" ? value.icon : "\u25a0",
    // A 256-colour code, painted behind the glyph and the mode's name wherever
    // it is shown. Display only, like the codename and the glyph, and clamped
    // to what a terminal actually understands.
    color:
      Number.isInteger(value.color) && value.color >= 0 && value.color <= 255
        ? value.color
        : null,
    description: typeof value.description === "string" ? value.description : "",
    settings: declared,
    projects: { ...(value.projects || {}), ...parsedGlitch.projects },
    disableHooks: value.disableHooks || [],
    glitch: parsedGlitch,
  };
}

/**
 * The first core hook a mode tries to disable, or null when it disables none.
 *
 * Matched the way the stripping matches, in both directions, because a gate
 * that recognises fewer strings than the thing it guards is not a gate. A mode
 * removes a hook when the hook's command line *contains* the declared string,
 * so comparing the declared string to the protected filenames for equality let
 * `disableHooks: ["guard"]` through untouched and then delete
 * `node hooks/git-guard.js` from settings.json. git-guard is what refuses a
 * push, a commit and a staged secret, so that was the whole escalation the
 * subtract-only design exists to prevent, reachable by writing one mode file.
 *
 * The reverse direction covers a declared string that spells the filename out
 * with a path in front of it, which the command line also contains.
 */
function coreHookViolation(mode) {
  for (const declared of mode.disableHooks || []) {
    const name = String(declared);
    const hit = CORE_HOOKS.find(
      (core) => core.includes(name) || name.includes(core),
    );
    if (hit !== undefined) return hit;
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
