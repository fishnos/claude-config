#!/usr/bin/env node
"use strict";

// ccfg -- manage this Claude Code configuration.
//
// Zero dependencies on purpose: this has to run on a machine where nothing is
// installed yet, which is exactly when setup tooling is most needed.
//
// Usage: node ~/.claude/tools/ccfg.js <command>
//        ccfg <command>          (after `ccfg install`)

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// Split out because standing up a daemon is a different job from managing this
// config, and it is the only part that needs sudo.
const brokerInstall = require("./ccfg-broker-install.js");

const CONFIG_DIR =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const CLAUDE_JSON = path.join(os.homedir(), ".claude.json");
const SETTINGS = path.join(CONFIG_DIR, "settings.json");
const SECRETS_FILE = path.join(CONFIG_DIR, "secrets.env");
const SHELL_INIT = path.join(CONFIG_DIR, "shell-init.sh");
// Overridable so a test can drive the real write path without touching the
// operator's live entries. The keychain write had no test precisely because
// exercising it meant clobbering real keys.
const KEYCHAIN_SERVICE = process.env.CCFG_KEYCHAIN_SERVICE || "ccfg";

// Every MCP secret this config knows how to manage, and where it lives inside
// ~/.claude.json. Adding a server here is all it takes for the whole toolchain
// -- migrate, check, install -- to cover it.
const MANAGED_SECRETS = [
  {
    variable: "STITCH_API_KEY",
    server: "stitch",
    location: ["headers", "X-Goog-Api-Key"],
    describe: "Google Stitch API key",
    // Checked before storing. Without this, a value typed at the wrong prompt
    // -- a passphrase, a username, an empty paste -- is filed as a credential
    // and only surfaces later as an auth failure with no obvious cause.
    pattern: /^AQ\.[A-Za-z0-9._~-]{30,}$/,
    shape: "AQ. followed by 30+ characters",
  },
  {
    // Supersedes MAGIC_API_KEY: @21st-dev/magic is a compatibility proxy for
    // old configs and its keys were reset upstream, so every old key now 401s.
    // `npx @21st-dev/cli login` writes a token to ~/.config/21st/auth.json that
    // authenticates this endpoint directly -- no separate key to issue.
    variable: "API_KEY_21ST",
    server: "21st",
    location: ["headers", "x-api-key"],
    describe: "21st.dev token (from `21st login`)",
    pattern: /^[a-f0-9]{64}$/,
    shape: "64 lowercase hex characters",
  },
  {
    variable: "CONTEXT7_API_KEY",
    server: "context7",
    location: ["headers", "CONTEXT7_API_KEY"],
    describe: "Context7 API key",
    pattern: /^ctx7sk-[A-Za-z0-9-]{20,}$/,
    shape: "ctx7sk- followed by 20+ characters",
  },
];

const isMac = process.platform === "darwin";

/* ------------------------------------------------------------------ output */

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (color ? `[${code}m${text}[0m` : text);
const bold = (text) => paint("1", text);
const red = (text) => paint("31", text);
const green = (text) => paint("32", text);
const yellow = (text) => paint("33", text);
const dim = (text) => paint("2", text);

function heading(title) {
  console.log("\n" + bold(title));
  console.log(dim("-".repeat(Math.max(title.length, 20))));
}

let problemCount = 0;
let warningCount = 0;

function ok(message, detail) {
  console.log(
    `  ${green("ok")}   ${message}${detail ? dim("  " + detail) : ""}`,
  );
}
function warn(message, fix) {
  warningCount += 1;
  console.log(`  ${yellow("warn")} ${message}`);
  if (fix) console.log(`       ${dim("fix: " + fix)}`);
}
function problem(message, fix) {
  problemCount += 1;
  console.log(`  ${red("FAIL")} ${message}`);
  if (fix) console.log(`       ${dim("fix: " + fix)}`);
}

/* ------------------------------------------------------------------- files */

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Write JSON through a temp file so an interrupted write cannot truncate the original. */
function writeJson(file, value) {
  const temporary = file + ".ccfg.tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  fs.renameSync(temporary, file);
}

function backupFile(file, label) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(CONFIG_DIR, "backups", `${label}-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, path.basename(file));
  fs.copyFileSync(file, target);
  return target;
}

function bytesToHuman(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)}${units[unit]}`;
}

function directorySize(directory) {
  let total = 0;
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  };
  walk(directory);
  return total;
}

/* ----------------------------------------------------------------- secrets */

