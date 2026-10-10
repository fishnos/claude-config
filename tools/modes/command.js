"use strict";

// `ccfg mode`: what posture is active, what the eleven modes are, and what
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
const ink = require("./ink.js");
const roles = require("./roles.js");
const crew = require("./crew.js");
const targets = require("./target.js");
const modeLock = require("../../hooks/lib/mode-lock.js");

const LOCK_NAME = "mode.lock";
const CODENAME_COLUMN = 11;
const NAME_COLUMN = 12;
const DIAL_COLUMN = 11;
const GAUGE_COLUMN = 7;
const VALUE_COLUMN = 11;
const ROLE_COLUMN = 14;

/**
 * Whether to strip colour, answered the same way for every mode surface.
 *
 * A pipe is the default answer, and the `/mode` slash command runs `ccfg mode`
 * into a pipe rather than a terminal, so without `--color` the paint is only
 * ever seen from a bare shell.
 */
function isPlain(argv) {
  if (argv.includes("--color")) return false;
  if (argv.includes("--plain")) return true;
  return Boolean(process.env.NO_COLOR) || !process.stdout.isTTY;
}

/** What a mode takes away, in the words the banner and the rack both use. */
function gatesOf({ tools = [], skills, subagents, commands = [] }) {
  return [
    tools.length > 0
      ? `${tools.length} tool${tools.length === 1 ? "" : "s"} gated`
      : null,
    // A mode file names which skills to hide; the lock knows how many that
    // turned out to be. Both arrive here, and the count is worth saying.
    skills === null || skills === undefined
      ? null
      : typeof skills === "number"
        ? `${skills} skill${skills === 1 ? "" : "s"} hidden`
        : "skills gated",
    subagents === "none" ? "solo" : null,
    commands.length > 0 ? commands.map((name) => `/${name}`).join(" ") : null,
  ].filter(Boolean);
}

function modesDir(configDir) {
  return path.join(configDir, "modes");
}

