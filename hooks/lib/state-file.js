"use strict";

// What is inside one working record: its sections, how much of it a session
// loads, the digest the clear gate compares, and reading and writing it whole.
// Where records live and which window holds which is lib/state-records.
//
// Filesystem-only, like lib/repo-audit, because SessionStart hooks read it.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// A cap, not a budget, on the same reasoning as the retired pre-compact hook's
// MAX_SECTION: a file this large is being used as a log, and truncating with a
// visible note keeps it from flooding the context while leaving that in view.
// The clear gate holds a clear while the file is over it, so the cut below is
// the backstop for a compaction, which no gate can hold.
const MAX_LOADED_CHARACTERS = 8000;

// Room kept for the note that says what the cut left out.
const CUT_NOTE_RESERVE = 600;

// A section cut to less than this is noise; it is left out and named instead.
const MINIMUM_CUT_SECTION = 200;

// Which sections a resumed session needs first. The short orienting ones come
// before Progress so a long log cannot push them out, and the history sections
// come last. A heading not listed here ranks after all of these.
const LOAD_PRIORITY = [
  "Goal",
  "Instructions",
  "Unconfirmed",
  "Hot files",
  "Where to look",
  "Open questions",
  "Progress",
  "Decisions",
  "Rejected",
];

// Lines the template itself carries, so a file holding only these is empty.
const TEMPLATE_SCAFFOLD =
  /^(# Working state|## .*|- (Done|In progress|Next):)$/;

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

function splitSections(text) {
  const lines = text.split(/\r?\n/);
  const firstHeading = lines.findIndex((line) => line.startsWith("## "));
  if (firstHeading === -1) return null;
  const sections = [];
  for (let index = firstHeading; index < lines.length; index += 1) {
    if (lines[index].startsWith("## ")) {
      sections.push({ heading: lines[index].slice(3).trim(), lines: [] });
    }
    sections[sections.length - 1].lines.push(lines[index]);
  }
  return {
    preamble: lines.slice(0, firstHeading).join("\n"),
    sections: sections.map((section, position) => ({
      heading: section.heading,
      position,
      text: section.lines.join("\n").trimEnd(),
    })),
  };
}

function priorityOf(heading) {
  const rank = LOAD_PRIORITY.indexOf(heading);
  return rank === -1 ? LOAD_PRIORITY.length : rank;
}

// Whole lines from the top, because entries are kept newest first.
function headOf(text, limit) {
  const cut = text.slice(0, limit);
  const lastBreak = cut.lastIndexOf("\n");
  return lastBreak > 0 ? cut.slice(0, lastBreak) : cut;
}

function formatCount(count) {
  return count.toLocaleString("en-US");
}

/**
 * The file as a session loads it: whole when it fits the cap, otherwise
 * section by section in LOAD_PRIORITY order, with a note naming every section
 * cut or left out so the session knows to read the file for them.
 */
function loadedText(
  text,
  recordName = ".claude/state.md",
  archiveName = ".claude/state.archive.md",
) {
  if (text.length <= MAX_LOADED_CHARACTERS) return text;
  const note = (details) =>
    `\n\n[${recordName} is ${formatCount(text.length)} characters, over ` +
    `the ${formatCount(MAX_LOADED_CHARACTERS)} that load. ${details}` +
    "Read the file for the rest, and move finished entries word for word " +
    `into ${archiveName}.]`;

  const parsed = splitSections(text);
  if (parsed === null) {
    return text.slice(0, MAX_LOADED_CHARACTERS) + note("");
  }

  let remaining =
    MAX_LOADED_CHARACTERS - CUT_NOTE_RESERVE - parsed.preamble.length;
  const kept = new Map();
  const cut = [];
  const omitted = [];
  const byPriority = [...parsed.sections].sort(
    (first, second) =>
      priorityOf(first.heading) - priorityOf(second.heading) ||
      first.position - second.position,
  );
  for (const section of byPriority) {
    const cost = section.text.length + 2;
    if (cost <= remaining) {
      kept.set(section.position, section.text);
      remaining -= cost;
    } else if (remaining >= MINIMUM_CUT_SECTION) {
      const head = headOf(section.text, remaining - 2);
      kept.set(section.position, head);
      cut.push(
        `${section.heading} (first ${formatCount(head.length)} of ` +
          `${formatCount(section.text.length)})`,
      );
      remaining -= head.length + 2;
    } else {
      omitted.push(`${section.heading} (${formatCount(section.text.length)})`);
    }
  }

  const body = parsed.sections
    .filter((section) => kept.has(section.position))
    .map((section) => kept.get(section.position))
    .join("\n\n");
  const details =
    (cut.length > 0 ? `Cut: ${cut.join(", ")}. ` : "") +
    (omitted.length > 0 ? `Left out: ${omitted.join(", ")}. ` : "");
  return `${parsed.preamble.trimEnd()}\n\n${body}${note(details)}`;
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
 * No per-section cap: the load cap and the clear gate already keep an overgrown
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
function readRecord(file) {
  try {
    return {
      text: fs.readFileSync(file, "utf8"),
      modifiedMs: fs.statSync(file).mtimeMs,
    };
  } catch {
    return null;
  }
}

// Through a rename, so the gauge never reads half a write and digests it.
function writeRecord(file, text) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, text, "utf8");
  fs.renameSync(temporary, file);
}

module.exports = {
  MAX_LOADED_CHARACTERS,
  sectionBody,
  goalLine,
  nextStep,
  hasContent,
  loadedText,
  formatAge,
  formatCount,
  stateDigest,
  withUnconfirmed,
  readRecord,
  writeRecord,
};
