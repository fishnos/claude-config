#!/usr/bin/env node
"use strict";

// Deep per-repo setup audit, the on-demand counterpart to the SessionStart hook.
//
// The hook is filesystem-only because it runs in front of every session. This
// runs when asked, so it may spawn git: authoritative ignore resolution, graph
// freshness against the newest commit, and whether a remote exists at all.
// Both read the same check definitions from lib/repo-audit, so the notice and
// the report can never disagree about what is wrong.

const fs = require("fs");
const path = require("path");

const configDir =
  process.env.CLAUDE_CONFIG_DIR || path.resolve(__dirname, "..", "..");
const repoAudit = require(path.join(configDir, "hooks", "lib", "repo-audit"));
const io = require(path.join(configDir, "hooks", "lib", "hook-io"));

const SNOOZE_DAYS = 14;

/**
 * Authoritative ignore status.
 *
 * `check-ignore -v` prints the rule that excluded the file and prints nothing
 * when it is tracked, so empty output means either "not ignored" or "git could
 * not run". Those need different answers, and the approximate scan is the only
 * one available for the second, so an absent git falls back to it rather than
 * reporting a clean repo it never inspected.
 */
function gitIgnores(root, fileName) {
  if (io.git(["check-ignore", "-v", fileName], root) !== "") return true;
  const gitWorks = io.git(["rev-parse", "--git-dir"], root) !== "";
  return gitWorks ? false : repoAudit.isIgnored(root, fileName);
}

function remoteUrl(root) {
  return io.git(["remote", "get-url", "origin"], root).trim() || null;
}

/** Newest commit timestamp in seconds, or null when the repo has no commits. */
function newestCommitSeconds(root) {
  const value = io.git(["log", "-1", "--format=%ct"], root).trim();
  return value === "" ? null : Number(value);
}

function graphStatus(root) {
  const graph = path.join(root, "graphify-out", "graph.json");
  if (!fs.existsSync(graph)) return { state: "missing" };
  let builtSeconds = null;
  try {
    builtSeconds = Math.floor(fs.statSync(graph).mtimeMs / 1000);
  } catch {
    return { state: "unreadable" };
  }
  const newest = newestCommitSeconds(root);
  if (newest === null) return { state: "fresh" };
  return {
    state: builtSeconds >= newest ? "fresh" : "stale",
    behindDays: Math.floor((newest - builtSeconds) / 86400),
  };
}

/** Every check, deep where git can answer better than the filesystem. */
function deepAudit(root) {
  const rows = [];
  const instructionFile = ["CLAUDE.md", "AGENTS.md"].find((name) =>
    fs.existsSync(path.join(root, name)),
  );

  if (instructionFile === undefined) {
    rows.push({
      id: "instructions",
      status: "missing",
      detail: "no CLAUDE.md or AGENTS.md at the repo root",
      fix: "/init writes one from the codebase",
    });
  } else if (gitIgnores(root, instructionFile)) {
    rows.push({
      id: "instructions-ignored",
      status: "broken",
      detail: `${instructionFile} exists but git ignores it, so every cloud run and every teammate starts with no instructions`,
      fix: `un-ignore and commit ${instructionFile}`,
    });
  } else {
    rows.push({
      id: "instructions",
      status: "ok",
      detail: `${instructionFile} tracked`,
    });
  }

  const graph = graphStatus(root);
  rows.push({
    id: "graph",
    status: graph.state === "fresh" ? "ok" : "missing",
    detail:
      graph.state === "missing"
        ? "no graphify-out/graph.json"
        : graph.state === "stale"
          ? `graph is ${graph.behindDays} day(s) behind the newest commit`
          : graph.state === "unreadable"
            ? "graph.json cannot be read"
            : "graph current with HEAD",
    fix:
      graph.state === "missing"
        ? "/graphify builds one"
        : graph.state === "stale"
          ? "/graphify --update re-extracts changed files"
          : undefined,
  });

  const remote = remoteUrl(root);
  rows.push({
    id: "remote",
    status: remote === null ? "missing" : "ok",
    detail:
      remote === null
        ? "no origin remote, so cloud routines cannot clone this repo"
        : remote,
    fix: remote === null ? "add a GitHub remote before scheduling" : undefined,
  });

  const routines = repoAudit.declaredRoutines(root);
  rows.push({
    id: "routines",
    status: routines.length === 0 ? "absent" : "declared",
    detail:
      routines.length === 0
        ? "no .claude/routines declared"
        : `${routines.length} declared: ${routines.join(", ")}`,
    fix:
      routines.length === 0
        ? "/repo-schedule plan proposes routines for this repo"
        : "/repo-schedule status compares them against the cloud",
  });

  if (routines.length > 0 && !fs.existsSync(path.join(root, ".mcp.json"))) {
    rows.push({
      id: "routine-mcp",
      status: "broken",
      detail:
        "routines are declared but there is no .mcp.json; cloud runs cannot see MCP servers added locally with `claude mcp add`",
      fix: "commit a .mcp.json, or attach account connectors to the routine",
    });
  }

  const unpromoted = repoAudit.unpromotedSkills(root);
  rows.push({
    id: "skill-overrides",
    status: unpromoted.length === 0 ? "ok" : "missing",
    detail:
      unpromoted.length === 0
        ? "no unroutable skills detected for this stack"
        : `${unpromoted.join(", ")} ${unpromoted.length === 1 ? "matches" : "match"} this stack but ${unpromoted.length === 1 ? "carries" : "carry"} no paths: signature, so nothing routes to ${unpromoted.length === 1 ? "it" : "them"} here`,
    fix:
      unpromoted.length === 0
        ? undefined
        : `add {"skillOverrides": {${unpromoted
            .map((skill) => `"${skill}": "on"`)
            .join(", ")}}} to .claude/settings.local.json`,
  });

  return rows;
}

