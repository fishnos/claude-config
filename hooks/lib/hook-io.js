"use strict";

// Shared plumbing for the standards hooks. Everything here is synchronous and
// failure-tolerant: a hook that throws must never be able to block real work.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

let keptPayload;

/**
 * Read the hook payload from stdin. Returns {} when stdin is empty or malformed.
 *
 * Kept after the first read. Standard input can be read once, and the runner
 * reads it before the hook body does, to learn which repository the call is in.
 */
function readPayload() {
  if (keptPayload !== undefined) return keptPayload;
  let raw = "";
  try {
    // fd 0 is a pipe when the harness invokes a hook, which reads reliably on
    // Windows as well; a TTY or closed stdin throws and is treated as no input.
    raw = fs.readFileSync(0, "utf8");
  } catch {
    keptPayload = {};
    return keptPayload;
  }
  try {
    keptPayload = JSON.parse(raw);
  } catch {
    keptPayload = {};
  }
  if (keptPayload === null || typeof keptPayload !== "object") keptPayload = {};
  return keptPayload;
}

/**
 * Write the hook result to stdout synchronously.
 *
 * process.stdout.write() to a pipe is asynchronous on Windows, so the
 * process.exit() that follows each emit would terminate before the payload
 * flushed. The hook would then return nothing, the harness would read the
 * silence as "no opinion", and whatever was being blocked would go through.
 * fs.writeSync is synchronous on every platform. It may also write short,
 * hence the loop.
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

/**
 * Hand the decision to the operator: the permission prompt appears even when
 * an allow rule would have let the call through. The reason is shown to them.
 */
function ask(hookEventName, reason) {
  emit({
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "ask",
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

/**
 * Say something to the operator and something to the model, in one reply.
 *
 * `additionalContext` reaches the model as a system reminder and is never
 * displayed; `systemMessage` is the opposite, shown in the transcript and
 * never given to the model. A hook that needs the operator to SEE something
 * has to use `systemMessage`. A session-start notice written only as context
 * therefore looked like a hook that had never run.
 *
 * systemMessage is a top-level field and needs Claude Code 2.1.227 or newer;
 * older versions ignore it and still deliver the context.
 */
function announce(hookEventName, additionalContext, systemMessage) {
  emit({
    systemMessage,
    hookSpecificOutput: { hookEventName, additionalContext },
  });
  process.exit(0);
}

/**
 * Let the call through with different arguments.
 *
 * Measured working on the Agent tool on build 2.1.270 by the 2026-09-15 spike,
 * against a five-month-old closed issue claiming it was silently ignored there.
 * It is the only channel that can put anything into a dispatch prompt, because
 * SubagentStart can inject context but never sees the brief.
 *
 * `systemMessage` is optional and reaches the operator's transcript rather than
 * the model, which is how a rewrite says something without turning itself into
 * a warning the harness treats as a separate decision.
 */
function rewrite(hookEventName, updatedInput, systemMessage) {
  emit({
    systemMessage,
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "allow",
      updatedInput,
    },
  });
  process.exit(0);
}

/** Stop-hook form: send the model back for another turn. */
function block(reason) {
  emit({ decision: "block", reason });
  process.exit(0);
}

/**
 * Say something to the operator and nothing to the model, and let the turn end.
 *
 * The one output a `Stop` hook has for "this is not being held, but you should
 * know": `block` would hold, and `additionalContext` is not read at `Stop`.
 */
function tell(systemMessage) {
  emit({ systemMessage });
  process.exit(0);
}

/** Root of the tracked config, honouring CLAUDE_CONFIG_DIR like the other hooks. */
function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

/**
 * Where the evidence log lives. Defined once because three separate callers
 * read it: the logger, the Stop reminder, and `ccfg evidence`. Spelled out in
 * each of the three instead, a renamed environment variable would split them
 * into two locations without saying so.
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
 * Whether the mode in force for this call has turned the named hook off.
 *
 * A mode used to turn a hook off by deleting its entry from settings.json. A
 * repository's settings file can add a hook and cannot remove a machine-wide
 * one, so that could never be done for one repository. The hook now decides
 * for itself, here.
 *
 * The protected hooks are checked at read time as well as at switch time, so a
 * record edited by hand cannot turn them off. Every failure answers "not turned
 * off": a hook that runs when it should have been quiet is an annoyance, and a
 * guardrail that goes quiet by accident is the failure this system exists to
 * prevent.
 */
function turnedOff(scriptPath) {
  try {
    const name = path.basename(String(scriptPath));
    const { resolveForPayload } = require("./mode-lock");
    const { lock } = resolveForPayload(configDir(), readPayload());
    if (lock === null || !Array.isArray(lock.disabledHooks)) return false;
    const listed = lock.disabledHooks.some(
      (entry) =>
        typeof entry === "string" && entry !== "" && name.includes(entry),
    );
    if (!listed) return false;
    const { CORE_HOOKS } = require(
      path.join(__dirname, "..", "..", "tools", "modes", "modes.js"),
    );
    return !CORE_HOOKS.includes(name);
  } catch {
    return false;
  }
}

/**
 * Run a hook body, swallowing every error. A broken guard is an inconvenience;
 * a guard that crashes the tool call it was meant to inspect is an outage.
 *
 * A hook that a mode may turn off passes its own `__filename`. It cannot be
 * read off the process: a hook is started as `node -e "require(...)"`, which
 * leaves no script name behind. A hook that passes nothing is never skipped.
 */
function run(body, scriptPath) {
  try {
    if (scriptPath === undefined || !turnedOff(scriptPath)) body();
  } catch {
    // Deliberately silent, for the reason in the docblock above.
  }
  process.exit(0);
}

module.exports = {
  readPayload,
  deny,
  ask,
  warn,
  announce,
  rewrite,
  block,
  tell,
  configDir,
  evidenceDir,
  git,
  run,
};
