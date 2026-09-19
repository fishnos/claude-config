"use strict";

// Stop: hold a /clear suggestion made without updating .claude/state.md, or
// while the file is larger than a clear loads.
//
// A clear taken with an out-of-date file is the one way the context design loses
// work outright, and whether the file changed this turn is machine-checkable, so
// this is a gate rather than a reminder.
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

const repoAudit = require("./lib/repo-audit");
const stateFile = require("./lib/state-file");
const transcriptTail = require("./lib/transcript-tail");
const zones = require("./lib/context-zones");
const graphRefresh = require("./lib/graph-refresh");
const io = require("./lib/hook-io");

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
// to write /clear-gate in a reply is the one editing this file — which is how
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

  // Claude Code 2.1.270 sends the final message on the payload; the transcript
  // tail covers versions that do not.
  const message =
    typeof payload.last_assistant_message === "string"
      ? payload.last_assistant_message
      : transcriptTail.latestAssistantText(payload.transcript_path);
  if (!CLEAR_SUGGESTION.test(withoutQuotations(message))) return;

  const tokens = transcriptTail.latestContextTokens(payload.transcript_path);
  if (zones.zoneOf(tokens) === "green") return;

  const root = repoAudit.findRepositoryRoot(payload.cwd || process.cwd());
  if (root === null) return;
  const state = stateFile.readStateFile(root);
  if (state === null) return;

  // Without the gauge's record there is nothing to compare against, and holding
  // a stop on a guess is worse than letting one suggestion through. The same
  // record carries the loop guard, so without it the size check waits too.
  const record = zones.readGaugeState(io.configDir(), payload.session_id);
  if (record !== null) {
    const unchanged =
      stateFile.stateDigest(state.text) === record.stateDigest;
    // Updated is not enough once the file is past what a clear loads: the
    // session after it would start from part of the record.
    const oversized = state.text.length > stateFile.MAX_LOADED_CHARACTERS;
    if (unchanged || oversized) {
      // The second loop guard: this gate has already held once for this turn,
      // so holding again would be the loop stop_hook_active is meant to prevent.
      if (record.gateHeldTurn === record.turn) return;

      // Hold only once the marker is on disk. If the write is lost the gate has
      // no memory of having held and would hold again on the next stop, so a
      // failed write degrades to letting the suggestion through, not looping.
      const holdRecorded = zones.writeGaugeState(
        io.configDir(),
        payload.session_id,
        { ...record, gateHeldTurn: record.turn },
      );
      if (!holdRecorded) return;

      const asks = [];
      if (unchanged) {
        asks.push(
          "update .claude/state.md before suggesting a clear: record " +
            "progress, decisions, rejected approaches and the next step.",
        );
      }
      if (oversized) {
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
      io.block(`${asks.join(" ")} Then suggest the clear again.`);
      return;
    }
  }

  // Whenever a graph exists, not only when stale: this session's edits are
  // uncommitted, so HEAD's log has not moved, and the session after the clear
  // should still read a graph that includes them.
  graphRefresh.startRefresh(io.configDir(), root);
});
