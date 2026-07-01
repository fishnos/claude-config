#!/usr/bin/env node
// Cross-platform PostToolUse formatter for Claude Code (Edit|Write).
// Replaces the POSIX-only `jq ... | xargs npx prettier` pipeline so the same
// tracked config formats edited files on Windows, macOS, and Linux. Reads the
// hook payload from stdin, extracts the edited file path, and runs Prettier.
// If Node/Prettier/npx is unavailable, it no-ops instead of failing the hook.

const { spawn } = require("child_process");

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
    return; // malformed payload — nothing to format
  }
  if (!filePath) return;

  // On Windows the npm shim is `npx.cmd`; `spawn` needs the exact name.
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawn(npx, ["prettier", "--write", filePath], {
    stdio: "ignore",
  });
  child.on("error", () => {}); // npx/prettier absent → silently skip
});
