"use strict";

// Regression suite for ccfg's secret-name gate and shell-profile wiring.
//
// The gate exists because `ccfg keys set <name>` takes the name positionally,
// so transposing the arguments files a live credential as a variable name. It
// must refuse before prompting, because a refusal that arrives after the value is
// read has already let the mistake happen.
//
// The wiring tests all run against a temp directory: a suite that edits the
// operator's real ~/.zshrc to prove it can edit ~/.zshrc is not a test.
//
// Usage: node ~/.claude/tools/test-ccfg.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// Set before ccfg is loaded, because it resolves its config directory once at
// module scope. Without this the wiring tests would drop backup copies into the
// operator's real ~/.claude/backups every run.
const SANDBOX_CONFIG = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-config-"));
process.env.CLAUDE_CONFIG_DIR = SANDBOX_CONFIG;

const {
  variableRejection,
  valueRejection,
  maskSecret,
  normalizeVariable,
  brokeredRoute,
  wireProfile,
  shellProfileTargets,
  PROFILE_OPEN,
} = require("./ccfg.js");
const voiceRegistry = require("./voice/registry.js");
const voiceScope = require("./voice/scope.js");
const voiceScaffold = require("./voice/scaffold.js");
const voiceCommand = require("./voice/command.js");
const modeApply = require("./modes/apply.js");
const modeParser = require("./modes/modes.js");
const modeTargets = require("./modes/target.js");
const stateCommand = require("./state/command.js");
const stateRecords = require("../hooks/lib/state-records.js");

const CCFG = path.join(__dirname, "ccfg.js");

// Assembled so this file is not itself a literal the secret scanner flags.
const KEY_SHAPED = "ctx7sk-" + "0000aaaa-1111-2222-3333-444455556666";

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  if (actual === expected) {
    passed += 1;
    console.log(`[PASS] ${label}`);
    return;
  }
  failed += 1;
  console.log(
    `[FAIL] ${label}\n       expected ${expected}\n       actual   ${actual}`,
  );
}

function rejects(label, variable, expectedFragment) {
  const message = variableRejection(variable);
  if (message === null) {
    failed += 1;
    console.log(`[FAIL] ${label}\n       expected a rejection, got none`);
    return;
  }
  check(label, message.includes(expectedFragment), true);
}

console.log("Name gate\n--------------------");

check(
  "a managed name is accepted",
  variableRejection("CONTEXT7_API_KEY"),
  null,
);

rejects(
  "an unknown name is rejected",
  "NOT_A_REAL_KEY",
  "Unknown variable NOT_A_REAL_KEY",
);

rejects(
  "an unknown name lists the managed names",
  "NOT_A_REAL_KEY",
  "CONTEXT7_API_KEY",
);

rejects(
  "a name shaped like a key is reported as a disclosure",
  KEY_SHAPED,
  "That is a key, not a variable name",
);

rejects(
  "a name shaped like a key says to rotate it",
  KEY_SHAPED,
  "Rotate it at the provider",
);

rejects(
  "a retired name points at its replacement",
  "MAGIC_API_KEY",
  "Use API_KEY_21ST",
);

rejects(
  "a lowercase managed name suggests the real spelling",
  "context7_api_key",
  "Did you mean CONTEXT7_API_KEY?",
);

rejects(
  "a hyphenated managed name suggests the real spelling",
  "context7-api-key",
  "Did you mean CONTEXT7_API_KEY?",
);

check(
  "normalizing ignores case and separators",
  normalizeVariable("context7-api_key"),
  "CONTEXT7APIKEY",
);

console.log("\nExit codes\n--------------------");

