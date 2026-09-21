"use strict";

// PreToolUse(Agent, Task): require a scope line, staple a contract, open a run.
//
// Stripping the one sentence that states the scope of consent out of otherwise
// identical prompts took Claude Code from 0.0% to 17.1% out-of-scope actions
// (p = 2.4e-4, https://arxiv.org/html/2605.18583v1). That is the strongest
// prompt-level result in the whole survey and it costs one line, so this hook
// refuses a dispatch that does not carry it wherever the mode wants proof.
//
// The run token exists to solve a join. SubagentStart and SubagentStop know a
// worker by its agent_id; this hook fires before the worker exists and never
// sees one. So the token travels out through the prompt and comes back in the
// worker's report, and the join needs no payload field beyond what the
// 2026-09-15 spike actually observed.
//
// Rewriting the prompt is measured working on the Agent tool on build 2.1.270
// by that same spike, against a closed issue claiming it was ignored there.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");
const record = require("./lib/crew-record");
const blindReview = require("./lib/blind-review");

const EVENT = "PreToolUse";
const DISPATCH_TOOLS = ["Agent", "Task"];

// The modes that want proof. At `verify: none` a missing scope line is worth
// saying out loud but not worth refusing work over: that posture exists for
// spikes, where the scope genuinely is "whatever this turns out to need".
const STRICT_VERIFY = ["tested", "proven"];

const UNDECLARED = "(undeclared)";

const REVIEWER_ROLE = "reviewer";
const REVIEW_SCOPE = "(review)";

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
 * The scope the dispatcher declared, as a list of patterns.
 *
 * Matched at the start of a line so a passing mention of the word inside a
 * sentence cannot be read as a declaration. Returns [] when there is no such
 * line, which is the case the strict modes refuse.
 */
function declaredScope(prompt) {
  const line = /^[ \t]*Scope:[ \t]*(.+)$/m.exec(prompt || "");
  if (line === null) return [];
  return line[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * The run tokens a reviewer dispatch asks to review, from its `Reviews:` line.
 *
 * Only well-formed tokens survive, so a stray word cannot be read as a run.
 */
function reviewedTokens(prompt) {
  const line = /^[ \t]*Reviews:[ \t]*(.+)$/m.exec(prompt || "");
  if (line === null) return [];
  return line[1]
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^[0-9a-f]{8}$/.test(entry));
}

const DENIAL =
  "This dispatch declares no scope, and this mode requires one. Add a line " +
  "naming the files the worker may change, for example:\n\n" +
  "  Scope: hooks/state-restore.js, tools/test-hooks.js\n\n" +
  "Naming the scope is what keeps a worker inside it: stripping that one line " +
  "took out-of-scope actions from 0% to 17%. Use " +
  "`Scope: (undeclared)` only if the work genuinely cannot name a file yet, " +
  "and say why in the prompt. Do not route around this by dispatching through " +
  "another tool.";

/**
 * What the worker is told, stapled above the dispatcher's own prompt.
 *
 * Four lines, deliberately. Format restriction measurably degrades reasoning,
 * and this is the smallest structure that still lets a finish gate join a
 * report to its dispatch and read a terminal state out of it.
 */
function contract(token, scope) {
  return [
    `RUN ${token}  (repeat this line unchanged at the end of your report)`,
    "End the report you return (your final message, or the message you hand back) with that RUN line,",
    "then STATE <done|blocked|rejected|input-required>, TOUCHED <paths you changed>, EVIDENCE <commands you actually ran>, each on its own line.",
    `Change only what the Scope line names (Scope: ${scope.join(", ")}). Name anything else on a Deviation line with a reason.`,
  ].join("\n");
}

io.run(() => {
  const payload = io.readPayload();
  if (!DISPATCH_TOOLS.includes(payload.tool_name || "")) return;

  const input = payload.tool_input || {};
  const prompt = typeof input.prompt === "string" ? input.prompt : "";

  // A dispatch this hook already rewrote must not be rewritten again: a second
  // token would join the report to the wrong run.
  if (/^RUN [0-9a-f]{8}\b/m.test(prompt)) return;

  const lock = readLock();
  const verify = (lock && lock.settings && lock.settings.verify) || "none";
  const scope = declaredScope(prompt);
  const reviews =
    input.subagent_type === REVIEWER_ROLE ? reviewedTokens(prompt) : [];
  const isBlindReview = reviews.length > 0;

  if (scope.length === 0 && !isBlindReview && STRICT_VERIFY.includes(verify)) {
    io.deny(EVENT, DENIAL);
  }

  const token = crypto.randomBytes(4).toString("hex");
  const effectiveScope = isBlindReview
    ? [REVIEW_SCOPE]
    : scope.length > 0
      ? scope
      : [UNDECLARED];

  record.openRun({
    sessionId: payload.session_id,
    token,
    role: input.subagent_type || null,
    scope: effectiveScope,
    head: io.git(["rev-parse", "HEAD"], payload.cwd).trim() || null,
    verify,
    reviews,
  });

  const scopeLine =
    scope.length > 0 ? "" : `Scope: ${UNDECLARED}\n(no scope was declared)\n\n`;

  // A blind review keeps none of the dispatcher's words: the diff is the whole
  // prompt, which is what makes "the reviewer never sees the brief" true of the
  // code rather than of whoever wrote the dispatch.
  const body = isBlindReview
    ? blindReview.buildPrompt({
        diff: blindReview.reviewDiff({
          sessionId: payload.session_id,
          tokens: reviews,
          cwd: payload.cwd,
        }),
      })
    : `${scopeLine}${prompt}`;

  io.rewrite(
    EVENT,
    {
      ...input,
      prompt: `${contract(token, effectiveScope)}\n\n${body}`,
    },
    // Said to the operator, not to the model: a dispatch that declared nothing
    // still goes through in this posture, and the transcript should show that
    // it did rather than leaving the operator to infer it.
    scope.length > 0 || isBlindReview
      ? undefined
      : `Dispatch ${token} declared no scope; recorded as ${UNDECLARED}.`,
  );
});
