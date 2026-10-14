"use strict";

// SessionStart: find this window's working record under .claude/state/ and load
// it according to how the session started.
//
// clear    the same window process, so the same record; continue from its next
//          step without asking.
// compact  the record wins over the lossy summary; Claude is told how stale the
//          record was when the compaction ran, so it can catch the record up.
// startup  a new window gets a fresh record and is told its path, with any
//          records earlier windows left unclaimed listed for the user to adopt.
// resume and fork bring the conversation back with the record already in it,
//          and loading it again would only say it twice. The window is still
//          pointed at the session's record so the reading hooks find it.
//
// When a clear or a compaction finds no record, it says why rather than staying
// silent, because silence there reads as "this repository has no earlier work".
// Outside any repository it also names the records this configuration directory
// keeps, without reading them, because that is the case where the session was
// started in the wrong place.

const fs = require("fs");
const path = require("path");

const { clearPreamble } = require("../probes/state-carryover.js");
const repoAudit = require("./lib/repo-audit");
const records = require("./lib/state-records");
const stateFile = require("./lib/state-file");
const io = require("./lib/hook-io");

const EVENT = "SessionStart";

const LISTED_RECORDS = 5;

// Say why nothing loaded, rather than leaving the model to infer that no earlier
// work exists. Only a clear or a compaction destroys the conversation, so only
// there does silence mislead; on startup nothing was lost, and repo-setup.js
// already asks for the setup a project is missing.
function reportNothingCarried(source, cause, pointerSentence = "") {
  if (source === "startup") return;
  const opening =
    source === "clear"
      ? "This session started with /clear"
      : "This session was just compacted";
  io.warn(
    EVENT,
    `${opening}. ${cause} Nothing was carried across: treat what the user ` +
      "says next as the whole brief, and do not guess at earlier work." +
      pointerSentence,
  );
}

function unclaimedLines(unclaimed, now) {
  return unclaimed.slice(0, LISTED_RECORDS).map((entry) => {
    const goal = entry.goal || "(no goal recorded)";
    const next = entry.next || "(no next step recorded)";
    const age = stateFile.formatAge(now - entry.modifiedMs);
    return `- ${entry.key}: ${goal}. Next: ${next} (updated ${age} ago)`;
  });
}

// Outside any repository the one useful thing to say is where the
// configuration repository's records are, without reading any of them.
//
// Naming a record is not loading one, which is the line this hook holds
// everywhere else: nothing is read into the session, so no other repository's
// work can be mistaken for this directory's. Deliberately narrow: inside some
// other repository that simply keeps no record, the configuration directory's
// records are not the answer and saying so would be noise.
function configurationRecordPointer(cwd) {
  const configDir = io.configDir();
  if (path.resolve(cwd) === path.resolve(configDir)) return "";
  if (!records.enabled(configDir)) return "";
  const kept = records
    .listRecords(configDir, configDir, new Set())
    .filter((entry) => !entry.untouched);
  if (kept.length === 0) return "";
  const age = stateFile.formatAge(Date.now() - kept[0].modifiedMs);
  return (
    ` The configuration repository at ${configDir} keeps ${kept.length} ` +
    `working record${kept.length === 1 ? "" : "s"}, the newest updated ` +
    `${age} ago. If this session was meant to continue that work, restart ` +
    `there: \`cd ${configDir} && claude\`.`
  );
}