/** Every mode on disk, in filename order, with its parse error if it has one. */
function loadModes(configDir) {
  const directory = modesDir(configDir);
  let entries = [];
  try {
    entries = fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(".json"));
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
 * someone types back: `ccfg mode NETRUNNER`, not `ccfg mode research`. Only
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

/**
 * How the active mode looks: its glyph and its colour.
 *
 * The mode file wins over the lock. The lock carries both, so a surface that
 * cannot reach the mode file still draws something. But the lock is a cache
 * written at the last switch, and editing a mode's glyph should show up on
 * the status line now rather than after the next switch.
 */
function activeLook(configDir, lock) {
  const cached = {
    icon: lock !== null && lock !== undefined && lock.icon ? lock.icon : "\u25a0",
    color:
      lock !== null && lock !== undefined && typeof lock.color === "number"
        ? lock.color
        : null,
  };
  if (lock === null || lock === undefined) return cached;

  const mode = loadMode(configDir, lock.mode);
  if (mode === null || mode.error) return cached;
  return {
    icon: mode.icon || cached.icon,
    color: mode.color === null ? cached.color : mode.color,
  };
}

/** Every name that would have worked, for an error worth reading. */
function knownModeNames(configDir) {
  return loadModes(configDir)
    .filter((entry) => !entry.error)
    .map((entry) => `${entry.codename || entry.name} (${entry.name})`)
    .join(", ");
}

/** A record, or the lack of one, in the shape every mode surface draws from. */
function describeRecord(recorded) {
  if (recorded === null)
    return {
      name: "(none)",
      codename: "(none)",
      settings: { ...settings.DEFAULTS },
      layers: [],
      adhoc: {},
    };
  return {
    name: typeof recorded.mode === "string" ? recorded.mode : "(none)",
    codename:
      typeof recorded.codename === "string" ? recorded.codename : "(none)",
    settings: { ...settings.DEFAULTS, ...(recorded.settings || {}) },
    layers: Array.isArray(recorded.layers) ? recorded.layers : [],
    adhoc: recorded.adhoc || {},
  };
}

/**
 * The posture in force for a working directory: its repository's own mode,
 * else the machine's, else the defaults under the name `(none)`.
 *
 * Falling back rather than failing matters because every other command that
 * wants to know the posture calls this, and a missing record is the ordinary
 * state of a fresh checkout, not an error.
 */
function activeMode(configDir, workingDirectory = process.cwd()) {
  const resolution = modeLock.resolveLock(configDir, workingDirectory);
  return {
    ...describeRecord(resolution.lock),
    scope: resolution.scope,
    root: resolution.root,
  };
}

/**
 * Is the applied mode fully in force, or only half of it?
 *
 * A session freezes its skill list, model and effort at startup. Switching
 * afterwards re-orders the rules and re-gates the tools immediately, but cannot
 * touch the frozen half, so the banner can say NETRUNNER while forty skills
 * the mode meant to hide are still loaded. Comparing the fingerprint the lock
 * carries against the one the session recorded is what makes that visible.
 *
 * The record compared is the one in force for the session's own repository, so
 * a machine switch does not mark a session whose repository has its own mode.
 *
 * Returns "clean", "corrupted", or "unknown" when no session recorded itself.
 */
function integrity(configDir, sessionId, workingDirectory = process.cwd()) {
  const lock = modeLock.resolveLock(configDir, workingDirectory).lock;
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

/**
 * Which record answered, in words. Printed on the status view and after a
 * switch, because the two scopes look identical otherwise and the mistake it
 * prevents (believing a repository switch changed the machine) is silent.
 */
function scopeLine(configDir, resolution) {
  if (resolution.scope === "repo") {
    const machine = apply.readLock(configDir);
    return (
      `this repository only (${resolution.root}); machine default is ` +
      (machine === null ? "none" : machine.codename || machine.mode)
    );
  }
  if (resolution.root === null) return "machine default";
  return "machine default (this repository has no mode of its own)";
}

/**
 * The one-screen answer to "what am I in right now?".
 *
 * Each dial is drawn with a bar showing where its value sits on its own scale,
 * because the dials are what a mode *is* and a column of bare words gives the
 * eye nothing to compare. `voice` gets no bar: its three values are registers
 * with no ladder between them, and a bar would invent a ranking.
 */
function commandShow(argv, io) {
  const resolution = modeLock.resolveLock(io.CONFIG_DIR, process.cwd());
  const active = describeRecord(resolution.lock);
  const lock = resolution.lock;
  const file = lock === null ? null : loadMode(io.CONFIG_DIR, lock.mode);
  const look = activeLook(io.CONFIG_DIR, lock);
  const paint = ink.painter(isPlain(argv), look.color);
  const counts = bandCounts(io.CONFIG_DIR, active.settings);
  const health = integrity(io.CONFIG_DIR, process.env.CLAUDE_SESSION_ID);

  const state =
    health.state === "corrupted"
      ? paint.yellow("[CORRUPTED]")
      : health.state === "unknown"
        ? paint.dim("[UNKNOWN]")
        : paint.green("[CLEAN]");
  const icon = lock === null ? "" : `${look.icon} `;

  console.log("");
  console.log(
    ink.frame({
      title: "ACTIVE CARTRIDGE",
      rows: [
        {
          left: paint.bold(
            paint.accent(icon + (active.codename || active.name)),
          ),
          right: state,
        },
      ],
      ink: paint,
    }),
  );
  // What this posture is for, in the mode file's own words. The dials below say
  // how it behaves; without this line they never say why.
  if (file !== null && !file.error && file.description)
    console.log(paint.dim(`    ${file.description}`));
  console.log("");

  for (const name of Object.keys(settings.SETTINGS)) {
    const dial = settings.SETTINGS[name];
    const value = active.settings[name];
    const bar = dial.categorical ? "" : ink.gauge(dial.values, value, paint);
    const overridden = Object.prototype.hasOwnProperty.call(active.adhoc, name);
    // The question the dial answers, printed beside it. It has been sitting in
    // settings.js unread since the dials existed, and without it a reader who
    // was not here when the dial was named has to guess what `claims` governs.
    console.log(
      "    " +
        name.padEnd(DIAL_COLUMN) +
        ink.pad(bar, GAUGE_COLUMN) +
        ink.pad(value, VALUE_COLUMN) +
        paint.dim(dial.question) +
        (dial.categorical ? paint.dim("  (a register, not a level)") : "") +
        (overridden ? paint.dim("  (ad-hoc)") : ""),
    );
  }

  console.log(
    paint.dim(
      `\n    rules      ${counts.primary} primary, ${counts.standing} standing (none dropped)`,
    ),
  );
  console.log(paint.dim(`    scope      ${scopeLine(io.CONFIG_DIR, resolution)}`));
  const gates =
    lock === null
      ? []
      : gatesOf({
          tools: lock.deniedTools || [],
          skills: lock.skillsHidden > 0 ? lock.skillsHidden : null,
          subagents: lock.subagents,
          commands: lock.installedCommands || [],
        });
  if (gates.length > 0)
    console.log(paint.dim(`    gates      ${gates.join(", ")}`));
  if (active.layers.length > 0)
    console.log(paint.dim(`    layers     ${active.layers.join(" < ")}`));

  if (health.state === "corrupted") {
    console.log("");
    console.log(
      "    " +
        paint.yellow(">>") +
        paint.dim(
          ` rules and tools are live; ${health.stale.join(", ")} still from ` +
            `${health.loadedMode || "the session start"}`,
        ),
    );
    console.log(
      "    " +
        paint.yellow(">>") +
        paint.dim(" start a new session to finish the swap"),
    );
  }
  console.log("");
}

/**
 * Every cartridge on the shelf, the loaded one marked.
 *
 * Each row is painted in its own mode's hue rather than one colour for the
 * whole list, because the hue is half of how a mode is recognised on the
 * switch banner, the status line and the notice at session start.
 */
function commandList(argv, io) {
  if (argv.includes("--repos")) return commandListRepos(io);
  const plain = isPlain(argv);
  const active = activeMode(io.CONFIG_DIR);
  const all = loadModes(io.CONFIG_DIR);
  const loaded = all.find((mode) => !mode.error && mode.name === active.name);
  const chrome = ink.painter(plain, loaded === undefined ? null : loaded.color);

  console.log("");
  console.log(
    ink.frame({
      title: "CARTRIDGE RACK",
      rows: [
        {
          left: `${all.length} SLOTS`,
          right:
            loaded === undefined
              ? chrome.dim("NONE LOADED")
              : chrome.accent(`${loaded.icon} ${loaded.codename} LOADED`),
        },
      ],
      ink: chrome,
    }),
  );
  console.log("");

  for (const mode of all) {
    if (mode.error) {
      console.log(`  ${io.yellow(path.basename(mode.file))}  ${mode.error}`);
      continue;
    }
    const paint = ink.painter(plain, mode.color);
    const gates = gatesOf(mode.glitch);
    console.log(
      (mode === loaded ? paint.accent("  > ") : "    ") +
        paint.accent(mode.icon) +
        " " +
        paint.bold(paint.accent(mode.codename.padEnd(CODENAME_COLUMN))) +
        paint.dim(mode.name.padEnd(NAME_COLUMN)) +
        mode.description +
        (gates.length > 0 ? paint.dim(`  [${gates.join(", ")}]`) : ""),
    );
  }
  console.log("");
}

/**
 * Every repository with a mode of its own.
 *
 * A record outlives its repository when the directory is moved or deleted,
 * and nothing removes it. It is listed and marked, so it can be removed by
 * hand.
 */
function commandListRepos(io) {
  const directory = path.join(modesDir(io.CONFIG_DIR), "repos");
  let keys = [];
  try {
    keys = fs.readdirSync(directory).sort();
  } catch {
    keys = [];
  }
  const records = keys
    .map((key) => {
      try {
        return {
          key,
          ...JSON.parse(
            fs.readFileSync(path.join(directory, key, LOCK_NAME), "utf8"),
          ),
        };
      } catch {
        return null;
      }
    })
    .filter((record) => record !== null && typeof record.root === "string");

  if (records.length === 0) {
    console.log("no repository has a mode of its own");
    return;
  }
  console.log("");
  for (const record of records)
    console.log(
      "    " +
        String(record.codename || record.mode).padEnd(CODENAME_COLUMN) +
        String(record.mode).padEnd(NAME_COLUMN) +
        record.root +
        (fs.existsSync(record.root)
          ? ""
          : `  (directory is gone; remove modes/repos/${record.key} by hand)`),
    );
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
      // The file name, because that is what the closing line tells the operator
      // to type to actually load it.
      toName: to.name,
      fromSettings,
      toSettings,
      ruleCounts: bandCounts(io.CONFIG_DIR, toSettings),
      hooks: { core: modes.CORE_HOOKS, disabled: to.disableHooks },
      projects: to.projects,
      icon: to.icon,
      fromIcon: from.icon,
      color: to.color,
      plain: isPlain(argv),
      applied: false,
    }),
  );
}