// Spawned rather than called: the gate is only useful if it reaches process
// exit, and `--stdin` must not consume the value before the name is judged.
function exitCodeFor(argv, input) {
  const result = spawnSync(process.execPath, [CCFG, "keys", "set", ...argv], {
    input: input || "",
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
  return {
    code: result.status,
    out: (result.stderr || "") + (result.stdout || ""),
  };
}

check("unknown name exits 2", exitCodeFor(["NOT_A_REAL_KEY"]).code, 2);
check("key-shaped name exits 2", exitCodeFor([KEY_SHAPED]).code, 2);
check("missing name exits 2", exitCodeFor([]).code, 2);
check(
  "inline value exits 2",
  exitCodeFor(["STITCH_API_KEY", "some-inline-value"]).code,
  2,
);

// The value must never be stored under a bad name even when it is already
// sitting on stdin ready to be read.
const piped = exitCodeFor(["NOT_A_REAL_KEY", "--stdin"], "a-secret-value\n");
check("unknown name with --stdin exits 2", piped.code, 2);
check(
  "unknown name with --stdin stores nothing",
  piped.out.includes("stored"),
  false,
);

console.log("\nValue gate\n--------------------");

// A passphrase typed at the wrong prompt is the case this exists for: it used
// to be accepted, stored, and only surfaced later as an unexplained 401.
// Deliberately a made-up 13-character string: a fixture in a tracked file must
// never be anything a real person might actually have typed.
const PASSPHRASE = "not-a-key-123";

check(
  "a well-formed Context7 key is accepted",
  valueRejection("CONTEXT7_API_KEY", "ctx7sk-" + "a".repeat(30)),
  null,
);
check(
  "a well-formed Stitch key is accepted",
  valueRejection("STITCH_API_KEY", "AQ." + "a".repeat(40)),
  null,
);
check(
  "a well-formed 21st token is accepted",
  valueRejection("API_KEY_21ST", "a1b2c3d4".repeat(8)),
  null,
);

function rejectsValue(label, variable, value, expectedFragment) {
  const message = valueRejection(variable, value);
  if (message === null) {
    failed += 1;
    console.log(`[FAIL] ${label}\n       expected a rejection, got none`);
    return;
  }
  check(label, message.includes(expectedFragment), true);
}

rejectsValue(
  "a passphrase is refused as a Context7 key",
  "CONTEXT7_API_KEY",
  PASSPHRASE,
  "does not look like a Context7 API key",
);
rejectsValue(
  "the refusal names the shape it wanted",
  "CONTEXT7_API_KEY",
  PASSPHRASE,
  "Expected: ctx7sk-",
);
rejectsValue(
  "the refusal says nothing was stored",
  "CONTEXT7_API_KEY",
  PASSPHRASE,
  "Nothing was stored",
);

// The rejected input is often more sensitive than a real key would be.
check(
  "the refusal never echoes the value",
  String(valueRejection("CONTEXT7_API_KEY", PASSPHRASE) || "").includes(
    PASSPHRASE,
  ),
  false,
);

rejectsValue(
  "another provider's key is refused",
  "STITCH_API_KEY",
  "ctx7sk-" + "a".repeat(30),
  "does not look like a Google Stitch API key",
);
rejectsValue(
  "a truncated paste is refused",
  "API_KEY_21ST",
  "a1b2c3d4",
  "64 lowercase hex",
);

console.log("\nMasking\n--------------------");

check(
  "a short value is never partially revealed",
  maskSecret(PASSPHRASE).includes(PASSPHRASE.slice(0, 4)),
  false,
);
check(
  "a short value still reports its length",
  maskSecret(PASSPHRASE),
  "******** (13 chars)",
);
check(
  "a long key keeps an identifying hint",
  maskSecret("ctx7sk-" + "a".repeat(30) + "wxyz"),
  "ctx7…wxyz",
);

console.log("\nBroker detection\n--------------------");

// Read from ~/.claude.json rather than the broker's config, which this user
// cannot read by design. What the agent can see is what ccfg reports.
const CONTEXT7 = {
  variable: "CONTEXT7_API_KEY",
  server: "context7",
  location: ["headers", "CONTEXT7_API_KEY"],
};

check(
  "a loopback url carrying the proxy token is a broker route",
  brokeredRoute(
    {
      mcpServers: {
        context7: {
          url: "http://127.0.0.1:8787/context7",
          headers: { "x-ccfg-token": "t" },
        },
      },
    },
    CONTEXT7,
  ),
  "http://127.0.0.1:8787/context7",
);

check(
  "a direct https server is not brokered",
  brokeredRoute(
    {
      mcpServers: {
        context7: {
          url: "https://mcp.context7.com/mcp",
          headers: { CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}" },
        },
      },
    },
    CONTEXT7,
  ),
  null,
);

// Someone else's local proxy is not ours, and treating it as ours would stop
// ccfg supplying a key that is still genuinely needed.
check(
  "a loopback url without the token is not ours",
  brokeredRoute(
    { mcpServers: { context7: { url: "http://127.0.0.1:9000/context7" } } },
    CONTEXT7,
  ),
  null,
);

check(
  "an absent server is not brokered",
  brokeredRoute({ mcpServers: {} }, CONTEXT7),
  null,
);

console.log("\nShell profile wiring\n--------------------");

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-profile-"));
const initFile = path.join(sandbox, "shell-init.sh");
fs.writeFileSync(initFile, "# generated\n");

function profileWith(name, contents) {
  const profile = path.join(sandbox, name);
  fs.writeFileSync(profile, contents);
  return profile;
}

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

const emptyProfile = profileWith(".zshrc-empty", "");
check(
  "an unwired profile is added to",
  wireProfile(emptyProfile, initFile).action,
  "added",
);
check(
  "the added block sources the init file",
  fs.readFileSync(emptyProfile, "utf8").includes(`. "${initFile}"`),
  true,
);

check(
  "re-running leaves the profile unchanged",
  wireProfile(emptyProfile, initFile).action,
  "unchanged",
);
check(
  "re-running does not append a second block",
  occurrences(fs.readFileSync(emptyProfile, "utf8"), PROFILE_OPEN),
  1,
);

const existing = profileWith(
  ".zshrc-existing",
  'export PATH="/opt/bin:$PATH"\n',
);
wireProfile(existing, initFile);
check(
  "wiring preserves what was already in the profile",
  fs.readFileSync(existing, "utf8").includes('export PATH="/opt/bin:$PATH"'),
  true,
);

const noTrailingNewline = profileWith(".zshrc-nonewline", "alias ll='ls -la'");
wireProfile(noTrailingNewline, initFile);
check(
  "a profile with no trailing newline is not corrupted",
  fs.readFileSync(noTrailingNewline, "utf8").includes("alias ll='ls -la'\n"),
  true,
);

// A line the operator wrote themselves is theirs. Appending a managed block
// beside it would source the same file twice and silently claim ownership.
const handWritten = profileWith(
  ".zshrc-byhand",
  `[ -f "${initFile}" ] && . "${initFile}"\n`,
);
const handResult = wireProfile(handWritten, initFile);
check(
  "a hand-written source line is recognised",
  handResult.action,
  "already sourced by hand",
);
check(
  "a hand-written source line is left alone",
  fs.readFileSync(handWritten, "utf8").includes(PROFILE_OPEN),
  false,
);

// A moved config directory has to be repaired in place, not appended to.
const stale = profileWith(
  ".zshrc-stale",
  `# >>> ccfg >>>\n[ -f "/old/path/shell-init.sh" ] && . "/old/path/shell-init.sh"\n# <<< ccfg <<<\n`,
);
check(
  "a stale block is refreshed",
  wireProfile(stale, initFile).action,
  "refreshed",
);
const staleContents = fs.readFileSync(stale, "utf8");
check("the stale path is gone", staleContents.includes("/old/path"), false);
check(
  "the refreshed block is not duplicated",
  occurrences(staleContents, PROFILE_OPEN),
  1,
);

// $SHELL decides which profile is written first, and it was only ever
// exercised under zsh. A bash user getting their zshrc wired instead is a
// silent failure: the install reports success and nothing loads.
{
  const realShell = process.env.SHELL;
  const realHome = process.env.HOME;
  process.env.HOME = sandbox;

  process.env.SHELL = "/bin/bash";
  fs.writeFileSync(path.join(sandbox, ".bashrc"), "");
  check(
    "a bash shell wires .bashrc first",
    path.basename(shellProfileTargets()[0]),
    ".bashrc",
  );

  process.env.SHELL = "/bin/zsh";
  fs.writeFileSync(path.join(sandbox, ".zshrc"), "");
  check(
    "a zsh shell wires .zshrc first",
    path.basename(shellProfileTargets()[0]),
    ".zshrc",
  );

  process.env.SHELL = realShell;
  process.env.HOME = realHome;
}

const created = path.join(sandbox, ".zshrc-created");
check(
  "a missing profile is created",
  wireProfile(created, initFile).action,
  "added",
);
check("the created profile exists on disk", fs.existsSync(created), true);

console.log("\nVoice registry\n--------------------");

const voiceSandboxes = [];

function voiceConfig() {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-voice-"));
  fs.mkdirSync(path.join(config, "skills"));
  voiceSandboxes.push(config);
  return config;
}

function writeSkill(config, skill, text) {
  const directory = path.join(config, "skills", skill);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), text);
  return path.join(directory, "SKILL.md");
}

function voiceText(skill, owner) {
  return (
    `---\nname: ${skill}\ndescription: Writes like ${owner}.\n` +
    `metadata:\n  kind: voice\n  owner: "${owner}"\n  template: "1"\n` +
    `  version: "0.1.0"\n---\n\n# ${owner}\n`
  );
}

