"use strict";

// SessionStart: keep SKILL-INDEX.md in step with what is actually installed.
//
// CLAUDE.md tells Claude to read that catalog before deciding no skill covers a
// task. A stale catalog is worse than none -- it answers confidently from a list
// that no longer matches settings.json -- so the rebuild happens here rather
// than relying on anyone to run the CLI after editing a skill.
//
// Never blocks and never speaks. A session that cannot write the catalog is
// still a working session, and a warning on every start would train the reader
// to ignore it.

const skillIndex = require("./lib/skill-index");

try {
  if (skillIndex.isStale()) skillIndex.build();
} catch {
  // Deliberately silent: see above.
}

process.exit(0);
