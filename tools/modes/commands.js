"use strict";

// Slash commands that exist only while one mode is in force.
//
// A mode is meant to be good at one task with nothing else in the way, and part
// of that is the shortcuts it puts within reach: TRACE wants a command for
// narrowing a reproduction, APPRAISER wants one for writing a verdict, and
// neither wants the other's.
//
// This is the one part of a glitched mode that ADDS something, which makes it
// the one part that could undo the rule holding the rest together. A slash
// command's frontmatter can carry `allowed-tools`, and Claude Code grants
// exactly those tools while the command runs. So a mode shipping an arbitrary
// command file could write `allowed-tools: Bash(*)` and hand itself everything
// that glitch.tools.allow is refused for asking. That is why a mode command is
// treated as a prompt and nothing else: any grant in its frontmatter is refused
// when the file is read, before a byte reaches commands/.
//
// Two further rules keep an installed command from outliving its welcome. A
// mode may never overwrite a command the operator already wrote, so switching
// modes cannot quietly replace `/commit` with something else wearing its name.
// And every file this module installs is recorded in mode.lock, so taking the
// mode off removes exactly what it added and nothing near it.

const fs = require("fs");
const path = require("path");

// Frontmatter keys that would turn a prompt into a permission. `allowed-tools`
// is Claude Code's own grant list; the others are spelling variants seen in the
// wild, refused so that a rename cannot walk past the check.
const GRANTING_KEYS = ["allowed-tools", "allowed_tools", "allowedTools"];

/** Where a mode keeps the commands it carries. */
function modeCommandDir(configDir, modeName) {
  return path.join(configDir, "modes", "commands", modeName);
}

function installedPath(configDir, name) {
  return path.join(configDir, "commands", `${name}.md`);
}

/**
 * A command name that is safe to build a path from.
 *
 * The name arrives from a mode file, which is data, and is used to construct
 * two paths. Without this a mode could declare `../../../etc/passwd` and this
 * module would dutifully read and copy it.
 */
function validName(name) {
  return typeof name === "string" && /^[a-z0-9][a-z0-9-]*$/.test(name);
}

/** The frontmatter block's raw lines, or an empty list when there is none. */
function frontmatterLines(text) {
  if (!text.startsWith("---")) return [];
  const end = text.indexOf("\n---", 3);
  if (end === -1) return [];
  return text.slice(3, end).split("\n");
}

/**
 * Read one mode command, refusing anything that would grant capability.
 *
 * Throws rather than returning an error, because every caller is applying a
 * mode and a half-installed set of commands is worse than a failed switch.
 */
function read(configDir, modeName, name) {
  if (!validName(name))
    throw new Error(
      `${modeName}: "${name}" is not a usable command name. Use lowercase letters, digits and dashes`,
    );

  const source = path.join(modeCommandDir(configDir, modeName), `${name}.md`);
  if (!fs.existsSync(source))
    throw new Error(
      `${modeName} declares the command "${name}" but modes/commands/${modeName}/${name}.md is missing`,
    );

  const body = fs.readFileSync(source, "utf8");
  for (const line of frontmatterLines(body)) {
    const key = line.split(":")[0].trim().toLowerCase();
    if (GRANTING_KEYS.includes(key))
      throw new Error(
        `${modeName}/${name}: allowed-tools is not permitted in a mode command. ` +
          `A mode may only take capability away, and a command's grant list would add it`,
      );
  }

  return { name, source, body };
}

/**
 * Everything that can go wrong, decided before anything is written.
 *
 * Applying a mode writes several files, and a failure partway through leaves a
 * posture that is neither the old one nor the new one. So the caller runs this
 * first: it reads and checks every declared command and throws on the first
 * problem, while the disk is still untouched.
 *
 * `previous` is what the last mode installed, which is about to be taken out.
 * Those names are excluded from the collision check, or re-applying the same
 * mode would see its own command sitting there and refuse.
 */
function plan(configDir, modeName, declared, previous = []) {
  const wanted = declared || [];
  const files = wanted.map((name) => read(configDir, modeName, name));
  const leaving = new Set(previous || []);

  for (const file of files) {
    if (leaving.has(file.name)) continue;
    if (fs.existsSync(installedPath(configDir, file.name)))
      throw new Error(
        `${modeName} carries a command called "${file.name}" but you already have ` +
          `one. A mode may not replace a command you wrote`,
      );
  }
  return files;
}

/** Write a checked plan out, taking the previous mode's commands away first. */
function commit(configDir, files, previous = []) {
  remove(configDir, previous);
  if (files.length === 0) return [];
  fs.mkdirSync(path.join(configDir, "commands"), { recursive: true });
  for (const file of files)
    fs.writeFileSync(installedPath(configDir, file.name), file.body);
  return files.map((file) => file.name);
}

/**
 * Put a mode's commands in place, taking the previous mode's out first.
 *
 * `previous` is the list recorded in mode.lock by the last applied mode. Taking
 * those out before installing means a command never outlives the mode that
 * carried it, which would otherwise leave TRACE's shortcuts sitting in an
 * APPRAISER session.
 */
function install(configDir, modeName, declared, previous = []) {
  return commit(
    configDir,
    plan(configDir, modeName, declared, previous),
    previous,
  );
}

/** Take out exactly the commands a mode installed. */
function remove(configDir, names) {
  for (const name of names || []) {
    if (!validName(name)) continue;
    fs.rmSync(installedPath(configDir, name), { force: true });
  }
}

/** Which commands a mode declares, for `ccfg mode list`. */
function declaredBy(mode) {
  const layer = mode.glitch || {};
  return Array.isArray(layer.commands) ? layer.commands : [];
}

module.exports = { install, plan, commit, remove, read, declaredBy, validName };
