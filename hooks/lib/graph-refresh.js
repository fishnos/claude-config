"use strict";

// Keeping graphify-out/graph.json current without anyone asking.
//
// `graphify update` reads code only and makes no model calls, checked on
// 2026-09-11 with the API keys removed and `claude` on PATH replaced by a script
// that refuses any call, so starting it unprompted spends only local CPU.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

function graphPath(root) {
  return path.join(root, "graphify-out", "graph.json");
}

function modifiedMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function headLogPath(root) {
  const dotGit = path.join(root, ".git");
  try {
    if (fs.statSync(dotGit).isFile()) {
      const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"));
      if (match === null) return null;
      return path.join(path.resolve(root, match[1].trim()), "logs", "HEAD");
    }
  } catch {
    return null;
  }
  return path.join(dotGit, "logs", "HEAD");
}

function graphIsStale(root) {
  const graphTime = modifiedMs(graphPath(root));
  const headLog = headLogPath(root);
  const headTime = headLog === null ? null : modifiedMs(headLog);
  return graphTime !== null && headTime !== null && graphTime < headTime;
}

function findExecutable(name, searchPath = process.env.PATH || "") {
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD").split(";")
      : [""];
  for (const directory of searchPath.split(path.delimiter)) {
    if (directory === "") continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, name + extension);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not in this directory.
      }
    }
  }
  return null;
}

function logFile(configDir, root) {
  const digest = crypto.createHash("sha1").update(root).digest("hex");
  return path.join(
    configDir,
    "cache",
    "graph-refresh",
    `${path.basename(root)}-${digest.slice(0, 12)}.log`,
  );
}

/**
 * Start `graphify update <root>` and return at once.
 *
 * False when the repository has no graph, because creating one is the
 * operator's call (the setup banner raises it), or when graphify is absent.
 */
function startRefresh(configDir, root) {
  if (modifiedMs(graphPath(root)) === null) return false;
  const executable = findExecutable("graphify");
  if (executable === null) return false;

  const log = logFile(configDir, root);
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const output = fs.openSync(log, "w");
  const options = {
    cwd: root,
    stdio: ["ignore", output, output],
    windowsHide: true,
  };
  try {
    // Foreground only for the suite, which reads the fake graphify's record as
    // soon as the hook exits rather than waiting on a detached process.
    if (process.env.CLAUDE_GRAPH_REFRESH_FOREGROUND === "1") {
      spawnSync(executable, ["update", root], options);
    } else {
      spawn(executable, ["update", root], {
        ...options,
        detached: true,
      }).unref();
    }
  } finally {
    fs.closeSync(output);
  }
  return true;
}

module.exports = {
  headLogPath,
  graphIsStale,
  findExecutable,
  logFile,
  startRefresh,
};