io.run(() => {
  const payload = io.readPayload();
  const source = payload.source;
  if (!["clear", "compact", "startup", "resume", "fork"].includes(source))
    return;
  // A resume or a fork brings its conversation with it, so nothing is said;
  // the pointer is still kept current.
  const speaks = ["clear", "compact", "startup"].includes(source);

  const cwd = payload.cwd || process.cwd();
  const root = repoAudit.findRepositoryRoot(cwd);
  if (root === null) {
    if (speaks) {
      reportNothingCarried(
        source,
        `The working directory (${cwd}) is not inside a git repository, so ` +
          "there is nowhere for a working record to live.",
        configurationRecordPointer(cwd),
      );
    }
    return;
  }
  if (!records.enabled(root)) {
    if (speaks) {
      reportNothingCarried(
        source,
        `${root} keeps no working records (no .claude/state/ folder that ` +
          ".gitignore covers). Run `ccfg state migrate` to turn them on.",
      );
    }
    return;
  }

  const configDir = io.configDir();
  const processTable = records.readProcessTable();
  const live = records.liveWindows(processTable);
  const windowIdentity = records.findWindow(processTable, process.ppid);
  const sessionIdentifier = payload.session_id || "";
  // A listing always includes at least this hook's own process, so an empty
  // one means `ps` failed and says nothing about which windows are open.
  // Pruning, template cleanup and the fallback adoption all read "not live" as
  // "closed", and would take records from windows that are still open.
  const windowsKnown = processTable.size > 0;
  if (windowsKnown) records.pruneDeadWindows(configDir, live);

  // A resume can switch conversations inside a window that already holds a
  // record, and the conversation it brings back is the one whose record wins.
  let record =
    source === "resume"
      ? records.recordForSession(configDir, sessionIdentifier) ||
        records.recordForWindow(configDir, windowIdentity)
      : records.resolveRecord(configDir, { windowIdentity, sessionIdentifier });

  // The session's directory moved into another repository. Repointing the
  // window here would make a later clear back home report that it never had
  // a record, so nothing is claimed or created; the model is told where the
  // record is.
  if (record !== null && !records.isInsideRepository(root, record)) {
    if (!speaks) return;
    const cause =
      `This window's working record is ${record}, outside ${root}, so it ` +
      "was not loaded and no record was made here.";
    if (source === "startup") io.warn(EVENT, cause);
    else reportNothingCarried(source, cause);
    return;
  }

  // A client whose process cannot be recognised has nothing that survives a
  // clear. The newest record no live window holds is what the single file
  // gave it, and is better than starting empty without saying so.
  if (
    record === null &&
    windowIdentity === null &&
    windowsKnown &&
    source !== "startup"
  ) {
    const newest = records
      .listRecords(root, configDir, live)
      .find((entry) => entry.heldBy === null && !entry.untouched);
    if (newest !== undefined) record = newest.path;
  }

  if (windowsKnown) records.removeAbandonedTemplates(root, configDir, live);
  if (record !== null && !fs.existsSync(record)) record = null;

  const isNew = record === null;
  if (isNew) record = records.createRecord(root, records.templateText());
  records.claim(configDir, { windowIdentity, sessionIdentifier, record });
  if (!speaks) return;

  const name = path.relative(root, record).split(path.sep).join("/");
  const now = Date.now();

  if (isNew) {
    const unclaimed = records
      .listRecords(root, configDir, live)
      .filter((entry) => entry.heldBy === null && !entry.untouched);
    const opening =
      source === "startup"
        ? ""
        : (source === "clear"
            ? "This session started with /clear"
            : "This session was just compacted") +
          ". This window had no working record before that, so nothing was " +
          "carried across: treat what the user says next as the whole brief. ";
    const own =
      `${opening}This window's working record is ${name} (\`ccfg state\` ` +
      "shows it). It is new and empty: write the goal into it once the work " +
      "is clear.";
    if (unclaimed.length === 0) {
      io.warn(EVENT, own);
      return;
    }
    io.announce(
      EVENT,
      `${own}\n\nEarlier windows left ${unclaimed.length} unclaimed ` +
        `record${unclaimed.length === 1 ? "" : "s"} in this repository:\n` +
        `${unclaimedLines(unclaimed, now).join("\n")}\n\nIf this session ` +
        "continues one of them, confirm with the user first, then run " +
        "`ccfg state use KEY` and read that record.",
      `${unclaimed.length} unclaimed working record` +
        `${unclaimed.length === 1 ? "" : "s"}; newest: ` +
        `${unclaimed[0].goal || "(no goal recorded)"} ` +
        `(\`ccfg state use ${unclaimed[0].key}\`)`,
    );
    return;
  }

  // A record git tracks arrives with every clone, so its text is whatever the
  // repository's author wrote, and loading it would hand them the session.
  if (io.git(["ls-files", "--", record], root).trim() !== "") {
    reportNothingCarried(
      source,
      `${name} is tracked by git, so it may have come with the repository ` +
        "rather than from an earlier session here, and it was not loaded. " +
        "If it is yours, untrack it (`git rm --cached`) and git-ignore it.",
    );
    return;
  }
  const state = stateFile.readRecord(record);
  if (state === null || !stateFile.hasContent(state.text)) {
    reportNothingCarried(
      source,
      `${name} is this window's working record, but it is still the ` +
        "untouched template, so nothing has ever been written into it.",
    );
    return;
  }

  const archiveName = name.replace(/\.md$/, ".archive.md");
  const loaded = stateFile.loadedText(state.text, name, archiveName);
  const age = stateFile.formatAge(now - state.modifiedMs);
  if (source === "clear") {
    io.warn(EVENT, clearPreamble(name) + loaded);
    return;
  }
  if (source === "compact") {
    io.warn(
      EVENT,
      "This session was just compacted: a summary replaced the earlier " +
        `conversation. Below is ${name}, this window's working record ` +
        "(`ccfg state` shows it). Where the summary and this file disagree, " +
        `the file wins. It was last updated ${age} before the compaction, ` +
        "so bring it up to date from the summary now, before continuing.\n\n" +
        loaded,
    );
    return;
  }
  // Startup with a record already: only a recognised override or a reused
  // lookup reaches here. Confirm before continuing, as the single file did.
  io.announce(
    EVENT,
    `This window's working record is ${name}, last updated ${age} ago. ` +
      "Before continuing that work, confirm with the user that this " +
      `session is for it.\n\n${loaded}`,
    `Resuming: ${stateFile.goalLine(state.text) || "(no goal recorded)"}. ` +
      `Next: ${stateFile.nextStep(state.text) || "(no next step recorded)"} ` +
      `(updated ${age} ago)`,
  );
});
