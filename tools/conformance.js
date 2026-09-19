"use strict";

// The conformance log: which things this design assumes about Claude Code have
// actually been seen to hold, on real dispatches.
//
// Every gate in the subagent architecture rests on something that was measured
// once, on one build of the harness. A worker's prompt carries the dispatch
// token because `updatedInput` reached it; a write is attributed because the
// inner payload carried `agent_id`; a hand-back denial is retried rather than
// swallowed. None of that is documented, so none of it is promised, and a
// harness update can take any of it away without a word.
//
// This reader answers one question about each of those assumptions: confirmed,
// contradicted, or not yet observed. It costs nothing to keep answered, because
// it reads the run record that dispatches already write rather than running
// anything of its own, and it names the build each verdict was last seen on so
// an assumption that broke at an update can be told from one that never held.

const fs = require("fs");
const path = require("path");
const record = require("../hooks/lib/crew-record.js");

const NOT_YET_OBSERVED = "not yet observed";
const CONFIRMED = "confirmed";
const CONTRADICTED = "contradicted";

const HANDBACK = "SubagentHandback";

/**
 * The assumptions, each with the observation that settles it.
 *
 * `read` is handed one record line and the scan so far, and answers with a
 * verdict or null for "this line says nothing about me". Three of the five can
 * only ever be confirmed: nothing in the record distinguishes "the harness
 * stopped doing this" from "no dispatch has needed it yet", and reporting the
 * second as a contradiction would raise an alarm on an idle week.
 */
const ASSUMPTIONS = [
  {
    id: "updated-input",
    assumption: "the dispatch prompt reaches the worker (updatedInput)",
    confirmedWhen: "a finish carried a token the dispatcher minted",
    contradictedWhen:
      "a finish had no token in its report and none in the prompt it was sent",
    read(entry, seen) {
      if (entry.kind !== "finish") return null;
      // A token no dispatch minted proves nothing: eight hex characters are
      // cheap to invent, and a worker that invented them would otherwise
      // confirm the very thing that failed.
      if (entry.token) return seen.minted.has(entry.token) ? CONFIRMED : null;
      // No token in the report, and the prompt that would have carried one was
      // read out of the worker's own transcript. That is the prompt not
      // arriving. A transcript that existed but could not be read says nothing:
      // reporting that as a contradiction would blame the harness for a prompt
      // too long to scan.
      return entry.transcriptRead === true ? CONTRADICTED : null;
    },
  },
  {
    id: "agent-id",
    assumption: "a worker's own tool calls carry agent_id",
    confirmedWhen: "a write was ever attributed to a worker",
    contradictedWhen: "never: an idle week looks the same",
    read(entry) {
      if (entry.kind !== "path") return null;
      return entry.agentId ? CONFIRMED : null;
    },
  },
  {
    id: "report-arrives",
    assumption: "a worker's report reaches a gate at one of its two points",
    confirmedWhen: "a finish parsed a token out of the report itself",
    contradictedWhen: "never: an idle week looks the same",
    read(entry) {
      if (entry.kind !== "finish") return null;
      return entry.tokenSource === "report" ? CONFIRMED : null;
    },
  },
  {
    id: "handback-retry",
    assumption: "a denied hand-back is retried rather than dropped",
    confirmedWhen:
      "a delivery followed a hand-back refusal for the same worker",
    contradictedWhen: "never: an idle week looks the same",
    read(entry, seen) {
      if (entry.kind !== "mark" || entry.mark !== "delivered") return null;
      return seen.refusedAtHandback.has(entry.agentId) ? CONFIRMED : null;
    },
  },
  {
    id: "transcript-layout",
    assumption:
      "a worker's transcript sits at the path derived beside its parent's",
    confirmedWhen:
      "a hand-back found the transcript where the derivation put it",
    contradictedWhen: "a hand-back found nothing at that path",
    read(entry) {
      if (entry.kind !== "finish" || entry.point !== HANDBACK) return null;
      if (entry.transcriptFound === true) return CONFIRMED;
      if (entry.transcriptFound === false) return CONTRADICTED;
      return null;
    },
  },
];

// Deliberately absent: whether a role's `tools:` list restricts a worker. A
// `path` line records neither the tool that wrote it nor the worker's role, so
// no line in this record could show a worker using a tool its role leaves out.
// Listing it here would print an untested assumption beside tested ones.

/**
 * One verdict per assumption, from record lines in the order they were written.
 *
 * The last observation wins. An assumption that broke on one build and holds
 * again on the next should read as confirmed, and the build on the row says
 * which build the verdict came from, so a stale confirmation cannot pass itself
 * off as current.
 */
