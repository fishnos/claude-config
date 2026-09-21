"use strict";

// Stop: hold the main session's turn until every run that changed files under a
// `verify: proven` posture has a blind review that is clean or answered.
//
// The review cannot be a gate on the worker's own report, because no reviewer
// can have run when that report arrives. It is checked here instead, at the
// main session's turn end, which is the first moment the main session has had
// the chance to dispatch one (hooks/agent-dispatch.js builds the reviewer's
// prompt; hooks/subagent-gate.js writes its verdict into the run record).
//
// A blocking verdict is settled by a fix reviewed clean, or by a line in the
// final message saying why it stands, which is the rule the gate always gave a
// worker. Each run is held at most twice, counted in the run record rather than
// through `stop_hook_active`: this hold has to fire again after the main session
// has gone off and dispatched the reviewer, and that flag would stop it.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");
const record = require("./lib/crew-record");
const blindReview = require("./lib/blind-review");
const transcriptTail = require("./lib/transcript-tail");

const MAX_HOLDS = 2;
const STANDS_LINE = /^[ \t]*Stands[ \t]+([0-9a-f]{8})[ \t]*:[ \t]*(.*)$/gim;

function readLock() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(io.configDir(), "mode.lock"), "utf8"),
    );
  } catch {
    return null;
  }
}

/**
 * The tokens of every run that owes a review.
 *
 * Dispatched under `verify: proven`, not itself a review, and joined through a
 * finish line to a worker that wrote at least one file. A worker still running
 * has no finish line yet and is not owed until it reports.
 */
function runsOwingReview(lines) {
  const agentsThatWrote = new Set(
    lines
      .filter((entry) => entry.kind === "path")
      .map((entry) => entry.agentId),
  );
  const agentForToken = new Map();
  for (const entry of lines) {
    if (entry.kind === "finish" && entry.token && entry.agentId)
      agentForToken.set(entry.token, entry.agentId);
  }
  return lines
    .filter(
      (entry) =>
        entry.kind === "run" &&
        entry.verify === "proven" &&
        !entry.reviews &&
        agentsThatWrote.has(agentForToken.get(entry.token)),
    )
    .map((entry) => entry.token);
}

/**
 * Where one run stands. Order in the file is the clock: the record is append
 * only, and two lines written in the same millisecond would tie on `at`.
 */
function standing(lines, token) {
  let verdict = null;
  let verdictIndex = -1;
  let standsIndex = -1;
  let holds = 0;
  lines.forEach((entry, index) => {
    if (
      entry.kind === "review" &&
      Array.isArray(entry.reviews) &&
      entry.reviews.includes(token)
    ) {
      verdict = entry;
      verdictIndex = index;
    }
    if (entry.kind === "stands" && entry.token === token) standsIndex = index;
    if (entry.kind === "hold" && entry.token === token) holds += 1;
  });
  if (verdict === null) return { settled: false, blocking: false, holds };
  const result = blindReview.interpret({ findings: verdict.findings });
  if (result.ok || standsIndex > verdictIndex) return { settled: true };
  return { settled: false, blocking: true, holds, reason: result.reason };
}

function holdText(token, state) {
  if (!state.blocking)
    return (
      `Run ${token} changed files and nobody has reviewed it. Dispatch a ` +
      `\`reviewer\` with the line \`Reviews: ${token}\`; the hook writes its prompt.`
    );
  return (
    `Run ${token}: ${state.reason} Fix it and review the fix together with this ` +
    `run (\`Reviews: ${token}, <fix token>\`), or write \`Stands ${token}: <reason>\` ` +
    "in your final message."
  );
}

io.run(() => {
  const payload = io.readPayload();
  const lock = readLock();
  if (!lock || !lock.settings || lock.settings.verify !== "proven") return;

  const sessionId = payload.session_id;
  const owing = runsOwingReview(record.readLines(sessionId));
  if (owing.length === 0) return;

  const message =
    typeof payload.last_assistant_message === "string"
      ? payload.last_assistant_message
      : transcriptTail.latestAssistantText(payload.transcript_path);
  const ignored = [];
  for (const found of String(message || "").matchAll(STANDS_LINE)) {
    const token = found[1].toLowerCase();
    const reason = found[2].trim();
    const state = standing(record.readLines(sessionId), token);
    if (!owing.includes(token) || !state.blocking) {
      ignored.push(
        `\`Stands ${token}\` was ignored: that run has no blocking finding to answer.`,
      );
    } else if (reason === "") {
      ignored.push(`\`Stands ${token}\` was ignored: it gives no reason.`);
    } else {
      record.appendStands(sessionId, { token, reason });
    }
  }

  const lines = record.readLines(sessionId);
  const held = [];
  const givenUp = [];
  for (const token of owing) {
    const state = standing(lines, token);
    if (state.settled) continue;
    if (state.holds >= MAX_HOLDS) givenUp.push(token);
    else held.push({ token, state });
  }

  if (held.length === 0) {
    if (givenUp.length > 0)
      io.tell(
        `Blind review: run${givenUp.length > 1 ? "s" : ""} ${givenUp.join(", ")} ` +
          "ended unreviewed or unresolved after two holds.",
      );
    return;
  }

  // The bound is counted from the record, so a record at its ceiling cannot
  // count it. Holding anyway risks a loop nothing stops, so the turn ends and
  // the operator is told why.
  for (const { token } of held) {
    if (!record.appendHold(sessionId, { token })) {
      io.tell(
        "Blind review: the run record has reached its size ceiling, so holds can " +
          `no longer be counted and the turn was let go. Owed: ${held.map((entry) => entry.token).join(", ")}.`,
      );
    }
  }

  io.block(
    [
      ...held.map(({ token, state }) => holdText(token, state)),
      ...ignored,
    ].join("\n\n"),
  );
});
