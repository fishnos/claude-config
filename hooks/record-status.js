"use strict";

// statusLine: say whether .claude/state.md has caught up with this session.
//
// A /clear the operator types cannot be held by any hook, so the place to
// answer "is it safe to clear?" is before the key is pressed. The clear gate
// keeps the count this reads: turns that edited files and ended with the record
// unchanged.
//
// Silent where there is no record to stand behind: a repository with no state
// file, and a session whose first prompt the gauge has not yet seen.

const path = require("path");

const repoAudit = require("./lib/repo-audit");
const stateFile = require("./lib/state-file");
const zones = require("./lib/context-zones");
const io = require("./lib/hook-io");

const ink = require(path.join(__dirname, "..", "tools", "modes", "ink.js"));

io.run(() => {
  const payload = io.readPayload();
  const workspace = payload.workspace || {};
  const root = repoAudit.findRepositoryRoot(
    payload.cwd || workspace.current_dir || process.cwd(),
  );
  if (root === null) return;
  const state = stateFile.readStateFile(root);
  if (state === null) return;
  const record = zones.readGaugeState(io.configDir(), payload.session_id);
  if (record === null) return;

  const paint = ink.painter(Boolean(process.env.NO_COLOR));
  const behind = zones.turnsBehind(record, stateFile.stateDigest(state.text));
  process.stdout.write(
    behind === 0
      ? paint.dim("record current")
      : paint.yellow(
          `record ${behind} ${behind === 1 ? "turn" : "turns"} behind`,
        ),
  );
});