function thrownMessage(action) {
  try {
    action();
    return "(no error)";
  } catch (error) {
    return error.message;
  }
}

const HAND_BUILT_SKILL =
  "---\nname: ada-voice\ndescription: Writes like Ada.\nlicense: MIT\n" +
  'metadata:\n  version: "3.1.0"\n  supersedes: "1.x"\n---\n\n# Ada\n\nBody.\n';

check("a short name gains the suffix", voiceRegistry.skillName("ada"), "ada-voice");
check(
  "a full skill name is left alone",
  voiceRegistry.skillName("ada-voice"),
  "ada-voice",
);
check("the short name drops the suffix", voiceRegistry.shortName("ada-voice"), "ada");
check("a lower-case name is usable", voiceRegistry.nameRejection("ada-2"), null);
check(
  "a name with a path separator is refused",
  voiceRegistry.nameRejection("../ada").includes("not a usable voice name"),
  true,
);
check(
  "an owner that would break the frontmatter is refused",
  voiceRegistry.ownerRejection("Ada: Lovelace").includes("cannot contain"),
  true,
);

{
  const config = voiceConfig();
  check("an empty skills directory lists no voices", voiceRegistry.listVoices(config).length, 0);

  writeSkill(config, "ada-voice", voiceText("ada-voice", "Ada Lovelace"));
  writeSkill(config, "bob-voice", voiceText("bob-voice", "Bob Stone"));
  writeSkill(config, "cy-voice", HAND_BUILT_SKILL.replace("ada-voice", "cy-voice"));
  writeSkill(config, "notes", voiceText("notes", "Nobody"));

  const voices = voiceRegistry.listVoices(config);
  check(
    "only registered voice skills are listed, in name order",
    voices.map((voice) => voice.skill).join(","),
    "ada-voice,bob-voice",
  );
  check("a voice carries its owner", voices[0].owner, "Ada Lovelace");
  check("a voice carries its version", voices[0].version, "0.1.0");
  check("a voice carries its short name", voices[0].name, "ada");
  check(
    "a voice-named skill without the marker is reported as unregistered",
    voiceRegistry.unregisteredVoices(config).join(","),
    "cy-voice",
  );
}

{
  const config = voiceConfig();
  const file = writeSkill(config, "ada-voice", HAND_BUILT_SKILL);
  const result = voiceRegistry.registerVoice(config, "ada", "Ada Lovelace");

  check("register reports the keys it added", result.added.join(","), "kind,owner,template");
  check(
    "register adds three lines under metadata and changes nothing else",
    fs.readFileSync(file, "utf8"),
    HAND_BUILT_SKILL.replace(
      "metadata:\n",
      'metadata:\n  kind: voice\n  owner: "Ada Lovelace"\n  template: "hand-built"\n',
    ),
  );
  check(
    "a registered skill is then listed with its existing version",
    voiceRegistry.listVoices(config)[0].version,
    "3.1.0",
  );
  check(
    "registering twice is refused",
    thrownMessage(() => voiceRegistry.registerVoice(config, "ada", "Ada Lovelace")).includes(
      "already registered",
    ),
    true,
  );
}

{
  const config = voiceConfig();
  const windowsText = "---\r\nname: ada-voice\r\ndescription: Ada.\r\n---\r\n\r\n# Ada\r\n";
  const file = writeSkill(config, "ada-voice", windowsText);
  voiceRegistry.registerVoice(config, "ada-voice", "Ada Lovelace");

  check(
    "register on a file with no metadata block and Windows line endings adds a block in the same endings",
    fs.readFileSync(file, "utf8"),
    "---\r\nname: ada-voice\r\ndescription: Ada.\r\n" +
      'metadata:\r\n  kind: voice\r\n  owner: "Ada Lovelace"\r\n' +
      '  template: "hand-built"\r\n  version: "0.1.0"\r\n' +
      "---\r\n\r\n# Ada\r\n",
  );
  check(
    "register on a missing skill names the command that makes one",
    thrownMessage(() => voiceRegistry.registerVoice(config, "zed", "Zed")).includes(
      "ccfg voice new zed",
    ),
    true,
  );
}

console.log("\nVoice scope\n--------------------");

function gitIn(directory, args) {
  return spawnSync("git", ["-C", directory, ...args], { encoding: "utf8" });
}

function voiceRepository() {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-voice-repo-"));
  gitIn(repository, ["init", "-q", "."]);
  voiceSandboxes.push(repository);
  return fs.realpathSync(repository);
}

function twoVoices() {
  const config = voiceConfig();
  writeSkill(config, "ada-voice", voiceText("ada-voice", "Ada Lovelace"));
  writeSkill(config, "bob-voice", voiceText("bob-voice", "Bob Stone"));
  return config;
}

function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function noBackup() {
  return null;
}

function quiet() {}

{
  const config = twoVoices();
  const settingsFile = path.join(config, "settings.json");
  writeJsonFile(settingsFile, {
    model: "opus",
    skillOverrides: { "other-skill": "user-invocable-only" },
  });
  const backups = [];
  const result = voiceScope.useVoice({
    configDir: config,
    root: null,
    name: "bob",
    voices: voiceRegistry.listVoices(config),
    backupFile: (file, label) => {
      backups.push(`${path.basename(file)}:${label}`);
      return "/backup/settings.json";
    },
    report: quiet,
  });
  const written = readJsonFile(settingsFile);

  check("a machine choice reports machine scope", result.scope, "machine");
  check("a machine choice turns the named voice on", written.skillOverrides["bob-voice"], "on");
  check("a machine choice turns every other voice off", written.skillOverrides["ada-voice"], "off");
  check(
    "a machine choice leaves a non-voice override untouched",
    written.skillOverrides["other-skill"],
    "user-invocable-only",
  );
  check("a machine choice leaves other settings untouched", written.model, "opus");
  check("a machine choice backs the settings file up first", backups.join(","), "settings.json:voice");
  check("a machine choice names the voices it turned off", result.turnedOff.join(","), "ada-voice");

  const states = voiceScope.voiceStates(config, null, voiceRegistry.listVoices(config));
  check("the chosen voice reads as in force", states[1].active, true);
  check("the other voice reads as not in force", states[0].active, false);
  check("a machine value names the machine as its source", states[1].source, "machine");
}

{
  const config = twoVoices();
  const states = voiceScope.voiceStates(config, null, voiceRegistry.listVoices(config));
  check("a voice no file mentions is in force by default", states[0].active, true);
  check("a voice no file mentions names no source", states[0].source, "default");
}

