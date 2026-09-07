"use strict";

// Is the mode system actually connected to anything?
//
// Every piece can be present and correct while the configuration references
// none of it. That failure is silent in the worst way: `ccfg mode` prints a
// banner, writes the lock, and reports success, while no hook reads it -- so
// tools are not gated, a mid-session switch never reaches the model, and the
// status line shows nothing. Everything looks like it worked.

const fs = require("fs");
const path = require("path");

const WIRING = [
  ["PreToolUse", "mode-guard.js", "tool and subagent gating"],
  ["SessionStart", "mode-session.js", "recording the loaded posture"],
  ["UserPromptSubmit", "mode-inject.js", "carrying a switch mid-session"],
];

module.exports = {
  name: "mode-wiring",
  kind: "oracle",
  question: "Is every part of the mode system connected to the configuration?",
  why: "A disconnected mode system still prints its banner and writes its lock. Nothing about a switch looks wrong until you notice no rule was ever enforced.",

  async run({ configDir }) {
    const settings = JSON.parse(
      fs.readFileSync(path.join(configDir, "settings.json"), "utf8"),
    );
    const hooks = settings.hooks || {};
    const missing = [];

    for (const [event, file, purpose] of WIRING) {
      if (!fs.existsSync(path.join(configDir, "hooks", file))) {
        missing.push(`${file} does not exist (${purpose})`);
        continue;
      }
      if (!JSON.stringify(hooks[event] || []).includes(file))
        missing.push(`${file} is not wired to ${event} (${purpose})`);
    }

    const statusLine = JSON.stringify(settings.statusLine || {});
    if (!statusLine.includes("statusline.js") && !statusLine.includes("mode-status"))
      missing.push("no status line shows the active mode");

    return {
      pass: missing.length === 0,
      answer:
        missing.length === 0
          ? "every hook and the status line are wired"
          : `${missing.length} parts not connected`,
      evidence: missing.length === 0 ? "the mode system is live" : missing.join("\n       "),
    };
  },
};
