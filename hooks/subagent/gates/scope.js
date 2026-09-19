"use strict";

// The scope gate: every path the trace hook recorded is covered by a pattern the
// dispatcher declared, or the report names it on a Deviations line with a reason.
//
// This is the gate that makes the dispatch's scope line binding rather than
// decorative, and the measurement behind it is the reason the line exists at all:
// stripping the sentence that states the scope of consent out of otherwise
// identical prompts took out-of-scope actions from 0.0% to 17.1%.
//
// It asks nothing of the worker beyond that one line. The paths come from the run
// record, which a worker cannot write, so a report that simply claims it stayed
// inside its area is checked against what the harness saw it do.

const UNDECLARED = "(undeclared)";

// How many offending paths a refusal spells out before it counts the rest.
const MAX_NAMED = 12;

/**
 * One declared pattern as a regular expression over whole path segments.
 *
 * Segments, never string prefixes: a scope of `src/a` must not cover
 * `src/ab.js`. The trailing `(/|$)` is what enforces that, and it is also what
 * makes a pattern that names a directory cover everything under it. A single `*`
 * stops at a separator and `**` crosses them, matching how a dispatcher who
 * types `hooks/*.js` or `hooks/**\/*.js` expects each to read.
 */
function patternToRegExp(pattern) {
  const withoutTrailingSlash = String(pattern).replace(/\/+$/, "");
  const escaped = withoutTrailingSlash.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const globbed = escaped
    .split("**")
    .map((part) => part.replace(/\*/g, "[^/]*"))
    .join(".*");
  return new RegExp(`^${globbed}(/|$)`);
}

/**
 * True when a deviation line names this path and says something about it.
 *
 * The bar is a reason, not a format: a worker writes `src/b.js: the import moved`
 * or `had to touch src/b.js too, the import followed`, and both are the honest
 * disclosure this gate is asking for. A line that is only the path is not, since
 * repeating the file it was caught writing costs the worker nothing.
 *
 * Known limit: a deviation naming a longer path that begins with this one, say
 * `src/b.js.bak`, excuses `src/b.js` too. Narrow enough to leave, because the
 * only cheap test for a boundary after the path is a punctuation check, and a
 * deviation that ends its sentence with a full stop would then stop counting.
 */
function excusedBy(written, deviations) {
  return deviations.some((line) => {
    const text = String(line);
    const foundAt = text.indexOf(written);
    if (foundAt === -1) return false;
    const besidePath =
      text.slice(0, foundAt) + " " + text.slice(foundAt + written.length);
    return besidePath.replace(/[\s:;,.()\-]+/g, "").length > 0;
  });
}

module.exports = {
  id: "scope",
  minimumVerify: "tested",
  check(run) {
    const scope = Array.isArray(run.scope) ? run.scope : [];
    const touched = Array.isArray(run.touched) ? run.touched : [];
    const finish = run.finish || {};
    const deviations = Array.isArray(finish.deviations)
      ? finish.deviations
      : [];

    // Nothing declared, nothing to measure against. The dispatch hook refuses a
    // scopeless dispatch under any posture that wants one, so a run that reaches
    // here undeclared is a spike, where the scope genuinely is whatever the work
    // turns out to need.
    if (scope.length === 0 || scope.includes(UNDECLARED)) return { ok: true };

    const patterns = scope.map(patternToRegExp);
    const outside = touched.filter(
      (written) =>
        !patterns.some((pattern) => pattern.test(written)) &&
        !excusedBy(written, deviations),
    );
    if (outside.length === 0) return { ok: true };

    // The refusal is written into a worker's context, and the record it is built
    // from holds every write of the run, so the list of names is capped rather
    // than left to the size of whatever the worker did.
    const named = outside.slice(0, MAX_NAMED);
    const unnamed = outside.length - named.length;
    const andMore = unnamed > 0 ? `, and ${unnamed} more` : "";
    const isOrAre = outside.length === 1 ? "is" : "are";
    return {
      ok: false,
      reason:
        `${named.join(", ")}${andMore} ${isOrAre} outside the scope this dispatch ` +
        `declared (${scope.join(", ")}). Add a Deviations line naming each one ` +
        "with the reason it had to change, or leave it out of this run.",
    };
  },
};
