#!/usr/bin/env node
// Cross-platform "attention" notification for Claude Code's Notification hook.
// Runs identically on macOS, Windows, and any Linux/BSD distro. Every external
// call is best-effort: a missing notifier or sound player degrades silently
// instead of erroring, so the same tracked config works on every machine.

const { spawn, spawnSync } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");

const title = "Claude Code";
const message = "Claude Code needs your attention";

// Fire-and-forget: launch a detached process, swallow "binary not found".
function fireAndForget(command, commandArguments) {
  try {
    const child = spawn(command, commandArguments, {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {}); // e.g. ENOENT when the binary is absent
    child.unref();
  } catch {
    /* ignore */
  }
}

// Synchronously test whether a binary is on PATH, cross-platform.
function isAvailable(binary) {
  const probe =
    process.platform === "win32"
      ? spawnSync("where", [binary], { stdio: "ignore" })
      : spawnSync("sh", ["-c", `command -v ${binary}`], { stdio: "ignore" });
  return probe.status === 0;
}

// Return the first installed binary from a preference-ordered list, or null.
function firstAvailable(candidates) {
  return candidates.find(isAvailable) || null;
}

const customSound = path.join(os.homedir(), "Downloads", "sea-bunny.mp3");
const hasCustomSound = fs.existsSync(customSound);

if (process.platform === "darwin") {
  fireAndForget("osascript", [
    "-e",
    `display notification "${message}" with title "${title}"`,
  ]);
  if (hasCustomSound) fireAndForget("afplay", [customSound]);
  else fireAndForget("afplay", ["/System/Library/Sounds/Glass.aiff"]);
} else if (process.platform === "win32") {
  // Balloon-tip notification via PowerShell, plus an audible beep.
  const powershellScript = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "Add-Type -AssemblyName System.Drawing;",
    "$notifyIcon = New-Object System.Windows.Forms.NotifyIcon;",
    "$notifyIcon.Icon = [System.Drawing.SystemIcons]::Information;",
    `$notifyIcon.BalloonTipTitle = ${JSON.stringify(title)};`,
    `$notifyIcon.BalloonTipText = ${JSON.stringify(message)};`,
    "$notifyIcon.Visible = $true;",
    "$notifyIcon.ShowBalloonTip(5000);",
    "Start-Sleep -Milliseconds 6000;",
    "$notifyIcon.Dispose();",
    "[console]::beep(880,300)",
  ].join(" ");
  fireAndForget("powershell", [
    "-NoProfile",
    "-WindowStyle",
    "Hidden",
    "-Command",
    powershellScript,
  ]);
} else {
  // Linux / *BSD desktop. Notification and sound are independent best-efforts.
  if (isAvailable("notify-send")) {
    fireAndForget("notify-send", ["-a", title, title, message]);
  }
  if (hasCustomSound) {
    const player = firstAvailable(["mpv", "ffplay", "paplay", "pw-play"]);
    if (player === "mpv")
      fireAndForget("mpv", ["--no-video", "--really-quiet", customSound]);
    else if (player === "ffplay")
      fireAndForget("ffplay", [
        "-nodisp",
        "-autoexit",
        "-loglevel",
        "quiet",
        customSound,
      ]);
    else if (player) fireAndForget(player, [customSound]);
  } else if (isAvailable("canberra-gtk-play")) {
    fireAndForget("canberra-gtk-play", ["-i", "message"]);
  }
}
