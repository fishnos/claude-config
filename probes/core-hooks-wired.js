"use strict";

// Are the hooks no mode may disable actually present in settings.json?
//
// CORE_HOOKS is a promise made in code. This checks the promise is kept on disk,
// which is the only place it matters.

const fs = require("fs");
const path = require("path");

const modes = require("../tools/modes/modes.js");

module.exports = {
  name: "core-hooks-wired",
  kind: "oracle",
  question: "Is every core hook actually wired into settings.json?",
  why: "CORE_HOOKS is what a mode is forbidden to remove. If one was never wired, the guarantee is nominal.",

  async run({ configDir }) {
    const configured = JSON.parse(
      fs.readFileSync(path.join(configDir, "settings.json"), "utf8"),
    );
    const wired = JSON.stringify(configured.hooks || {});
    const missing = modes.CORE_HOOKS.filter((hook) => !wired.includes(hook));

    return {
      pass: missing.length === 0,
      answer: `${modes.CORE_HOOKS.length - missing.length}/${modes.CORE_HOOKS.length} core hooks wired`,
      evidence:
        missing.length === 0
          ? `wired: ${modes.CORE_HOOKS.join(", ")}`
          : `missing: ${missing.join(", ")}`,
    };
  },
};