function keychainGet(variable) {
  if (!isMac) return null;
  const result = spawnSync(
    "security",
    ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", variable, "-w"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return null;
  return (result.stdout || "").trim() || null;
}

function keychainSet(variable, value) {
  if (/[\n\r]/.test(value))
    throw new Error(`${variable} contains a newline and cannot be stored`);

  // `security -i` takes its command line on stdin, which is what keeps the
  // secret out of argv -- argv is readable via `ps` by any same-uid process for
  // the life of the call.
  //
  // The obvious alternative, piping the value into a bare
  // `add-generic-password -w`, is silently wrong: when a controlling terminal
  // exists, security prompts on /dev/tty and never reads stdin, so the piped
  // value is dropped and whatever the operator types at that prompt is stored
  // instead. It still exits 0. Measured 2026-08-10 by running both forms under
  // a pty; the piped form stored nothing and timed out waiting on the tty.
  const request = `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${variable} -w ${JSON.stringify(value)}\n`;
  const result = spawnSync("security", ["-i"], {
    input: request,
    encoding: "utf8",
    stdio: ["pipe", "ignore", "pipe"],
  });
  if (result.status !== 0)
    throw new Error(
      `keychain write failed for ${variable}: ${(result.stderr || "").trim()}`,
    );

  // Read back instead of trusting the exit status. The bug above exited 0 while
  // storing the wrong value, and a write nobody verified is not a write.
  if (keychainGet(variable) !== value)
    throw new Error(
      `keychain write for ${variable} did not round-trip; nothing usable was stored`,
    );
}

function secretsFileRead() {
  if (!fs.existsSync(SECRETS_FILE)) return {};
  const values = {};
  for (const line of fs.readFileSync(SECRETS_FILE, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

function secretsFileSet(variable, value) {
  const values = secretsFileRead();
  values[variable] = value;
  const body =
    "# Written by ccfg. Never commit this file.\n" +
    Object.entries(values)
      .map(([name, secret]) => `export ${name}=${JSON.stringify(secret)}`)
      .join("\n") +
    "\n";
  fs.writeFileSync(SECRETS_FILE, body, { mode: 0o600 });
  fs.chmodSync(SECRETS_FILE, 0o600);
}

/** Resolve a secret from every place it might live, nearest first. */
function secretLookup(variable) {
  if (process.env[variable])
    return { value: process.env[variable], source: "environment" };
  const fromKeychain = keychainGet(variable);
  if (fromKeychain) return { value: fromKeychain, source: "keychain" };
  const fromFile = secretsFileRead()[variable];
  if (fromFile) return { value: fromFile, source: "secrets.env" };
  return { value: null, source: null };
}

function secretStore(variable, value, backend) {
  const chosen = backend || (isMac ? "keychain" : "file");
  if (chosen === "keychain") keychainSet(variable, value);
  else secretsFileSet(variable, value);
  return chosen;
}

/**
 * Render a secret as an identifying hint, never as recoverable material.
 *
 * The 8 revealed characters are only a hint on a long random key. On a short
 * value they are most of it -- and a short value in this store is, by
 * definition, something that failed to be an API key.
 */
function maskSecret(value) {
  if (!value) return "";
  if (value.length < 24) return `${"*".repeat(8)} (${value.length} chars)`;
  return value.slice(0, 4) + "…" + value.slice(-4);
}

/** Read the raw value sitting at a secret's location in ~/.claude.json. */
function rawConfiguredValue(claudeJson, secret) {
  const server =
    claudeJson && claudeJson.mcpServers && claudeJson.mcpServers[secret.server];
  if (!server) return undefined;
  const container = server[secret.location[0]];
  return container ? container[secret.location[1]] : undefined;
}

const PLACEHOLDER = /^\$\{([A-Z0-9_]+)\}$/;

/* --------------------------------------------------------------- commands */

function commandKeysList() {
  heading("Managed secrets");
  const claudeJson = readJson(CLAUDE_JSON);
  for (const secret of MANAGED_SECRETS) {
    const raw = rawConfiguredValue(claudeJson, secret);
    const stored = secretLookup(secret.variable);
    const state =
      raw === undefined
        ? dim("server not configured")
        : PLACEHOLDER.test(String(raw))
          ? green("indirect ${" + secret.variable + "}")
          : red("PLAINTEXT in ~/.claude.json");
    const backing = stored.value
      ? `${stored.source} ${dim(maskSecret(stored.value))}`
      : red("not stored");
    console.log(`  ${secret.variable.padEnd(20)} ${state}`);
    console.log(`  ${" ".repeat(20)} ${dim("value:")} ${backing}`);
  }
  console.log(
    "\n" + dim("  set one with:  ccfg keys set CONTEXT7_API_KEY   (prompts)"),
  );
}

/**
 * Read a secret from the terminal without echoing it.
 *
 * The value must never be an argv element: argv is visible in `ps` for the life
 * of the process and, worse, the shell writes the whole line to history, so a
 * key passed that way outlives the command indefinitely.
 */
function readSecretFromTerminal(promptText) {
  const input = fs.openSync("/dev/tty", "rs");
  process.stderr.write(promptText);

  const buffer = Buffer.alloc(1);
  let secret = "";
  const wasRaw = process.stdin.isTTY && process.stdin.isRaw;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  try {
    for (;;) {
      const read = fs.readSync(input, buffer, 0, 1, null);
      if (read === 0) break;
      const character = buffer.toString("utf8");
      if (character === "\n" || character === "\r") break;
      if (character === "") throw new Error("cancelled");
      // Backspace, so a mistyped key can be corrected without echo.
      if (character === "" || character === "\b") {
        secret = secret.slice(0, -1);
        continue;
      }
      secret += character;
    }
  } finally {
    if (process.stdin.isTTY) process.stdin.setRawMode(Boolean(wasRaw));
    fs.closeSync(input);
    process.stderr.write("\n");
  }
  // Trimmed because a pasted key routinely carries a trailing space, and no
  // provider issues a key whose value depends on surrounding whitespace.
  return secret.trim();
}

/** Read a secret piped on stdin, for scripted use. */
function readSecretFromStdin() {
  try {
    return fs.readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
}

// Names that used to be managed, so muscle memory gets a pointer at the
// replacement rather than a bare "unknown variable".
const RETIRED_VARIABLES = {
  MAGIC_API_KEY:
    "API_KEY_21ST -- @21st-dev/magic was retired upstream and its keys reset",
};

/** Collapse a name so realistic typos compare equal: case, dashes, spacing. */
function normalizeVariable(name) {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Why `variable` may not be written to, or null if it may.
 *
 * Separate from the command so the refusals can be tested without a terminal, a
 * keychain, or a real secret to feed it.
 */
function variableRejection(variable) {
  if (MANAGED_SECRETS.some((secret) => secret.variable === variable))
    return null;

  const listing =
    "Managed names:\n" +
    MANAGED_SECRETS.map(
      (secret) => `  ${secret.variable.padEnd(20)} ${secret.describe}`,
    ).join("\n");

  // Ordered ahead of the spelling hints: a name shaped like a credential is a
  // disclosure to report, not a typo to correct.
  if (patternMatches(variable).length > 0)
    return (
      "That is a key, not a variable name.\n" +
      "It is now in your shell history and visible in `ps`.\n" +
      "Rotate it at the provider before doing anything else.\n\n" +
      listing
    );

  const retired = RETIRED_VARIABLES[variable.toUpperCase()];
  if (retired) return `${variable} is no longer managed. Use ${retired}.`;

  const near = MANAGED_SECRETS.find(
    (secret) =>
      normalizeVariable(secret.variable) === normalizeVariable(variable),
  );
  if (near)
    return `Unknown variable ${variable}. Did you mean ${near.variable}?`;

  return `Unknown variable ${variable}.\n${listing}`;
}

/**
 * Why `value` may not be stored as `variable`, or null if it may.
 *
 * Deliberately reports the shape it wanted and never the value it got: this
 * runs on input that turned out to be the wrong thing entirely, and the wrong
 * thing is routinely more sensitive than the right one.
 */
function valueRejection(variable, value) {
  const secret = MANAGED_SECRETS.find((entry) => entry.variable === variable);
  if (!secret || !secret.pattern) return null;
  if (secret.pattern.test(value)) return null;
  return (
    `That does not look like a ${secret.describe}.\n` +
    `Expected: ${secret.shape}.\n` +
    `Got: ${value.length} characters, not matching.\n\n` +
    "Nothing was stored. If this really is the key and the provider changed\n" +
    "its format, re-run with --force."
  );
}

function commandKeysSet(argv) {
  const [variable, ...rest] = argv;
  if (!variable) {
    console.error(
      "usage: ccfg keys set <VARIABLE>          (prompts, no echo)",
    );
    console.error("       <command> | ccfg keys set <VARIABLE> --stdin");
    process.exit(2);
  }

  // A value on the command line is refused outright rather than accepted with a
  // warning: by the time the warning prints, the shell has already recorded it.
  const positional = rest.filter((argument) => !argument.startsWith("--"));
  if (positional.length > 0) {
    console.error(
      red("Refusing to take the secret from the command line.\n") +
        "It would be written to your shell history and visible in `ps`.\n\n" +
        `  ccfg keys set ${variable}                 # prompts, nothing echoed\n` +
        `  cat keyfile | ccfg keys set ${variable} --stdin\n\n` +
        "If you already ran it with the value inline, treat that key as exposed:\n" +
        "rotate it at the provider and clear the line from your shell history.",
    );
    process.exit(2);
  }

  // Checked before prompting, because the interesting failure is transposing
  // the arguments -- `ccfg keys set <the-key-itself>`. Prompting for a value to
  // file under a name that is itself a live credential buries the mistake
  // instead of reporting it.
  const rejection = variableRejection(variable);
  if (rejection) {
    console.error(red(rejection));
    process.exit(2);
  }

  const value = rest.includes("--stdin")
    ? readSecretFromStdin()
    : readSecretFromTerminal(`Value for ${variable} (not echoed): `);

  if (!value) {
    console.error("no value provided");
    process.exit(2);
  }

  if (!rest.includes("--force")) {
    const badValue = valueRejection(variable, value);
    if (badValue) {
      console.error(red(badValue));
      process.exit(2);
    }
  }

  const backend = secretStore(
    variable,
    value,
    process.env.CLAUDE_SECRETS_BACKEND,
  );
  console.log(`stored ${variable} in ${backend}`);
  console.log(dim("run `ccfg keys migrate` to point ~/.claude.json at it"));
}

const REDACTION = "***REDACTED-BY-CCFG***";

// High-confidence credential shapes, mirroring the scanner in hooks/git-guard.js.
// Pattern matching matters because once `keys migrate` has run, the old value is
// gone from ~/.claude.json and ccfg no longer knows what to search backups for --
// yet that is exactly when the stale copies still hold it.
const SECRET_PATTERNS = [
  /ctx7sk-[A-Za-z0-9-]{20,}/g,
  /AQ\.[A-Za-z0-9_-]{30,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /glpat-[A-Za-z0-9_-]{20,}/g,
];

/** Credential-shaped strings in a file, whether or not ccfg knows their value. */
function patternMatches(contents) {
  const found = new Set();
  for (const pattern of SECRET_PATTERNS) {
    for (const match of contents.matchAll(pattern)) found.add(match[0]);
  }
  return [...found];
}

/** Every secret value this machine knows about, for searching backups. */
function knownSecretValues() {
  const values = new Set();
  const claudeJson = readJson(CLAUDE_JSON);
  for (const secret of MANAGED_SECRETS) {
    const raw = rawConfiguredValue(claudeJson, secret);
    if (typeof raw === "string" && !PLACEHOLDER.test(raw) && raw.length >= 12)
      values.add(raw);
    const stored = secretLookup(secret.variable);
    if (stored.value && stored.value.length >= 12) values.add(stored.value);
  }
  return [...values];
}

function walkFiles(directory, onFile) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walkFiles(full, onFile);
    else onFile(full);
  }
}

/**
 * Find secrets left behind in backups.
 *
 * Migration rewrites ~/.claude.json but cannot rewrite history: every backup
 * taken while the key was plaintext still holds it, and those files outlive the
 * rotation people assume replaced them.
 */
function commandKeysScrub(argv) {
  const apply = argv.includes("--yes");
  const secrets = knownSecretValues();

  heading(apply ? "Scrubbing backups" : "Backups holding plaintext secrets");

  const hits = [];
  const searchRoots = [path.join(CONFIG_DIR, "backups")];
  for (const root of searchRoots) {
    walkFiles(root, (file) => {
      let contents;
      try {
        if (fs.statSync(file).size > 32 * 1024 * 1024) return;
        contents = fs.readFileSync(file, "utf8");
      } catch {
        return;
      }
      const found = [
        ...new Set([
          ...secrets.filter((secret) => contents.includes(secret)),
          ...patternMatches(contents),
        ]),
      ];
      if (found.length > 0) hits.push({ file, found, contents });
    });
  }

  if (hits.length === 0) {
    ok("no plaintext secrets found in backups");
    return;
  }

  for (const hit of hits) {
    console.log(
      `  ${apply ? yellow("redact") : red("holds")} ${path.relative(CONFIG_DIR, hit.file)} ${dim(`(${hit.found.length} secret(s))`)}`,
    );
    if (!apply) continue;
    let cleaned = hit.contents;
    for (const secret of hit.found)
      cleaned = cleaned.split(secret).join(REDACTION);
    fs.writeFileSync(hit.file, cleaned);
  }

  if (apply) {
    console.log(`\n  redacted ${hits.length} file(s)`);
    console.log(
      dim("  the backups stay usable; only the secret values were replaced"),
    );
  } else {
    console.log(
      `\n  ${bold(String(hits.length))} file(s) still contain a live key.` +
        "\n  " +
        dim("re-run with --yes to replace the values in place"),
    );
    console.log(
      "\n  " +
        bold("Redacting is not rotation.") +
        " These values have been on disk in\n  plaintext; rotate them at the provider regardless.",
    );
  }
}

/**
 * Replace plaintext secrets in ~/.claude.json with ${VAR} placeholders, saving
 * whatever was there into the chosen backend first so nothing is lost.
 */
function commandKeysMigrate(argv) {
  const dryRun = argv.includes("--dry-run");
  const claudeJson = readJson(CLAUDE_JSON);
  if (!claudeJson) {
    console.error(`cannot read ${CLAUDE_JSON}`);
    process.exit(1);
  }

  heading(
    dryRun
      ? "Migration plan (dry run)"
      : "Migrating secrets out of ~/.claude.json",
  );
  // Claude Code holds ~/.claude.json open and rewrites it as it runs, so a
  // migration performed mid-session can be silently overwritten.
  if (!dryRun)
    console.log(
      dim(
        "  Quit Claude Code before this: it rewrites ~/.claude.json while running.\n",
      ),
    );
  const pending = [];
  for (const secret of MANAGED_SECRETS) {
    const raw = rawConfiguredValue(claudeJson, secret);
    if (raw === undefined) {
      console.log(
        `  ${dim("skip")} ${secret.variable} -- server "${secret.server}" not configured`,
      );
      continue;
    }
    if (PLACEHOLDER.test(String(raw))) {
      console.log(`  ${green("done")} ${secret.variable} -- already indirect`);
      continue;
    }
    pending.push({ secret, value: String(raw) });
    console.log(
      `  ${yellow("move")} ${secret.variable} ${dim(maskSecret(String(raw)))} -> ${isMac ? "keychain" : "secrets.env"}`,
    );
  }

  if (pending.length === 0) {
    console.log("\nnothing to migrate.");
    return;
  }
  if (dryRun) {
    console.log("\n" + dim("re-run without --dry-run to apply"));
    return;
  }

  const saved = backupFile(CLAUDE_JSON, "keys-migrate");
  for (const { secret, value } of pending) {
    // Never overwrite a stored value with the one found in the file. After a
    // rotation the file still holds the dead key, so clobbering here would
    // silently replace the new credential with the one it just replaced.
    const stored = secretLookup(secret.variable);
    if (stored.value && stored.value !== value) {
      console.log(
        `  ${yellow("keep")} ${secret.variable} -- a different value is already in ${stored.source};\n` +
          "       leaving it alone and only rewriting the placeholder",
      );
    } else {
      secretStore(secret.variable, value, process.env.CLAUDE_SECRETS_BACKEND);
    }
    const server = claudeJson.mcpServers[secret.server];
    server[secret.location[0]][secret.location[1]] =
      "${" + secret.variable + "}";
  }
  writeJson(CLAUDE_JSON, claudeJson);
  writeShellInit();

  console.log(`\nbacked up to ${dim(saved)}`);
  console.log(`wrote ${pending.length} placeholder(s) into ~/.claude.json`);
  console.log(
    "\n" +
      bold(
        "These keys were plaintext on disk. Rotate them at the provider, then re-run\n",
      ) +
      bold(
        "`ccfg keys set <VAR>` and paste the new one -- migration is not rotation.",
      ),
  );
  commandShellInit([]);
}

/** Generate the shim a shell profile sources to export managed secrets. */
function writeShellInit() {
  // Scoped to the `claude` invocation rather than exported into the shell.
  // Claude Code resolves ${VAR} from its own process environment, so the keys
  // only need to exist for that one command. Exporting them from a profile
  // would instead hand all three to every unrelated process the shell ever
  // spawns, for the life of the session.
  const lines = [
    "#!/bin/sh",
    "# Generated by ccfg. Supplies Claude Code MCP secrets to the `claude`",
    "# process only, where ${VAR} placeholders in ~/.claude.json resolve.",
    "# Nothing is exported into the surrounding shell.",
    "",
    "_ccfg_secret() {",
  ];
  if (isMac)
    lines.push(
      `  security find-generic-password -s ${KEYCHAIN_SERVICE} -a "$1" -w 2>/dev/null && return 0`,
    );
  lines.push(
    `  [ -f "${SECRETS_FILE}" ] || return 1`,
    `  ( . "${SECRETS_FILE}"; eval "printf '%s' \\"\\$$1\\"" )`,
    "}",
    "",
    "claude() {",
  );
  for (const secret of MANAGED_SECRETS) {
    lines.push(
      `  ${secret.variable}="\${${secret.variable}:-$(_ccfg_secret ${secret.variable})}" \\`,
    );
  }
  lines.push(
    '  command claude "$@"',
    "}",
    "",
    "# ccfg reads the same secrets directly and needs nothing exported.",
    "",
  );
  fs.writeFileSync(SHELL_INIT, lines.join("\n"), { mode: 0o700 });
  return SHELL_INIT;
}

// Fenced so a re-run can replace its own block instead of appending a second
// copy, and so an operator can see at a glance what is ccfg's and what is
// theirs.
const PROFILE_OPEN = "# >>> ccfg >>>";
const PROFILE_CLOSE = "# <<< ccfg <<<";

function profileBlock(file) {
  return [
    PROFILE_OPEN,
    "# Supplies Claude Code MCP secrets to the `claude` process only.",
    `[ -f "${file}" ] && . "${file}"`,
    PROFILE_CLOSE,
  ].join("\n");
}

/**
 * Profiles to wire, in the order a shell reads them.
 *
 * Only files that already exist are touched, except for the current shell's
 * own profile, which is created if absent -- a machine with no ~/.zshrc is a
 * fresh one, which is exactly the case this is meant to serve.
 */
function shellProfileTargets() {
  const home = os.homedir();
  const shell = path.basename(process.env.SHELL || "");
  const candidates =
    shell === "bash"
      ? [".bashrc", ".bash_profile", ".zshrc"]
      : [".zshrc", ".bashrc", ".bash_profile"];

  const targets = candidates
    .map((name) => path.join(home, name))
    .filter((file) => fs.existsSync(file));
  if (targets.length === 0) targets.push(path.join(home, candidates[0]));
  return targets;
}

/**
 * Add (or refresh) the source line in one profile.
 *
 * Returns what happened, so the caller can report it rather than guess.
 */
function wireProfile(profile, file) {
  const block = profileBlock(file);
  const existing = fs.existsSync(profile)
    ? fs.readFileSync(profile, "utf8")
    : "";

  if (existing.includes(PROFILE_OPEN)) {
    const pattern = new RegExp(
      `${PROFILE_OPEN}[\\s\\S]*?${PROFILE_CLOSE}\\n?`,
      "g",
    );
    const updated = existing.replace(pattern, block + "\n");
    if (updated === existing) return { profile, action: "unchanged" };
    backupFile(profile, "shell-profile");
    fs.writeFileSync(profile, updated);
    return { profile, action: "refreshed" };
  }

  // A hand-written line is left exactly as it is. Appending a managed block
  // next to it would source the same file twice and quietly take ownership of
  // something the operator wrote themselves.
  if (existing.includes(path.basename(file)))
    return { profile, action: "already sourced by hand" };

  backupFile(profile, "shell-profile");
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(profile, `${separator}\n${block}\n`);
  return { profile, action: "added" };
}

function commandShellInit(argv) {
  const write = (argv || []).includes("--write");
  const file = writeShellInit();

  heading("Shell integration");
  console.log(`  wrote ${file}`);

  if (!write) {
    console.log(`\n  Add this to your shell profile, or let ccfg do it:\n`);
    console.log(`    ${bold("ccfg shell-init --write")}\n`);
    console.log(`  ${dim("the line it adds:")}`);
    console.log(`    ${bold(`[ -f "${file}" ] && . "${file}"`)}\n`);
    return;
  }

  for (const profile of shellProfileTargets()) {
    const result = wireProfile(profile, file);
    const shown = profile.replace(os.homedir(), "~");
    if (result.action === "added" || result.action === "refreshed")
      ok(`${result.action} ccfg block in ${shown}`);
    else console.log(`  ${dim(`${result.action}: ${shown}`)}`);
  }

  if (path.basename(process.env.SHELL || "") === "fish")
    warn(
      "$SHELL is fish, which cannot source this POSIX file",
      `run claude from a POSIX shell, or translate ${file} by hand`,
    );

  console.log(
    `\n  ${dim("Restart your shell (or `exec $SHELL`) before launching claude.")}`,
  );
}

function commandDoctor() {
  console.log(bold("\nccfg doctor") + dim(`  (${CONFIG_DIR})`));

  heading("Secrets");
  const claudeJson = readJson(CLAUDE_JSON);
  let plaintext = 0;
  for (const secret of MANAGED_SECRETS) {
    const raw = rawConfiguredValue(claudeJson, secret);
    if (raw === undefined) continue;
    if (PLACEHOLDER.test(String(raw))) {
      const stored = secretLookup(secret.variable);
      if (stored.value)
        ok(`${secret.variable} indirect`, `from ${stored.source}`);
      else
        problem(
          `${secret.variable} is a \${placeholder} but nothing provides it`,
          `ccfg keys set ${secret.variable} <value>`,
        );
    } else {
      plaintext += 1;
      problem(
        `${secret.describe} is plaintext in ~/.claude.json`,
        "ccfg keys migrate",
      );
    }
  }
  if (plaintext === 0 && MANAGED_SECRETS.length > 0)
    ok("no plaintext MCP keys on disk");
  if (fs.existsSync(SECRETS_FILE)) {
    const mode = fs.statSync(SECRETS_FILE).mode & 0o777;
    if (mode === 0o600) ok("secrets.env permissions", "0600");
    else
      problem(
        `secrets.env is mode ${mode.toString(8)}`,
        `chmod 600 ${SECRETS_FILE}`,
      );
  }

  // Migration rewrites the live file but never the copies taken before it.
  const knownSecrets = knownSecretValues();
  let leakyBackups = 0;
  if (knownSecrets.length > 0)
    walkFiles(path.join(CONFIG_DIR, "backups"), (file) => {
      try {
        if (fs.statSync(file).size > 32 * 1024 * 1024) return;
        const contents = fs.readFileSync(file, "utf8");
        if (knownSecrets.some((secret) => contents.includes(secret)))
          leakyBackups += 1;
      } catch {
        // An unreadable backup is not evidence of a leak.
      }
    });
  if (leakyBackups > 0)
    problem(
      `${leakyBackups} backup file(s) hold a live key in plaintext`,
      "ccfg keys scrub --yes",
    );
  else if (knownSecrets.length > 0) ok("no plaintext keys left in backups");

  heading("Hooks");
  const settings = readJson(SETTINGS);
  const hookEvents =
    settings && settings.hooks ? Object.keys(settings.hooks) : [];
  for (const event of [
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "SessionStart",
    "UserPromptSubmit",
  ]) {
    if (hookEvents.includes(event)) ok(`${event} wired`);
    else warn(`${event} not wired`, "optional, but it is free leverage");
  }
  const hooksDirectory = path.join(CONFIG_DIR, "hooks");
  for (const script of [
    "git-guard.js",
    "style-check.js",
    "review-reminder.js",
    "format.js",
  ]) {
    const file = path.join(hooksDirectory, script);
    if (!fs.existsSync(file)) {
      problem(`hooks/${script} missing`, "restore it from backups/");
      continue;
    }
    const check = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });
    if (check.status === 0) ok(`hooks/${script} parses`);
    else
      problem(
        `hooks/${script} has a syntax error`,
        (check.stderr || "").split("\n")[0],
      );
  }

  heading("Permissions");
  const permissions = (settings && settings.permissions) || {};
  const allowCount = (permissions.allow || []).length;
  const denyCount = (permissions.deny || []).length;
  if (allowCount === 0)
    warn(
      "no allow rules -- every read-only command goes through a prompt",
      "see README",
    );
  else ok(`${allowCount} allow rules`);
  const denyProtectsReads = (permissions.deny || []).some((rule) =>
    rule.startsWith("Read("),
  );
  if (denyProtectsReads)
    ok(`${denyCount} deny rules, credential files covered`);
  else
    problem("no Read() denies -- .env and ssh keys are readable", "see README");

  heading("Startup cost");
  const servers = (claudeJson && claudeJson.mcpServers) || {};
  for (const [name, server] of Object.entries(servers)) {
    const args = (server.args || []).join(" ");
    if (/@latest/.test(args))
      warn(
        `MCP "${name}" runs an unpinned @latest package at every launch`,
        "pin the version",
      );
  }
  const statusLine =
    (settings && settings.statusLine && settings.statusLine.command) || "";
  if (/@latest/.test(statusLine))
    warn(
      "statusLine runs an unpinned @latest package",
      "pin it or use statusline-command.sh",
    );
  else if (statusLine) ok("statusLine pinned");

  heading("Disk");
  const total = directorySize(CONFIG_DIR);
  const noisy = [];
  for (const entry of [
    "projects",
    "file-history",
    "telemetry",
    "debug",
    "paste-cache",
  ]) {
    const directory = path.join(CONFIG_DIR, entry);
    if (!fs.existsSync(directory)) continue;
    const size = directorySize(directory);
    if (size > 100 * 1024 * 1024) noisy.push(`${entry} ${bytesToHuman(size)}`);
  }
  console.log(
    `  total ${bytesToHuman(total)}${noisy.length ? dim("  large: " + noisy.join(", ")) : ""}`,
  );
  if (total > 2 * 1024 * 1024 * 1024)
    warn("config directory over 2GB", "ccfg clean");

  console.log(
    "\n" +
      (problemCount === 0
        ? green(`no problems`) + dim(`  (${warningCount} warnings)`)
        : red(`${problemCount} problems`) +
          dim(`  (${warningCount} warnings)`)),
  );
  process.exit(problemCount === 0 ? 0 : 1);
}

function commandClean(argv) {
  const dryRun = !argv.includes("--yes");
  heading(dryRun ? "Cleanup plan (dry run)" : "Cleaning");
  let reclaimed = 0;

  // Compressed, never truncated: these logs are the only record of what was
  // actually run on this machine, and they compress by roughly 10x anyway.
  const staleLogs = ["bash-commands.log", "cost-tracker.log"];
  for (const name of staleLogs) {
    const file = path.join(CONFIG_DIR, name);
    if (!fs.existsSync(file)) continue;
    const size = fs.statSync(file).size;
    if (size === 0) continue;
    const idleDays =
      (Date.now() - fs.statSync(file).mtimeMs) / (24 * 60 * 60 * 1000);
    if (idleDays < 7) {
      console.log(`  ${dim("skip")} ${name} -- written to in the last 7 days`);
      continue;
    }
    console.log(`  archive ${name} ${dim(bytesToHuman(size))} -> ${name}.gz`);
    if (!dryRun) {
      const zlib = require("zlib");
      fs.writeFileSync(file + ".gz", zlib.gzipSync(fs.readFileSync(file)));
      reclaimed += size - fs.statSync(file + ".gz").size;
      fs.rmSync(file);
    } else {
      reclaimed += size;
    }
  }

  const ageLimitDays = Number(process.env.CLAUDE_CLEAN_DAYS || 30);
  const cutoff = Date.now() - ageLimitDays * 24 * 60 * 60 * 1000;
  for (const name of [
    "file-history",
    "paste-cache",
    "debug",
    "session-data",
    "session-env",
  ]) {
    const directory = path.join(CONFIG_DIR, name);
    if (!fs.existsSync(directory)) continue;
    let removed = 0;
    let bytes = 0;
    for (const entry of fs.readdirSync(directory)) {
      const full = path.join(directory, entry);
      let stats;
      try {
        stats = fs.statSync(full);
      } catch {
        continue;
      }
      if (stats.mtimeMs >= cutoff) continue;
      bytes += stats.isDirectory() ? directorySize(full) : stats.size;
      removed += 1;
      if (!dryRun) fs.rmSync(full, { recursive: true, force: true });
    }
    if (removed > 0) {
      reclaimed += bytes;
      console.log(
        `  prune ${name}/ ${removed} entries older than ${ageLimitDays}d ${dim(bytesToHuman(bytes))}`,
      );
    }
  }

  console.log(
    `\n  ${dryRun ? "would reclaim" : "reclaimed"} ${bold(bytesToHuman(reclaimed))}`,
  );
  if (dryRun) console.log(dim("  re-run with --yes to apply"));
  console.log(
    dim(
      "  projects/ holds session transcripts and is never touched automatically",
    ),
  );
}

/**
 * Show the commands a session actually executed.
 *
 * This is the only record in the config that is not somebody's summary, which is
 * exactly what makes it worth having: a claim about behaviour can be checked
 * against whether any command backing it ever ran.
 */
function commandEvidence(argv) {
  // Shared with the hooks so the location has exactly one definition.
  const directory = require("../hooks/lib/hook-io").evidenceDir();
  if (!fs.existsSync(directory)) {
    console.log("no evidence recorded yet");
    return;
  }

  const sessions = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => ({
      name,
      file: path.join(directory, name),
      modified: fs.statSync(path.join(directory, name)).mtimeMs,
    }))
    .sort((first, second) => second.modified - first.modified);

  if (sessions.length === 0) {
    console.log("no evidence recorded yet");
    return;
  }

  const requested = argv.find((argument) => !argument.startsWith("-"));
  const chosen = requested
    ? sessions.find((session) => session.name.startsWith(requested))
    : sessions[0];
  if (!chosen) {
    console.error(`no session matching ${requested}`);
    process.exit(1);
  }

  const entries = fs
    .readFileSync(chosen.file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  heading(`Commands run -- session ${chosen.name.replace(/\.jsonl$/, "")}`);
  // An unknown exit status renders as "?" and never as "ok". Showing success for
  // something never observed is the exact confusion this log exists to prevent.
  const describeStatus = (entry) => {
    if (entry.interrupted) return red("interrupted");
    if (typeof entry.exit !== "number") return dim("  ?");
    return entry.exit === 0 ? dim(" ok") : red(`exit ${entry.exit}`);
  };

  for (const entry of entries) {
    console.log(
      `  ${describeStatus(entry)}  ${entry.command.replace(/\s+/g, " ").slice(0, 110)}`,
    );
  }

  const failures = entries.filter(
    (entry) => typeof entry.exit === "number" && entry.exit !== 0,
  ).length;
  const interrupted = entries.filter((entry) => entry.interrupted).length;
  const unknown = entries.filter(
    (entry) => typeof entry.exit !== "number" && !entry.interrupted,
  ).length;

  console.log(`\n  ${bold(String(entries.length))} commands recorded`);
  if (failures > 0) console.log(`  ${failures} exited non-zero`);
  if (interrupted > 0) console.log(`  ${interrupted} interrupted`);
  if (unknown > 0)
    console.log(
      dim(
        `  ${unknown} with no exit status -- this harness does not report one.\n` +
          "  A recorded command means it ran, not that it succeeded.",
      ),
    );
  if (sessions.length > 1)
    console.log(
      dim(
        `  ${sessions.length - 1} older session(s); pass a session id prefix`,
      ),
    );
}

function commandTest() {
  const suites = [
    path.join(CONFIG_DIR, "hooks", "test-hooks.js"),
    path.join(CONFIG_DIR, "tools", "test-ccfg.js"),
    path.join(CONFIG_DIR, "tools", "test-broker.js"),
  ];
  let worst = 0;
  for (const suite of suites) {
    if (!fs.existsSync(suite)) {
      console.error(`${path.relative(CONFIG_DIR, suite)} not found`);
      worst = 1;
      continue;
    }
    // Every suite runs even after one fails: stopping at the first hides
    // whatever the others would have said, which is the whole point of running
    // them.
    const result = spawnSync(process.execPath, [suite], { stdio: "inherit" });
    worst = Math.max(worst, result.status === null ? 1 : result.status);
  }
  process.exit(worst);
}

function commandValidate() {
  const validator = path.join(CONFIG_DIR, "hooks", "validate-config.js");
  if (!fs.existsSync(validator)) {
    console.error("hooks/validate-config.js not found");
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [validator], { stdio: "inherit" });
  process.exit(result.status === null ? 1 : result.status);
}

function commandBackup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(CONFIG_DIR, "backups", `manual-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const files = [SETTINGS, path.join(CONFIG_DIR, "CLAUDE.md"), CLAUDE_JSON];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    fs.copyFileSync(file, path.join(directory, path.basename(file)));
  }
  fs.cpSync(path.join(CONFIG_DIR, "hooks"), path.join(directory, "hooks"), {
    recursive: true,
    force: true,
  });
  console.log(`backed up to ${directory}`);
}

/** Put a `ccfg` shim on PATH so the tool is usable by name. */
function commandInstall(argv = []) {
  heading("Installing ccfg");

  const target = path.join(os.homedir(), ".local", "bin");
  fs.mkdirSync(target, { recursive: true });
  const shim = path.join(target, "ccfg");
  fs.writeFileSync(
    shim,
    `#!/bin/sh\nexec "${process.execPath}" "${__filename}" "$@"\n`,
    { mode: 0o755 },
  );
  ok(`installed ${shim}`);
  if (!(process.env.PATH || "").split(path.delimiter).includes(target))
    warn(`${target} is not on PATH`, `add: export PATH="${target}:$PATH"`);

  writeShellInit();
  ok(`wrote ${SHELL_INIT}`);

  // Wired here rather than printed for the operator to paste: a setup step that
  // ends in "now edit this file yourself" is the step people skip, and skipping
  // it leaves every placeholder in ~/.claude.json unresolved.
  if (!argv.includes("--no-shell")) {
    for (const profile of shellProfileTargets()) {
      const result = wireProfile(profile, SHELL_INIT);
      const shown = profile.replace(os.homedir(), "~");
      if (result.action === "added" || result.action === "refreshed")
        ok(`${result.action} ccfg block in ${shown}`);
      else console.log(`  ${dim(`${result.action}: ${shown}`)}`);
    }
  }

  const missing = MANAGED_SECRETS.filter(
    (secret) => !secretLookup(secret.variable).value,
  );
  if (missing.length > 0) {
    console.log("\n  " + bold("Secrets still needed:"));
    for (const secret of missing)
      console.log(
        `    ccfg keys set ${secret.variable}   ${dim(secret.describe)}`,
      );
  }

  console.log("\n  " + bold("Next:"));
  console.log(
    "    1. ccfg keys migrate     " +
      dim("move plaintext keys out of ~/.claude.json"),
  );
  console.log(
    "    2. exec $SHELL           " + dim("pick up the shell integration"),
  );
  console.log("    3. ccfg doctor           " + dim("verify the whole setup"));
}

// Handed to the broker installer rather than imported by it: the installer
// needs this file's helpers, and this file registers the installer's commands.
// Passing them one way keeps that from becoming a require cycle.
const IO = {
  CONFIG_DIR,
  CLAUDE_JSON,
  KEYCHAIN_SERVICE,
  MANAGED_SECRETS,
  keychainGet,
  readJson,
  writeJson,
  backupFile,
  heading,
  ok,
  warn,
  problem,
  bold,
  dim,
  yellow,
};

const COMMANDS = {
  doctor: commandDoctor,
  broker: (argv) => brokerInstall.commandBroker(argv, IO),
  evidence: commandEvidence,
  clean: commandClean,
  test: commandTest,
  validate: commandValidate,
  backup: commandBackup,
  install: commandInstall,
  "shell-init": commandShellInit,
  keys: (argv) => {
    const [subcommand, ...rest] = argv;
    if (subcommand === "list" || subcommand === undefined)
      return commandKeysList();
    if (subcommand === "set") return commandKeysSet(rest);
    if (subcommand === "migrate") return commandKeysMigrate(rest);
    if (subcommand === "scrub") return commandKeysScrub(rest);
    console.error(`unknown: keys ${subcommand}`);
    process.exit(2);
  },
};

function commandHelp() {
  console.log(`
${bold("ccfg")} -- manage this Claude Code configuration

  ${bold("doctor")}              health check: secrets, hooks, permissions, startup cost, disk
  ${bold("install")}             put ccfg on PATH and wire your shell (--no-shell to skip)
  ${bold("keys list")}           show every managed secret and where its value comes from
  ${bold("keys set")} VAR        store a secret in the keychain (macOS) or secrets.env
                      prompts without echo; an inline value is refused
  ${bold("keys migrate")}        replace plaintext keys in ~/.claude.json with \${VAR}
  ${bold("keys scrub")} [--yes]   find/redact plaintext keys left behind in backups
  ${bold("broker install")}      run the key broker as a root-owned service account
                      status | seal | uninstall
  ${bold("evidence")} [session]   list the commands a session actually ran
  ${bold("shell-init")}          print the shell profile line (--write to add it for you)
  ${bold("clean")} [--yes]       gzip idle logs, prune caches older than 30 days
  ${bold("test")}                run the hook, ccfg and broker regression suites
  ${bold("validate")}            check settings.json for drift
  ${bold("backup")}              snapshot settings, CLAUDE.md, hooks and ~/.claude.json

${dim("Fresh machine:  node ~/.claude/tools/ccfg.js install")}
`);
}

// Required rather than run: hand the pure helpers to the test suite instead of
// executing a command. Nothing here touches the keychain or the filesystem.
if (require.main !== module) {
  module.exports = {
    MANAGED_SECRETS,
    variableRejection,
    valueRejection,
    maskSecret,
    normalizeVariable,
    wireProfile,
    shellProfileTargets,
    PROFILE_OPEN,
  };
} else {
  const [command, ...argv] = process.argv.slice(2);
  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    commandHelp();
  } else if (COMMANDS[command]) {
    COMMANDS[command](argv);
  } else {
    console.error(`unknown command: ${command}\n`);
    commandHelp();
    process.exit(2);
  }
}
