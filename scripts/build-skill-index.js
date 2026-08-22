#!/usr/bin/env node
"use strict";

// Rebuilds ~/.claude/SKILL-INDEX.md on demand. The SessionStart hook does this
// automatically when the catalog goes stale; run this when you want it now.

const path = require("path");
const skillIndex = require(path.join(__dirname, "..", "hooks", "lib", "skill-index"));

const counts = skillIndex.build();
console.log(
  `${skillIndex.indexPath()} written: ` +
    Object.entries(counts)
      .map(([group, count]) => `${group}=${count}`)
      .join(" "),
);