function commandMode(argv, io) {
  // Flags are stripped before the first word is read as a subcommand, or
  // `ccfg mode --color` would go looking for a mode called "--color".
  const [subcommand] = argv.filter((word) => !word.startsWith("--"));
  const rest =
    subcommand === undefined ? argv : argv.slice(argv.indexOf(subcommand) + 1);
  // Read from the whole argument list: `rest` holds only what follows the
  // subcommand, and `ccfg mode --global spike` has to work too.
  const machineWide = argv.includes("--global");

  if (subcommand === undefined || subcommand === "show")
    return commandShow(argv, io);
  if (subcommand === "list") return commandList(argv, io);
  if (subcommand === "diff") return commandDiff(rest, io);

  if (subcommand === "revert") return commandRevert(io, machineWide);

  const target = loadMode(io.CONFIG_DIR, subcommand);
  if (target !== null) return commandSwitch(target, rest, io, machineWide);

  console.error(`unknown mode: ${subcommand}`);
  console.error(`try one of: ${knownModeNames(io.CONFIG_DIR)}`);
  process.exit(2);
}

function commandSwitch(target, argv, io, machineWide) {
  if (target.error) {
    console.error(target.error);
    process.exit(2);
  }

  // Inside a repository a switch changes that repository and nothing else.
  // Outside one, or with --global, it sets the machine default.
  const root = machineWide ? null : modeLock.repositoryRoot(process.cwd());
  const destination =
    root === null
      ? targets.machineTarget(io.CONFIG_DIR)
      : targets.repoTarget(io.CONFIG_DIR, root);

  // Read before the switch rewrites the record. Read after, it would be the
  // arriving mode's glyph shown on both sides of the arrow. Inside a
  // repository the mode being left is whichever was in force there, which is
  // the machine's when the repository had none of its own.
  const leavingLock =
    root === null
      ? apply.readLock(io.CONFIG_DIR)
      : modeLock.resolveLock(io.CONFIG_DIR, root).lock;
  const before = describeRecord(leavingLock);
  const leavingIcon =
    leavingLock === null ? "" : activeLook(io.CONFIG_DIR, leavingLock).icon;
  // Ad-hoc dial changes belong to the record being replaced, so a
  // repository's first switch does not inherit the machine's.
  const ownRecord =
    root === null
      ? leavingLock
      : modeLock.resolveLock(io.CONFIG_DIR, root).scope === "repo"
        ? leavingLock
        : null;
  const corpus = rules.loadCorpus(path.join(modesDir(io.CONFIG_DIR), "rules"));
  if (corpus.errors.length > 0) {
    for (const problem of corpus.errors) console.error(problem);
    process.exit(2);
  }

  let applied;
  try {
    applied = apply.applyMode(
      io.CONFIG_DIR,
      target,
      corpus.rules,
      (ownRecord && ownRecord.adhoc) || {},
      destination,
    );
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
      fromIcon: leavingIcon,
      color: target.color,
      plain: isPlain(argv),
    }),
  );
  console.log(
    root === null
      ? "    scope      machine default"
      : `    scope      this repository only (${root}); new sessions here pick up its skills and effort`,
  );
}