{
  const config = twoVoices();
  const settingsFile = path.join(config, "settings.json");
  writeJsonFile(settingsFile, { model: "opus" });
  const before = fs.readFileSync(settingsFile, "utf8");
  const message = thrownMessage(() =>
    voiceScope.useVoice({
      configDir: config,
      root: null,
      name: "bod",
      voices: voiceRegistry.listVoices(config),
      backupFile: noBackup,
      report: quiet,
    }),
  );
  check("an unknown voice is refused with the registered ones named", message.includes("ada, bob"), true);
  check("an unknown voice leaves the settings file byte-identical", fs.readFileSync(settingsFile, "utf8"), before);
}

{
  const config = twoVoices();
  writeSkill(config, "cy-voice", HAND_BUILT_SKILL.replace("ada-voice", "cy-voice"));
  const message = thrownMessage(() =>
    voiceScope.useVoice({
      configDir: config,
      root: null,
      name: "cy",
      voices: voiceRegistry.listVoices(config),
      backupFile: noBackup,
      report: quiet,
    }),
  );
  check("an unregistered voice skill is refused with the register command", message.includes("ccfg voice register cy"), true);
}

{
  const config = twoVoices();
  const settingsFile = path.join(config, "settings.json");
  fs.writeFileSync(settingsFile, "{ not json");
  const backups = [];
  const message = thrownMessage(() =>
    voiceScope.useVoice({
      configDir: config,
      root: null,
      name: "ada",
      voices: voiceRegistry.listVoices(config),
      backupFile: (file) => {
        backups.push(file);
        return null;
      },
      report: quiet,
    }),
  );
  check("a settings file that does not parse is refused", message.includes("is not valid JSON"), true);
  check("a refused settings file is left byte-identical", fs.readFileSync(settingsFile, "utf8"), "{ not json");
  check("a refused settings file is not backed up", backups.length, 0);

  writeJsonFile(settingsFile, { skillOverrides: ["ada-voice"] });
  check(
    "a settings file whose skillOverrides is a list is refused",
    thrownMessage(() =>
      voiceScope.useVoice({
        configDir: config,
        root: null,
        name: "ada",
        voices: voiceRegistry.listVoices(config),
        backupFile: noBackup,
        report: quiet,
      }),
    ).includes('"skillOverrides" is not an object'),
    true,
  );
}

{
  const config = twoVoices();
  const settingsFile = path.join(config, "settings.json");
  const savedCopy = path.join(config, "settings.before-mode.json");
  const lockFile = path.join(config, "mode.lock");
  writeJsonFile(settingsFile, { skillOverrides: { "hidden-by-mode": "off" } });
  writeJsonFile(savedCopy, { model: "opus" });
  writeJsonFile(lockFile, {
    mode: "runner",
    settingsBackup: savedCopy,
    baseSkillOverrides: {},
    hardHash: "abc",
  });
  const result = voiceScope.useVoice({
    configDir: config,
    root: null,
    name: "ada",
    voices: voiceRegistry.listVoices(config),
    backupFile: noBackup,
    report: quiet,
  });

  check(
    "with a mode in force the choice is carried into the copy a revert restores",
    (readJsonFile(savedCopy).skillOverrides ?? {})["bob-voice"],
    "off",
  );
  check("the copy a revert restores keeps its other settings", readJsonFile(savedCopy).model, "opus");
  check(
    "with a mode in force the choice is carried into the baseline the next switch reads",
    readJsonFile(lockFile).baseSkillOverrides["bob-voice"],
    "off",
  );
  check("the mode record keeps its other fields", readJsonFile(lockFile).hardHash, "abc");
  check("the mode's own hiding is not copied into its baseline", "hidden-by-mode" in readJsonFile(lockFile).baseSkillOverrides, false);
  check("the result names the mode whose record it wrote", result.modeRecord.mode, "runner");
}

function repositoryModeFixture() {
  const config = twoVoices();
  fs.mkdirSync(path.join(config, "modes"), { recursive: true });
  fs.symlinkSync(
    path.join(__dirname, "..", "modes", "roles"),
    path.join(config, "modes", "roles"),
  );
  const repository = voiceRepository();
  const target = modeTargets.repoTarget(config, repository);
  const hidesBothVoices = modeParser.parseMode(
    { name: "quiet", settings: {}, glitch: { skills: { off: ["ada-voice", "bob-voice"] } } },
    "quiet.json",
  );
  const hidesNothing = modeParser.parseMode({ name: "plain", settings: {} }, "plain.json");
  modeApply.applyMode(config, hidesBothVoices, [], {}, target);
  voiceScope.useVoice({
    configDir: config,
    root: repository,
    name: "bob",
    voices: voiceRegistry.listVoices(config),
    backupFile: noBackup,
    report: quiet,
  });
  return {
    config,
    target,
    hidesNothing,
    localFile: path.join(repository, ".claude", "settings.local.json"),
  };
}

{
  const { config, target, hidesNothing, localFile } = repositoryModeFixture();
  modeApply.applyMode(config, hidesNothing, [], {}, target);
  const overrides = readJsonFile(localFile).skillOverrides ?? {};

  check("a repository choice survives a switch to another mode: chosen voice stays on", overrides["bob-voice"], "on");
  check("a repository choice survives a switch to another mode: other voice stays off", overrides["ada-voice"], "off");
}

{
  const { config, target, localFile } = repositoryModeFixture();
  modeApply.revert(config, target, quiet);
  const overrides = readJsonFile(localFile).skillOverrides ?? {};

  check("a repository choice survives a mode revert: chosen voice stays on", overrides["bob-voice"], "on");
  check("a repository choice survives a mode revert: other voice stays off", overrides["ada-voice"], "off");
}

{
  const config = twoVoices();
  const repository = voiceRepository();
  const machineFile = path.join(config, "settings.json");
  const localFile = path.join(repository, ".claude", "settings.local.json");
  writeJsonFile(machineFile, { skillOverrides: { "ada-voice": "on", "bob-voice": "off" } });
  const machineBefore = fs.readFileSync(machineFile, "utf8");
  writeJsonFile(localFile, { env: { KEPT: "1" } });

  const result = voiceScope.useVoice({
    configDir: config,
    root: repository,
    name: "bob",
    voices: voiceRegistry.listVoices(config),
    backupFile: noBackup,
    report: quiet,
  });
  const written = readJsonFile(localFile);

  check("a repository choice reports repository scope", result.scope, "repository");
  check("a repository choice writes the repository's local settings file", result.file, localFile);
  check("a repository choice turns the named voice on there", written.skillOverrides["bob-voice"], "on");
  check("a repository choice turns the other voice off there", written.skillOverrides["ada-voice"], "off");
  check("a repository choice keeps what was already in the file", written.env.KEPT, "1");
  check("a repository choice leaves the machine settings byte-identical", fs.readFileSync(machineFile, "utf8"), machineBefore);
  check(
    "a repository choice keeps the file out of git status",
    gitIn(repository, ["status", "--porcelain"]).stdout,
    "",
  );

  const states = voiceScope.voiceStates(config, repository, voiceRegistry.listVoices(config));
  check("inside the repository its own choice wins over the machine's", states[1].active, true);
  check("inside the repository the source is the repository", states[1].source, "repository");

  const dropped = voiceScope.dropRepositoryChoice({
    configDir: config,
    root: repository,
    voices: voiceRegistry.listVoices(config),
  });
  check("dropping the choice names what it removed", dropped.dropped.join(","), "ada-voice,bob-voice");
  check("dropping the choice removes the emptied skillOverrides key", "skillOverrides" in readJsonFile(localFile), false);
  check("dropping the choice keeps the rest of the file", readJsonFile(localFile).env.KEPT, "1");
  check(
    "after dropping, the machine's voice is in force again",
    voiceScope.voiceStates(config, repository, voiceRegistry.listVoices(config))[0].source,
    "machine",
  );
}

