#!/usr/bin/env node
"use strict";

// How much context sessions carry, and how often they compact.
//
// Run by hand. Two weeks after the context-management rollout, repeat the
// 2026-09-11 measurement in docs/superpowers/specs/2026-09-11-context-management-design.md
// and compare: turns above 200K and compactions per week should both have fallen.
//
// Usage: node ~/.claude/tools/context-report.js [--since YYYY-MM-DD]

const fs = require("fs");
const os = require("os");
const path = require("path");

const transcriptTail = require(
  path.join(__dirname, "..", "hooks", "lib", "transcript-tail.js"),
);

const configDir =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const OVER_TOKENS = 200000;
const DAY_MS = 86400000;
const BUCKETS = [
  { label: "under 100K", below: 100000 },
  { label: "100K to 200K", below: 200000 },
  { label: "200K to 400K", below: 400000 },
  { label: "over 400K", below: Infinity },
];

// One level down only: subagent transcripts sit deeper, under the session's
// own directory, and counting them would add thousands of empty "sessions".
function sessionTranscripts(projectsDir, sinceMs) {
  const files = [];
  let projects = [];
  try {
    projects = fs.readdirSync(projectsDir);
  } catch {
    return files;
  }
  for (const project of projects) {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(projectsDir, project));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const file = path.join(projectsDir, project, entry);
      try {
        if (fs.statSync(file).mtimeMs >= sinceMs) files.push(file);
      } catch {
        // Removed while scanning.
      }
    }
  }
  return files;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function thousands(tokens) {
  return `${Math.round(tokens / 1000)}K`;
}

function main() {
  const args = process.argv.slice(2);
  const sinceArgument = args.includes("--since")
    ? args[args.indexOf("--since") + 1]
    : null;
  const sinceMs = sinceArgument
    ? Date.parse(sinceArgument)
    : Date.now() - 14 * DAY_MS;
  if (Number.isNaN(sinceMs)) {
    console.error("--since takes a date: YYYY-MM-DD");
    process.exit(2);
  }

  const files = sessionTranscripts(path.join(configDir, "projects"), sinceMs);
  const bucketCounts = BUCKETS.map(() => 0);
  const compactions = [];
  let turnsOver = 0;
  let compactedSessions = 0;

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const summary = transcriptTail.summarize(
      transcriptTail.parseLines(text),
      OVER_TOKENS,
    );
    bucketCounts[
      BUCKETS.findIndex((bucket) => summary.peakTokens < bucket.below)
    ] += 1;
    turnsOver += summary.turnsOver;
    if (summary.compactions.length > 0) compactedSessions += 1;
    compactions.push(...summary.compactions);
  }

  const weeks = Math.max((Date.now() - sinceMs) / (7 * DAY_MS), 1 / 7);
  const byTrigger = (trigger) =>
    compactions.filter((compaction) => compaction.trigger === trigger);
  const lines = [
    `Sessions modified since ${new Date(sinceMs).toISOString().slice(0, 10)}: ${files.length}`,
    "",
    "Largest context a session reached:",
    ...BUCKETS.map(
      (bucket, index) => `  ${bucket.label.padEnd(14)} ${bucketCounts[index]}`,
    ),
    "",
    `Turns above ${thousands(OVER_TOKENS)}: ${turnsOver}`,
    `Compactions: ${compactions.length} in ${compactedSessions} sessions (${(compactions.length / weeks).toFixed(1)} a week)`,
  ];
  for (const trigger of ["auto", "manual"]) {
    const matching = byTrigger(trigger);
    lines.push(
      `  ${trigger.padEnd(7)} ${matching.length}, median ${thousands(median(matching.map((compaction) => compaction.preTokens)))} before`,
    );
  }
  console.log(lines.join("\n"));
}

main();
