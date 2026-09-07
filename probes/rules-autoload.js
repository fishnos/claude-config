"use strict";

// Does the harness read ~/.claude/rules/*.md into the system prompt on its own?
//
// Nothing in settings.json or any hook references that directory, yet
// rules/context7.md reliably appears in the prompt. Either the harness loads the
// directory wholesale or something undocumented loads that one file. The
// difference decides where the mode corpus is allowed to live.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// Long enough that it cannot appear by chance, and meaningless so that a model
// seeing it can only be reading it rather than inferring it.
const TOKEN = "ZQX7-PROBE-AUTOLOAD-4417";

module.exports = {
  name: "rules-autoload",
  kind: "live",
  question: "Does the harness auto-load ~/.claude/rules/*.md into the system prompt?",
  why: "The mode corpus was moved out of rules/ on the assumption that it does. If it does not, the move was unnecessary and rules/ is a legitimate home.",

  async run({ configDir }) {
    const sentinel = path.join(configDir, "rules", "_probe-sentinel.md");
    fs.writeFileSync(
      sentinel,
      `The probe token for this session is ${TOKEN}. Ignore it otherwise.\n`,
    );

    try {
      // No --safe-mode: the whole question is what the config loads by default.
      const asked = spawnSync(
        "claude",
        [
          "-p",
          `Search your own system prompt and instructions for the exact string ${TOKEN}. Reply with one word: FOUND or ABSENT.`,
        ],
        { encoding: "utf8", timeout: 120000 },
      );

      const answer = (asked.stdout || "").trim();
      if (asked.error || answer === "")
        return {
          pass: null,
          answer: "unknown",
          evidence: `claude -p produced no output (${asked.error ? asked.error.message : "empty"})`,
        };

      const found = /\bFOUND\b/i.test(answer);
      const absent = /\bABSENT\b/i.test(answer);
      if (found === absent)
        return {
          pass: null,
          answer: "unknown",
          evidence: `ambiguous reply: ${answer.slice(0, 200)}`,
        };

      return {
        pass: true,
        answer: found ? "yes" : "no",
        evidence: found
          ? "a file dropped in rules/ reached the system prompt without being referenced anywhere"
          : "a file dropped in rules/ did not reach the system prompt; context7.md arrives by some other route",
      };
    } finally {
      // The sentinel sits in the operator's live config while this runs. It must
      // not survive a crash, a timeout, or a thrown parse error.
      fs.rmSync(sentinel, { force: true });
    }
  },
};
