"use strict";

// The per-repository working record, .claude/state.md: where it lives and
// whether the repository's .gitignore keeps it out of version control.
//
// Filesystem-only, like lib/repo-audit, because SessionStart hooks read it.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STATE_FILE_RELATIVE = path.join(".claude", "state.md");

// The four spellings the design names. Anything subtler is for the skill, which
// asks `git check-ignore`; a missed match here costs one extra notice.
const COVERING_LINES = new Set([
  ".claude/state.md",
  "/.claude/state.md",
  ".claude/",
  "/.claude/",
]);

function stateFilePath(root) {
  return path.join(root, STATE_FILE_RELATIVE);
}

function stateFileIgnoreListed(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  } catch {
    return false;
  }
  return text.split(/\r?\n/).some((line) => COVERING_LINES.has(line.trim()));
}

// A cap, not a budget, on the same reasoning as the retired pre-compact hook's
// MAX_SECTION: a file this large is being used as a log, and truncating with a
// visible note keeps it from flooding the context while leaving that in view.
const MAX_LOADED_CHARACTERS = 8000;

// Lines the template itself carries, so a file holding only these is empty.
const TEMPLATE_SCAFFOLD =
  /^(# Working state|## .*|- (Done|In progress|Next):)$/;

function readStateFile(root) {
  const file = stateFilePath(root);
  try {
    return {
      text: fs.readFileSync(file, "utf8"),
      modifiedMs: fs.statSync(file).mtimeMs,
    };
  } catch {
    return null;
  }
}

function withoutComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

function sectionBody(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return "";
  const following = lines.slice(start + 1);
  const end = following.findIndex((line) => line.startsWith("## "));
  const body = end === -1 ? following : following.slice(0, end);
  return withoutComments(body.join("\n")).trim();
}

function goalLine(text) {
  const firstLine = sectionBody(text, "Goal")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  return (firstLine || "").replace(/[.\s]+$/, "");
}

function nextStep(text) {
  const match = /^[ \t]*-?[ \t]*Next:[ \t]*(.*)$/m.exec(
    sectionBody(text, "Progress"),
  );
  return match ? match[1].trim() : "";
}

function hasContent(text) {
  return withoutComments(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line !== "" && !TEMPLATE_SCAFFOLD.test(line));
}

function loadedText(text) {
  if (text.length <= MAX_LOADED_CHARACTERS) return text;
  return (
    text.slice(0, MAX_LOADED_CHARACTERS) +
    "\n\n[truncated at 8,000 characters: .claude/state.md is being used as a " +
    "log; move finished work to auto-memory and trim it]"
  );
}

function formatAge(milliseconds) {
  const minutes = Math.max(0, Math.round(milliseconds / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.round(hours / 24)} days`;
}

/**
 * SHA-1 of the file with the Unconfirmed section's body removed.
 *
 * The keyword capture writes Unconfirmed on any matching prompt. Counted as a
 * change, that write would satisfy the clear gate and reset the staleness count
 * without Claude having touched the file.
 */
function stateDigest(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Unconfirmed");
  let kept = lines;
  if (start !== -1) {
    const following = lines.slice(start + 1);
    const end = following.findIndex((line) => line.startsWith("## "));
    kept = [
      ...lines.slice(0, start + 1),
      ...(end === -1 ? [] : following.slice(end)),
    ];
  }
  return crypto.createHash("sha1").update(kept.join("\n")).digest("hex");
}

/**
 * The text with each new line added at the end of the Unconfirmed section.
 *
 * No per-section cap: the 8,000-character load cap already keeps an overgrown
 * file visible, and dropping the oldest capture here would lose an instruction
 * Claude has not yet confirmed.
 */
function withUnconfirmed(text, newLines) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "## Unconfirmed");
  if (start === -1) {
    const separator = text.endsWith("\n") ? "" : "\n";
    return `${text}${separator}\n## Unconfirmed\n\n${newLines.join("\n")}\n`;
  }
  const endOffset = lines
    .slice(start + 1)
    .findIndex((line) => line.startsWith("## "));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  const section = lines.slice(start + 1, end).map((line) => line.trim());
  const additions = newLines.filter((line) => !section.includes(line));
  if (additions.length === 0) return text;

  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === "")
    insertAt -= 1;
  const leading = lines[insertAt - 1].trim().startsWith("- ") ? [] : [""];
  const trailing = insertAt === end && end < lines.length ? [""] : [];
  return [
    ...lines.slice(0, insertAt),
    ...leading,
    ...additions,
    ...trailing,
    ...lines.slice(insertAt),
  ].join("\n");
}

// Through a rename, so the gauge never reads half a write and digests it.
function writeStateFile(root, text) {
  const file = stateFilePath(root);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, "utf8");
  fs.renameSync(temporary, file);
}

module.exports = {
  STATE_FILE_RELATIVE,
  stateFilePath,
  stateFileIgnoreListed,
  MAX_LOADED_CHARACTERS,
  readStateFile,
  sectionBody,
  goalLine,
  nextStep,
  hasContent,
  loadedText,
  formatAge,
  stateDigest,
  withUnconfirmed,
  writeStateFile,
};
