"use strict";

// `ccfg mode` -- what posture is active, what the ten modes are, and what
// switching between two of them would change.
//
// Reading is separated from switching on purpose. `ccfg mode` with no argument
// must never have a side effect: the question "what am I in right now?" is
// asked most often when something has already gone wrong, and an answer that
// also changed the answer would be worse than no answer.

const fs = require("fs");
const path = require("path");

const settings = require("./settings.js");
const modes = require("./modes.js");
const rules = require("./rules.js");
const render = require("./render.js");
const banner = require("./banner.js");
const apply = require("./apply.js");
const glitch = require("./glitch.js");

const LOCK_NAME = "mode.lock";

function modesDir(configDir) {
  return path.join(configDir, "modes");
}

/** Every mode on disk, in filename order, with its parse error if it has one. */
function loadModes(configDir) {
  const directory = modesDir(configDir);
  let entries = [];
  try {
    entries = fs.readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  return entries.sort().map((entry) => {
    const file = path.join(directory, entry);
    let parsed;
    try {
      parsed = modes.parseMode(JSON.parse(fs.readFileSync(file, "utf8")), file);
    } catch (error) {
      parsed = { error: `${file}: ${error.message}` };
    }
    return { file, ...parsed };
  });
}

/**
 * A mode name that cannot leave modes/.
 *
 * The name arrives from the command line and is used to build a path, so
 * without this `ccfg mode ../../../etc/passwd` would be read off disk.
 */
function plainModeName(name) {
  return typeof name === "string" && /^[a-z0-9][a-z0-9-]*$/i.test(name);
}

/**
 * Find a mode by anything a person would reasonably type.
 *
 * `mode list` prints the codename in the first column, so the codename is what
 * someone types back -- `ccfg mode NETRUNNER`, not `ccfg mode research`. Only
 * the file name used to resolve, which meant the command answered its own
 * output with "unknown mode". Both work now, in any case.
 */
function loadMode(configDir, name) {
  if (!plainModeName(name)) return null;

  const file = path.join(modesDir(configDir), `${name}.json`);
  if (fs.existsSync(file)) {
    try {
      const parsed = modes.parseMode(
        JSON.parse(fs.readFileSync(file, "utf8")),
        file,
      );
      return parsed.error ? parsed : { file, ...parsed };
    } catch (error) {
      return { error: `${file}: ${error.message}` };
    }
  }

  const wanted = name.toLowerCase();
  for (const entry of loadModes(configDir)) {
    if (entry.error) continue;
    const codename = String(entry.codename || "").toLowerCase();
    if (String(entry.name).toLowerCase() === wanted || codename === wanted)
      return entry;
  }
  return null;
}

/** Every name that would have worked, for an error worth reading. */
function knownModeNames(configDir) {
  return loadModes(configDir)
    .filter((entry) => !entry.error)
    .map((entry) => `${entry.codename || entry.name} (${entry.name})`)
    .join(", ");
}

/**
 * The posture in force: whatever the lock recorded, or the defaults under the
 * name `(none)` when nothing has been switched to yet.
 *
 * Falling back rather than failing matters because every other command that
 * wants to know the posture calls this, and a missing lock is the ordinary
 * state of a fresh checkout, not an error.
 */
function activeMode(configDir) {
  const lock = path.join(configDir, LOCK_NAME);
  try {
    const recorded = JSON.parse(fs.readFileSync(lock, "utf8"));
    return {
      name: typeof recorded.mode === "string" ? recorded.mode : "(none)",
      codename:
        typeof recorded.codename === "string" ? recorded.codename : "(none)",
      settings: { ...settings.DEFAULTS, ...(recorded.settings || {}) },
      layers: Array.isArray(recorded.layers) ? recorded.layers : [],
      adhoc: recorded.adhoc || {},
    };
  } catch {
    return {
      name: "(none)",
      codename: "(none)",
      settings: { ...settings.DEFAULTS },
      layers: [],
      adhoc: {},
    };
  }
}

/**
 * Is the applied mode fully in force, or only half of it?
 *
 * A session freezes its skill list, model and effort at startup. Switching
 * afterwards re-orders the rules and re-gates the tools immediately, but cannot
 * touch the frozen half -- so the banner can say NETRUNNER while forty skills
 * the mode meant to hide are still loaded. Comparing the fingerprint the lock
 * carries against the one the session recorded is what makes that visible.
 *
 * Returns "clean", "corrupted", or "unknown" when no session recorded itself.
 */
function integrity(configDir, sessionId) {
  const lock = apply.readLock(configDir);
  if (lock === null) return { state: "clean", stale: [] };

  const directory = path.join(configDir, "cache", "mode-session");
  let sessions = [];
  try {
    sessions = fs
      .readdirSync(directory)
      .map((name) => path.join(directory, name))
      .map((file) => ({ file, at: fs.statSync(file).mtimeMs }))
      .sort((left, right) => right.at - left.at);
  } catch {
    return { state: "unknown", stale: [] };
  }

  // Each chat is its own session with its own startup snapshot, so the answer
  // is only ever this session's marker. Falling back to the newest marker made
  // one chat report another's state: open a second chat after a switch and the
  // first one, genuinely half-applied, went quiet because the newer marker
  // matched the lock. "I do not know" is the honest answer for a session that
  // never recorded one.
  const chosen =
    sessionId === undefined || sessionId === null || sessionId === ""
      ? sessions[0]
      : sessions.find((entry) => path.basename(entry.file) === sessionId);
  if (chosen === undefined) return { state: "unknown", stale: [] };

  let recorded;
  try {
    recorded = JSON.parse(fs.readFileSync(chosen.file, "utf8"));
  } catch {
    return { state: "unknown", stale: [] };
  }

  if (recorded.hardHash === (lock.hardHash || null))
    return { state: "clean", stale: [] };

  return {
    state: "corrupted",
    stale: glitch.HARD_FIELDS,
    loadedMode: recorded.mode,
  };
}

function bandCounts(configDir, resolvedSettings) {
  const corpus = rules.loadCorpus(path.join(modesDir(configDir), "rules"));
  const { primary, standing } = render.band(corpus.rules, resolvedSettings);
  return { primary: primary.length, standing: standing.length };
}

function commandShow(io) {
  const active = activeMode(io.CONFIG_DIR);
  const counts = bandCounts(io.CONFIG_DIR, active.settings);

  console.log("\n  " + io.bold(active.codename || active.name));
  for (const name of Object.keys(settings.SETTINGS)) {
    const overridden = Object.prototype.hasOwnProperty.call(active.adhoc, name);
    console.log(
      `    ${name.padEnd(11)}${active.settings[name]}` +
        (overridden ? io.dim("   (ad-hoc)") : ""),
    );
  }
  const health = integrity(io.CONFIG_DIR, process.env.CLAUDE_SESSION_ID);
  if (health.state === "corrupted") {
    console.log(
      "\n    " +
        io.yellow("CORRUPTED") +
        io.dim(
          `  rules and tools are live; ${health.stale.join(", ")} still from ` +
            `${health.loadedMode || "the session start"}`,
        ),
    );
    console.log(io.dim("    start a new session to finish the swap"));
  }
  console.log(
    io.dim(
      `\n    rules      ${counts.primary} primary, ${counts.standing} standing (none dropped)`,
    ),
  );
  if (active.layers.length > 0)
    console.log(io.dim(`    layers     ${active.layers.join(" < ")}`));
  console.log("");
}

function commandList(io) {
  console.log("");
  for (const mode of loadModes(io.CONFIG_DIR)) {
    if (mode.error) {
      console.log(`  ${io.yellow(path.basename(mode.file))}  ${mode.error}`);
      continue;
    }
    const gates = [
      mode.glitch.tools.length > 0 ? `${mode.glitch.tools.length} tools gated` : null,
      mode.glitch.skills !== null ? "skills gated" : null,
      mode.glitch.subagents === "none" ? "solo" : null,
      (mode.glitch.commands || []).length > 0
        ? (mode.glitch.commands || []).map((name) => `/${name}`).join(" ")
        : null,
    ].filter(Boolean);
    console.log(
      `  ${io.bold(mode.codename.padEnd(11))}${io.dim(mode.name.padEnd(12))}${mode.description}` +
        (gates.length > 0 ? io.dim(`  [${gates.join(", ")}]`) : ""),
    );
  }
  console.log("");
}

function commandDiff(argv, io) {
  const [fromName, toName] = argv.filter((word) => !word.startsWith("--"));
  if (fromName === undefined || toName === undefined) {
    console.error("usage: ccfg mode diff <from> <to>");
    process.exit(2);
  }

  const from = loadMode(io.CONFIG_DIR, fromName);
  const to = loadMode(io.CONFIG_DIR, toName);
  for (const [name, mode] of [
    [fromName, from],
    [toName, to],
  ]) {
    if (mode === null) {
      console.error(`unknown mode: ${name}`);
      console.error(`try one of: ${knownModeNames(io.CONFIG_DIR)}`);
      process.exit(2);
    }
    if (mode.error) {
      console.error(mode.error);
      process.exit(2);
    }
  }

  const fromSettings = { ...settings.DEFAULTS, ...from.settings };
  const toSettings = { ...settings.DEFAULTS, ...to.settings };

  console.log(
    banner.renderBanner({
      from: from.codename || from.name,
      to: to.codename || to.name,
      fromSettings,
      toSettings,
      ruleCounts: bandCounts(io.CONFIG_DIR, toSettings),
      hooks: { core: modes.CORE_HOOKS, disabled: to.disableHooks },
      projects: to.projects,
      icon: to.icon,
      color: to.color,
      plain: argv.includes("--plain") || !process.stdout.isTTY,
    }),
  );
}

function commandMode(argv, io) {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || subcommand === "show") return commandShow(io);
  if (subcommand === "list") return commandList(io);
  if (subcommand === "diff") return commandDiff(rest, io);

  if (subcommand === "revert") return commandRevert(io);

  const target = loadMode(io.CONFIG_DIR, subcommand);
  if (target !== null) return commandSwitch(target, rest, io);

  console.error(`unknown mode: ${subcommand}`);
  console.error(`try one of: ${knownModeNames(io.CONFIG_DIR)}`);
  process.exit(2);
}

