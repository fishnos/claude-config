#!/usr/bin/env node
"use strict";

// Generates the plugin marketplace from scripts/marketplace-plugins.json:
// .claude-plugin/marketplace.json, and a self-contained root under marketplace/
// for each plugin.
//
// Why a plugin gets its own copy of a skill rather than pointing at skills/:
// Claude Code always scans a plugin's own skills/ directory, and a manifest path
// only ever adds to that scan. A plugin rooted at this repository would
// therefore publish all of skills/ -- every vendored skill included, two of
// whose upstreams grant no redistribution right at all -- no matter what the
// manifest listed. An isolated root is the only way the advertised contents and
// the installed contents are the same thing.
//
// Pass --check to report drift without writing, which is what CI wants.

const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const spec = JSON.parse(
  fs.readFileSync(path.join(__dirname, "marketplace-plugins.json"), "utf8"),
);
const vendored = new Set(
  Object.keys(
    JSON.parse(
      fs.readFileSync(path.join(__dirname, "external-skills.json"), "utf8"),
    ).skills || {},
  ),
);
const checkOnly = process.argv.includes("--check");

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

function differs(source, copy) {
  if (!fs.existsSync(copy)) return true;
  const a = fileList(source);
  const b = fileList(copy);
  if (a.join("\0") !== b.join("\0")) return true;
  return a.some(
    (rel) =>
      !fs
        .readFileSync(path.join(source, rel))
        .equals(fs.readFileSync(path.join(copy, rel))),
  );
}

function writeIfChanged(file, contents) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (existing === contents) return false;
  if (!checkOnly) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return true;
}

let changed = 0;
const problems = [];
const entries = [];

for (const name of Object.keys(spec.plugins).sort()) {
  const plugin = spec.plugins[name];
  const root = path.join(repoRoot, "marketplace", name);

  entries.push({
    name,
    source: `./marketplace/${name}`,
    description: plugin.description,
    version: plugin.version,
    author: spec.owner,
  });

  for (const skill of plugin.skills) {
    const source = path.join(repoRoot, "skills", skill);
    const copy = path.join(root, "skills", skill);

    if (!fs.existsSync(path.join(source, "SKILL.md"))) {
      problems.push(`${name}: skills/${skill} does not exist`);
      continue;
    }
    // Republishing someone else's skill under this marketplace is the one
    // failure this build must never produce quietly. NOTICE says these stay out.
    if (vendored.has(skill)) {
      problems.push(`${name}: ${skill} is vendored from upstream, cannot publish`);
      continue;
    }
    if (!differs(source, copy)) continue;

    changed++;
    if (checkOnly) {
      console.log(`drift: ${name}/${skill}`);
      continue;
    }
    fs.rmSync(copy, { recursive: true, force: true });
    fs.cpSync(source, copy, { recursive: true, dereference: true });
    console.log(`copied: ${name}/${skill}`);
  }

  const manifest =
    JSON.stringify(
      {
        name,
        description: plugin.description,
        version: plugin.version,
        author: spec.owner,
      },
      null,
      2,
    ) + "\n";
  if (writeIfChanged(path.join(root, ".claude-plugin", "plugin.json"), manifest)) {
    changed++;
    console.log(`${checkOnly ? "drift" : "wrote"}: ${name}/.claude-plugin/plugin.json`);
  }

  // A skill removed from the spec leaves its copy behind, which would keep
  // publishing content the manifest no longer claims.
  const skillsDir = path.join(root, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const present of fs.readdirSync(skillsDir)) {
      if (plugin.skills.includes(present)) continue;
      changed++;
      if (checkOnly) {
        console.log(`stale: ${name}/${present}`);
        continue;
      }
      fs.rmSync(path.join(skillsDir, present), { recursive: true, force: true });
      console.log(`removed: ${name}/${present}`);
    }
  }
}

const marketplace =
  JSON.stringify(
    {
      name: spec.marketplace,
      owner: spec.owner,
      description: spec.description,
      plugins: entries,
    },
    null,
    2,
  ) + "\n";
if (
  writeIfChanged(
    path.join(repoRoot, ".claude-plugin", "marketplace.json"),
    marketplace,
  )
) {
  changed++;
  console.log(`${checkOnly ? "drift" : "wrote"}: .claude-plugin/marketplace.json`);
}

for (const problem of problems) console.error(`ERROR ${problem}`);

const verb = checkOnly ? "drifted" : "written";
console.log(
  `${changed} ${verb}, ${entries.length} plugins, ` +
    `${Object.values(spec.plugins).reduce((n, p) => n + p.skills.length, 0)} skills.`,
);
process.exit(problems.length || (checkOnly && changed) ? 1 : 0);
