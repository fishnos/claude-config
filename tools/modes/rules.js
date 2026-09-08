"use strict";

// The rule corpus: one rule per file, each declaring which setting governs it
// and where on that setting it becomes primary. An ordered scale uses
// `primary_at`, and a set of categories uses `only_at`.
//
// The header is a handful of fixed keys read by regex, not YAML. ccfg has no
// dependencies by design, and a hand-rolled YAML subset is a parser to maintain
// in exchange for syntax nobody asked for.
//
// A malformed rule is collected as an error and skipped, never thrown. The
// renderer runs on every prompt; one bad file must not leave the model with no
// rules at all.

const fs = require("fs");
const path = require("path");

const settings = require("./settings.js");

const HEADER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function headerField(header, key) {
  const found = new RegExp(`^${key}:[ \\t]*(.+)$`, "m").exec(header);
  return found === null ? null : found[1].trim();
}

function parseRule(text, sourcePath) {
  const matched = HEADER.exec(text);
  if (matched === null) return { error: `${sourcePath}: no --- header` };

  const header = matched[1];
  const id = headerField(header, "id");
  const setting = headerField(header, "setting");
  const threshold = headerField(header, "primary_at");
  const category = headerField(header, "only_at");

  if (id === null) return { error: `${sourcePath}: no id` };
  if (setting === null) return { error: `${sourcePath}: no setting` };
  if (settings.SETTINGS[setting] === undefined)
    return { error: `${sourcePath}: unknown setting '${setting}'` };

  // A rule is either a threshold on an ordered scale or a member of one
  // category. Both at once has no meaning, and neither leaves the renderer with
  // no way to place it.
  if (threshold === null && category === null)
    return { error: `${sourcePath}: no primary_at or only_at` };
  if (threshold !== null && category !== null)
    return { error: `${sourcePath}: both primary_at and only_at` };

  // The placement must match the shape of the scale. A threshold on a set of
  // registers is the bug this whole distinction exists to prevent: `voice:
  // normal` read as "caveman or above" made the caveman rules primary in every
  // mode that had switched away from caveman. Refusing it here is what stops a
  // later rule author reintroducing it.
  if (threshold !== null && settings.isCategorical(setting))
    return { error: `${sourcePath}: ${setting} is categorical, use only_at` };
  if (category !== null && !settings.isCategorical(setting))
    return { error: `${sourcePath}: ${setting} is ordered, use primary_at` };

  const value = threshold === null ? category : threshold;
  if (!settings.isValid(setting, value))
    return { error: `${sourcePath}: '${value}' is not a value of ${setting}` };

  return {
    id,
    setting,
    primary_at: threshold,
    only_at: category,
    body: text.slice(matched[0].length).trim(),
  };
}

/**
 * Every rule in a directory, plus the reasons any file was skipped.
 *
 * `_active.md` is excluded by name because it is this system's own output.
 * Reading it back in would duplicate the entire corpus on the second render.
 */
function loadCorpus(directory) {
  const rules = [];
  const errors = [];

  let entries;
  try {
    entries = fs.readdirSync(directory).sort();
  } catch {
    return { rules, errors };
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    if (entry === "_active.md") continue;
    const file = path.join(directory, entry);
    const parsed = parseRule(fs.readFileSync(file, "utf8"), file);
    if (parsed.error !== undefined) {
      errors.push(parsed.error);
      continue;
    }
    rules.push({ ...parsed, file });
  }

  return { rules, errors };
}

module.exports = { parseRule, loadCorpus };