function summarise(entries) {
  const seen = {
    minted: new Set(),
    refusedAtHandback: new Set(),
    build: null,
  };
  const verdicts = new Map();

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== "object") continue;

    if (typeof entry.build === "string" && entry.build !== "")
      seen.build = entry.build;
    if (entry.kind === "run" && entry.token) seen.minted.add(entry.token);
    if (
      entry.kind === "mark" &&
      entry.mark === "refusal" &&
      entry.point === HANDBACK
    )
      seen.refusedAtHandback.add(entry.agentId);

    for (const assumption of ASSUMPTIONS) {
      const state = assumption.read(entry, seen);
      if (state === null) continue;
      verdicts.set(assumption.id, {
        state,
        build:
          typeof entry.build === "string" && entry.build !== ""
            ? entry.build
            : seen.build,
      });
    }
  }

  return ASSUMPTIONS.map((assumption) => {
    const verdict = verdicts.get(assumption.id);
    return {
      id: assumption.id,
      assumption: assumption.assumption,
      confirmedWhen: assumption.confirmedWhen,
      contradictedWhen: assumption.contradictedWhen,
      state: verdict === undefined ? NOT_YET_OBSERVED : verdict.state,
      build: verdict === undefined ? null : verdict.build,
    };
  });
}

/**
 * Every session's record, oldest session first.
 *
 * Ordered by when the file was last written, because the verdicts are
 * last-one-wins and a record from this morning must not overrule tonight's.
 */
function readRecords() {
  const dir = record.recordDir();
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return { entries: [], sessions: 0 };
  }

  const files = names
    .map((name) => {
      let modified = 0;
      try {
        modified = fs.statSync(path.join(dir, name)).mtimeMs;
      } catch {
        // A file removed between the listing and the stat sorts first and
        // contributes nothing, which is better than failing the whole read.
      }
      return { session: name.replace(/\.jsonl$/, ""), modified };
    })
    .sort((first, second) => first.modified - second.modified);

  const entries = [];
  for (const file of files) entries.push(...record.readLines(file.session));
  return { entries, sessions: files.length };
}

function countKinds(entries) {
  const counts = { run: 0, path: 0, finish: 0, refusal: 0, delivered: 0 };
  for (const entry of entries) {
    if (entry.kind === "run") counts.run += 1;
    else if (entry.kind === "path") counts.path += 1;
    else if (entry.kind === "finish") counts.finish += 1;
    else if (entry.kind === "mark" && entry.mark === "refusal")
      counts.refusal += 1;
    else if (entry.kind === "mark" && entry.mark === "delivered")
      counts.delivered += 1;
  }
  return counts;
}

// The verdict sits in its own column, as wide as the longest verdict word, so
// the assumption text under it lines up with the text beside it.
const STATE_WIDTH = NOT_YET_OBSERVED.length;

/** Print one verdict per assumption, with what the record counted under them. */
function commandConformance(argv, IO) {
  const { entries, sessions } = readRecords();
  const rows = summarise(entries);
  const counts = countKinds(entries);

  IO.heading("What real dispatches have confirmed about this harness");

  const paint = (row) => {
    if (row.state === CONFIRMED) return IO.green(CONFIRMED.padEnd(STATE_WIDTH));
    if (row.state === CONTRADICTED)
      return IO.red(CONTRADICTED.padEnd(STATE_WIDTH));
    return IO.dim(NOT_YET_OBSERVED.padEnd(STATE_WIDTH));
  };

  for (const row of rows) {
    console.log(`  ${paint(row)} ${IO.bold(row.id)}`);
    console.log(`  ${" ".repeat(STATE_WIDTH)} ${row.assumption}`);
    const shown =
      row.state === NOT_YET_OBSERVED
        ? `confirmed when ${row.confirmedWhen}`
        : row.build
          ? `last seen on build ${row.build}`
          : "last seen on an unrecorded build";
    console.log(`  ${" ".repeat(STATE_WIDTH)} ${IO.dim(shown)}`);
  }

  const count = (number, one, many) => `${number} ${number === 1 ? one : many}`;
  console.log(
    `\n  from ${IO.bold(String(sessions))} session record${sessions === 1 ? "" : "s"}: ` +
      `${count(counts.run, "dispatch", "dispatches")}, ` +
      `${count(counts.finish, "report", "reports")} read, ` +
      `${count(counts.path, "write", "writes")} traced, ` +
      `${counts.refusal} refused, ${counts.delivered} delivered`,
  );
  if (counts.finish === 0)
    console.log(
      IO.dim(
        "  no report has reached a gate yet, so most rows cannot say anything",
      ),
    );
  console.log(
    IO.dim(
      "\n  not tracked: whether a role's tools: list restricts a worker.\n" +
        "  A traced write records neither the tool that made it nor the role,\n" +
        "  so nothing in this record could show that restriction holding.",
    ),
  );
}

module.exports = {
  ASSUMPTIONS,
  summarise,
  readRecords,
  countKinds,
  commandConformance,
  NOT_YET_OBSERVED,
  CONFIRMED,
  CONTRADICTED,
};