function commandRevert(io, machineWide) {
  const root = machineWide ? null : modeLock.repositoryRoot(process.cwd());

  if (root !== null) {
    const resolution = modeLock.resolveLock(io.CONFIG_DIR, root);
    // Taking the machine mode off from inside a repository by accident is the
    // same leak in the other direction, so it has to be asked for by name.
    if (resolution.scope !== "repo") {
      console.error(
        "this repository has no mode of its own, so nothing was changed. " +
          "`ccfg mode revert --global` takes the machine mode off",
      );
      process.exit(2);
    }
    // Collected and printed beside the outcome, so a revert that left a
    // linked path alone is never read as one that took everything back.
    const skipped = [];
    apply.revert(
      io.CONFIG_DIR,
      targets.repoTarget(io.CONFIG_DIR, root),
      (message) => skipped.push(message),
    );
    for (const message of skipped) io.warn(message);
    const left =
      skipped.length === 0
        ? ""
        : `; ${skipped.length} path${skipped.length === 1 ? "" : "s"} left ` +
          `as found, named above`;
    io.ok(
      `reverted ${resolution.lock.mode} for this repository (${root}); ` +
        `it follows the machine mode again${left}`,
    );
    return;
  }

  const lock = apply.readLock(io.CONFIG_DIR);
  if (!apply.revert(io.CONFIG_DIR)) {
    console.error("no mode is applied");
    process.exit(2);
  }
  io.ok(`reverted ${lock.mode}; settings restored and rules re-rendered`);
}

