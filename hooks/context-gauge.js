"use strict";

// UserPromptSubmit: tell Claude how large the context is once that matters, and
// when .claude/state.md has gone stale.
//
// A number delivered each turn rather than a standing rule, because of the
// measurement recorded in mode-inject.js: a rule buried behind ~6,600 tokens was
// followed 0 times in 36, while new information on the user's message won 12 in
// 12. A size that changes every turn is new information.
//
// Silent in a repository with no state file, where the setup banner speaks.

const repoAudit = require("./lib/repo-audit");
const stateFile = require("./lib/state-file");
const transcriptTail = require("./lib/transcript-tail");
const zones = require("./lib/context-zones");
const io = require("./lib/hook-io");

const EVENT = "UserPromptSubmit";

io.run(() => {
  const payload = io.readPayload();
  const root = repoAudit.findRepositoryRoot(payload.cwd || process.cwd());
  if (root === null) return;
  const state = stateFile.readStateFile(root);
  if (state === null) return;

  const previous = zones.readGaugeState(io.configDir(), payload.session_id) || {
    turn: 0,
  };
  const turn = previous.turn + 1;
  const digest = stateFile.stateDigest(state.text);
  const digestChangedTurn =
    digest === previous.stateDigest ? previous.digestChangedTurn : turn;
  zones.writeGaugeState(io.configDir(), payload.session_id, {
    turn,
    stateDigest: digest,
    digestChangedTurn,
  });

  const tokens = transcriptTail.latestContextTokens(payload.transcript_path);
  const zone = zones.zoneOf(tokens);
  if (zone !== "green") {
    io.warn(
      EVENT,
      `Context is ${Math.round(tokens / 1000)}K tokens (${zone} zone` +
        (zone === "red" ? ", automatic compaction is near" : "") +
        "). At your next natural stopping point, never mid-task: bring " +
        ".claude/state.md up to date, then end the reply with " +
        '"good point to clear: `/clear`, then `go`".',
    );
    return;
  }

  const unchangedTurns = turn - digestChangedTurn;
  if (unchangedTurns >= zones.STALE_TURNS) {
    io.warn(
      EVENT,
      `.claude/state.md has not changed in ${unchangedTurns} turns. If a ` +
        "decision, a rejected approach or a finished phase has happened " +
        "since, record it.",
    );
  }
});
