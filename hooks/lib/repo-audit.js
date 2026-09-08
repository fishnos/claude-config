"use strict";

// Per-repo agent-infrastructure checks, shared by the SessionStart hook and the
// /repo-setup skill.
//
// Everything exported here is pure filesystem work: existence tests, a JSON
// parse, and a line scan. That is a hard constraint rather than a preference.
// This runs in front of every session, and a `git log` against one of the
// larger local repos was measured taking over two minutes, which would stall
// the session it was meant to help. Checks needing git or the network belong to
// the skill, which runs on demand.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/** Repository root holding `cwd`, or null when the path is not inside a repo. */
function findRepositoryRoot(cwd) {
  let directory = path.resolve(cwd || process.cwd());
  for (let depth = 0; depth < 40; depth += 1) {
    if (fs.existsSync(path.join(directory, ".git"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
  return null;
}

function exists(root, relative) {
  return fs.existsSync(path.join(root, relative));
}

function readText(root, relative) {
  try {
    return fs.readFileSync(path.join(root, relative), "utf8");
  } catch {
    return null;
  }
}

function readJson(root, relative) {
  const text = readText(root, relative);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Whether a gitignore pattern would exclude a root-level file.
 *
 * This is an approximation of gitignore matching covering the forms that occur
 * in practice at the repository root: a bare name, a rooted `/name`, a `*` glob
 * and a `!` negation. Directory-scoped and `**` patterns are deliberately not
 * handled, because a missed match costs one unshown notice, while `git check-ignore`
 * in the skill gives the authoritative answer when it matters.
 */
function ignorePatternMatches(pattern, fileName) {
  const trimmed = pattern.trim().replace(/^\//, "").replace(/\/$/, "");
  if (trimmed === "") return false;
  const expression = trimmed
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${expression}$`).test(fileName);
}

/** True when the repo's ignore files exclude `fileName` from version control. */
function isIgnored(root, fileName) {
  const sources = [
    readText(root, ".gitignore"),
    readText(root, path.join(".git", "info", "exclude")),
  ];
  let ignored = false;
  for (const source of sources) {
    if (source === null) continue;
    for (const line of source.split("\n")) {
      const rule = line.trim();
      if (rule === "" || rule.startsWith("#")) continue;
      // Gitignore resolves a path by last matching rule, so a later `!CLAUDE.md`
      // re-includes a file an earlier `*.md` excluded.
      const negated = rule.startsWith("!");
      const pattern = negated ? rule.slice(1) : rule;
      if (ignorePatternMatches(pattern, fileName)) ignored = !negated;
    }
  }
  return ignored;
}

// Stacks whose skill carries no `paths:` signature, so nothing can route to it
// automatically. Promoting one in `.claude/settings.local.json` is the only way
// it reaches the model's listing in the repo that needs it.
const UNROUTABLE_SKILLS = [
  { skill: "spacetimedb", manifest: "Cargo.toml", marker: /spacetimedb/i },
  { skill: "spacetimedb", manifest: "package.json", marker: /spacetimedb/i },
  { skill: "upstash", manifest: "package.json", marker: /@upstash\// },
  {
    skill: "motion-patterns",
    manifest: "package.json",
    marker: /"(framer-motion|motion)"\s*:/,
  },
  {
    skill: "sentry-sdk-setup",
    manifest: "package.json",
    marker: /"@sentry\/[^"]+"\s*:/,
  },
];

/** Skills this repo's dependencies call for that its local settings do not promote. */
function unpromotedSkills(root) {
  const overrides = readJson(root, path.join(".claude", "settings.local.json"));
  const promoted = new Set(Object.keys(overrides?.skillOverrides || {}));
  const wanted = new Set();
  for (const candidate of UNROUTABLE_SKILLS) {
    if (promoted.has(candidate.skill)) continue;
    const manifest = readText(root, candidate.manifest);
    if (manifest !== null && candidate.marker.test(manifest)) {
      wanted.add(candidate.skill);
    }
  }
  return [...wanted];
}

function declaredRoutines(root) {
  try {
    return fs
      .readdirSync(path.join(root, ".claude", "routines"))
      .filter((name) => name.endsWith(".md"));
  } catch {
    return [];
  }
}

/**
 * Cheap findings for one repository, most consequential first.
 *
 * Each finding carries the `fix` naming what resolves it, because the notice
 * the model sees is one line and the reader needs to know where to go without
 * opening anything.
 */
function audit(root) {
  const findings = [];
  const instructionFile = ["CLAUDE.md", "AGENTS.md"].find((name) =>
    exists(root, name),
  );

  if (instructionFile === undefined) {
    findings.push({
      id: "instructions",
      message: "no CLAUDE.md",
      fix: "/init",
    });
  } else if (isIgnored(root, instructionFile)) {
    // Routines and other cloud sessions clone from the remote, so an ignored
    // instruction file means every unattended run starts with no instructions.
    findings.push({
      id: "instructions-ignored",
      message: `${instructionFile} is gitignored, so cloud runs never see it`,
      fix: "/repo-setup",
    });
  }

  if (!exists(root, path.join("graphify-out", "graph.json"))) {
    findings.push({
      id: "graph",
      message: "no knowledge graph",
      fix: "/graphify",
    });
  }

  const routines = declaredRoutines(root);
  if (routines.length > 0 && !exists(root, ".mcp.json")) {
    // Cloud runs cannot see MCP servers registered locally with `claude mcp add`;
    // only a committed `.mcp.json` or an account connector reaches them.
    findings.push({
      id: "routine-mcp",
      message: "routines declared but no .mcp.json for them to load",
      fix: "/repo-schedule status",
    });
  }

  const unpromoted = unpromotedSkills(root);
  if (unpromoted.length > 0) {
    findings.push({
      id: "skill-overrides",
      message: `${unpromoted.join(", ")} not promoted in .claude/settings.local.json`,
      fix: "/repo-setup",
    });
  }

  return findings;
}

/** Per-repo state file. Keyed by a path hash so two same-named repos stay distinct. */
function stateFile(configDir, root) {
  const digest = crypto.createHash("sha1").update(root).digest("hex");
  const name = `${path.basename(root)}-${digest.slice(0, 12)}.json`;
  return path.join(configDir, "cache", "repo-setup", name);
}

function readState(configDir, root) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(configDir, root), "utf8"));
  } catch {
    return {};
  }
}

function writeState(configDir, root, state) {
  const file = stateFile(configDir, root);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    // Losing the state costs a repeated notice, never a blocked session.
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIsoDate, toIsoDate) {
  const millis = Date.parse(toIsoDate) - Date.parse(fromIsoDate);
  return Number.isNaN(millis) ? Infinity : millis / 86400000;
}

/** Findings the reader has not dismissed outright or snoozed past today. */
function activeFindings(findings, state) {
  const dismissed = new Set(state.dismissed || []);
  const snoozed = state.snoozed || {};
  return findings.filter((finding) => {
    if (dismissed.has(finding.id)) return false;
    const until = snoozed[finding.id];
    return !(until && daysBetween(today(), until) > 0);
  });
}

module.exports = {
  audit,
  activeFindings,
  daysBetween,
  declaredRoutines,
  findRepositoryRoot,
  isIgnored,
  readState,
  stateFile,
  today,
  unpromotedSkills,
  writeState,
};
