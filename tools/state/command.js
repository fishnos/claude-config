"use strict";

// ccfg state: which working record this Claude Code window uses, and the moves
// between records.
//
// Claude never passes its own key. A command run from Claude's shell tool has
// the window's process above it and the session identifier in its environment,
// and both are read here.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const repoAudit = require("../../hooks/lib/repo-audit.js");
const stateFile = require("../../hooks/lib/state-file.js");
const records = require("../../hooks/lib/state-records.js");

const OLD_RECORD = path.join(".claude", "state.md");
const OLD_ARCHIVE = path.join(".claude", "state.archive.md");
const OLD_IGNORE_LINES = new Set([
  ".claude/state.md",
  "/.claude/state.md",
  ".claude/state.archive.md",
  "/.claude/state.archive.md",
]);

// Month-day, hour-minute, then a short suffix: the shape newKey produces.
const RECORD_KEY_PATTERN = /^\d{4}-\d{4}-[0-9a-z]{2,4}$/;

class UsageError extends Error {}

function requireEnabled(context) {
  if (records.enabled(context.root)) return;
  throw new Error(
    "this repository keeps no working records yet. Run `ccfg state migrate` " +
      "to create .claude/state/ and its .gitignore line.",
  );
}

function ownRecord(context) {
  requireEnabled(context);
  const record = records.resolveRecord(context.configDir, context);
  if (record === null) {
    throw new Error(
      "this window has no working record. `ccfg state list` shows the " +
        "repository's records, `ccfg state use KEY` adopts one, and " +
        "`ccfg state new` starts one.",
    );
  }
  return record;
}

function requireWindow(context) {
  if (context.windowIdentity || context.sessionIdentifier) return;
  throw new Error(
    "no Claude Code window found above this shell, so there is nothing to " +
      "point at a record. `ccfg state list` works from anywhere.",
  );
}

function describe(entry, now) {
  const age = stateFile.formatAge(now - entry.modifiedMs);
  const holder = entry.heldBy === null ? "unclaimed" : `held by ${entry.heldBy}`;
  const goal = entry.goal || "(no goal recorded)";
  return `${entry.key}  ${holder}  ${goal}  (updated ${age} ago)`;
}

function show(context, print) {
  const record = ownRecord(context);
  const state = stateFile.readRecord(record);
  if (state === null) throw new Error(`cannot read ${record}`);
  print(`record: ${record}`);
  print(`goal:   ${stateFile.goalLine(state.text) || "(no goal recorded)"}`);
  print(`next:   ${stateFile.nextStep(state.text) || "(no next step recorded)"}`);
  print(`age:    updated ${stateFile.formatAge(Date.now() - state.modifiedMs)} ago`);
}

function list(context, print) {
  requireEnabled(context);
  const entries = records.listRecords(context.root, context.configDir, context.live);
  if (entries.length === 0) {
    print("no working records in this repository");
    return;
  }
  for (const entry of entries) print(describe(entry, Date.now()));
}

function use(context, print, key) {
  if (!key) throw new UsageError("usage: ccfg state use KEY");
  if (!RECORD_KEY_PATTERN.test(key)) {
    throw new UsageError(
      `${key} is not a record key. \`ccfg state list\` shows the keys.`,
    );
  }
  requireEnabled(context);
  requireWindow(context);
  const record = records.recordPath(context.root, key);
  if (!fs.existsSync(record)) {
    throw new Error(`no record named ${key}. \`ccfg state list\` shows them.`);
  }
  const holder = records.holderOf(context.configDir, record, context.live);
  if (holder !== null && holder !== context.windowIdentity) {
    throw new Error(
      `${key} is held by ${holder}, a window that is still open. Close that ` +
        "window, or run `ccfg state new` there, before adopting it here.",
    );
  }
  records.claim(context.configDir, { ...context, record });
  print(`this window now uses ${record}`);
}

