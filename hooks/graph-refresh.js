"use strict";

// SessionStart: rebuild a stale knowledge graph in the background.
//
// Stale means graphify-out/graph.json is older than .git/logs/HEAD, which moves
// on every commit and checkout. Silent throughout: staleness fixes itself at no
// cost, and only a missing graph needs the operator, which repo-setup.js raises.
//
// Its own hook so that repo-setup.js stays filesystem-only, as its header
// promises.

const repoAudit = require("./lib/repo-audit");
const graphRefresh = require("./lib/graph-refresh");
const io = require("./lib/hook-io");

io.run(() => {
  const payload = io.readPayload();
  const root = repoAudit.findRepositoryRoot(payload.cwd || process.cwd());
  if (root === null || !graphRefresh.graphIsStale(root)) return;
  graphRefresh.startRefresh(io.configDir(), root);
});
