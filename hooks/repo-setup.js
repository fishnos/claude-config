"use strict";

// SessionStart: name the agent infrastructure this repo is missing, once.
//
// The checks live in lib/repo-audit so the /repo-setup skill runs the same ones
// and cannot drift from what this notice claimed. The skill adds the checks that
// need git or the network; this hook stays filesystem-only so it cannot stall a
// session start.
//
// Urgent findings (no state file, no ignore line for it, no graph) are shown on
// every start, as a banner the operator sees, until fixed or dismissed: the
// context design does not work without them. The rest speak at most once per
// fortnight per repository, and again as soon as that set changes. A routine
// notice on every start is a notice nobody reads.

const path = require("path");

const repoAudit = require("./lib/repo-audit");
const io = require("./lib/hook-io");

const EVENT = "SessionStart";
const QUIET_DAYS = 14;

io.run(() => {
  const payload = io.readPayload();
  const root = repoAudit.findRepositoryRoot(payload.cwd || process.cwd());
  if (root === null) return;

  // Anything under the config directory is harness plumbing rather than a
  // project: the config repo itself, plugin marketplace clones, plugin caches.
  // Each of those carries a .git, and reporting on one would describe the
  // harness to someone who opened a project.
  const configRoot = path.resolve(io.configDir());
  if (root === configRoot || root.startsWith(`${configRoot}${path.sep}`))
    return;

  const state = repoAudit.readState(io.configDir(), root);
  const findings = repoAudit.activeFindings(repoAudit.audit(root), state);
  const urgent = findings.filter((finding) => finding.urgent === true);
  const routine = findings.filter((finding) => finding.urgent !== true);

  // The fingerprint covers routine findings only, so fixing an urgent one does
  // not re-arm a routine notice shown yesterday.
  const fingerprint = routine
    .map((finding) => finding.id)
    .sort()
    .join(",");
  const unchanged = fingerprint === state.lastFingerprint;
  const age = state.lastNoticeAt
    ? repoAudit.daysBetween(state.lastNoticeAt, repoAudit.today())
    : Infinity;
  const routineDue = routine.length > 0 && !(unchanged && age < QUIET_DAYS);
  if (urgent.length === 0 && !routineDue) return;

  if (routineDue) {
    repoAudit.writeState(io.configDir(), root, {
      ...state,
      repo: root,
      lastFingerprint: fingerprint,
      lastNoticeAt: repoAudit.today(),
    });
  }

  const shown = [...urgent, ...(routineDue ? routine : [])];
  const context =
    `Repo setup: ${shown.map((finding) => finding.message).join("; ")}. ` +
    `Run /repo-setup to review or dismiss. ` +
    `Mention this once, then continue with the task at hand.`;

  if (urgent.length === 0) {
    io.warn(EVENT, context);
  } else {
    io.announce(
      EVENT,
      context,
      `Repo setup: ${urgent.map((finding) => finding.message).join("; ")}. ` +
        `Fix with /repo-setup context, or dismiss.`,
    );
  }
});