/**
 * `ccfg crew`: each worker the mode in force puts to work, the tools its agent
 * file allows and the gates its finish must pass.
 *
 * The mode in force is the one for the directory it is run from: inside a
 * repository with a mode of its own, that mode and the role files in the
 * repository's .claude/agents; anywhere else, the machine's.
 *
 * Read-only, like `ccfg mode` with no argument. It is how the operator checks
 * the crew without dispatching a worker, so it reports what is actually on disk:
 * a role the switch has not rendered yet says so rather than looking ready.
 */
function commandCrew(argv, io) {
  const plain = isPlain(argv);
  // The same lookup the hooks use, so the crew shown is the one a worker
  // dispatched from this directory would actually be given.
  const resolution = modeLock.resolveLock(io.CONFIG_DIR, process.cwd());
  const lock = resolution.lock;
  const agentsDirectory =
    resolution.scope === "repo"
      ? targets.repoTarget(io.CONFIG_DIR, resolution.root).agentsDirectory
      : targets.machineTarget(io.CONFIG_DIR).agentsDirectory;
  const shownDirectory =
    resolution.scope === "repo" ? ".claude/agents" : "agents";
  const chrome = ink.painter(plain, lock === null ? null : lock.color);
  const corpus = roles.loadRoles(path.join(modesDir(io.CONFIG_DIR), "roles"));
  const deniedTools = lock === null ? [] : lock.deniedTools || [];
  const roster = crew.crewRoster(
    corpus.roles,
    lock === null ? null : lock.subagents,
  );

  console.log("");
  console.log(
    ink.frame({
      title: "CREW",
      rows: [
        {
          left: `${corpus.roles.length} ROLES`,
          right:
            lock === null
              ? chrome.dim("NO MODE LOADED")
              : chrome.accent(`${lock.icon} ${lock.codename} LOADED`),
        },
      ],
      ink: chrome,
    }),
  );
  console.log("");

  for (const role of corpus.roles) {
    const tools = crew.allowedTools(role, deniedTools);
    const file = path.join(agentsDirectory, `${role.id}.md`);
    let state = "";
    if (fs.existsSync(file) && !crew.isGenerated(file))
      state = chrome.yellow(
        `${shownDirectory}/${role.id}.md is your own file, left alone`,
      );
    else if (lock === null) state = chrome.dim("not rendered: no mode applied");
    else if (!roster.includes(role))
      state = chrome.dim("not rendered: this mode runs alone");
    else if (tools.length === 0)
      state = chrome.dim("withheld: this mode denies every tool it uses");
    else if (!fs.existsSync(file))
      state = chrome.yellow("not rendered yet: switch to the mode again");

    const indent = " ".repeat(ROLE_COLUMN);
    console.log(`  ${chrome.bold(role.id.padEnd(ROLE_COLUMN))}${state}`);
    console.log(`  ${indent}${chrome.dim("tools")}  ${tools.join(", ") || "none"}`);
    console.log(
      `  ${indent}${chrome.dim("gates")}  ${role.gates.join(", ") || "none"}`,
    );
  }
  for (const problem of corpus.errors) console.log(`  ${chrome.yellow(problem)}`);
  console.log("");
}

module.exports = {
  commandMode,
  commandCrew,
  activeMode,
  activeLook,
  gatesOf,
  loadModes,
  loadMode,
  integrity,
};
