"use strict";

// Shared plumbing for the standards hooks. Everything here is synchronous and
// failure-tolerant: a hook that throws must never be able to block real work.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

/** Read the hook payload from stdin. Returns {} when stdin is empty or malformed. */
function readPayload() {
  let raw = "";
  try {
    // fd 0 is a pipe when the harness invokes a hook, which reads reliably on
    // Windows as well; a TTY or closed stdin throws and is treated as no input.
    raw = fs.readFileSync(0, "utf8");
  } catch {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Write the hook result to stdout synchronously.
 *
 * process.stdout.write() to a pipe is asynchronous on Windows, so the
 * process.exit() that follows each emit would terminate before the payload
 * flushed -- the hook would return nothing and the harness would read that as
 * "no opinion", silently permitting whatever was being blocked. fs.writeSync
 * is synchronous on every platform. It may also write short, hence the loop.
 */
function emit(object) {
  const payload = Buffer.from(JSON.stringify(object), "utf8");
  let written = 0;
  while (written < payload.length) {
    try {
      written += fs.writeSync(1, payload, written, payload.length - written);
    } catch (error) {
      if (error.code === "EAGAIN") continue;
      return;
    }
  }
}

/** Refuse the tool call outright. The reason is shown to the model. */
function deny(hookEventName, reason) {
  emit({
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
  process.exit(0);
}

/** Let the call through but inject context the model has to read. */
function warn(hookEventName, additionalContext) {
  emit({ hookSpecificOutput: { hookEventName, additionalContext } });
  process.exit(0);
}

/** Stop-hook form: send the model back for another turn. */
function block(reason) {
  emit({ decision: "block", reason });
  process.exit(0);
}

/** Root of the tracked config, honouring CLAUDE_CONFIG_DIR like the other hooks. */
function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

/**
 * Where the evidence log lives. Defined once because three separate callers read
 * it -- the logger, the Stop reminder, and `ccfg evidence`. Spelled out in each,
 * a renamed env var would silently split them into two locations.
 */
function evidenceDir() {
  return (
    process.env.CLAUDE_EVIDENCE_DIR ||
    path.join(configDir(), "cache", "evidence")
  );
}

/** Run a read-only git command. Returns stdout, or '' if git is absent or fails. */
function git(args, cwd) {
  try {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
    return result.status === 0 && result.stdout ? result.stdout : "";
  } catch {
    return "";
  }
}

/**
 * Run a hook body, swallowing every error. A broken guard is an inconvenience;
 * a guard that crashes the tool call it was meant to inspect is an outage.
 */
function run(body) {
  try {
    body();
  } catch {
    // Deliberately silent -- see above.
  }
  process.exit(0);
}

module.exports = {
  readPayload,
  deny,
  warn,
  block,
  configDir,
  evidenceDir,
  git,
  run,
};
