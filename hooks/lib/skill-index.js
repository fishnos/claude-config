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
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
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
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8")).skillOverrides || {};
  } catch {
    return {};
  }
}

/** Every personal skill, sorted into the five visibility groups. */
function collect() {
  const overrides = readOverrides();
  const groups = { byName: [], hiddenChild: [], gated: [], listed: [], disabled: [] };

  let names;
  try {
    names = fs.readdirSync(skillsDir()).sort();
  } catch {
    return groups;
  }

  for (const name of names) {
    const fields = readFrontmatter(path.join(skillsDir(), name, "SKILL.md"));
    if (!fields) continue;

    const entry = {
      name,
      description: (fields.description || "(no description)").trim(),
      paths: fields.paths ? fields.paths.replace(/^["']|["']$/g, "") : null,
      parent: fields.parent || null,
    };
    const state = overrides[name] || "on";

    if (state === "off") groups.disabled.push(entry);
    else if (state === "user-invocable-only" || state === "name-only") groups.byName.push(entry);
    else if (String(fields["disable-model-invocation"]).trim() === "true") groups.hiddenChild.push(entry);
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
  const out = [
    "# Skill index",
    "",
    "Generated. Do not edit by hand -- rerun `node ~/.claude/scripts/build-skill-index.js`,",
    "or start a session and the SessionStart hook rebuilds it when it goes stale.",
    "",
    `Every personal skill on this machine and whether Claude can see it. ${invocable} of these`,
    "are invisible in the session listing but run right now when invoked by name. Only the",
    "**Disabled** section needs settings.json changed before use.",
    "",
    "Read this before concluding that no skill covers a task, and before falling back to",
    "web search or find-docs for a named framework, language, platform, or SDK.",
    "",
  ];

  renderSection(out, "Invocable by name only",
    "Hidden from the session listing by `user-invocable-only`. Invoke with `/name`.",
    groups.byName);
  renderSection(out, "Hidden children",
    "Their authors set `disable-model-invocation: true`, usually because a router skill picks between them. Never listed, but `/name` works.",
    groups.hiddenChild);
  renderSection(out, "Path-gated",
    "Enter the listing on their own once a matching file is read or edited. Nothing to do.",
    groups.gated);
  renderSection(out, "Always listed",
    "Already in the session listing with descriptions.",
    groups.listed);
  renderSection(out, "Disabled",
    "Set to `off` in settings.json. NOT invocable until that changes.",
    groups.disabled);

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

  if (newer(settingsPath())) return true;

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