function commandSwitch(target, argv, io) {
  if (target.error) {
    console.error(target.error);
    process.exit(2);
  }

  const before = activeMode(io.CONFIG_DIR);
  const corpus = rules.loadCorpus(path.join(modesDir(io.CONFIG_DIR), "rules"));
  if (corpus.errors.length > 0) {
    for (const problem of corpus.errors) console.error(problem);
    process.exit(2);
  }

  let applied;
  try {
    applied = apply.applyMode(io.CONFIG_DIR, target, corpus.rules, before.adhoc);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  console.log(
    banner.renderBanner({
      from: before.codename || before.name,
      to: target.codename || target.name,
      fromSettings: before.settings,
      toSettings: applied.lock.settings,
      ruleCounts: bandCounts(io.CONFIG_DIR, applied.lock.settings),
      hooks: { core: modes.CORE_HOOKS, disabled: target.disableHooks },
      projects: target.projects,
      icon: target.icon,
      color: target.color,
      plain: argv.includes("--plain") || !process.stdout.isTTY,
    }),
  );
}

function commandRevert(io) {
  const lock = apply.readLock(io.CONFIG_DIR);
  if (!apply.revert(io.CONFIG_DIR)) {
    console.error("no mode is applied");
    process.exit(2);
  }
  io.ok(`reverted ${lock.mode}; settings restored and rules re-rendered`);
}

module.exports = { commandMode, activeMode, loadModes, loadMode, integrity };
