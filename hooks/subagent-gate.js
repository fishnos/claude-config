"use strict";

// The gate runner: check a worker's report wherever it arrives, and send it back
// with a reason when a gate refuses it.
//
// A report arrives at one of two places, and the difference was measured rather
// than assumed. In auto mode the parent already holds the report by the time
// `SubagentStop` fires, because the worker delivers it through a
// `SubagentHandback` call first, and a block at the stop only sends the worker
// back to a second hand-back the harness refuses. So the runner answers at both:
// it denies the hand-back, which withholds an unchecked report from the parent,
// and it blocks at the stop for every worker that never calls that tool.
// `PostToolUse` on the same tool is where it takes notes: a hand-back the
// harness actually delivered excuses the stop that follows it.
//
// Which gates run is the role's business, not this file's. A role file names
// them in its `gates:` list, one module per gate under hooks/subagent/gates/,
// and the directory is the registry. A worker whose type has no role file (every
// built-in type: Explore, general-purpose, code-simplifier) is still gated on
// the shape of its finish, by the operator's decision of 2026-09-15.
//
// Two refusals per worker, counted in the run record across both points. The
// count cannot come from `stop_hook_active`, which only says a stop hook is
// already running and is never set by a hand-back denial.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");
const record = require("./lib/crew-record");
const blindReview = require("./lib/blind-review");
const { loadRoles } = require("../tools/modes/roles.js");

const HANDBACK = "SubagentHandback";
const GATES_DIR = path.join(__dirname, "subagent", "gates");

// The mode's `verify` dial, weakest first. A gate asking for more proof than the
// posture gives still runs; its failure is carried as a warning.
const VERIFY_ORDER = ["none", "tested", "proven"];

// What a worker with no role file is gated on. Not "nothing": a built-in type
// cannot be given a role file at all, and an ungated finish is the case this
// whole design exists to prevent.
const FALLBACK_GATES = ["finish-shape"];

// The four field names of the finish block, from the contract the dispatch hook
// staples onto every prompt (hooks/agent-dispatch.js).
const FIELDS = ["RUN", "STATE", "TOUCHED", "EVIDENCE"];

const MAX_REFUSALS = 2;

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
 * The finish block as fields.
 *
 * Split on the field names rather than on commas, because `TOUCHED` lists paths
 * separated by commas and splitting there would cut a value in half. Each value
 * runs from its field name to the next field name, which is what makes the
 * four-line form and the one-line form (`RUN x, STATE done, ...`) parse the
 * same way; a measured worker wrote both. The last occurrence of a field wins,
 * so a report that discusses the word STATE in prose before writing its block
 * still reports the block.
 */
function parseFinish(report) {
  const text = typeof report === "string" ? report : "";

  const fieldMarks = [];
  for (const field of FIELDS) {
    const pattern = new RegExp(`(^|[\\s,])${field}\\b[ \\t]*:?[ \\t]*`, "g");
    let found;
    while ((found = pattern.exec(text)) !== null) {
      const start = found.index + found[0].length;
      fieldMarks.push({ field, at: found.index, start });
      pattern.lastIndex = start;
    }
  }
  fieldMarks.sort((left, right) => left.at - right.at);

  const values = {};
  for (let index = 0; index < fieldMarks.length; index += 1) {
    const mark = fieldMarks[index];
    const next = fieldMarks[index + 1];
    const raw = text.slice(mark.start, next ? next.at : text.length);
    // The one-line form leaves a comma between a value and the next field.
    values[mark.field] = raw.trim().replace(/,$/, "").trim();
  }

  const commaList = (value) =>
    (value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

  // Both values are read from the front of the field rather than matched whole.
  // A worker that copies the contract line with its parenthetical, or writes
  // `STATE done (all tests pass)`, has said the right thing, and refusing it
  // would spend a round trip teaching it punctuation.
  const token = /^([0-9a-f]{8})\b/.exec(values.RUN || "");
  const state = /^([a-z][a-z-]*)/.exec((values.STATE || "").toLowerCase());

  return {
    run: token === null ? null : token[1],
    state: state === null ? null : state[1],
    touched: commaList(values.TOUCHED),
    // A list, because the evidence gate checks each cited command against the
    // log separately. A worker citing two commands separates them with a comma,
    // the same way it lists two paths; `;` and `&&` are left alone, because they
    // are part of one command rather than a separator between two.
    evidence: commaList(values.EVIDENCE),
    deviations: [...text.matchAll(/^[ \t]*Deviations?:?[ \t]*(.+)$/gim)].map(
      (found) => found[1].trim(),
    ),
    report: text,
  };
}

/**
 * This session's evidence log, with each entry's time as a number.
 *
 * Written by hooks/evidence-log.js from real `Bash` calls, one JSON object per
 * line, and read here so a gate never has to know where it lives or how it is
 * spelled. An entry from before the log carried a time gets NaN, which the
 * evidence gate reads as "cannot be ordered" rather than as stale.
 */
function evidenceLog(sessionId) {
  let text = "";
  try {
    text = fs.readFileSync(
      path.join(io.evidenceDir(), `${sessionId || "unknown"}.jsonl`),
      "utf8",
    );
  } catch {
    return [];
  }

  const entries = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const entry = JSON.parse(line);
      entries.push({ ...entry, at: Date.parse(entry.at) });
    } catch {
      // A truncated last line loses one command rather than the whole log.
    }
  }
  return entries;
}