const STATUS_GLYPH = {
  ok: "ok  ",
  missing: "MISS",
  broken: "BAD ",
  declared: "ok  ",
  absent: "--  ",
  unreadable: "BAD ",
};

function render(root, rows, state) {
  const dismissed = new Set(state.dismissed || []);
  const snoozed = state.snoozed || {};
  const lines = [`Repo setup audit: ${root}`, ""];
  for (const row of rows) {
    const muted = dismissed.has(row.id)
      ? " [dismissed]"
      : snoozed[row.id]
        ? ` [snoozed until ${snoozed[row.id]}]`
        : "";
    lines.push(
      `  ${STATUS_GLYPH[row.status] || row.status}  ${row.id.padEnd(20)} ${row.detail}${muted}`,
    );
    if (row.fix) lines.push(`        ${" ".repeat(20)} -> ${row.fix}`);
  }
  const open = rows.filter(
    (row) =>
      ["missing", "broken", "unreadable"].includes(row.status) &&
      !dismissed.has(row.id),
  );
  lines.push("");
  lines.push(
    open.length === 0
      ? "Nothing outstanding."
      : `${open.length} outstanding: ${open.map((row) => row.id).join(", ")}`,
  );
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const positional = args.filter((value) => !value.startsWith("--"));
  const command = ["snooze", "dismiss", "reset"].includes(positional[0])
    ? positional.shift()
    : "report";

  // For snooze and dismiss the first positional is the check id, so the path is
  // whatever follows it. Relative paths resolve against the caller's directory
  // rather than being ignored, which would silently audit the wrong repository.
  const pathArgument = command === "report" ? positional[0] : positional[1];
  const root = repoAudit.findRepositoryRoot(
    pathArgument ? path.resolve(pathArgument) : process.cwd(),
  );
  if (root === null) {
    console.error("Not inside a git repository.");
    process.exit(1);
  }

  const state = repoAudit.readState(configDir, root);

  if (command === "reset") {
    repoAudit.writeState(configDir, root, { repo: root });
    console.log(`Cleared dismissals and snoozes for ${root}.`);
    return;
  }

  if (command === "snooze" || command === "dismiss") {
    const checkId = positional[0];
    if (!checkId) {
      console.error(`Usage: audit.js ${command} <check-id>`);
      process.exit(1);
    }
    const next = { ...state, repo: root };
    if (command === "dismiss") {
      next.dismissed = [...new Set([...(state.dismissed || []), checkId])];
    } else {
      const until = new Date(Date.now() + SNOOZE_DAYS * 86400000)
        .toISOString()
        .slice(0, 10);
      next.snoozed = { ...(state.snoozed || {}), [checkId]: until };
    }
    repoAudit.writeState(configDir, root, next);
    console.log(
      command === "dismiss"
        ? `Dismissed ${checkId} for ${root}. It will never be raised again here.`
        : `Snoozed ${checkId} for ${SNOOZE_DAYS} days.`,
    );
    return;
  }

  const rows = deepAudit(root);
  console.log(
    asJson
      ? JSON.stringify({ repo: root, state, checks: rows }, null, 2)
      : render(root, rows, state),
  );
}

main();