{
  const config = twoVoices();
  const repository = voiceRepository();
  const localFile = path.join(repository, ".claude", "settings.local.json");
  writeJsonFile(localFile, { env: {} });
  gitIn(repository, ["add", "-f", ".claude/settings.local.json"]);
  const before = fs.readFileSync(localFile, "utf8");
  const message = thrownMessage(() =>
    voiceScope.useVoice({
      configDir: config,
      root: repository,
      name: "ada",
      voices: voiceRegistry.listVoices(config),
      backupFile: noBackup,
      report: quiet,
    }),
  );
  check("a tracked local settings file is refused", message.includes("is tracked by git"), true);
  check("a refused tracked file is left byte-identical", fs.readFileSync(localFile, "utf8"), before);
}

{
  const config = twoVoices();
  const repository = voiceRepository();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-voice-link-"));
  voiceSandboxes.push(elsewhere);
  fs.symlinkSync(elsewhere, path.join(repository, ".claude"));
  const message = thrownMessage(() =>
    voiceScope.useVoice({
      configDir: config,
      root: repository,
      name: "ada",
      voices: voiceRegistry.listVoices(config),
      backupFile: noBackup,
      report: quiet,
    }),
  );
  check("a symbolic link at .claude is refused", message.includes("symbolic link at"), true);
  check("nothing is written through the link", fs.readdirSync(elsewhere).length, 0);
}

check(
  "dropping a repository choice outside a repository is refused",
  thrownMessage(() =>
    voiceScope.dropRepositoryChoice({ configDir: twoVoices(), root: null, voices: [] }),
  ).includes("--global"),
  true,
);

console.log("\nVoice scaffold\n--------------------");

function sampleDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-voice-samples-"));
  voiceSandboxes.push(directory);
  fs.writeFileSync(path.join(directory, "essay.md"), "An essay.\n");
  fs.writeFileSync(path.join(directory, "letter.txt"), "A letter.\n");
  fs.writeFileSync(path.join(directory, ".DS_Store"), "junk");
  return directory;
}

{
  const config = voiceConfig();
  const samples = sampleDirectory();
  const result = voiceScaffold.createVoice({
    configDir: config,
    name: "ada",
    owner: "Ada Lovelace",
    sources: [samples],
  });
  const skillDirectory = path.join(config, "skills", "ada-voice");
  const skillText = fs.readFileSync(path.join(skillDirectory, "SKILL.md"), "utf8");

  check("new reports the skill it made", result.skill, "ada-voice");
  check(
    "new writes the five-part shape",
    [
      "SKILL.md",
      "references/UPDATING.md",
      "references/mechanics.md",
      "references/structure.md",
      "references/genres.md",
      "references/corrections.md",
      "references/samples/README.md",
      "references/paired/README.md",
    ]
      .map((file) => fs.existsSync(path.join(skillDirectory, file)))
      .join(","),
    "true,true,true,true,true,true,true,true",
  );
  check("new leaves no placeholder unfilled", skillText.includes("{{"), false);
  check("new writes the skill name on the second line of SKILL.md", skillText.split("\n")[1], "name: ada-voice");
  check("a new skill is listed as a voice", voiceRegistry.listVoices(config)[0].skill, "ada-voice");
  check("a new skill carries its owner", voiceRegistry.listVoices(config)[0].owner, "Ada Lovelace");
  check(
    "a new skill carries the scaffold version",
    voiceRegistry.listVoices(config)[0].template,
    voiceScaffold.TEMPLATE_VERSION,
  );
  check("a new skill says it is still empty", skillText.includes("This skill is still empty"), true);
  check("new copies the samples from a directory", result.samples.join(","), "essay.md,letter.txt");
  check(
    "a copied sample keeps its content",
    fs.readFileSync(path.join(skillDirectory, "references", "samples", "essay.md"), "utf8"),
    "An essay.\n",
  );
  check(
    "a dotfile in a sample directory is not copied",
    fs.existsSync(path.join(skillDirectory, "references", "samples", ".DS_Store")),
    false,
  );
  check(
    "new refuses a directory that already exists",
    thrownMessage(() =>
      voiceScaffold.createVoice({ configDir: config, name: "ada", owner: "Ada Lovelace", sources: [] }),
    ).includes("already exists"),
    true,
  );

  check(
    "add refuses a sample whose name is already taken",
    thrownMessage(() =>
      voiceScaffold.addSamples({
        configDir: config,
        name: "ada",
        sources: [path.join(samples, "essay.md")],
      }),
    ).includes("already holds essay.md"),
    true,
  );

  const extra = path.join(samples, "speech.md");
  fs.writeFileSync(extra, "A speech.\n");
  check(
    "add copies a new sample",
    voiceScaffold.addSamples({ configDir: config, name: "ada", sources: [extra] }).samples.join(","),
    "speech.md",
  );
  const fresh = path.join(samples, "speech2.md");
  fs.writeFileSync(fresh, "A second speech.\n");
  check(
    "add with a taken name beside a new one copies neither",
    thrownMessage(() =>
      voiceScaffold.addSamples({
        configDir: config,
        name: "ada",
        sources: [fresh, extra],
      }),
    ).includes("already holds speech.md"),
    true,
  );
  check(
    "the new file beside the taken name was not copied",
    fs.existsSync(path.join(skillDirectory, "references", "samples", "speech2.md")),
    false,
  );
  check(
    "add refuses a path that does not exist",
    thrownMessage(() =>
      voiceScaffold.addSamples({ configDir: config, name: "ada", sources: ["/no/such/file.md"] }),
    ).includes("no such file"),
    true,
  );
  check(
    "add refuses a voice that does not exist",
    thrownMessage(() =>
      voiceScaffold.addSamples({ configDir: config, name: "zed", sources: [extra] }),
    ).includes("no voice skill at skills/zed-voice"),
    true,
  );

  fs.mkdirSync(path.join(config, "outside-voice"));
  fs.writeFileSync(path.join(config, "outside-voice", "SKILL.md"), "---\nname: outside-voice\n---\n");
  check(
    "add refuses a voice name that climbs out of skills/",
    thrownMessage(() =>
      voiceScaffold.addSamples({ configDir: config, name: "../outside", sources: [extra] }),
    ).includes("is not a usable voice name"),
    true,
  );
  check(
    "a refused climbing name copies nothing outside skills/",
    fs.existsSync(path.join(config, "outside-voice", "references")),
    false,
  );
  check(
    "pair refuses a voice name that climbs out of skills/",
    thrownMessage(() =>
      voiceScaffold.startPair({ configDir: config, name: "../outside", slug: "x", today: "2026-10-10" }),
    ).includes("is not a usable voice name"),
    true,
  );

  const first = voiceScaffold.startPair({
    configDir: config,
    name: "ada",
    slug: "cover-letter",
    today: "2026-10-10",
  });
  const second = voiceScaffold.startPair({
    configDir: config,
    name: "ada",
    slug: undefined,
    today: "2026-10-11",
  });
  check("the first paired file is numbered 001", path.basename(first.file), "001-cover-letter.md");
  check("the next paired file counts upward and has a default slug", path.basename(second.file), "002-untitled.md");
  check(
    "a paired file names the owner's rewrite",
    fs.readFileSync(first.file, "utf8").includes("## Ada's rewrite"),
    true,
  );
  check(
    "a paired file carries the date it was started",
    fs.readFileSync(first.file, "utf8").includes("**Date:** 2026-10-10"),
    true,
  );
  check(
    "a slug with a path separator is refused",
    thrownMessage(() =>
      voiceScaffold.startPair({ configDir: config, name: "ada", slug: "../x", today: "2026-10-10" }),
    ).includes("not a usable slug"),
    true,
  );
}

