"use strict";

// SessionStart: name the agent infrastructure this repo is missing, once.
//
// The checks live in lib/repo-audit so the /repo-setup skill runs the same ones
// and cannot drift from what this notice claimed. The skill adds the checks that
// need git or the network; this hook stays filesystem-only so it cannot stall a
// session start.
//
// Speaks at most once per fortnight per repository, and again immediately when
// the set of problems changes. A notice on every start is a notice nobody reads.

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
  if (root === configRoot || root.startsWith(`${configRoot}${path.sep}`)) return;

  const state = repoAudit.readState(io.configDir(), root);
  const findings = repoAudit.activeFindings(repoAudit.audit(root), state);
  if (findings.length === 0) return;

  const fingerprint = findings
    .map((finding) => finding.id)
    .sort()
    .join(",");
  const unchanged = fingerprint === state.lastFingerprint;
  const age = state.lastNoticeAt
    ? repoAudit.daysBetween(state.lastNoticeAt, repoAudit.today())
    : Infinity;
  if (unchanged && age < QUIET_DAYS) return;

  repoAudit.writeState(io.configDir(), root, {
    ...state,
    repo: root,
    lastFingerprint: fingerprint,
    lastNoticeAt: repoAudit.today(),
  });

  const summary = findings.map((finding) => finding.message).join("; ");
  io.warn(
    EVENT,
    `Repo setup: ${summary}. Run /repo-setup to review or dismiss. ` +
      `Mention this once, then continue with the task at hand.`,
  );
});
