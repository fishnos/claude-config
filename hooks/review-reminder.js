"use strict";

// Stop: require one self-review pass before finishing a session that touched code.
//
// Fires at most once per session, and only when source files were actually edited.
// Two independent loop guards: the harness's own stop_hook_active flag, and a
// per-session marker file.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");
const paths = require("./lib/paths");

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const MAX_TRANSCRIPT_BYTES = 4000000;
const MARKER_TTL_MS = 7 * 24 * 3600 * 1000;

// Overridable so the test suite can point at a scratch directory instead of clearing
// the markers of whatever session is live -- doing that re-arms the reminder mid-session.
function markerDir() {
  return (
    process.env.CLAUDE_REVIEW_MARKER_DIR ||
    path.join(io.configDir(), "cache", "review-reminder")
  );
}

const REMINDER = `Before you report this work as done, run one self-review pass (google-code-review):

1. Re-read every line you changed, not just the parts you remember writing.
2. Design -- do the pieces interact sensibly, and does this belong here?
3. Complexity -- anything a reader could not follow quickly? Anything built for a
   requirement that does not exist yet?
4. Tests -- does a test actually fail if this code breaks? Are they in this change?
5. Naming -- every name says what it holds, spelled out.
6. Comments -- why, not what. Delete any comment that restates the code.
7. Style -- google-style is the authority for the language you just wrote.

Then say plainly what you verified and what you did not. If something is untested or
unfinished, say so explicitly rather than implying it works.

This reminder fires once per session; it will not fire again.`;

/** Markers accumulate one per session; drop those no live session can still match. */
function pruneMarkers(directory) {
  try {
    const cutoff = Date.now() - MARKER_TTL_MS;
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    }
  } catch {
    // Pruning is housekeeping; never let it affect the decision.
  }
}

function alreadyFired(sessionId) {
  if (!sessionId) return false;
  const directory = markerDir();
  const marker = path.join(directory, sessionId);
  if (fs.existsSync(marker)) return true;
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(marker, "1");
  } catch {
    // Cannot record it -- stay silent rather than risk repeating every turn.
    return true;
  }
  pruneMarkers(directory);
  return false;
}

function touchedSource(transcriptPath) {
  if (!transcriptPath) return false;
  let raw;
  try {
    if (!fs.existsSync(transcriptPath)) return false;
    if (fs.statSync(transcriptPath).size > MAX_TRANSCRIPT_BYTES) return false;
    raw = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return false;
  }

  for (const line of raw.split("\n")) {
    if (!line.includes('"name"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry && entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || block.type !== "tool_use" || !EDIT_TOOLS.has(block.name))
        continue;
      const filePath = (block.input && block.input.file_path) || "";
      if (paths.isEditedSourceFile(filePath)) return true;
    }
  }
  return false;
}

io.run(() => {
  const payload = io.readPayload();
  if (payload.stop_hook_active) return;
  if (!touchedSource(payload.transcript_path)) return;
  if (alreadyFired(payload.session_id)) return;
  io.block(REMINDER);
});