{
  const config = voiceConfig();
  const samples = sampleDirectory();
  const twin = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-voice-twin-"));
  voiceSandboxes.push(twin);
  fs.writeFileSync(path.join(twin, "essay.md"), "Another essay.\n");
  check(
    "new refuses two sources that share a file name",
    thrownMessage(() =>
      voiceScaffold.createVoice({
        configDir: config,
        name: "ada",
        owner: "Ada Lovelace",
        sources: [samples, path.join(twin, "essay.md")],
      }),
    ).includes("essay.md is given twice"),
    true,
  );
  check(
    "a refused new leaves no skill directory behind",
    fs.existsSync(path.join(config, "skills", "ada-voice")),
    false,
  );
}

{
  const config = voiceConfig();
  const samples = sampleDirectory();
  fs.writeFileSync(path.join(samples, "README.md"), "About this folder.\n");
  const result = voiceScaffold.createVoice({
    configDir: config,
    name: "ada",
    owner: "Ada Lovelace",
    sources: [samples],
  });

  check("new skips a README.md found in a sample directory", result.samples.join(","), "essay.md,letter.txt");
  check(
    "new keeps the scaffold's own samples README.md when the directory held one",
    fs.readFileSync(
      path.join(config, "skills", "ada-voice", "references", "samples", "README.md"),
      "utf8",
    ).includes("About this folder"),
    false,
  );
}

{
  const config = voiceConfig();
  const samples = sampleDirectory();
  const named = path.join(samples, "README.md");
  fs.writeFileSync(named, "About this folder.\n");
  check(
    "new still refuses a README.md the user names explicitly",
    thrownMessage(() =>
      voiceScaffold.createVoice({
        configDir: config,
        name: "ada",
        owner: "Ada Lovelace",
        sources: [named],
      }),
    ).includes("a sample cannot be named README.md"),
    true,
  );
}

check(
  "the scaffold is not stored under skills/",
  voiceScaffold.TEMPLATE_DIRECTORY.split(path.sep).includes("skills"),
  false,
);

console.log("\nVoice command\n--------------------");

function runVoice(config, workingDirectory, args) {
  return spawnSync(process.execPath, [CCFG, "voice", ...args], {
    encoding: "utf8",
    cwd: workingDirectory,
    env: { ...process.env, CLAUDE_CONFIG_DIR: config, NO_COLOR: "1" },
  });
}

function outsideAnyRepository() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-voice-plain-"));
  voiceSandboxes.push(directory);
  return directory;
}

{
  const parsed = voiceCommand.parseArguments([
    "new",
    "ada",
    "--owner",
    "Ada Lovelace",
    "--from",
    "one.md",
    "two.md",
    "--global",
  ]);
  check("the subcommand is the first word", parsed.subcommand, "new");
  check("the name is positional", parsed.positional.join(","), "ada");
  check("--owner takes the next word", parsed.owner, "Ada Lovelace");
  check("--from takes every path up to the next flag", parsed.from.join(","), "one.md,two.md");
  check("--global is a switch", parsed.global, true);
  check(
    "a flag with no value is refused",
    thrownMessage(() => voiceCommand.parseArguments(["new", "ada", "--owner"])).includes(
      "--owner needs a value",
    ),
    true,
  );
  check(
    "an unknown flag is refused",
    thrownMessage(() => voiceCommand.parseArguments(["use", "ada", "--everywhere"])).includes(
      "unknown option --everywhere",
    ),
    true,
  );
}

