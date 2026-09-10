"use strict";

// UserPromptSubmit: keep a copy of the session's standing constraints outside
// the transcript, so compaction cannot summarize them away.
//
// Says nothing to the model. The constraint is already in front of it on the
// turn it was issued, and re-stating a rule that is already present measured
// 0/36 (see mode-inject.js). The file exists for pre-compact.js to copy
// verbatim into the handoff.
//
// Detection is a heuristic on purpose. A model call per turn would tax every
// prompt, and whether the registry helps at all is unmeasured until the
// standing-band probe runs against it.

const fs = require("fs");
const io = require("./lib/hook-io");
const { cachePath } = require("./lib/session-cache");

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
const MAX_FILE = 4000;
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
  const prompt = String(payload.prompt || "").trim();
  if (!prompt) return;

  const newLines = capturedLines(prompt);
  if (newLines.length === 0) return;

  const file = cachePath("constraints", payload.session_id, { create: true });
  let existing = "";
  try {
    existing = fs.readFileSync(file, "utf8");
  } catch {
    existing = "";
  }

  const lines = existing.split("\n").filter(Boolean);
  for (const line of newLines) if (!lines.includes(line)) lines.push(line);

  // Trim whole lines from the front once over the cap, so the file keeps the
  // most recently captured constraints instead of silently refusing new ones.
  while (lines.length > 1 && lines.join("\n").length > MAX_FILE) lines.shift();

  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
});
