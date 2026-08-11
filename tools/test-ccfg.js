"use strict";

// Regression suite for ccfg's secret-name gate and shell-profile wiring.
//
// The gate exists because `ccfg keys set <name>` takes the name positionally,
// so transposing the arguments files a live credential as a variable name. It
// must refuse before prompting -- a refusal that arrives after the value is
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

fs.rmSync(sandbox, { recursive: true, force: true });
fs.rmSync(SANDBOX_CONFIG, { recursive: true, force: true });
console.log("\ntemp profiles and sandbox config removed");

console.log(`\nPASS ${passed}  FAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
