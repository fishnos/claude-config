"use strict";

// SessionStart: catch config drift before it costs a session.
//
// Deliberately cheap -- file existence and JSON parsing only, no subprocesses.
// The thorough version is `ccfg validate`, which runs the whole hook
// suite and is far too slow to sit in front of every session.

const fs = require("fs");
const os = require("os");
const path = require("path");
const io = require("./lib/hook-io");

const EVENT = "SessionStart";
const PLACEHOLDER = /^\$\{[A-Z0-9_]+\}$/;

/** Hook scripts named inside settings.json, however the bootstrap spells them. */
function referencedHooks(settings) {
  const commands = Object.values(settings.hooks || {})
    .flat()
    .flatMap((group) => group.hooks || [])
    .map((hook) => hook.command || "");
  const names = new Set();
  for (const command of commands) {
    const match = /'([\w.-]+\.js)'/.exec(command);
    if (match) names.add(match[1]);
  }
  return [...names];
}

/** MCP secrets sitting in ~/.claude.json as literal values rather than ${VAR}. */
function plaintextSecrets() {
  let config;
  try {
    config = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8"),
    );
  } catch {
    return [];
  }
  const exposed = [];
  for (const [name, server] of Object.entries(config.mcpServers || {})) {
    for (const container of [server.headers, server.env]) {
      for (const [key, value] of Object.entries(container || {})) {
        if (typeof value !== "string" || value.length < 16) continue;
        if (PLACEHOLDER.test(value)) continue;
        if (!/(key|token|secret|password)/i.test(key)) continue;
        exposed.push(`${name}.${key}`);
      }
    }
  }
  return exposed;
}

io.run(() => {
  const root = io.configDir();
  const problems = [];

  let settings = null;
  try {
    settings = JSON.parse(
      fs.readFileSync(path.join(root, "settings.json"), "utf8"),
    );
  } catch (error) {
    io.warn(
      EVENT,
      `settings.json does not parse (${error.message}). Hooks and permissions are ` +
        `not in effect until it does. Restore from ~/.claude/backups/.`,
    );
    return;
  }

  for (const name of referencedHooks(settings)) {
    if (!fs.existsSync(path.join(root, "hooks", name)))
      problems.push(
        `settings.json references hooks/${name}, which does not exist`,
      );
  }

  const exposed = plaintextSecrets();
  if (exposed.length > 0)
    problems.push(
      `plaintext MCP credentials in ~/.claude.json: ${exposed.join(", ")}. ` +
        `Rotate them, then run \`ccfg keys migrate\`.`,
    );

  if (problems.length === 0) return;
  io.warn(
    EVENT,
    "Config problems detected:\n" + problems.map((p) => "- " + p).join("\n"),
  );
});