function startNew(context, print) {
  requireEnabled(context);
  requireWindow(context);
  const record = records.createRecord(context.root, records.templateText());
  records.claim(context.configDir, { ...context, record });
  print(`this window now uses ${record}`);
}

function done(context, print, confirmed) {
  const record = ownRecord(context);
  const archive = records.archivePathOf(record);
  if (!confirmed) {
    print(`would remove ${record}`);
    if (fs.existsSync(archive)) print(`would remove ${archive}`);
    print("nothing removed. Run `ccfg state done --yes` to remove them.");
    return;
  }
  fs.rmSync(record, { force: true });
  fs.rmSync(archive, { force: true });
  records.release(context.configDir, context);
  print(`removed ${record}. \`ccfg state new\` starts the next one.`);
}

/**
 * Turn records on for a repository: create the folder, move the old single
 * record into it if there is one, and make the ignore file cover the folder.
 */
function migrate(root, now = new Date()) {
  const oldRecord = path.join(root, OLD_RECORD);
  const oldArchive = path.join(root, OLD_ARCHIVE);
  fs.mkdirSync(records.recordsDirectory(root), { recursive: true });

  let moved = null;
  if (fs.existsSync(oldRecord)) {
    let key = records.newKey(now, "00");
    while (fs.existsSync(records.recordPath(root, key))) {
      key = records.newKey(now, crypto.randomBytes(2).toString("hex"));
    }
    moved = records.recordPath(root, key);
    fs.renameSync(oldRecord, moved);
    if (fs.existsSync(oldArchive)) {
      fs.renameSync(oldArchive, records.archivePathOf(moved));
    }
  }

  const ignoreFile = path.join(root, ".gitignore");
  let ignoreText = "";
  try {
    ignoreText = fs.readFileSync(ignoreFile, "utf8");
  } catch {
    // No ignore file yet; one is written below.
  }
  const kept = ignoreText
    .split(/\r?\n/)
    .filter((line) => !OLD_IGNORE_LINES.has(line.trim()));
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  if (!kept.some((line) => line.trim() === ".claude/state/")) {
    kept.push(".claude/state/");
  }
  const updated = `${kept.join("\n")}\n`;
  const ignoreChanged = updated !== ignoreText;
  if (ignoreChanged) fs.writeFileSync(ignoreFile, updated);
  return { moved, ignoreChanged };
}

function runMigrate(context, print) {
  const result = migrate(context.root);
  print(
    result.moved === null
      ? "no old .claude/state.md to move"
      : `moved the old record to ${result.moved} (unclaimed: adopt it with ` +
          `\`ccfg state use ${records.keyOf(result.moved)}\`)`,
  );
  print(
    result.ignoreChanged
      ? ".gitignore now covers .claude/state/"
      : ".gitignore already covered .claude/state/",
  );
}

function runState(argv, context, print) {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case undefined:
      return show(context, print);
    case "path":
      return print(ownRecord(context));
    case "list":
      return list(context, print);
    case "use":
      return use(context, print, rest[0]);
    case "new":
      return startNew(context, print);
    case "done":
      return done(context, print, rest.includes("--yes"));
    case "migrate":
      return runMigrate(context, print);
    default:
      throw new UsageError(
        `unknown: state ${subcommand}. Try: path | list | use | new | done | migrate`,
      );
  }
}

function commandState(argv, io) {
  try {
    const root = repoAudit.findRepositoryRoot(process.cwd());
    if (root === null) {
      throw new Error("not inside a git repository, so there are no working records here");
    }
    const processTable = records.readProcessTable();
    runState(
      argv,
      {
        root,
        configDir: io.CONFIG_DIR,
        live: records.liveWindows(processTable),
        windowIdentity: records.findWindow(processTable, process.ppid),
        sessionIdentifier: process.env.CLAUDE_CODE_SESSION_ID || "",
      },
      (line) => console.log(line),
    );
  } catch (error) {
    console.error(`ccfg state: ${error.message}`);
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}

module.exports = { commandState, runState, migrate };
