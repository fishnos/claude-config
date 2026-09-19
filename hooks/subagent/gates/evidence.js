"use strict";

// The evidence gate: a claim of done, checked against commands that really ran.
//
// This is the answer to "claimed a verification it never ran", and the hard half
// of that failure is not the lie. It is the honest report written after the
// suite ran and the code then changed again: every sentence in it was true when
// it was written, and the claim is false by the time it is read. Only the
// ordering of the two catches that one, which is why this gate asks when as well
// as whether.
//
// Both records it reads are written by hooks from things that really happened,
// and hooks/agent-guard.js denies a worker every write into either of them. So
// nothing here is the worker's account of its own work: the report is checked
// against lines it never had the chance to author. That is what the survey's
// mechanism 4 means by making the verification record a policy surface no worker
// may write, and it is why this gate, unlike a reader of prose, cannot be talked
// out of a refusal by confident closing language.

// The mode's `claims` dial, weakest first. `loose` checks nothing, `labeled`
// wants a citation beside a claim of done, and `sourced` wants the cited command
// to appear in the log and to have run after the last write.
const CLAIMS = ["loose", "labeled", "sourced"];

// Every mode in modes/*.json sets `claims`, so a lock without one is damaged or
// hand-written. It reads as the middle posture rather than the weakest, because
// a gate that quietly checks nothing is the failure this design exists to stop.
const DEFAULT_CLAIMS = "labeled";

