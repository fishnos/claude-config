"use strict";

// Is the mode system actually connected to anything?
//
// Every piece can be present and correct while the configuration references
// none of it. That failure is silent in the worst way: `ccfg mode` prints a
// banner, writes the lock, and reports success, while no hook reads the lock.
// Tools are then not gated, a mid-session switch never reaches the model, and
// the status line shows nothing. Everything looks like it worked.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

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

    // A file the mode system needs can sit on disk, pass every test, and still
    // be invisible to git, which is exactly what an unanchored `debug/` in
    // .gitignore did to modes/commands/debug/. Nothing looks wrong until a
    // clone tries to apply the mode and finds the file was never committed.
    for (const directory of ["modes", "probes", "tools/modes", "tools/probe"]) {
      const full = path.join(configDir, directory);
      if (!fs.existsSync(full)) continue;
      let untracked = "";
      try {
        untracked = execFileSync(
          "git",
          ["ls-files", "--others", "--ignored", "--exclude-standard", "--", directory],
          { cwd: configDir, encoding: "utf8" },
        ).trim();
      } catch {
        continue; // Not a git checkout; nothing to verify.
      }
      for (const file of untracked.split("\n").filter(Boolean))
        missing.push(`${file} is on disk but git ignores it`);
    }

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
