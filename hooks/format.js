#!/usr/bin/env node
// Cross-platform PostToolUse formatter for Claude Code (Edit|Write).
// Replaces the POSIX-only `jq ... | xargs npx prettier` pipeline so the same
// tracked config formats edited files on Windows, macOS, and Linux. Reads the
// hook payload from stdin, extracts the edited file path, and runs Prettier.
// If Node/Prettier/npx is unavailable, it no-ops instead of failing the hook.

const { spawn } = require("child_process");
const path = require("path");
const prettierCommand = require("./lib/prettier-command");
const { isForeignRepository } = require("./lib/repository-trust");

let payload = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  payload += chunk;
});
process.stdin.on("end", () => {
  let filePath;
  try {
    filePath = JSON.parse(payload)?.tool_input?.file_path;
  } catch {
    return; // malformed payload, nothing to format
  }
  if (!filePath) return;
  // Prettier loads the config beside the file, and that config can be code.
  // Nobody is at hand to ask after an edit, so a clone of someone else's
  // repository is left unformatted.
  if (isForeignRepository(path.dirname(path.resolve(filePath)))) return;

  const { command, args } = prettierCommand(filePath);
  const child = spawn(command, args, { stdio: "ignore" });
  child.on("error", () => {}); // npx/prettier absent → silently skip
});
