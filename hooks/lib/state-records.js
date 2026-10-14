"use strict";

// Which working record belongs to which Claude Code window.
//
// A record is a file in the repository with a fixed name. What ties a window to
// one is a pair of small lookup folders under the configuration directory: one
// keyed by the window's process, which is what survives a /clear, and one keyed
// by session identifier, which is what every hook is handed and what survives a
// closed window when the session is resumed.
//
// Only the session-start hook and `ccfg state` write the lookup. Everything
// else reads one file by session identifier and never starts a process.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const stateFile = require("./state-file");
const { sanitizeSessionIdentifier } = require("./session-cache");

const RECORDS_RELATIVE = path.join(".claude", "state");
const ARCHIVE_SUFFIX = ".archive.md";

// Names the window outright. For the suites, which have no claude process above
// them, and for a client whose process cannot be recognised.
const WINDOW_OVERRIDE_VARIABLE = "CLAUDE_STATE_WINDOW";

// The override value that means "no window can be recognised", so a suite run
// from inside Claude Code can still exercise that path.
const NO_WINDOW = "none";

// Comma-separated windows to count as open besides the real ones. A suite's
// hooks each run as their own process, so one hook cannot otherwise see the
// window another case named.
const LIVE_WINDOWS_VARIABLE = "CLAUDE_STATE_LIVE_WINDOWS";

const WINDOW_COMMAND = /(^|\/)claude$/;

// A hook sits one or two shells below its window; this is only a stop for a
// process table that loops.
const MAX_ANCESTORS = 12;

const IGNORE_LINES = new Set([
  ".claude/state/",
  "/.claude/state/",
  ".claude/state",
  "/.claude/state",
  ".claude/",
  "/.claude/",
]);

function recordsDirectory(root) {
  return path.join(root, RECORDS_RELATIVE);
}

function recordPath(root, key) {
  return path.join(recordsDirectory(root), `${key}.md`);
}

function archivePathOf(recordFile) {
  return recordFile.replace(/\.md$/, ARCHIVE_SUFFIX);
}

function keyOf(recordFile) {
  return path.basename(recordFile, ".md");
}

function recordsIgnoreListed(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  } catch {
    return false;
  }
  return text.split(/\r?\n/).some((line) => IGNORE_LINES.has(line.trim()));
}

// Both, because a folder the ignore file does not cover could be swept into a
// commit, and a record is never meant to travel with the repository.
function enabled(root) {
  return fs.existsSync(recordsDirectory(root)) && recordsIgnoreListed(root);
}

function newKey(
  now = new Date(),
  suffix = crypto.randomBytes(1).toString("hex"),
) {
  const twoDigits = (value) => String(value).padStart(2, "0");
  return (
    `${twoDigits(now.getMonth() + 1)}${twoDigits(now.getDate())}-` +
    `${twoDigits(now.getHours())}${twoDigits(now.getMinutes())}-${suffix}`
  );
}

function readProcessTable() {
  const table = new Map();
  let output = "";
  try {
    const result = spawnSync("ps", ["-A", "-o", "pid=,ppid=,lstart=,comm="], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status === 0) output = result.stdout || "";
  } catch {
    return table;
  }
  for (const line of output.split("\n")) {
    const match =
      /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(
        line,
      );
    if (match === null) continue;
    table.set(Number(match[1]), {
      processId: Number(match[1]),
      parentProcessId: Number(match[2]),
      started: match[3].replace(/\s+/g, " "),
      command: match[4].trim(),
    });
  }
  return table;
}

// The start time is part of the identity so that a later process handed the
// same number does not inherit a record.
function identityOf(entry) {
  return sanitizeSessionIdentifier(`${entry.processId}-${entry.started}`);
}

function findWindow(processTable, startProcessId, environment = process.env) {
  const override = environment[WINDOW_OVERRIDE_VARIABLE];
  if (override === NO_WINDOW) return null;
  if (override) return sanitizeSessionIdentifier(override);
  let processId = startProcessId;
  for (let depth = 0; depth < MAX_ANCESTORS; depth += 1) {
    const entry = processTable.get(processId);
    if (entry === undefined) return null;
    if (WINDOW_COMMAND.test(entry.command)) return identityOf(entry);
    processId = entry.parentProcessId;
  }
  return null;
}

function liveWindows(processTable, environment = process.env) {
  const live = new Set();
  for (const entry of processTable.values()) {
    if (WINDOW_COMMAND.test(entry.command)) live.add(identityOf(entry));
  }
  const override = environment[WINDOW_OVERRIDE_VARIABLE];
  if (override && override !== NO_WINDOW) {
    live.add(sanitizeSessionIdentifier(override));
  }
  for (const name of (environment[LIVE_WINDOWS_VARIABLE] || "").split(",")) {
    if (name.trim()) live.add(sanitizeSessionIdentifier(name.trim()));
  }
  return live;
}

function lookupDirectory(configDir, kind) {
  return path.join(configDir, "cache", "state-records", kind);
}

function entryFile(configDir, kind, identifier) {
  return path.join(
    lookupDirectory(configDir, kind),
    `${sanitizeSessionIdentifier(identifier)}.json`,
  );
}