{
  const config = voiceConfig();
  const plain = outsideAnyRepository();

  const empty = runVoice(config, plain, ["list"]);
  check("list with no voices exits cleanly", empty.status, 0);
  check("list with no voices names the command that makes one", empty.stdout.includes("ccfg voice new"), true);

  const made = runVoice(config, plain, ["new", "ada", "--owner", "Ada Lovelace"]);
  check("new exits cleanly", made.status, 0);
  check("new says where the skill is", made.stdout.includes(path.join("skills", "ada-voice")), true);
  check("new names the companion skill as the next step", made.stdout.includes("/voice-build ada"), true);

  const again = runVoice(config, plain, ["new", "ada", "--owner", "Ada Lovelace"]);
  check("a refused new exits 1", again.status, 1);
  check("a refused new says why on stderr", again.stderr.includes("already exists"), true);

  check("new without an owner is a usage error", runVoice(config, plain, ["new", "bob"]).status, 2);

  runVoice(config, plain, ["new", "bob", "--owner", "Bob Stone"]);
  const used = runVoice(config, plain, ["use", "bob"]);
  check("use outside a repository exits cleanly", used.status, 0);
  check("use outside a repository says it wrote the machine", used.stdout.includes("machine-wide"), true);
  check(
    "use outside a repository writes the machine settings",
    readJsonFile(path.join(config, "settings.json")).skillOverrides["ada-voice"],
    "off",
  );

  const listed = runVoice(config, plain, ["list"]);
  check("list marks the voice in force", /bob\s+Bob Stone\s+0\.1\.0\s+in force/.test(listed.stdout), true);
  check("list marks the other voice off", /ada\s+Ada Lovelace\s+0\.1\.0\s+off/.test(listed.stdout), true);

  const repository = voiceRepository();
  const local = runVoice(config, repository, ["use", "ada"]);
  check("use inside a repository says it wrote that repository only", local.stdout.includes("this repository only"), true);
  check("use inside a repository names --global", local.stdout.includes("--global"), true);
  check(
    "use inside a repository leaves the machine choice alone",
    readJsonFile(path.join(config, "settings.json")).skillOverrides["bob-voice"],
    "on",
  );
  check(
    "list inside the repository shows where the choice came from",
    /ada\s+Ada Lovelace\s+0\.1\.0\s+in force \(repository\)/.test(
      runVoice(config, repository, ["list"]).stdout,
    ),
    true,
  );

  const none = runVoice(config, repository, ["use", "--none"]);
  check("use --none exits cleanly", none.status, 0);
  check(
    "after use --none the machine's voice is in force in the repository",
    /bob\s+Bob Stone\s+0\.1\.0\s+in force \(machine\)/.test(
      runVoice(config, repository, ["list"]).stdout,
    ),
    true,
  );
  check("use --none with --global is a usage error", runVoice(config, repository, ["use", "--none", "--global"]).status, 2);
  check("use with a name and --none is a usage error", runVoice(config, repository, ["use", "ada", "--none"]).status, 2);

  const learned = runVoice(config, plain, ["learn", "ada", "--slug", "memo"]);
  check("learn prints the path of the file it made", learned.stdout.includes("001-memo.md"), true);

  const sample = path.join(plain, "note.md");
  fs.writeFileSync(sample, "A note.\n");
  check("add reports the copy", runVoice(config, plain, ["add", "ada", sample]).stdout.includes("note.md"), true);

  writeSkill(config, "cy-voice", HAND_BUILT_SKILL.replace("ada-voice", "cy-voice"));
  check(
    "list points at an unregistered voice skill",
    runVoice(config, plain, ["list"]).stdout.includes("ccfg voice register cy"),
    true,
  );
  check(
    "register exits cleanly",
    runVoice(config, plain, ["register", "cy", "--owner", "Cy Twombly"]).status,
    0,
  );
  check("an unknown subcommand is a usage error", runVoice(config, plain, ["sing"]).status, 2);

  const inherited = runVoice(config, plain, ["constructor"]);
  check("a subcommand named like an inherited property is a usage error", inherited.status, 2);
  check(
    "a subcommand named like an inherited property is reported as unknown",
    inherited.stderr.includes("unknown: voice constructor"),
    true,
  );
  const inheritedMethod = runVoice(config, plain, ["hasOwnProperty"]);
  check("a subcommand named like an inherited method is a usage error", inheritedMethod.status, 2);
  check(
    "a subcommand named like an inherited method is reported as unknown",
    inheritedMethod.stderr.includes("unknown: voice hasOwnProperty"),
    true,
  );
  check(
    "a voice named like an inherited property stays a name, not a flag",
    voiceCommand.parseArguments(["use", "constructor"]).positional.join(","),
    "constructor",
  );
}

{
  const config = voiceConfig();
  const plain = outsideAnyRepository();
  const outside = path.join(config, "evil-voice", "SKILL.md");
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, HAND_BUILT_SKILL.replace("ada-voice", "evil-voice"));
  const before = fs.readFileSync(outside, "utf8");

  const refused = runVoice(config, plain, ["register", "../evil", "--owner", "X"]);
  check("register refuses a name that climbs out of skills/", refused.status, 1);
  check("register of a climbing name writes nothing", fs.readFileSync(outside, "utf8"), before);
}

{
  const config = voiceConfig();
  const plain = outsideAnyRepository();
  check(
    "with no voice skill the health check says so without warning",
    voiceCommand.doctorFindings(config, plain).map((finding) => finding.level).join(","),
    "ok",
  );
  check(
    "with no voice in force the installer points at the command",
    voiceCommand.installPointer(config, plain).includes("ccfg voice new"),
    true,
  );

  writeSkill(config, "ada-voice", voiceText("ada-voice", "Ada Lovelace"));
  const oneActive = voiceCommand.doctorFindings(config, plain);
  check("a voice in force draws one warning", oneActive.length, 1);
  check("the warning names the owner the voice declares", oneActive[0].label.includes("Ada Lovelace"), true);
  check("the warning is a warning", oneActive[0].level, "warn");
  check("with a voice in force the installer stays quiet", voiceCommand.installPointer(config, plain), null);

  writeSkill(config, "bob-voice", voiceText("bob-voice", "Bob Stone"));
  check(
    "two voices in force at once draw a warning of their own",
    voiceCommand
      .doctorFindings(config, plain)
      .some((finding) => finding.label.includes("2 voice skills are in force at once")),
    true,
  );

  writeJsonFile(path.join(config, "settings.json"), {
    skillOverrides: { "ada-voice": "off", "bob-voice": "off" },
  });
  writeJsonFile(path.join(config, "mode.lock"), {
    mode: "quiet",
    baseSkillOverrides: { "bob-voice": "off" },
  });
  const hidden = voiceCommand.doctorFindings(config, plain);
  check(
    "a voice the mode in force hid is reported with the mode's name",
    hidden.some((finding) => finding.label.includes("mode quiet hides the voice skill ada-voice")),
    true,
  );
  check(
    "a voice the operator turned off is not blamed on the mode",
    hidden.some((finding) => finding.label.includes("bob-voice")),
    false,
  );
}

