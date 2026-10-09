"use strict";

// Stop: hold a reply that leaves .claude/state.md behind the session. Two
// replies do that: one that ends a turn of edits with the file unchanged, and
// one that suggests /clear with the file unchanged or larger than a clear loads.
//
// A clear taken with an out-of-date file is the one way the context design loses
// work outright, and whether the file changed this turn is machine-checkable, so
// this is a gate rather than a reminder.
//
// The edit hold is what covers a /clear the operator types, which no hook can
// refuse: the file is brought up to date at the end of every turn that edited
// anything, at any context size, so there is no moment when clearing loses the
// turn before. It counts the turns it could not get recorded, and the status
// line (record-status.js) shows that count.
//
// Two independent loop guards, the same shape as review-reminder.js's: the
// harness's own stop_hook_active flag, and a record of the turn this gate last
// held on. The second exists because stop_hook_active is the harness's promise,
// not this hook's own state, and a version or a direct test invocation that
// omits it must still not hold twice for the same turn.
//
// "Changed this turn" compares against the digest the context gauge recorded
// when the prompt arrived. A digest, not a modification time, because the
// keyword capture writes into the same file.

const path = require("path");

const repoAudit = require("./lib/repo-audit");
const stateFile = require("./lib/state-file");
const transcriptTail = require("./lib/transcript-tail");
const zones = require("./lib/context-zones");
const graphRefresh = require("./lib/graph-refresh");
const io = require("./lib/hook-io");
const paths = require("./lib/paths");

// A bare \bclear\b would also match "clear" as an ordinary word, and \/clear\b
// alone matched an ordinary file path (hooks/clear-gate.js, docs/clear-gate.md):
// \b only checks the boundary after "clear", not what precedes the slash. So
// both ends are spelled out: the command may not be preceded by a letter, a
// digit or another slash (which is what makes hooks/clear-gate.js a path).
//
// After the command, three shapes are a name rather than a suggestion: another
// letter or digit (/clearing), a slash (/clear/notes.md), and a hyphen or dot
// carrying a letter or digit (/clear-gate, /clear-gate.md). That last one has to
// look past the punctuation to the character after it: a dot with a letter after
// it extends the name, while a dot with nothing after it ends a sentence, and
// "then run /clear." has to keep firing.
//
// This hook's own name is the case that bites, because the session most likely
// to write /clear-gate in a reply is the one editing this file, which is how
// the defect was found, and why it costs whoever is fixing it a blocked stop.
//
// Underscore sits outside every class on purpose, because \b counts it as a word
// character and emphasis around the command (_/clear_, */clear*) is a real
// suggestion.
const CLEAR_SUGGESTION =
  /(?<![A-Za-z0-9/])\/clear(?![A-Za-z0-9]|[-.][A-Za-z0-9]|\/)/;

// A reply quoting a commit message or the operator's words mentions /clear
// without suggesting it, and quoted text sits in a fence or a blockquote. The
// gauge's own suggestion is never in either, so dropping both before matching
// loses no real suggestion. The first pattern takes an opening fence through to
// its matching close, or to the end of the message when it never closes.
const NAMED_FILES = 3;

/**
 * Files in the repository this turn edited, leaving out the record itself.
 *
 * Edit tools only. A file changed through the shell or by a subagent is not
 * seen, so a turn that worked only that way is not held.
 */
function editedThisTurn(transcriptPath, turnStartBytes, root) {
  const recordFiles = [
    stateFile.stateFilePath(root),
    path.join(root, stateFile.ARCHIVE_FILE_RELATIVE),
  ];
  return transcriptTail
    .editedFilesSince(transcriptPath, turnStartBytes)
    .filter(
      (file) =>
        transcriptTail.isUnderDirectory(file, root) &&
        !recordFiles.some((recordFile) => paths.samePath(file, recordFile)),
    )
    .map((file) => path.relative(root, path.resolve(file)));
}

function namesOf(files) {
  const named = files.slice(0, NAMED_FILES).join(", ");
  const rest = files.length - NAMED_FILES;
  return rest > 0 ? `${named} and ${rest} more` : named;
}

