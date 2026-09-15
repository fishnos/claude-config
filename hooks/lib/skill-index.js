"use strict";

// Builds SKILL-INDEX.md, the on-demand catalog Claude reads when a task needs
// expertise it has no listed skill for.
//
// Only a fraction of installed skills reach the session listing: Claude Code
// drops descriptions under context pressure, `user-invocable-only` hides them
// outright, and `disable-model-invocation` hides router children. Every one of
// those still runs when invoked by name, so the gap is discovery, not capability.
// This file closes it by writing the full catalog to disk, grouped by whether
// Claude can see the entry on its own.

const fs = require("fs");
const path = require("path");
const io = require("./hook-io");

const INDEX_FILENAME = "SKILL-INDEX.md";

function indexPath() {
  return path.join(io.configDir(), INDEX_FILENAME);
}

function skillsDir() {
  return path.join(io.configDir(), "skills");
}

function settingsPath() {
  return path.join(io.configDir(), "settings.json");
}

function lockfilePath() {
  return path.join(io.configDir(), "plugins", "installed_plugins.json");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Every skill an installed plugin ships, as {plugin, name, file}.
 *
 * Driven by the lockfile (plugins/installed_plugins.json) rather than by walking
 * plugins/cache, because that cache also holds temporary git clones and
 * superseded versions: 3,222 SKILL.md files sat under it on this machine when
 * this was written against 88 belonging to an installed plugin.
 */
function pluginSkills() {
  const lockfile = readJson(lockfilePath());
  if (lockfile === null) return [];
  const settings = readJson(settingsPath()) || {};
  const enabled = settings.enabledPlugins || {};

  const found = [];
  for (const [key, installs] of Object.entries(lockfile.plugins || {})) {
    // Only an explicit false hides a plugin. An installed plugin missing from
    // enabledPlugins is catalogued: for a file read to decide whether anything
    // covers a task, omitting a skill that does run is the worse mistake.
    if (enabled[key] === false) continue;
    const plugin = key.split("@")[0];
    for (const install of installs || []) {
      const directory = path.join(install.installPath || "", "skills");
      let names;
      try {
        names = fs.readdirSync(directory).sort();
      } catch {
        continue;
      }
      for (const name of names)
        found.push({
          plugin,
          name,
          file: path.join(directory, name, "SKILL.md"),
        });
    }
  }
  return found;
}

/**
 * Parse YAML frontmatter well enough for the fields skills actually use.
 *
 * A real YAML parser is not available to hooks, and pulling one in for five
 * scalar fields would put a dependency in front of every session start. This
 * handles the two shapes that appear in practice: `key: value` and folded
 * blocks (`key: >-`) whose continuation lines are indented.
 */
function readFrontmatter(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  // A UTF-8 BOM ahead of the opening `---` makes Claude Code miss the
  // frontmatter entirely and fall back to the first paragraph of prose.
  const lines = raw.replace(/^﻿/, "").split("\n");
  if (lines[0].trim() !== "---") return null;
  const close = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (close < 0) return null;

  const fields = {};
  let currentKey = null;
  for (const line of lines.slice(1, close)) {
    const assignment = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (assignment) {
      currentKey = assignment[1];
      fields[currentKey] = assignment[2]
        .replace(/^["'>|-]+\s*/, "")
        .replace(/["']$/, "");
    } else if (currentKey && /^\s+\S/.test(line)) {
      fields[currentKey] = `${fields[currentKey]} ${line.trim()}`.trim();
    }
  }
  return fields;
}

function readOverrides() {
  return (readJson(settingsPath()) || {}).skillOverrides || {};
}

/**
 * Every skill on the machine, personal and from installed plugins, sorted into
 * the five visibility groups.
 *
 * A plugin's skill is entered under the name that invokes it, `plugin:skill`,
 * so the catalog gives the spelling that works rather than the bare directory.
 */
function collect() {
  const overrides = readOverrides();
  const groups = {
    byName: [],
    hiddenChild: [],
    gated: [],
    listed: [],
    disabled: [],
  };

  let personal;
  try {
    personal = fs.readdirSync(skillsDir()).sort();
  } catch {
    personal = [];
  }

  const sources = [
    ...personal.map((name) => ({
      name,
      file: path.join(skillsDir(), name, "SKILL.md"),
      fromPlugin: false,
    })),
    ...pluginSkills().map((skill) => ({
      name: `${skill.plugin}:${skill.name}`,
      file: skill.file,
      fromPlugin: true,
    })),
  ];

  for (const source of sources) {
    const fields = readFrontmatter(source.file);
    if (!fields) continue;

    const entry = {
      name: source.name,
      fromPlugin: source.fromPlugin,
      description: (fields.description || "(no description)").trim(),
      paths: fields.paths ? fields.paths.replace(/^["']|["']$/g, "") : null,
      parent: fields.parent || null,
    };
    const state = overrides[source.name] || "on";

    if (state === "off") groups.disabled.push(entry);
    else if (state === "user-invocable-only" || state === "name-only")
      groups.byName.push(entry);
    else if (String(fields["disable-model-invocation"]).trim() === "true")
      groups.hiddenChild.push(entry);
    else if (entry.paths) groups.gated.push(entry);
    else groups.listed.push(entry);
  }
  return groups;
}

function renderSection(out, title, note, entries) {
  out.push(`## ${title} (${entries.length})`, "", note, "");
  if (!entries.length) {
    out.push("_none_", "");
    return;
  }
  for (const entry of entries) {
    out.push(`### \`/${entry.name}\``);
    if (entry.paths) out.push(`Activates on: \`${entry.paths}\``);
    if (entry.parent) out.push(`Child of \`/${entry.parent}\`.`);
    out.push("", entry.description, "");
  }
}

function render(groups) {
  const invocable = groups.byName.length + groups.hiddenChild.length;
  const allSkills = Object.values(groups).flat();
  const fromPlugins = allSkills.filter((entry) => entry.fromPlugin).length;
  const out = [
    "# Skill index",
    "",
    "Generated. Do not edit by hand. Rerun `node ~/.claude/scripts/build-skill-index.js`,",
    "or start a session and the SessionStart hook rebuilds it when it goes stale.",
    "",
    `Every skill on this machine and whether Claude can see it: ${allSkills.length} in all,`,
    `${fromPlugins} of them from enabled plugins, named the way they are invoked`,
    `(\`plugin:skill\`). ${invocable} of these`,
    "are invisible in the session listing but run right now when invoked by name. Only the",
    "**Disabled** section needs settings.json changed before use.",
    "",
    "Read this before concluding that no skill covers a task, and before falling back to",
    "web search or find-docs for a named framework, language, platform, or SDK.",
    "",
  ];

  renderSection(
    out,
    "Invocable by name only",
    "Hidden from the session listing by `user-invocable-only`. Invoke with `/name`.",
    groups.byName,
  );
  renderSection(
    out,
    "Hidden children",
    "Their authors set `disable-model-invocation: true`, usually because a router skill picks between them. Never listed, but `/name` works.",
    groups.hiddenChild,
  );
  renderSection(
    out,
    "Path-gated",
    "Enter the listing on their own once a matching file is read or edited. Nothing to do.",
    groups.gated,
  );
  renderSection(
    out,
    "Always listed",
    "Already in the session listing with descriptions.",
    groups.listed,
  );
  renderSection(
    out,
    "Disabled",
    "Set to `off` in settings.json. NOT invocable until that changes.",
    groups.disabled,
  );

  return out.join("\n");
}

/**
 * True when the catalog no longer reflects what is on disk.
 *
 * Compares against settings.json and each skill's own SKILL.md rather than the
 * skills directory alone, because editing frontmatter in place leaves the parent
 * directory's mtime untouched on every platform we run on.
 */
function isStale() {
  let indexModified;
  try {
    indexModified = fs.statSync(indexPath()).mtimeMs;
  } catch {
    return true;
  }

  const newer = (file) => {
    try {
      return fs.statSync(file).mtimeMs > indexModified;
    } catch {
      return false;
    }
  };

  if (newer(settingsPath()) || newer(lockfilePath())) return true;
  if (pluginSkills().some((skill) => newer(skill.file))) return true;

  let names;
  try {
    names = fs.readdirSync(skillsDir());
  } catch {
    return false;
  }
  return names.some((name) => newer(path.join(skillsDir(), name, "SKILL.md")));
}

/** Writes the catalog and returns the group counts. */
function build() {
  const groups = collect();
  fs.writeFileSync(indexPath(), render(groups));
  return Object.fromEntries(
    Object.entries(groups).map(([group, entries]) => [group, entries.length]),
  );
}

module.exports = { build, isStale, indexPath, INDEX_FILENAME };