function readEntry(file) {
  try {
    const entry = JSON.parse(fs.readFileSync(file, "utf8"));
    return entry !== null && typeof entry.record === "string" ? entry : null;
  } catch {
    return null;
  }
}

function writeEntry(file, entry) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(entry)}\n`);
  fs.renameSync(temporary, file);
}

// A record deleted by hand is nobody's: the entry is ignored, not followed to
// a file that is not there.
function recordOf(file) {
  const entry = readEntry(file);
  return entry !== null && fs.existsSync(entry.record) ? entry.record : null;
}

function recordForSession(configDir, sessionIdentifier) {
  if (!sessionIdentifier) return null;
  return recordOf(entryFile(configDir, "sessions", sessionIdentifier));
}

function recordForWindow(configDir, windowIdentity) {
  if (!windowIdentity) return null;
  return recordOf(entryFile(configDir, "windows", windowIdentity));
}

// The window first: after a clear the session identifier is new and the
// process is not.
function resolveRecord(configDir, { windowIdentity, sessionIdentifier }) {
  return (
    recordForWindow(configDir, windowIdentity) ||
    recordForSession(configDir, sessionIdentifier)
  );
}

function claim(configDir, { windowIdentity, sessionIdentifier, record }) {
  if (windowIdentity) {
    writeEntry(entryFile(configDir, "windows", windowIdentity), {
      record,
      window: windowIdentity,
    });
  }
  if (sessionIdentifier) {
    writeEntry(entryFile(configDir, "sessions", sessionIdentifier), { record });
  }
}

function release(configDir, { windowIdentity, sessionIdentifier }) {
  if (windowIdentity) {
    fs.rmSync(entryFile(configDir, "windows", windowIdentity), { force: true });
  }
  if (sessionIdentifier) {
    fs.rmSync(entryFile(configDir, "sessions", sessionIdentifier), {
      force: true,
    });
  }
}

function windowEntries(configDir) {
  const directory = lookupDirectory(configDir, "windows");
  let names;
  try {
    names = fs.readdirSync(directory);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const file = path.join(directory, name);
      const entry = readEntry(file);
      return entry === null ? null : { ...entry, file };
    })
    .filter((entry) => entry !== null && typeof entry.window === "string");
}

function holderOf(configDir, recordFile, live) {
  const wanted = path.resolve(recordFile);
  const holder = windowEntries(configDir).find(
    (entry) => path.resolve(entry.record) === wanted && live.has(entry.window),
  );
  return holder === undefined ? null : holder.window;
}

function pruneDeadWindows(configDir, live) {
  for (const entry of windowEntries(configDir)) {
    if (!live.has(entry.window)) fs.rmSync(entry.file, { force: true });
  }
}

function listRecords(root, configDir, live) {
  let names;
  try {
    names = fs.readdirSync(recordsDirectory(root));
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".md") && !name.endsWith(ARCHIVE_SUFFIX))
    .map((name) => {
      const file = path.join(recordsDirectory(root), name);
      const state = stateFile.readRecord(file);
      if (state === null) return null;
      return {
        key: keyOf(file),
        path: file,
        goal: stateFile.goalLine(state.text),
        next: stateFile.nextStep(state.text),
        modifiedMs: state.modifiedMs,
        untouched: !stateFile.hasContent(state.text),
        heldBy: holderOf(configDir, file, live),
      };
    })
    .filter((entry) => entry !== null)
    .sort((first, second) => second.modifiedMs - first.modifiedMs);
}

function createRecord(root, templateText, key = newKey()) {
  let file = recordPath(root, key);
  while (fs.existsSync(file)) {
    file = recordPath(
      root,
      `${key.slice(0, key.lastIndexOf("-"))}-${crypto.randomBytes(2).toString("hex")}`,
    );
  }
  stateFile.writeRecord(file, templateText);
  return file;
}

// Every window that opens gets a record, and most never write to it.
function removeAbandonedTemplates(root, configDir, live) {
  for (const entry of listRecords(root, configDir, live)) {
    if (!entry.untouched || entry.heldBy !== null) continue;
    fs.rmSync(entry.path, { force: true });
    fs.rmSync(archivePathOf(entry.path), { force: true });
  }
}

function templateText() {
  return fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "skills",
      "repo-setup",
      "templates",
      "state.md",
    ),
    "utf8",
  );
}

/**
 * The session's record as the reading hooks need it, or null.
 *
 * Null when the record is not under `root`: a session whose directory moved
 * into another repository must not write this window's work into that one's
 * hooks, or read that repository's rules from this record.
 */
function readForSession(configDir, sessionIdentifier, root) {
  const file = recordForSession(configDir, sessionIdentifier);
  if (file === null) return null;
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const state = stateFile.readRecord(file);
  if (state === null) return null;
  return { file, name: relative.split(path.sep).join("/"), ...state };
}

module.exports = {
  WINDOW_OVERRIDE_VARIABLE,
  recordsDirectory,
  recordPath,
  archivePathOf,
  keyOf,
  recordsIgnoreListed,
  enabled,
  newKey,
  readProcessTable,
  findWindow,
  liveWindows,
  recordForSession,
  recordForWindow,
  resolveRecord,
  claim,
  release,
  holderOf,
  pruneDeadWindows,
  listRecords,
  createRecord,
  removeAbandonedTemplates,
  templateText,
  readForSession,
};