function withoutQuotations(message) {
  return String(message || "")
    .replace(
      /^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?(^ {0,3}\1[^\n]*$|(?![\s\S]))/gm,
      "",
    )
    .replace(/^ {0,3}>.*$/gm, "");
}

io.run(() => {
  const payload = io.readPayload();
  if (payload.stop_hook_active) return;

  const root = repoAudit.findRepositoryRoot(payload.cwd || process.cwd());
  if (root === null) return;
  const state = stateFile.readStateFile(root);
  if (state === null) return;

  // Claude Code 2.1.270 sends the final message on the payload; the transcript
  // tail covers versions that do not.
  const message =
    typeof payload.last_assistant_message === "string"
      ? payload.last_assistant_message
      : transcriptTail.latestAssistantText(payload.transcript_path);
  const suggestsClear =
    CLEAR_SUGGESTION.test(withoutQuotations(message)) &&
    zones.zoneOf(
      transcriptTail.latestContextTokens(payload.transcript_path),
    ) !== "green";

  // Without the gauge's record there is nothing to compare against, and holding
  // a stop on a guess is worse than letting one reply through. The same record
  // carries the loop guard, so without it the size check waits too.
  const record = zones.readGaugeState(io.configDir(), payload.session_id);
  const asks = [];
  let editedFiles = [];
  if (record !== null) {
    const unchanged = stateFile.stateDigest(state.text) === record.stateDigest;
    // A record written before the gauge noted where turns start (a session
    // already running when that was added) cannot say which edits are this
    // turn's, and every edit in the transcript would be read as one.
    if (unchanged && typeof record.turnStartBytes === "number") {
      editedFiles = editedThisTurn(
        payload.transcript_path,
        record.turnStartBytes,
        root,
      );
    }
    if (unchanged && suggestsClear) {
      asks.push(
        "update .claude/state.md before suggesting a clear: record " +
          "progress, decisions, rejected approaches and the next step.",
      );
    } else if (editedFiles.length > 0) {
      asks.push(
        `This turn edited ${namesOf(editedFiles)} and .claude/state.md did ` +
          "not change. Bring it up to date now: progress, decisions, " +
          "rejected approaches and the next step, so that a clear typed at " +
          "any moment loses nothing. This holds once a turn.",
      );
    }
    // Updated is not enough once the file is past what a clear loads: the
    // session after it would start from part of the record.
    if (suggestsClear && state.text.length > stateFile.MAX_LOADED_CHARACTERS) {
      asks.push(
        `.claude/state.md is ${stateFile.formatCount(state.text.length)} ` +
          "characters, and a clear loads only " +
          `${stateFile.formatCount(stateFile.MAX_LOADED_CHARACTERS)}. ` +
          "Move finished Progress entries, settled Decisions and old " +
          "Rejected approaches word for word to the end of " +
          ".claude/state.archive.md, keeping the newest entries at the top " +
          "of each section.",
      );
    }
  }

  if (asks.length > 0) {
    // The second loop guard: this gate has already held once for this turn,
    // so holding again would be the loop stop_hook_active is meant to prevent.
    if (record.gateHeldTurn === record.turn) return;

    // Hold only once the marker is on disk. If the write is lost the gate has
    // no memory of having held and would hold again on the next stop, so a
    // failed write degrades to letting the reply through, not looping. The
    // count of unrecorded turns rides on the same write, and the loop guard
    // above is what keeps one turn from being counted twice.
    const holdRecorded = zones.writeGaugeState(
      io.configDir(),
      payload.session_id,
      {
        ...record,
        gateHeldTurn: record.turn,
        unrecordedEditTurns:
          (record.unrecordedEditTurns || 0) + (editedFiles.length > 0 ? 1 : 0),
      },
    );
    if (!holdRecorded) return;

    io.block(
      asks.join(" ") + (suggestsClear ? " Then suggest the clear again." : ""),
    );
    return;
  }

  // Whenever a graph exists, not only when stale: this session's edits are
  // uncommitted, so HEAD's log has not moved, and the session after the clear
  // should still read a graph that includes them.
  if (suggestsClear) graphRefresh.startRefresh(io.configDir(), root);
});
