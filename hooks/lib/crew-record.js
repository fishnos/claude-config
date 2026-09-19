"use strict";

// The run record: what a worker was sent to do, and what it actually touched.
//
// One JSON object per line under cache/crew/<session>.jsonl. A `run` line is
// written by the dispatch hook before the worker exists; a `path` line is
// written by the trace hook every time a worker writes a file. The finish gates
// read both back and compare them, which is the whole point: a worker cannot
// write its own verification record, so the claim it returns is checked against
// lines it never had the chance to author.
//
// Append-only, never read-modify-write. Two hooks write this file from separate
// processes while a worker runs, so a read, edit and rewrite would silently drop
// whichever line landed in between.

const fs = require("fs");
const path = require("path");
const io = require("./hook-io");

// Same ceiling as hooks/evidence-log.js, for the same reason: this is here to
// stop unbounded growth, not to hit an exact number.
const MAX_RECORD_BYTES = 512 * 1024;

/** The directory every session's run record lives in. */
function recordDir() {
  return path.join(io.configDir(), "cache", "crew");
}

/** Where a session's run record lives. */
function recordFile(sessionId) {
  return path.join(recordDir(), `${sessionId || "unknown"}.jsonl`);
}

function appendLine(sessionId, entry) {
  const file = recordFile(sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.statSync(file).size >= MAX_RECORD_BYTES) return false;
  } catch {
    // No file yet, which is the normal first-dispatch case.
  }
  fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  return true;
}

function readLines(sessionId) {
  let text = "";
  try {
    text = fs.readFileSync(recordFile(sessionId), "utf8");
  } catch {
    return [];
  }
  const entries = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A truncated last line is possible if a write was cut short. Skipping it
      // loses one record; throwing would lose the whole session's history.
    }
  }
  return entries;
}

/**
 * Open a run: the dispatch as the dispatcher declared it.
 *
 * `head` is the repository's commit at dispatch time, kept so a later diff can
 * be taken against the state the worker actually started from rather than
 * against whatever HEAD has become by the time it reports.
 */
function openRun({ sessionId, token, role, scope, head, verify, reviews }) {
  return appendLine(sessionId, {
    kind: "run",
    token,
    role: role || null,
    scope: Array.isArray(scope) ? scope : [],
    head: head || null,
    verify: verify || null,
    // Only a reviewer's dispatch carries this. Null rather than an empty list
    // so a reader can test it for truth without also checking its length.
    reviews: Array.isArray(reviews) && reviews.length > 0 ? reviews : null,
    at: new Date().toISOString(),
  });
}

/** Record one file a worker wrote, keyed by the worker's own agent id. */
function appendPath(sessionId, agentId, filePath) {
  return appendLine(sessionId, {
    kind: "path",
    agentId: agentId || null,
    path: filePath,
    at: new Date().toISOString(),
  });
}

/**
 * Note something a gate decided about one worker: `refusal` when the runner sent
 * a report back, `delivered` when a hand-back actually reached the parent.
 *
 * The bound on retries is counted from these lines rather than from
 * `stop_hook_active`, which only says a stop hook is already running and is
 * never set by a hand-back denial. `point` keeps which event the mark came from,
 * because a worker's two refusals may arrive one at each.
 */
function appendMark(sessionId, { agentId, mark, gate, point }) {
  return appendLine(sessionId, {
    kind: "mark",
    agentId: agentId || null,
    mark,
    gate: gate || null,
    point: point || null,
    at: new Date().toISOString(),
  });
}

/**
 * Note one report a gate actually read, and what the harness carried with it.
 *
 * The conformance reader (tools/conformance.js) has no other source: every
 * assumption this design rests on about the dispatch prompt arriving, about
 * which point a report shows up at, and about where a worker's transcript sits
 * is settled by these lines. `tokenSource` is where the token was found,
 * "report" or "transcript" or null, which is what separates a prompt that never
 * arrived from a worker that simply left the token out of its report.
 */
function appendFinish(
  sessionId,
  {
    agentId,
    point,
    token,
    tokenSource,
    transcriptFound,
    transcriptRead,
    build,
  },
) {
  return appendLine(sessionId, {
    kind: "finish",
    agentId: agentId || null,
    point: point || null,
    token: token || null,
    tokenSource: tokenSource || null,
    // Two separate questions, both defaulting to false, because an undefined
    // flag would read downstream as a hard "no" and contradict an assumption
    // nothing had actually looked at. `transcriptFound` is whether the file was
    // where it was expected; `transcriptRead` is whether any line in it parsed,
    // which is the only one that can speak for the prompt the worker was sent.
    transcriptFound: transcriptFound === true,
    transcriptRead: transcriptRead === true,
    build: build || null,
    at: new Date().toISOString(),
  });
}

/** A reviewer's verdict on the runs it was dispatched to review. */
function appendReview(sessionId, { token, reviews, findings }) {
  return appendLine(sessionId, {
    kind: "review",
    token,
    reviews,
    findings,
    at: new Date().toISOString(),
  });
}

/**
 * The main session's written reason that a run's blocking findings stand.
 *
 * Kept here rather than read back from the transcript each time, because the
 * turn end that wrote it is gone by the next one.
 */
function appendStands(sessionId, { token, reason }) {
  return appendLine(sessionId, {
    kind: "stands",
    token,
    reason,
    at: new Date().toISOString(),
  });
}

/** One turn end held on a run, counted toward the two-hold bound. */
function appendHold(sessionId, { token }) {
  return appendLine(sessionId, {
    kind: "hold",
    token,
    at: new Date().toISOString(),
  });
}

/** Every mark recorded against a given worker. */
function marksFor(sessionId, agentId) {
  return readLines(sessionId).filter(
    (entry) => entry.kind === "mark" && entry.agentId === agentId,
  );
}

/** The run a token belongs to, or null when no dispatch minted it. */
function findRun(sessionId, token) {
  if (!token) return null;
  for (const entry of readLines(sessionId)) {
    if (entry.kind === "run" && entry.token === token) return entry;
  }
  return null;
}

/**
 * The worker a run token belongs to, or null.
 *
 * Only a `finish` line holds both halves of the join: the dispatch minted the
 * token before the worker had an agent id, and the trace hook records paths by
 * agent id alone. The newest wins, because a worker whose report was refused
 * reports a second time, and the later line is the one that describes the work.
 */
function agentForToken(sessionId, token) {
  let agentId = null;
  for (const entry of readLines(sessionId)) {
    if (entry.kind === "finish" && entry.token === token && entry.agentId)
      agentId = entry.agentId;
  }
  return agentId;
}

/** Every path a given worker wrote. */
function pathsFor(sessionId, agentId) {
  return readLines(sessionId)
    .filter((entry) => entry.kind === "path" && entry.agentId === agentId)
    .map((entry) => entry.path);
}

module.exports = {
  recordDir,
  recordFile,
  openRun,
  appendPath,
  appendMark,
  appendFinish,
  appendReview,
  appendStands,
  appendHold,
  agentForToken,
  marksFor,
  findRun,
  pathsFor,
  readLines,
  MAX_RECORD_BYTES,
};
