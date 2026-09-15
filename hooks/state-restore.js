"use strict";

// SessionStart: load .claude/state.md according to how the session started.
//
// clear    continue from the file's next step without asking.
// compact  the file wins over the lossy summary; Claude is told how stale the
//          file was when the compaction ran, so it can catch the file up.
// startup  the operator sees what would be resumed and Claude confirms first,
//          because a new session may be for different work.
// resume and fork bring the conversation back with the file already in it, and
//          loading it again would only say it twice.
//
// When a clear or a compaction finds no record, it says which of the three
// reasons applies rather than staying silent, because silence there reads as
// "this repository has no earlier work".

const repoAudit = require("./lib/repo-audit");
const stateFile = require("./lib/state-file");
const io = require("./lib/hook-io");

const EVENT = "SessionStart";

// Word for word the text probes/state-carryover.js measured.
const CLEAR_PREAMBLE =
  "This session started with /clear. Below is .claude/state.md, the working " +
  "record for this repository. Re-read the files under Hot files and run " +
  'the queries under Where to look as `graphify query "<question>" ' +
  "--budget 1500`, never through the /graphify skill; then continue from " +
  "the next step under Progress without asking.\n\n";

// Say why nothing loaded, rather than leaving the model to infer that no earlier
// work exists. Only a clear or a compaction destroys the conversation, so only
// there does silence mislead; on startup nothing was lost, and repo-setup.js
// already asks for the setup a project is missing.
function reportNothingCarried(source, cause) {
  if (source === "startup") return;
  const opening =
    source === "clear"
      ? "This session started with /clear"
      : "This session was just compacted";
  io.warn(
    EVENT,
    `${opening}. ${cause} Nothing was carried across: treat what the user ` +
      "says next as the whole brief, and do not guess at earlier work.",
  );
}

io.run(() => {
  const payload = io.readPayload();
  if (!["clear", "compact", "startup"].includes(payload.source)) return;

  const cwd = payload.cwd || process.cwd();
  const root = repoAudit.findRepositoryRoot(cwd);
  if (root === null) {
    reportNothingCarried(
      payload.source,
      `The working directory (${cwd}) is not inside a git repository, so ` +
        "there is nowhere for a per-repository working record " +
        "(.claude/state.md) to live.",
    );
    return;
  }

  const file = stateFile.stateFilePath(root);
  const state = stateFile.readStateFile(root);
  if (state === null) {
    reportNothingCarried(
      payload.source,
      `${file} does not exist, so this repository keeps no working record. ` +
        "Run `/repo-setup context` to create one.",
    );
    return;
  }
  if (!stateFile.hasContent(state.text)) {
    reportNothingCarried(
      payload.source,
      `${file} exists but is still the untouched template, so nothing has ` +
        "ever been written into it.",
    );
    return;
  }

  const loaded = stateFile.loadedText(state.text);
  const age = stateFile.formatAge(Date.now() - state.modifiedMs);

  if (payload.source === "clear") {
    io.warn(EVENT, CLEAR_PREAMBLE + loaded);
    return;
  }

  if (payload.source === "compact") {
    io.warn(
      EVENT,
      "This session was just compacted: a summary replaced the earlier " +
        "conversation. Below is .claude/state.md. Where the summary and this " +
        `file disagree, the file wins. It was last updated ${age} before the ` +
        "compaction, so bring it up to date from the summary now, before " +
        "continuing.\n\n" +
        loaded,
    );
    return;
  }

  const goal = stateFile.goalLine(state.text) || "(no goal recorded)";
  const next = stateFile.nextStep(state.text) || "(no next step recorded)";
  io.announce(
    EVENT,
    `A working record for this repository exists (.claude/state.md), last ` +
      `updated ${age} ago. Before continuing that work, confirm with the user ` +
      `that this session is for it.\n\n${loaded}`,
    `Resuming: ${goal}. Next: ${next} (updated ${age} ago)`,
  );
});
