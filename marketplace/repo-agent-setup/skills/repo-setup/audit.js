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
const stateRecords = require(
  path.join(configDir, "hooks", "lib", "state-records"),
);
const { migrate } = require(
  path.join(configDir, "tools", "state", "command.js"),
);
const { spawnSync } = require("child_process");

const SNOOZE_DAYS = 14;

/**
 * Authoritative ignore status.
 *
 * Plain `check-ignore` prints the path and exits 0 only when git ignores it.
 * Not `-v`: that form also prints, and exits 0, for a file a `!` exception
 * re-includes, which would read an excepted file as ignored. Empty output
 * means either "not ignored" or "git could not run". Those need different
 * answers, and the approximate scan is the only one available for the second,
 * so an absent git falls back to it rather than reporting a clean repo it
 * never inspected.
 */
function gitIgnores(root, fileName) {
  if (io.git(["check-ignore", fileName], root) !== "") return true;
  const gitWorks = io.git(["rev-parse", "--git-dir"], root) !== "";
  return gitWorks ? false : repoAudit.isIgnored(root, fileName);
}

/** Whether git ignores the records folder, with the hook's approximation when git cannot run. */
function recordsGitIgnored(root) {
  if (io.git(["check-ignore", ".claude/state/"], root) !== "") return true;
  const gitWorks = io.git(["rev-parse", "--git-dir"], root) !== "";
  return gitWorks ? false : stateRecords.recordsIgnoreListed(root);
}

/**
 * The one-step setup: the records folder with its ignore line, then the code
 * graph. The folder step is `ccfg state migrate`, which never overwrites a
 * record, and this never starts graphify's document pass, which spends tokens.
 */
