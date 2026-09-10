"use strict";

// SessionStart(source: compact): put the handoff back.
//
// Silent on every other source. A fresh session already loads CLAUDE.md and
// the generated rules file from disk, and re-stating them would only say the
// same thing twice; the measurement behind mode-inject.js found that repeating
// an already-present rule buys nothing. This hook exists for the one case
// where the text is genuinely gone.

const fs = require("fs");
const io = require("./lib/hook-io");
const { cachePath } = require("./lib/session-cache");

const EVENT = "SessionStart";

// A cap, not a budget: bounded here so this reader does not depend on the
// writer's own limit (pre-compact.js's MAX_SECTION) to stay bounded.
const MAX_HANDOFF = 8000;

io.run(() => {
  const payload = io.readPayload();
  if (payload.source !== "compact") return;

  // create: false — a reader must never bring the cache directory into
  // existence; only pre-compact.js and constraint-capture.js do that.
  const file = cachePath("handoff", payload.session_id, { create: false });

  let handoff = "";
  try {
    handoff = fs.readFileSync(file, "utf8").slice(0, MAX_HANDOFF);
  } catch {
    return;
  }
  if (!handoff.trim()) return;

  io.warn(
    EVENT,
    "This session was just compacted. The summary above is lossy. The " +
      "following was written down before it ran. The Mode section is " +
      "authoritative where the two disagree. The Standing constraints " +
      "section is only a keyword match over each prompt, not a verified " +
      "reading of it: it may be incomplete or truncated, so check it against " +
      "the user's actual words rather than treating it as a verbatim rule:\n\n" +
      handoff,
  );
});
