"use strict";

// `ccfg voice`: build a writing-voice skill and choose the one in force.
//
// Every subcommand that writes says what it wrote and where. `use` says the
// scope every time, because ~/.claude is itself a git repository and a plain
// `use` run there sets that repository only.

const fs = require("fs");
const path = require("path");

const registry = require("./registry.js");
const scaffold = require("./scaffold.js");
const scope = require("./scope.js");
const modeLock = require("../../hooks/lib/mode-lock.js");

const VALUE_FLAGS = { "--owner": "owner", "--slug": "slug" };
const SWITCHES = { "--global": "global", "--none": "none" };

class UsageError extends Error {}

function parseArguments(argv) {
  const parsed = {
    subcommand: argv[0],
    positional: [],
    owner: null,
    slug: null,
    from: [],
    global: false,
    none: false,
  };
  let index = 1;
  while (index < argv.length) {
    const word = argv[index];
    if (Object.hasOwn(VALUE_FLAGS, word)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new UsageError(`${word} needs a value`);
      parsed[VALUE_FLAGS[word]] = value;
      index += 2;
    } else if (Object.hasOwn(SWITCHES, word)) {
      parsed[SWITCHES[word]] = true;
      index += 1;
    } else if (word === "--from") {
      index += 1;
      while (index < argv.length && !argv[index].startsWith("--")) {
        parsed.from.push(argv[index]);
        index += 1;
      }
      if (parsed.from.length === 0)
        throw new UsageError("--from needs at least one file or directory");
    } else if (word.startsWith("--")) {
      throw new UsageError(`unknown option ${word}`);
    } else {
      parsed.positional.push(word);
      index += 1;
    }
  }
  return parsed;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function statesHere(configDir, workingDirectory) {
  return scope.voiceStates(
    configDir,
    modeLock.repositoryRoot(workingDirectory),
    registry.listVoices(configDir),
  );
}

/** The mode that hid this voice, or null when the "off" is the operator's. */
function hidingMode(configDir, workingDirectory, state) {
  if (state.value !== "off") return null;
  if (state.source === "machine") {
    const lock = readJson(path.join(configDir, "mode.lock"));
    if (!isPlainObject(lock) || !isPlainObject(lock.baseSkillOverrides)) return null;
    return lock.baseSkillOverrides[state.skill] === "off" ? null : lock.mode;
  }
  if (state.source === "repository") {
    const resolution = modeLock.resolveLock(configDir, workingDirectory);
    if (resolution.scope !== "repo" || !isPlainObject(resolution.lock)) return null;
    const changes = resolution.lock.settingsChanges;
    const written =
      isPlainObject(changes) && isPlainObject(changes.skills)
        ? changes.skills[state.skill]
        : undefined;
    return isPlainObject(written) && written.wrote === "off"
      ? resolution.lock.mode
      : null;
  }
  return null;
}

function doctorFindings(configDir, workingDirectory) {
  const states = statesHere(configDir, workingDirectory);
  if (states.length === 0)
    return [
      {
        level: "ok",
        label: "no voice skill installed",
        detail: 'ccfg voice new NAME --owner "Your Name"',
      },
    ];

  const findings = [];
  const active = states.filter((state) => state.active);
  for (const state of active)
    findings.push({
      level: "warn",
      label: `voice in force: ${state.skill}, written for ${state.owner || "an unnamed owner"}`,
      detail: 'if that is not you: ccfg voice new NAME --owner "Your Name"',
    });
  if (active.length > 1)
    findings.push({
      level: "warn",
      label: `${active.length} voice skills are in force at once`,
      detail: "ccfg voice use NAME turns the others off",
    });
  for (const state of states) {
    const mode = hidingMode(configDir, workingDirectory, state);
    if (mode !== null)
      findings.push({
        level: "warn",
        label: `mode ${mode} hides the voice skill ${state.skill}`,
        detail: "prose is written with no voice until the mode changes",
      });
  }
  if (findings.length === 0)
    findings.push({
      level: "ok",
      label: "no voice skill in force",
      detail: "ccfg voice use NAME",
    });
  return findings;
}

function installPointer(configDir, workingDirectory) {
  const active = statesHere(configDir, workingDirectory).filter(
    (state) => state.active,
  );
  if (active.length > 0) return null;
  return 'ccfg voice new NAME --owner "Your Name"';
}

function describeState(state) {
  if (state.active)
    return state.source === "default" ? "in force" : `in force (${state.source})`;
  return `${state.value} (${state.source})`;
}

function commandList(io) {
  const root = modeLock.repositoryRoot(process.cwd());
  const states = scope.voiceStates(
    io.CONFIG_DIR,
    root,
    registry.listVoices(io.CONFIG_DIR),
  );
  console.log(
    io.bold("\nccfg voice") +
      io.dim(root === null ? "  (machine-wide)" : `  (repository ${root})`),
  );
  if (states.length === 0) {
    console.log("\n  no voice skill yet");
    console.log(`  ${io.dim('start one: ccfg voice new NAME --owner "Your Name"')}`);
  }
  const nameWidth = Math.max(4, ...states.map((state) => state.name.length));
  const ownerWidth = Math.max(5, ...states.map((state) => state.owner.length));
  for (const state of states)
    console.log(
      `  ${state.name.padEnd(nameWidth)}  ${state.owner.padEnd(ownerWidth)}  ` +
        `${state.version}  ${describeState(state)}`,
    );
  for (const skill of registry.unregisteredVoices(io.CONFIG_DIR))
    console.log(
      `\n  ${skill} is not registered as a voice: ` +
        `ccfg voice register ${registry.shortName(skill)} --owner "Full Name"`,
    );
  console.log(
    io.dim(
      root === null
        ? "\n  ccfg voice use NAME sets the machine-wide voice from here"
        : "\n  ccfg voice use NAME sets this repository only; --global sets the machine-wide voice",
    ),
  );
}

function commandNew(parsed, io) {
  if (parsed.positional.length !== 1 || parsed.owner === null)
    throw new UsageError(
      'usage: ccfg voice new NAME --owner "Full Name" [--from DIR|FILE...]',
    );
  const result = scaffold.createVoice({
    configDir: io.CONFIG_DIR,
    name: parsed.positional[0],
    owner: parsed.owner,
    sources: parsed.from,
  });
  console.log(`wrote ${result.directory} (${result.files.length} files)`);
  if (result.samples.length > 0)
    console.log(`copied ${result.samples.length} samples: ${result.samples.join(", ")}`);
  console.log(
    `\nThe skill is empty. In a Claude session, run ` +
      `/voice-build ${registry.shortName(result.skill)} to read the samples ` +
      `and write its rules.\nIt is on by default. To make it the only voice: ` +
      `ccfg voice use ${registry.shortName(result.skill)}`,
  );
}

function commandUse(parsed, io) {
  if (parsed.none) {
    if (parsed.global || parsed.positional.length > 0)
      throw new UsageError(
        "usage: ccfg voice use --none   (drops this repository's own choice; " +
          "takes no name and no --global)",
      );
    const result = scope.dropRepositoryChoice({
      configDir: io.CONFIG_DIR,
      root: modeLock.repositoryRoot(process.cwd()),
      voices: registry.listVoices(io.CONFIG_DIR),
    });
    console.log(
      result.dropped.length === 0
        ? `${result.file} held no voice choice; nothing changed`
        : `dropped this repository's voice choice from ${result.file}\n` +
            `the machine-wide voice is in force here again`,
    );
    return;
  }
  if (parsed.positional.length !== 1)
    throw new UsageError("usage: ccfg voice use NAME [--global] | ccfg voice use --none");

  const result = scope.useVoice({
    configDir: io.CONFIG_DIR,
    root: parsed.global ? null : modeLock.repositoryRoot(process.cwd()),
    name: parsed.positional[0],
    voices: registry.listVoices(io.CONFIG_DIR),
    backupFile: io.backupFile,
    report: (message) => console.error(message),
  });
  console.log(
    result.scope === "repository"
      ? `${result.chosen.skill} is the voice for this repository only (${result.root})`
      : `${result.chosen.skill} is the machine-wide voice`,
  );
  console.log(`wrote ${result.file}`);
  if (result.turnedOff.length > 0)
    console.log(`turned off: ${result.turnedOff.join(", ")}`);
  if (result.backup !== null) console.log(`backup: ${result.backup}`);
  if (result.modeRecord !== null && result.modeRecord.touched.length > 0)
    console.log(
      `mode ${result.modeRecord.mode} is in force, so the choice was also ` +
        `written into its record and survives ccfg mode revert`,
    );
  console.log(
    result.scope === "repository"
      ? "To set the machine-wide voice instead: add --global"
      : "A repository with its own choice keeps it. Takes effect at the next session.",
  );
}

function commandAdd(parsed, io) {
  if (parsed.positional.length < 2)
    throw new UsageError("usage: ccfg voice add NAME FILE...");
  const result = scaffold.addSamples({
    configDir: io.CONFIG_DIR,
    name: parsed.positional[0],
    sources: parsed.positional.slice(1),
  });
  console.log(
    `copied ${result.samples.length} samples into ` +
      `${path.join(result.directory, "references", "samples")}: ` +
      result.samples.join(", "),
  );
}

function commandLearn(parsed, io) {
  if (parsed.positional.length !== 1)
    throw new UsageError("usage: ccfg voice learn NAME [--slug SLUG]");
  const result = scaffold.startPair({
    configDir: io.CONFIG_DIR,
    name: parsed.positional[0],
    slug: parsed.slug === null ? undefined : parsed.slug,
    today: new Date().toISOString().slice(0, 10),
  });
  console.log(result.file);
}

function commandRegister(parsed, io) {
  if (parsed.positional.length !== 1 || parsed.owner === null)
    throw new UsageError('usage: ccfg voice register NAME --owner "Full Name"');
  const result = registry.registerVoice(
    io.CONFIG_DIR,
    parsed.positional[0],
    parsed.owner,
  );
  console.log(
    `added ${result.added.join(", ")} to the frontmatter of ${result.file}; ` +
      `no other line changed`,
  );
}

const SUBCOMMANDS = {
  list: (parsed, io) => commandList(io),
  new: commandNew,
  use: commandUse,
  add: commandAdd,
  learn: commandLearn,
  register: commandRegister,
};

function commandVoice(argv, io) {
  try {
    const parsed = parseArguments(argv.length === 0 ? ["list"] : argv);
    const run = Object.hasOwn(SUBCOMMANDS, parsed.subcommand)
      ? SUBCOMMANDS[parsed.subcommand]
      : undefined;
    if (run === undefined)
      throw new UsageError(
        `unknown: voice ${parsed.subcommand}. ` +
          `Try: list | new | use | add | learn | register`,
      );
    run(parsed, io);
  } catch (error) {
    console.error(`ccfg voice: ${error.message}`);
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}

module.exports = { commandVoice, parseArguments, doctorFindings, installPointer };