function runContext(root) {
  const result = migrate(root);
  console.log(
    result.moved === null
      ? "ready     .claude/state/ (no old .claude/state.md to move)"
      : `moved     the old .claude/state.md to ${path.relative(root, result.moved)}`,
  );
  console.log(
    result.ignoreChanged
      ? "wrote     .claude/state/ to .gitignore"
      : "kept      .gitignore (already covers .claude/state/)",
  );

  const graphBuild = spawnSync("graphify", ["update", root], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (graphBuild.error && graphBuild.error.code === "ENOENT") {
    console.log(
      "skipped   graph: graphify is not on PATH; install it and rerun",
    );
  } else if (graphBuild.status !== 0) {
    console.log(`failed    graphify update exited ${graphBuild.status}`);
    console.log((graphBuild.stderr || "").slice(-2000));
    process.exitCode = 1;
  } else {
    console.log(
      "built     graphify-out/graph.json (code only, no model calls)",
    );
  }

  console.log(
    "\nNot run: graphify's pass over documents, papers and images spends " +
      "model tokens. Offer it; start it with /graphify only on a yes.",
  );
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
        ? "audit.js context builds it (code only)"
        : graph.state === "stale"
          ? "/graphify --update re-extracts changed files"
          : undefined,
  });

  const oldRecordPresent = fs.existsSync(path.join(root, ".claude", "state.md"));
  const recordsPresent = fs.existsSync(stateRecords.recordsDirectory(root));
  rows.push({
    id: "state-file",
    status: recordsPresent ? "ok" : "missing",
    detail: recordsPresent
      ? ".claude/state/ present"
      : oldRecordPresent
        ? "working record is still the single .claude/state.md"
        : "no .claude/state/ folder, so nothing carries the work across a /clear",
    fix: recordsPresent
      ? undefined
      : oldRecordPresent
        ? "ccfg state migrate moves it into .claude/state/"
        : "audit.js context creates .claude/state/",
  });

  const stateIgnored = recordsGitIgnored(root);
  rows.push({
    id: "state-file-tracked",
    status: stateIgnored ? "ok" : "broken",
    detail: stateIgnored
      ? "git ignores .claude/state/"
      : "git would track .claude/state/, the per-window working records",
    fix: stateIgnored ? undefined : "ccfg state migrate adds it to .gitignore",
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

  const formatHooksUsed = repoAudit.usesFormatHooks(root);
  rows.push({
    id: "format-hooks",
    status: formatHooksUsed ? "ok" : "missing",
    detail: formatHooksUsed
      ? ".pre-commit-config.yaml pulls in format-hooks"
      : "no format-hooks in .pre-commit-config.yaml, so commits skip the shared formatters",
    fix: formatHooksUsed
      ? undefined
      : "audit.js format writes the config and installs the hooks",
  });

  return rows;
}

// Used when the tag lookup cannot reach GitHub; bump it when format-hooks tags a release.
const FORMAT_HOOKS_FALLBACK_REV = "v0.2.0";

const FORMAT_HOOK_IDS = [
  "ruff-check",
  "ruff-format",
  "python-spacing",
  "comment-pronouns",
  "comment-density",
  "clang-format",
  "prettier",
  "shfmt",
  "config-drift",
  "sync-config",
];

/**
 * The newest `vX.Y.Z` tag of format-hooks, or the fallback when offline.
 * `FORMAT_HOOKS_REV` overrides both, so tests never touch the network.
 */
function newestFormatHooksRev() {
  if (process.env.FORMAT_HOOKS_REV) {
    return { rev: process.env.FORMAT_HOOKS_REV, usedFallback: false };
  }
  const listing = io.git(
    ["ls-remote", "--tags", "--refs", repoAudit.FORMAT_HOOKS_URL],
    process.cwd(),
  );
  const versions = [...listing.matchAll(/refs\/tags\/v(\d+)\.(\d+)\.(\d+)$/gm)]
    .map((match) => match.slice(1, 4).map(Number))
    .sort((left, right) =>
      left[0] !== right[0]
        ? left[0] - right[0]
        : left[1] !== right[1]
          ? left[1] - right[1]
          : left[2] - right[2],
    );
  if (versions.length === 0) {
    return { rev: FORMAT_HOOKS_FALLBACK_REV, usedFallback: true };
  }
  return {
    rev: `v${versions[versions.length - 1].join(".")}`,
    usedFallback: false,
  };
}

function formatHooksEntry(rev) {
  return [
    `  - repo: ${repoAudit.FORMAT_HOOKS_URL}`,
    `    rev: ${rev}`,
    "    hooks:",
    ...FORMAT_HOOK_IDS.map((hookId) => `      - id: ${hookId}`),
  ].join("\n");
}

/**
 * Writes the pre-commit config and installs the hooks. An existing config is
 * never edited, since merging YAML by hand risks breaking the reader's hooks;
 * the block to paste is printed instead.
 */
function runFormat(root) {
  if (repoAudit.usesFormatHooks(root)) {
    console.log(
      "kept      .pre-commit-config.yaml (already uses format-hooks)",
    );
    return;
  }
  const { rev, usedFallback } = newestFormatHooksRev();
  const entry = formatHooksEntry(rev);
  const configPath = path.join(root, ".pre-commit-config.yaml");

  if (fs.existsSync(configPath)) {
    console.log(
      "kept      .pre-commit-config.yaml (it exists; nothing was edited)\n\n" +
        "Paste this under its repos: list, then run pre-commit install and\n" +
        "pre-commit run sync-config --hook-stage manual:\n\n" +
        entry,
    );
    return;
  }

  fs.writeFileSync(configPath, `repos:\n${entry}\n`);
  console.log(
    `wrote     .pre-commit-config.yaml (format-hooks ${rev}` +
      (usedFallback
        ? ", the fallback: GitHub was unreachable)"
        : ")"),
  );

  for (const preCommitArgs of [
    ["install"],
    ["run", "sync-config", "--hook-stage", "manual"],
  ]) {
    const run = spawnSync("pre-commit", preCommitArgs, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    if (run.error && run.error.code === "ENOENT") {
      console.log(
        "skipped   pre-commit is not on PATH; install it, then run " +
          "pre-commit install and pre-commit run sync-config --hook-stage manual",
      );
      return;
    }
    console.log(
      `ran       pre-commit ${preCommitArgs.join(" ")} (exit ${run.status})`,
    );
  }

  console.log(
    "\nNot run: pre-commit run --all-files rewrites every file in the repo. " +
      "Offer it; run it only on a yes.",
  );
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
  const command = ["snooze", "dismiss", "reset", "context", "format"].includes(
    positional[0],
  )
    ? positional.shift()
    : "report";

  // For snooze and dismiss the first positional is the check id, so the path is
  // whatever follows it. Relative paths resolve against the caller's directory
  // rather than being ignored, which would silently audit the wrong repository.
  const pathArgument =
    command === "report" || command === "context" || command === "format"
      ? positional[0]
      : positional[1];
  const root = repoAudit.findRepositoryRoot(
    pathArgument ? path.resolve(pathArgument) : process.cwd(),
  );
  if (root === null) {
    console.error("Not inside a git repository.");
    process.exit(1);
  }

  if (command === "context") {
    runContext(root);
    return;
  }

  if (command === "format") {
    runFormat(root);
    return;
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
