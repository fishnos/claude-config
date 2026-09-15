"use strict";

// UserPromptSubmit: copy sentences that scope an instruction beyond this turn
// out of the transcript, where a clear or a compaction cannot lose them.
//
// With a .claude/state.md they go under its Unconfirmed section, which survives
// a clear; Claude moves each into Instructions or deletes it at the next
// checkpoint. Without one nothing is captured: the state file is the only thing
// that reads them, and the cache file the retired pre-compact hook copied from
// has no reader left.
//
// Says nothing to the model: the instruction is already in front of it on the
// turn it was given, and re-stating a rule already present measured 0/36 (see
// mode-inject.js).
//
// Detection is a heuristic on purpose. A model call per turn would tax every
// prompt, and whether capture helps at all is unmeasured until the
// state-carryover probe runs with and without it; it goes if it does not help.

const io = require("./lib/hook-io");
const repoAudit = require("./lib/repo-audit");
const stateFile = require("./lib/state-file");

// Background task notifications, slash-command echoes and bash blocks all arrive
// in the user-message position, so this hook is handed them as prompts. Their
// prose belongs to a subagent's report or a command's output, and storing it
// under Unconfirmed files it as an instruction the operator gave: a report
// reading "the client never retries a failed upload" captured as a standing rule.
//
// A hyphen in the tag name is what separates them from prose. Measured over the
// 40 most recent transcripts in ~/.claude/projects (2026-08-15 to 2026-09-14):
// 381 closed outermost blocks, every one hyphenated — task-notification,
// command-name, command-message, command-args, bash-input, bash-stdout,
// bash-stderr, local-command-caveat, local-command-stdout, local-command-stderr
// — and the single hyphen-free block at that level was an operator's own pasted
// <script>. A harness message type spelled without a hyphen would reopen this,
// so re-run that scan after an upgrade rather than trusting the list.
//
// The blocks are cut out and the rest of the message is kept, rather than the
// whole prompt being skipped, because the harness wraps its blocks around a real
// prompt: an instruction typed straight after a slash command is still the
// operator's. Inner tags need no rule of their own — <result> and <summary> sit
// inside <task-notification> and leave with it.
//
// A tag with no closing partner is left where it stands. All 16 unclosed ones in
// that same scan were placeholders in ordinary prose — <feature-name>,
// <session-id>, <repo-root>, <plan-basename>, <one-liner>, <full-path> — so
// cutting from one to the end of the message would throw away what the operator
// actually typed.
const HARNESS_BLOCK = /<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)>[\s\S]*?<\/\1>/g;

function withoutHarnessBlocks(prompt) {
  return prompt.replace(HARNESS_BLOCK, " ");
}

// Phrases that scope an instruction beyond the current turn. Matched per
// sentence, so one unrelated sentence elsewhere in a long prompt cannot pull
// the whole prompt in as if all of it were the standing rule.
const PERSISTENCE = [
  /\bfrom now on\b/i,
  /\bfor the rest of\b/i,
  /\buntil I\b/i,
  /\bgoing forward\b/i,
  /\bevery time\b/i,
  /\bnever\b/i,
  /\balways\b/i,
  /\bstop\s+(?:using|doing|touching)\b/i,
  /\bdon'?t\b.*\buntil\b/i,
];

// An exception that scopes the sentence before it. "Never use the cache."
// followed by "Unless the flag is set." carries its condition in a separate
// sentence, and keeping only the first stores the inverse of what was asked.
const TRAILING_QUALIFIER =
  /^(unless|except|but|however|although|though|only if|only when|until|if)\b/i;

const MAX_LINE = 400;
const TRUNCATION_MARKER = " … (truncated)";

/** Split on sentence-ending punctuation or a newline; each piece is judged alone. */
function splitSentences(prompt) {
  return prompt
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function formatLine(sentence) {
  const collapsed = sentence.replace(/\s+/g, " ");
  if (collapsed.length <= MAX_LINE) return "- " + collapsed;
  return "- " + collapsed.slice(0, MAX_LINE) + TRUNCATION_MARKER;
}

/**
 * The matching sentences from this prompt, one formatted line each, with any
 * qualifying sentences that follow a match kept attached to it.
 */
function capturedLines(prompt) {
  const sentences = splitSentences(prompt);
  const lines = [];
  for (let index = 0; index < sentences.length; index += 1) {
    if (!PERSISTENCE.some((pattern) => pattern.test(sentences[index])))
      continue;
    const parts = [sentences[index]];
    while (
      index + 1 < sentences.length &&
      TRAILING_QUALIFIER.test(sentences[index + 1])
    ) {
      index += 1;
      parts.push(sentences[index]);
    }
    lines.push(formatLine(parts.join(" ")));
  }
  return lines;
}

io.run(() => {
  const payload = io.readPayload();
  const prompt = withoutHarnessBlocks(String(payload.prompt || "")).trim();
  if (!prompt) return;

  const newLines = capturedLines(prompt);
  if (newLines.length === 0) return;

  const root = repoAudit.findRepositoryRoot(payload.cwd || process.cwd());
  const state = root === null ? null : stateFile.readStateFile(root);
  // Nothing outside the working record survives a clear, so there is nowhere else
  // worth writing.
  if (state === null) return;
  const updated = stateFile.withUnconfirmed(state.text, newLines);
  if (updated !== state.text) stateFile.writeStateFile(root, updated);
});