/**
 * When this worker last wrote a file, from the run record's `path` lines.
 *
 * The one number the evidence gate orders a cited command against, and it comes
 * from the record rather than from the report: a worker cannot move the moment
 * it last wrote code. Null when the record holds no usable time.
 */
function lastWriteAt(sessionId, agentId) {
  let latest = null;
  for (const entry of record.readLines(sessionId)) {
    if (entry.kind !== "path" || entry.agentId !== agentId) continue;
    const at = Date.parse(entry.at);
    if (Number.isFinite(at) && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

/** Every gate module in the registry, in directory order. */
function loadGateModules() {
  let files = [];
  try {
    files = fs
      .readdirSync(GATES_DIR)
      .filter((entry) => entry.endsWith(".js"))
      .sort();
  } catch {
    return [];
  }

  const modules = [];
  for (const file of files) {
    const id = path.basename(file, ".js");
    try {
      const module = require(path.join(GATES_DIR, file));
      if (module && typeof module.check === "function")
        modules.push({ ...module, id: module.id || id });
    } catch (error) {
      // A module that will not even load is reported as a failing gate rather
      // than skipped. A gate that silently stops running is the failure this
      // design exists to prevent, and that includes a typo in the gate itself.
      const message = (error && error.message) || String(error);
      modules.push({
        id,
        minimumVerify: "none",
        check() {
          return { ok: false, reason: `this gate will not load: ${message}` };
        },
      });
    }
  }
  return modules;
}

/** The gates a role names, or the fallback when it has no file. */
function gatesNamedBy(role) {
  if (!role) return FALLBACK_GATES;
  const { roles } = loadRoles(path.join(io.configDir(), "modes", "roles"));
  const found = roles.find((entry) => entry.id === role);
  return found === undefined ? FALLBACK_GATES : found.gates;
}

/** True when a gate asks for more proof than the mode's posture gives. */
function abovePosture(minimum, verify) {
  const wanted = VERIFY_ORDER.indexOf(minimum || "none");
  const given = VERIFY_ORDER.indexOf(verify || "none");
  return wanted > given;
}

// Only the front of a worker's transcript is ever read. A finished worker's
// transcript runs to megabytes, this hook wants its first lines, and the gate
// reads it on every report rather than only on a refusal.
const TRANSCRIPT_PREFIX_BYTES = 128 * 1024;

/**
 * The build and the dispatch token, from the front of a transcript.
 *
 * The first `type: "user"` line of a worker's transcript is the dispatch prompt,
 * and its `message.content` was a plain string on 2.1.273; `version` is the
 * build, carried on every line on that build. Both are observations rather than
 * documented promises, which is exactly why they are logged.
 *
 * `read` is whether any line parsed at all, which is not the same question as
 * whether the file was there. A prompt longer than the prefix leaves nothing
 * parseable, and reading that as "the prompt never arrived" would have the
 * conformance log cry harness drift over a long prompt.
 */
function scanTranscript(text) {
  let build = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      // A line cut in half by the prefix read, or by a write in progress.
      continue;
    }
    if (build === null && typeof entry.version === "string")
      build = entry.version;
    if (entry.type !== "user") continue;
    const content = (entry.message || {}).content;
    const prompt =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((block) => (block && block.text) || "").join("\n")
          : "";
    const found = /\bRUN ([0-9a-f]{8})\b/.exec(prompt);
    return { build, token: found === null ? null : found[1], read: true };
  }
  return { build, token: null, read: false };
}

/**
 * The worker's own transcript: whether it was there, whether anything in it
 * could be read, which build wrote it, and the token the dispatch put in its
 * prompt.
 *
 * Two jobs, one read. The token makes a refusal concrete: when the report left
 * it out, the refusal quotes the exact RUN line rather than a placeholder. The
 * rest is for the conformance log, which needs to tell a transcript that held
 * no token from one that was never there at all. A miss falls back to the
 * template and never throws.
 */
function readTranscript(payload) {
  const file =
    payload.hook_event_name === "SubagentStop"
      ? payload.agent_transcript_path
      : workerTranscriptBeside(payload);
  if (!file) return { found: false, read: false, build: null, token: null };

  let text = "";
  let handle = null;
  try {
    handle = fs.openSync(file, "r");
    const buffer = Buffer.alloc(TRANSCRIPT_PREFIX_BYTES);
    const filled = fs.readSync(handle, buffer, 0, buffer.length, 0);
    text = buffer.subarray(0, filled).toString("utf8");
  } catch {
    return { found: false, read: false, build: null, token: null };
  } finally {
    if (handle !== null) {
      try {
        fs.closeSync(handle);
      } catch {
        // Nothing to do about a handle that will not close, and throwing here
        // would lose the transcript that was already read.
      }
    }
  }

  const scanned = scanTranscript(text);
  return {
    found: true,
    read: scanned.read,
    build: scanned.build,
    token: scanned.token,
  };
}

/** Where a worker's transcript sits beside its parent's, at the hand-back. */
function workerTranscriptBeside(payload) {
  if (!payload.transcript_path || !payload.session_id || !payload.agent_id)
    return null;
  return path.join(
    path.dirname(payload.transcript_path),
    payload.session_id,
    "subagents",
    `agent-${payload.agent_id}.jsonl`,
  );
}

/**
 * Record a reviewer's report as the verdict on the runs it was sent to review.
 *
 * The turn-end hold (hooks/review-hold.js) reads nothing else. Written by this
 * runner because it is the one place that has both the report and the run it
 * joins to. Only a reviewer's run carries `reviews`, so any other worker's
 * report writes nothing; a report the parser cannot read writes nothing either,
 * and the hold then treats that run as unreviewed.
 */
function writeVerdict(sessionId, matched, finish) {
  if (!matched || !Array.isArray(matched.reviews)) return;
  const findings = blindReview.parseFindings(finish.report);
  if (findings === null) return;
  record.appendReview(sessionId, {
    token: matched.token,
    reviews: matched.reviews,
    findings,
  });
}

const STATE_CHOICES = "done | blocked | rejected | input-required";

function template(token) {
  return [
    `RUN ${token || "<the token from your dispatch>"}`,
    `STATE ${STATE_CHOICES}`,
    "TOUCHED <the paths you changed>",
    "EVIDENCE <the commands you actually ran>",
  ].join("\n");
}

// Only the shape gate is satisfied by the block alone. Every other gate's reason
// asks for something done (a deviation named, a command run), and telling that
// worker its work needs no change would tell it to ignore the reason.
const SHAPE_GATE = "finish-shape";

function firstRefusal(gate, reason, token) {
  if (gate !== SHAPE_GATE) {
    return (
      `${gate} refused this report: ${reason}\n\n` +
      "Do what the reason above asks, then send the report again, ending with " +
      `these four lines, each on its own line:\n\n${template(token)}`
    );
  }
  return (
    `${gate} refused this report: ${reason}\n\n` +
    `End the report with these four lines, each on its own line:\n\n${template(token)}\n\n` +
    "Send the same report again with that block on the end. Nothing about the " +
    "work itself needs to change."
  );
}

function secondRefusal(gate, reason, token) {
  const ask =
    gate === SHAPE_GATE
      ? "Copy these lines onto the end of the report, exactly as they read here:"
      : "Do what the reason above asks, then end the report with these lines:";
  return (
    `${gate} refused this report again: ${reason}\n\n` +
    `${ask}\n\n${template(token)}\n\n` +
    "This is the last time this report is sent back: the next one goes through " +
    "whatever it says."
  );
}

function warningText(notes, token, fromGate) {
  const lines = notes.map((note) => `- ${note}`).join("\n");
  const head =
    "Nothing is being refused here, but this report did not pass every gate:\n\n";
  if (!fromGate) return head + lines;
  return `${head}${lines}\n\nThe finish block this run wanted:\n\n${template(token)}`;
}

io.run(() => {
  const payload = io.readPayload();
  const event = payload.hook_event_name || "";

  // No agent id means the main session, which has no dispatch to answer to.
  const agentId = payload.agent_id;
  if (!agentId) return;

  const isHandback = (payload.tool_name || "") === HANDBACK;
  if (event === "PostToolUse") {
    // Taking notes only: a hand-back the harness reported as delivered excuses
    // the stop that follows. Marking delivery here rather than at an allowed
    // PreToolUse keeps one case honest: if another hook denies the hand-back
    // after this gate passed it, nothing was delivered and the stop is gated.
    if (!isHandback) return;
    if ((payload.tool_response || {}).success !== true) return;
    record.appendMark(payload.session_id, {
      agentId,
      mark: "delivered",
      point: HANDBACK,
    });
    return;
  }
  if (event === "PreToolUse" && !isHandback) return;
  if (event !== "PreToolUse" && event !== "SubagentStop") return;

  const workerMarks = record.marksFor(payload.session_id, agentId);
  if (
    event === "SubagentStop" &&
    workerMarks.some((mark) => mark.mark === "delivered")
  )
    return;

  const refusals = workerMarks.filter((mark) => mark.mark === "refusal").length;
  const report =
    event === "SubagentStop"
      ? payload.last_assistant_message
      : (payload.tool_input || {}).message;
  const finish = parseFinish(report);

  // Past its refusals a report goes through unchecked, but a readable review
  // still counts: dropping it would cost a second review of the same diff.
  if (refusals >= MAX_REFUSALS) {
    writeVerdict(
      payload.session_id,
      record.findRun(payload.session_id, finish.run),
      finish,
    );
    return;
  }
  const point = event === "SubagentStop" ? "SubagentStop" : HANDBACK;

  // Every report this runner reads leaves a line, pass or refusal. It is what
  // `ccfg conformance` reads back: five things this design assumes about the
  // harness are only ever settled by a real dispatch, and a harness update that
  // takes one away would otherwise show up as a gate that quietly stops firing.
  const transcript = readTranscript(payload);
  record.appendFinish(payload.session_id, {
    agentId,
    point,
    token: finish.run || transcript.token,
    tokenSource: finish.run ? "report" : transcript.token ? "transcript" : null,
    transcriptFound: transcript.found,
    transcriptRead: transcript.read,
    build: transcript.build,
  });

  const matched = record.findRun(payload.session_id, finish.run);
  const lock = readLock();
  const settings = (lock && lock.settings) || {};
  const role = (matched && matched.role) || payload.agent_type || null;

  const namedGates = gatesNamedBy(role);
  const modules = loadGateModules();
  const chosenGates = namedGates
    .map((name) => modules.find((module) => module.id === name))
    .filter((module) => module !== undefined);
  const missingGates = namedGates.filter(
    (name) => !modules.some((module) => module.id === name),
  );

  const gateView = {
    token: matched ? matched.token : null,
    role,
    scope: matched ? matched.scope : [],
    head: matched ? matched.head : null,
    touched: record.pathsFor(payload.session_id, agentId),
    finish,
    settings,
    log: evidenceLog(payload.session_id),
    lastWriteAt: lastWriteAt(payload.session_id, agentId),
  };

  const notes = missingGates.map(
    (name) =>
      `${name}: role ${role} names this gate and no module in hooks/subagent/gates provides it.`,
  );
  let fromGate = false;
  let refusal = null;

  for (const gate of chosenGates) {
    let result;
    try {
      result = gate.check(gateView);
    } catch (error) {
      // Never swallowed: a gate that throws has not passed the report.
      result = {
        ok: false,
        reason: `this gate threw: ${(error && error.message) || String(error)}`,
      };
    }
    if (!result || result.ok) continue;

    if (abovePosture(gate.minimumVerify, settings.verify)) {
      notes.push(`${gate.id}: ${result.reason}`);
      fromGate = true;
      continue;
    }
    refusal = { gate: gate.id, reason: result.reason };
    break;
  }

  if (refusal === null) writeVerdict(payload.session_id, matched, finish);

  if (refusal === null) {
    if (notes.length === 0) return;
    io.warn(event, warningText(notes, finish.run, fromGate));
    return;
  }

  const token = finish.run || transcript.token;
  const text =
    refusals === 0
      ? firstRefusal(refusal.gate, refusal.reason, token)
      : secondRefusal(refusal.gate, refusal.reason, token);

  const counted = record.appendMark(payload.session_id, {
    agentId,
    mark: "refusal",
    gate: refusal.gate,
    point,
  });

  // The two-refusal bound is counted from the record, so a record at its size
  // ceiling cannot count it any more. Refusing anyway risks a loop with nothing
  // to stop it: the harness caps stop-hook blocks, and no cap on hand-back
  // denials was ever observed. So the report goes through carrying the reason.
  if (!counted) {
    io.warn(
      event,
      `${text}\n\nThis report was not sent back: the run record has reached its ` +
        "size ceiling, so refusals here can no longer be counted.",
    );
    return;
  }

  if (event === "SubagentStop") io.block(text);
  io.deny(event, text);
});
