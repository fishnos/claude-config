"use strict";

// The role corpus: one worker type per file, declaring the tools it may use,
// the skills worth preloading into it, and the gates its finish must pass.
//
// The header is the same handful of fixed keys read by regex that
// tools/modes/rules.js uses, for the same reason: ccfg has no dependencies, and
// a hand-rolled YAML subset is a parser to maintain in exchange for syntax
// nobody asked for.
//
// A malformed role is collected as an error and skipped, never thrown. A mode
// switch renders the whole crew, and one bad file must not leave the operator
// with no workers at all.

const fs = require("fs");
const path = require("path");

const HEADER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function headerField(header, key) {
  const found = new RegExp(`^${key}:[ \\t]*(.+)$`, "m").exec(header);
  return found === null ? null : found[1].trim();
}

function commaList(value) {
  if (value === null) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseRole(text, sourcePath) {
  const matched = HEADER.exec(text);
  if (matched === null) return { error: `${sourcePath}: no --- header` };

  const header = matched[1];
  const id = headerField(header, "id");
  const description = headerField(header, "description");
  const tools = commaList(headerField(header, "tools"));

  if (id === null) return { error: `${sourcePath}: no id` };
  if (description === null) return { error: `${sourcePath}: no description` };
  if (tools.length === 0) return { error: `${sourcePath}: no tools` };

  return {
    id,
    description,
    tools,
    skills: commaList(headerField(header, "skills")),
    gates: commaList(headerField(header, "gates")),
    body: text.slice(matched[0].length).trim(),
  };
}

/** Every role in a directory, plus the reasons any file was skipped. */
function loadRoles(directory) {
  const roles = [];
  const errors = [];

  let entries;
  try {
    entries = fs.readdirSync(directory).sort();
  } catch {
    return { roles, errors };
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const file = path.join(directory, entry);
    const parsed = parseRole(fs.readFileSync(file, "utf8"), file);
    if (parsed.error !== undefined) {
      errors.push(parsed.error);
      continue;
    }
    roles.push({ ...parsed, file });
  }

  return { roles, errors };
}

module.exports = { parseRole, loadRoles };