// What a touched path has to fall outside of to be code a command could verify.
// Prose and mode data are the exceptions: a worker that only edited
// documentation has nothing to run, and asking it for a command would teach it
// to cite one that proves nothing.
const NOT_RUNTIME = [/^docs\//, /^modes\//, /\.md$/i];

// How many touched paths a refusal spells out before it counts the rest. Capped
// because these come from the run record, which holds every write of the run;
// the cited commands below are not capped, because they come from the report the
// worker just wrote.
const MAX_NAMED = 6;

function isRuntime(written) {
  const cleaned = String(written).replace(/^\.\//, "");
  return !NOT_RUNTIME.some((pattern) => pattern.test(cleaned));
}

/** Whitespace is never the difference between two spellings of a command. */
function normalize(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every log entry that is a run of one cited command.
 *
 * The match runs one way only: the executed text may contain the citation and
 * never the reverse. The log holds the command as the harness ran it, which is
 * routinely longer than the part a worker means (`cd /repo && node x` against
 * `node x`), while a citation that contains the executed command is a worker
 * claiming more than it ran (`node x && npx prettier` against `node x`).
 *
 * The one exception is a citation longer than what the log could store:
 * hooks/evidence-log.js cuts a command at 400 characters and flags the cut, so a
 * flagged entry matches the citation whose front it is.
 */
function runsOf(citation, log) {
  const wanted = normalize(citation);
  if (wanted === "") return [];
  return log.filter((entry) => {
    const executed = normalize(entry && entry.command);
    if (executed === "") return false;
    if (executed.includes(wanted)) return true;
    return Boolean(entry && entry.truncated) && wanted.startsWith(executed);
  });
}

/**
 * True when a run of a command is worth citing as proof.
 *
 * A run that was cut short proves nothing, and neither does one that came back
 * non-zero. An unknown exit stays unknown: this harness reports no exit code at
 * all (see hooks/evidence-log.js), so reading null as failure would refuse every
 * honest report written on it.
 */
function proves(entry) {
  if (entry.interrupted === true) return false;
  return !(typeof entry.exit === "number" && entry.exit !== 0);
}

/** What the log says happened to a run, for a refusal that names the reason. */
function outcomeOf(entry) {
  if (entry.interrupted === true) return "was interrupted";
  if (typeof entry.exit === "number") return `exited ${entry.exit}`;
  return "did not come back clean";
}

function nameSome(paths) {
  const named = paths.slice(0, MAX_NAMED);
  const unnamed = paths.length - named.length;
  const andMore = unnamed > 0 ? `, and ${unnamed} more` : "";
  return named.join(", ") + andMore;
}

module.exports = {
  id: "evidence",
  minimumVerify: "tested",
  check(run) {
    const settings = run.settings || {};
    const claims = CLAIMS.includes(settings.claims)
      ? settings.claims
      : DEFAULT_CLAIMS;
    if (claims === "loose") return { ok: true };

    // Only a claim of done claims anything a command could settle. A worker that
    // reports blocked, rejected or input-required is doing what the contract
    // asks of it, and has nothing to prove.
    const finish = run.finish || {};
    if (finish.state !== "done") return { ok: true };

    const runtime = (Array.isArray(run.touched) ? run.touched : []).filter(
      isRuntime,
    );
    if (runtime.length === 0) return { ok: true };

    const cited = (Array.isArray(finish.evidence) ? finish.evidence : [])
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0);
    if (cited.length === 0) {
      return {
        ok: false,
        reason:
          `this report says STATE done and the record has it writing ${nameSome(runtime)}, ` +
          "with no EVIDENCE line behind that. Name the command you actually ran, " +
          "or report the state you are actually in.",
      };
    }

    // At `labeled` the posture asks for a claim to carry its label, and the
    // citation is the label. Whether the command ran is the next posture's
    // question, so the log is deliberately not read here.
    if (claims === "labeled") return { ok: true };

    const log = Array.isArray(run.log) ? run.log : [];
    const citations = cited.map((citation) => {
      const matched = runsOf(citation, log);
      return { citation, matched, proving: matched.filter(proves) };
    });

    const unrun = citations.filter((each) => each.matched.length === 0);
    if (unrun.length > 0) {
      const names = unrun.map((each) => each.citation).join(", ");
      return {
        ok: false,
        reason:
          `cited and never run: ${names}. The log behind this check is written ` +
          "from real Bash calls, so anything that ran is in it. Run it and " +
          "report what it said, or take the claim out.",
      };
    }

    // The most recent run is the one a report means, and in an append-ordered
    // log that is the last match.
    const failed = citations.filter((each) => each.proving.length === 0);
    if (failed.length > 0) {
      const names = failed
        .map(
          (each) =>
            `${each.citation} (${outcomeOf(each.matched[each.matched.length - 1])})`,
        )
        .join(", ");
      return {
        ok: false,
        reason:
          `cited and not clean: ${names}. Fix what the run reported and cite a ` +
          "run that came back clean, or report the state you are in.",
      };
    }

    // No usable write time leaves nothing to order against. That is an older run
    // record rather than a dishonest report, and a refusal a worker cannot act
    // on is worse than a pass that checked one thing less. A missing time is
    // read as missing rather than converted: Number(null) is 0, a time every run
    // is later than, which would pass this check for the wrong reason.
    const lastWriteAt =
      typeof run.lastWriteAt === "number" ? run.lastWriteAt : NaN;
    if (!Number.isFinite(lastWriteAt)) return { ok: true };

    // Stale when no run of the command can be placed at or after the last write.
    // A re-run after the write clears an earlier one; equal times are the same
    // millisecond, which cannot be ordered, so the benefit of the doubt goes to
    // the worker; and a run the log gave no time to leaves nothing to order at
    // all, which is an older log rather than a dishonest report.
    const stale = citations.filter((each) => {
      const timed = each.proving.filter((entry) => Number.isFinite(entry.at));
      return (
        timed.length > 0 && !timed.some((entry) => entry.at >= lastWriteAt)
      );
    });
    if (stale.length > 0) {
      const names = stale.map((each) => each.citation).join(", ");
      return {
        ok: false,
        reason:
          `cited and stale: ${names}. That last ran BEFORE the last write to ` +
          `${nameSome(runtime)}, so it says nothing about the code this report ` +
          "is about. Run it again on what you are reporting, and cite that run.",
      };
    }

    return { ok: true };
  },
};
