#!/usr/bin/env node
"use strict";

// Re-copies the skills listed in external-skills.json from the local installer
// directory into this repo.
//
// These were symlinks into ~/.agents/skills once. A symlink pointing outside the
// repository resolves to nothing after a clone, which silently removed 29 skills
// for anyone but the author, so the content lives here instead. That trade costs
// one command: after updating a skill upstream, run this to bring the change in.
//
// Pass --check to report drift without writing, which is what CI would want.

const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "external-skills.json"), "utf8"),
);
const upstreamRoot =
  process.env.AGENT_SKILLS_DIR || path.join(os.homedir(), ".agents", "skills");
const checkOnly = process.argv.includes("--check");

if (!fs.existsSync(upstreamRoot)) {
  console.error(
    `Upstream skills directory not found: ${upstreamRoot}\n` +
      "Nothing to sync. The vendored copies in skills/ are already complete and " +
      "usable; this script only matters when refreshing them from upstream.",
  );
  process.exit(checkOnly ? 0 : 1);
}

/** Relative paths of every file under dir, sorted, for a content comparison. */
function fileList(dir) {
  const found = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else found.push(rel);
    }
  };
  walk(dir, "");
  return found.sort();
}

function differs(upstream, vendored) {
  if (!fs.existsSync(vendored)) return true;
  const a = fileList(upstream);
  const b = fileList(vendored);
  if (a.join("\0") !== b.join("\0")) return true;
  return a.some(
    (rel) =>
      !fs.readFileSync(path.join(upstream, rel)).equals(
        fs.readFileSync(path.join(vendored, rel)),
      ),
  );
}

let changed = 0;
let missing = 0;

for (const name of Object.keys(manifest.skills).sort()) {
  const upstream = path.join(upstreamRoot, name);
  const vendored = path.join(repoRoot, "skills", name);

  if (!fs.existsSync(upstream)) {
    console.warn(`missing upstream: ${name} (vendored copy left as is)`);
    missing++;
    continue;
  }
  if (!differs(upstream, vendored)) continue;

  changed++;
  if (checkOnly) {
    console.log(`drift: ${name}`);
    continue;
  }
  fs.rmSync(vendored, { recursive: true, force: true });
  fs.cpSync(upstream, vendored, { recursive: true, dereference: true });
  console.log(`synced: ${name}`);
}

const verb = checkOnly ? "drifted" : "synced";
console.log(
  `${changed} ${verb}, ${missing} missing upstream, ` +
    `${Object.keys(manifest.skills).length} tracked.`,
);
if (changed && !checkOnly) {
  console.log(
    "Frontmatter added locally (paths:, for example) is overwritten by a sync. " +
      "Re-apply it, then rerun `node scripts/build-skill-index.js`.",
  );
}
process.exit(checkOnly && changed ? 1 : 0);