console.log("\nccfg state\n--------------------");
{
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-state-repo-"));
  fs.mkdirSync(path.join(stateRoot, ".git"));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-state-home-"));
  const contextFor = (windowIdentity, sessionIdentifier) => ({
    root: stateRoot,
    configDir: stateHome,
    live: new Set(["window-a", "window-b"]),
    windowIdentity,
    sessionIdentifier,
  });
  const outputOf = (argv, context) => {
    const lines = [];
    stateCommand.runState(argv, context, (line) => lines.push(line));
    return lines.join("\n");
  };
  const failureOf = (argv, context) => {
    try {
      stateCommand.runState(argv, context, () => {});
      return "";
    } catch (error) {
      return error.message;
    }
  };

  fs.mkdirSync(path.join(stateRoot, ".claude"));
  fs.writeFileSync(
    path.join(stateRoot, ".claude", "state.md"),
    "# Working state\n\n## Goal\n\nOld single record.\n",
  );
  fs.writeFileSync(
    path.join(stateRoot, ".gitignore"),
    "node_modules\n.claude/state.md\n.claude/state.archive.md\n",
  );
  check(
    "before migrating, state says how to turn records on",
    failureOf([], contextFor("window-a", "session-a")).includes("ccfg state migrate"),
    true,
  );

  const oldRecordWritten = new Date(2026, 9, 13, 11, 26);
  fs.utimesSync(path.join(stateRoot, ".claude", "state.md"), oldRecordWritten, oldRecordWritten);
  const migrated = stateCommand.migrate(stateRoot);
  check("migrate moves the old record into the folder", fs.existsSync(migrated.moved), true);
  check(
    "the moved record is keyed by when the old file was last written",
    stateRecords.keyOf(migrated.moved),
    "1013-1126-00",
  );
  check("the old file is gone", fs.existsSync(path.join(stateRoot, ".claude", "state.md")), false);
  check(
    "the ignore file covers the folder and drops the old lines",
    fs.readFileSync(path.join(stateRoot, ".gitignore"), "utf8"),
    "node_modules\n.claude/state/\n",
  );
  check("migrating twice changes nothing", stateCommand.migrate(stateRoot).moved, null);

  const oldKey = stateRecords.keyOf(migrated.moved);
  check(
    "a window with no record is told how to get one",
    failureOf(["path"], contextFor("window-a", "session-a")).includes("ccfg state new"),
    true,
  );

  check(
    "list shows the migrated record as unclaimed",
    outputOf(["list"], contextFor("window-a", "session-a")).includes(`${oldKey}  unclaimed  Old single record`),
    true,
  );

  outputOf(["use", oldKey], contextFor("window-a", "session-a"));
  check(
    "use points the window at the record",
    outputOf(["path"], contextFor("window-a", "session-a")),
    migrated.moved,
  );
  check(
    "use refuses a record another live window holds",
    failureOf(["use", oldKey], contextFor("window-b", "session-b")).includes("held by window-a"),
    true,
  );
  check(
    "use refuses a key that does not exist",
    failureOf(["use", "0101-0000-zz"], contextFor("window-b", "session-b")).includes("no record"),
    true,
  );

  outputOf(["new"], contextFor("window-b", "session-b"));
  const freshPath = outputOf(["path"], contextFor("window-b", "session-b"));
  check("new starts the window on another record", freshPath === migrated.moved, false);
  check("and the fresh record exists", fs.existsSync(freshPath), true);

  const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-state-other-repo-"));
  fs.mkdirSync(path.join(otherRoot, ".git"));
  fs.mkdirSync(path.join(otherRoot, ".claude", "state"), { recursive: true });
  fs.writeFileSync(path.join(otherRoot, ".gitignore"), ".claude/state/\n");
  const fromOtherRepository = { ...contextFor("window-b", "session-b"), root: otherRoot };
  check(
    "done --yes from another repository names where the record lives",
    failureOf(["done", "--yes"], fromOtherRepository).includes(freshPath),
    true,
  );
  check("and removes nothing", fs.existsSync(freshPath), true);
  fs.rmSync(otherRoot, { recursive: true, force: true });

  check(
    "state shows the goal of the window's record",
    outputOf([], contextFor("window-a", "session-a")).includes("Old single record"),
    true,
  );

  outputOf(["done"], contextFor("window-a", "session-a"));
  check("done without --yes removes nothing", fs.existsSync(migrated.moved), true);
  outputOf(["done", "--yes"], contextFor("window-a", "session-a"));
  check("done --yes removes the record", fs.existsSync(migrated.moved), false);
  check(
    "and the window no longer has one",
    failureOf(["path"], contextFor("window-a", "session-a")).includes("ccfg state new"),
    true,
  );

  check(
    "use refuses a key that climbs out of the records folder",
    failureOf(["use", "../../outside"], contextFor("window-b", "session-b")).includes("not a record key"),
    true,
  );

  fs.mkdirSync(path.join(stateRoot, ".claude"), { recursive: true });
  const collidingKeyPath = stateRecords.recordPath(stateRoot, "1013-1126-00");
  fs.writeFileSync(collidingKeyPath, "# Working state\n\n## Goal\n\nAlready here.\n");
  fs.writeFileSync(
    path.join(stateRoot, ".claude", "state.md"),
    "# Working state\n\n## Goal\n\nSecond old record.\n",
  );
  fs.utimesSync(path.join(stateRoot, ".claude", "state.md"), oldRecordWritten, oldRecordWritten);
  const collided = stateCommand.migrate(stateRoot);
  check(
    "migrate keeps a record already at the key it would use",
    fs.readFileSync(collidingKeyPath, "utf8").includes("Already here"),
    true,
  );
  check(
    "and the moved record lands under another key",
    fs.readFileSync(collided.moved, "utf8").includes("Second old record") && collided.moved !== collidingKeyPath,
    true,
  );

  for (const directory of [stateRoot, stateHome])
    fs.rmSync(directory, { recursive: true, force: true });
}

{
  const trackedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-state-tracked-"));
  gitIn(trackedRoot, ["init", "-q", "."]);
  fs.mkdirSync(path.join(trackedRoot, ".claude"));
  const trackedRecord = path.join(trackedRoot, ".claude", "state.md");
  fs.writeFileSync(trackedRecord, "# Working state\n\n## Goal\n\nCommitted record.\n");
  gitIn(trackedRoot, ["add", ".claude/state.md"]);
  gitIn(trackedRoot, ["-c", "user.email=t@t.t", "-c", "user.name=T", "commit", "-q", "-m", "seed"]);
  const lines = [];
  stateCommand.runState(
    ["migrate"],
    { root: trackedRoot, configDir: trackedRoot, live: new Set(), windowIdentity: "", sessionIdentifier: "" },
    (line) => lines.push(line),
  );
  check("migrate leaves a tracked state.md in place", fs.existsSync(trackedRecord), true);
  check("and says it was tracked and not moved", lines.join("\n").includes("tracked by git"), true);
  check("and still turns the records folder on", stateRecords.enabled(trackedRoot), true);
  fs.rmSync(trackedRoot, { recursive: true, force: true });
}

fs.rmSync(sandbox, { recursive: true, force: true });
fs.rmSync(SANDBOX_CONFIG, { recursive: true, force: true });
for (const directory of voiceSandboxes)
  fs.rmSync(directory, { recursive: true, force: true });
console.log("\ntemp profiles and sandbox config removed");

console.log(`\nPASS ${passed}  FAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
