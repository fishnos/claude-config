"use strict";

// `ccfg broker install|status|uninstall` -- stands the credential broker up.
//
// The broker only helps if the account it runs as is one this user cannot
// reach. Every step here exists to keep that true, and the install refuses
// rather than degrades: a half-installed broker that still leaves the keys
// readable is worse than none, because it looks like protection.
//
// Required by tools/ccfg.js; not a command in its own right.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ACCOUNT = "_ccfgbroker";
const LABEL = "com.ccfg.broker";
const LIBEXEC = "/usr/local/libexec/ccfg-broker";
const VAR_DIR = "/usr/local/var/ccfg-broker";
const PLIST = `/Library/LaunchDaemons/${LABEL}.plist`;
const LOG_FILE = "/var/log/ccfg-broker.log";
const CONFIG_FILE = path.join(VAR_DIR, "config.json");
const DEFAULT_PORT = 8787;

// Anything under here is loaded by a process that holds the keys, so it must
// not be writable by the account the keys are being hidden from.
const INSTALLED_SCRIPT = path.join(LIBEXEC, "ccfg-broker.js");
const INSTALLED_NODE = path.join(LIBEXEC, "node");

/**
 * Report why an interpreter cannot be trusted to run as the broker, or null.
 *
 * A daemon is only as isolated as the binary it executes. Homebrew installs
 * into a prefix owned by the logged-in user, so pointing launchd at
 * /opt/homebrew/bin/node would let this user replace the interpreter and have
 * it run as the broker account -- reading the very config the account exists to
 * protect. Ownership of every ancestor matters too: write access to a parent
 * directory is write access to what it contains.
 */
function tamperableBy(target, uid) {
  let current = fs.realpathSync(target);
  for (;;) {
    const stats = fs.lstatSync(current);
    const groupOrWorldWritable = (stats.mode & 0o022) !== 0;
    if (stats.uid === uid) return `${current} is owned by uid ${uid}`;
    if (groupOrWorldWritable) return `${current} is group- or world-writable`;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** True when a binary links only against libraries that ship with macOS. */
function selfContained(binary) {
  const result = spawnSync("otool", ["-L", binary], { encoding: "utf8" });
  if (result.status !== 0) return false;
  const dependencies = result.stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" ")[0])
    .filter(Boolean);
  return dependencies.every(
    (lib) => lib.startsWith("/usr/lib/") || lib.startsWith("/System/"),
  );
}

/**
 * Find a node that can be copied somewhere root-owned and still run.
 *
 * A Homebrew node resolves its dylibs out of the Homebrew prefix, so copying
 * the binary alone produces a daemon that dies at exec with a linker error.
 * Official builds -- which is what nvm installs -- depend only on system
 * libraries, so one file is the whole interpreter.
 */
function candidateInterpreters() {
  const candidates = [process.execPath];
  const nvm = path.join(os.homedir(), ".nvm", "versions", "node");
  if (fs.existsSync(nvm))
    for (const version of fs.readdirSync(nvm).sort().reverse())
      candidates.push(path.join(nvm, version, "bin", "node"));
  candidates.push("/usr/local/bin/node", "/opt/homebrew/bin/node");
  return candidates.filter((binary) => fs.existsSync(binary));
}

function chooseInterpreter() {
  const rejected = [];
  for (const binary of candidateInterpreters()) {
    if (selfContained(binary)) return { binary, rejected };
    rejected.push(binary);
  }
  return { binary: null, rejected };
}

/**
 * Build the broker's routes from what ~/.claude.json points at today.
 *
 * Read from an installed config first: once the servers point at loopback, the
 * live file no longer knows the real upstream, and rebuilding from it would
 * pin the broker to itself.
 */
function brokerRoutes(managedSecrets, claudeJson, installedConfig) {
  const routes = {};
  for (const secret of managedSecrets) {
    const existing = (installedConfig && installedConfig.routes) || {};
    const known = existing[secret.server];
    const server = ((claudeJson || {}).mcpServers || {})[secret.server];
    const upstream = known ? known.upstream : server && server.url;
    if (!upstream || !upstream.startsWith("https://")) continue;
    const [section, header] = secret.location;
    if (section !== "headers") continue;
    routes[secret.server] = {
      upstream,
      header,
      secret: secret.variable,
    };
  }
  return routes;
}

function renderPlist({ nodePath, scriptPath }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>UserName</key><string>${ACCOUNT}</string>
  <key>GroupName</key><string>${ACCOUNT}</string>
  <key>ProgramArguments</key><array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${LOG_FILE}</string>
  <key>StandardErrorPath</key><string>${LOG_FILE}</string>
</dict></plist>
`;
}

function sudo(args, options) {
  return spawnSync("sudo", args, {
    stdio: ["inherit", "inherit", "inherit"],
    ...options,
  });
}

/** Write a file as root without its contents ever reaching a terminal. */
function sudoWrite(file, contents) {
  const result = sudo(["tee", file], {
    input: contents,
    stdio: ["pipe", "ignore", "inherit"],
  });
  if (result.status !== 0) throw new Error(`could not write ${file}`);
}

function firstFreeUid() {
  const listed = spawnSync("dscl", [".", "-list", "/Users", "UniqueID"], {
    encoding: "utf8",
  });
  const taken = new Set(
    (listed.stdout || "")
      .split("\n")
      .map((line) => Number(line.trim().split(/\s+/).pop()))
      .filter((uid) => Number.isFinite(uid)),
  );
  for (let uid = 350; uid < 400; uid += 1) if (!taken.has(uid)) return uid;
  throw new Error("no free system uid between 350 and 400");
}

function accountExists() {
  return (
    spawnSync("dscl", [".", "-read", `/Users/${ACCOUNT}`, "UniqueID"], {
      stdio: "ignore",
    }).status === 0
  );
}

function createAccount() {
  const uid = firstFreeUid();
  const settings = [
    ["/Groups/" + ACCOUNT, "PrimaryGroupID", String(uid)],
    ["/Users/" + ACCOUNT, "UniqueID", String(uid)],
    ["/Users/" + ACCOUNT, "PrimaryGroupID", String(uid)],
    ["/Users/" + ACCOUNT, "UserShell", "/usr/bin/false"],
    ["/Users/" + ACCOUNT, "NFSHomeDirectory", "/var/empty"],
    ["/Users/" + ACCOUNT, "RealName", "ccfg credential broker"],
    ["/Users/" + ACCOUNT, "IsHidden", "1"],
    ["/Users/" + ACCOUNT, "Password", "*"],
  ];
  for (const [record, key, value] of settings) {
    const result = sudo(["dscl", ".", "-create", record, key, value]);
    if (result.status !== 0)
      throw new Error(`could not set ${key} on ${record}`);
  }
  return uid;
}

/** Sleep without a timer, because every caller here is synchronous. */
function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function health(port) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = spawnSync(
      "curl",
      ["-fsS", "--max-time", "2", `http://127.0.0.1:${port}/health`],
      { encoding: "utf8" },
    );
    if (result.status === 0) return result.stdout.trim();
    pause(300);
  }
  return null;
}

function confirm(io, question) {
  process.stdout.write(`${question} [y/N] `);
  let answer = "";
  const tty = fs.openSync("/dev/tty", "r");
  try {
    const buffer = Buffer.alloc(64);
    const read = fs.readSync(tty, buffer, 0, buffer.length, null);
    answer = buffer.toString("utf8", 0, read).trim().toLowerCase();
  } finally {
    fs.closeSync(tty);
  }
  return answer === "y" || answer === "yes";
}

function commandBrokerInstall(argv, io) {
  const assumeYes = argv.includes("--yes");
  const portFlag = argv.indexOf("--port");
  const port = portFlag === -1 ? DEFAULT_PORT : Number(argv[portFlag + 1]);

  io.heading("Broker install");

  if (process.platform !== "darwin") {
    io.problem("the broker installs as a launchd daemon; macOS only");
    process.exit(1);
  }

  const source = path.join(io.CONFIG_DIR, "tools", "ccfg-broker.js");
  if (!fs.existsSync(source)) {
    io.problem(`${source} not found`);
    process.exit(1);
  }

  // Refusing here rather than falling back to whatever node is on PATH: a
  // tamperable interpreter makes the whole account boundary decorative, and an
  // install that silently accepts one is worse than no install at all.
  const { binary, rejected } = chooseInterpreter();
  if (!binary) {
    io.problem(
      "no self-contained node found to run as the broker",
      "install one with `nvm install --lts`; a Homebrew node links against " +
        "libraries in its own prefix and cannot be copied somewhere root-owned",
    );
    for (const candidate of rejected)
      console.log(io.dim(`    rejected ${candidate}`));
    process.exit(1);
  }

  const claudeJson = io.readJson(io.CLAUDE_JSON) || {};
  const installed = fs.existsSync(CONFIG_FILE)
    ? io.readJson(CONFIG_FILE)
    : null;
  const routes = brokerRoutes(io.MANAGED_SECRETS, claudeJson, installed);
  if (Object.keys(routes).length === 0) {
    io.problem(
      "no https MCP servers to broker",
      "run `ccfg keys migrate` first so ~/.claude.json still names real upstreams",
    );
    process.exit(1);
  }

  const secrets = {};
  const missing = [];
  for (const name of Object.values(routes).map((route) => route.secret)) {
    const value = io.keychainGet(name);
    if (value) secrets[name] = value;
    else missing.push(name);
  }
  if (Object.keys(secrets).length === 0) {
    io.problem(
      "none of the managed keys are in the keychain",
      "store them with `ccfg keys set <VAR>` before installing",
    );
    process.exit(1);
  }

  console.log(`\n  ${io.bold("Plan")}`);
  console.log(`    account   ${ACCOUNT} (created if absent)`);
  console.log(
    `    node      ${binary}\n              -> ${INSTALLED_NODE} (root:wheel)`,
  );
  console.log(`    daemon    ${PLIST} on 127.0.0.1:${port}`);
  for (const [name, route] of Object.entries(routes))
    console.log(`    route     /${name} -> ${route.upstream}`);
  for (const name of missing)
    console.log(io.yellow(`    skipped   ${name} is not in the keychain`));
  console.log(
    `\n  ${io.dim("sudo is needed for the account, the daemon, and the root-owned copies.")}`,
  );

  if (!assumeYes && !confirm(io, "\n  Proceed?")) {
    console.log("  nothing was changed");
    return;
  }

  if (!accountExists()) {
    const uid = createAccount();
    io.ok(`created ${ACCOUNT}`, `uid ${uid}`);
  } else io.ok(`${ACCOUNT} already exists`);

  sudo(["mkdir", "-p", LIBEXEC, VAR_DIR]);
  sudo(["cp", binary, INSTALLED_NODE]);
  sudo(["cp", source, INSTALLED_SCRIPT]);
  sudo(["chown", "-R", "root:wheel", LIBEXEC, VAR_DIR]);
  sudo(["chmod", "755", LIBEXEC, INSTALLED_NODE, VAR_DIR]);
  sudo(["chmod", "644", INSTALLED_SCRIPT]);

  const stillTamperable = tamperableBy(INSTALLED_NODE, process.getuid());
  if (stillTamperable) {
    io.problem(
      "the installed interpreter is still writable by this user",
      stillTamperable,
    );
    process.exit(1);
  }
  io.ok("interpreter and script are root-owned");

  const token = require("crypto").randomBytes(32).toString("base64");
  sudoWrite(
    CONFIG_FILE,
    JSON.stringify({ port, token, routes, secrets }, null, 2) + "\n",
  );
  sudo(["chown", `${ACCOUNT}:${ACCOUNT}`, CONFIG_FILE]);
  sudo(["chmod", "600", CONFIG_FILE]);
  io.ok(
    `wrote ${CONFIG_FILE}`,
    `0600 ${ACCOUNT}, holds ${Object.keys(secrets).length} key(s)`,
  );

  sudoWrite(
    PLIST,
    renderPlist({ nodePath: INSTALLED_NODE, scriptPath: INSTALLED_SCRIPT }),
  );
  sudo(["chown", "root:wheel", PLIST]);
  sudo(["chmod", "644", PLIST]);
  sudo(["launchctl", "bootout", `system/${LABEL}`], { stdio: "ignore" });
  const boot = sudo(["launchctl", "bootstrap", "system", PLIST]);
  if (boot.status !== 0) {
    io.problem("launchctl could not start the daemon", `see ${LOG_FILE}`);
    process.exit(1);
  }

  const reported = health(port);
  if (!reported) {
    io.problem(
      "the daemon started but /health never answered",
      `check: sudo tail ${LOG_FILE} -- then \`ccfg broker uninstall\` to roll back`,
    );
    process.exit(1);
  }
  io.ok("daemon is answering", reported);

  io.backupFile(io.CLAUDE_JSON, "broker-install");
  for (const name of Object.keys(routes))
    claudeJson.mcpServers[name] = {
      type: "http",
      url: `http://127.0.0.1:${port}/${name}`,
      headers: { "x-ccfg-token": token },
    };
  io.writeJson(io.CLAUDE_JSON, claudeJson);
  io.ok(
    "pointed Claude Code at the broker",
    "the token permits the call, not the key",
  );

  // Everything above is inert until this runs: while the keychain entries
  // remain, this user -- and so the agent -- can still read the keys, and the
  // broker is an extra hop rather than a boundary.
  console.log(`\n  ${io.bold("Seal")}`);
  console.log(
    "    The keys are now in the broker's config. Until they are removed from",
  );
  console.log(
    "    your login keychain, anything running as you can still read them.",
  );
  const seal =
    assumeYes ||
    confirm(
      io,
      `\n  Delete ${Object.keys(secrets).length} entries from your keychain?`,
    );
  if (!seal) {
    console.log(
      io.yellow(
        "\n  Left in place. The broker is running but nothing is protected yet.",
      ),
    );
    console.log(io.dim("  Seal later with: ccfg broker seal"));
  } else {
    for (const name of Object.keys(secrets)) {
      spawnSync(
        "security",
        ["delete-generic-password", "-s", io.KEYCHAIN_SERVICE, "-a", name],
        { stdio: "ignore" },
      );
      io.ok(`removed ${name} from the login keychain`);
    }
  }

  console.log(
    `\n  ${io.bold("Next:")}  restart Claude Code, then \`ccfg broker status\``,
  );
}

function commandBrokerSeal(argv, io) {
  const installed = fs.existsSync(CONFIG_FILE)
    ? io.readJson(CONFIG_FILE)
    : null;
  if (!installed) {
    io.problem(
      "no broker config to seal against",
      "run `ccfg broker install` first",
    );
    process.exit(1);
  }
  io.heading("Broker seal");
  let removed = 0;
  for (const secret of io.MANAGED_SECRETS) {
    if (!io.keychainGet(secret.variable)) continue;
    const result = spawnSync(
      "security",
      [
        "delete-generic-password",
        "-s",
        io.KEYCHAIN_SERVICE,
        "-a",
        secret.variable,
      ],
      { stdio: "ignore" },
    );
    if (result.status === 0) {
      io.ok(`removed ${secret.variable} from the login keychain`);
      removed += 1;
    }
  }
  if (removed === 0) io.ok("nothing left in the login keychain");
}

function commandBrokerStatus(argv, io) {
  io.heading("Broker status");

  if (!fs.existsSync(PLIST)) {
    io.warn("not installed", "ccfg broker install");
    return;
  }

  const printed = spawnSync("launchctl", ["print", `system/${LABEL}`], {
    encoding: "utf8",
  });
  const running = /state = running/.test(printed.stdout || "");
  if (running) io.ok("daemon is running");
  else io.problem("daemon is not running", `sudo tail ${LOG_FILE}`);

  // Read without sudo on purpose: being refused here is the control working.
  try {
    fs.readFileSync(CONFIG_FILE, "utf8");
    io.problem(
      "this user can read the broker config",
      "the keys are not actually isolated -- check ownership on " + CONFIG_FILE,
    );
  } catch {
    io.ok("broker config is unreadable by this user", "as intended");
  }

  const tamper = fs.existsSync(INSTALLED_NODE)
    ? tamperableBy(INSTALLED_NODE, process.getuid())
    : "not installed";
  if (tamper)
    io.problem("the broker's interpreter is tamperable", String(tamper));
  else io.ok("interpreter is root-owned all the way up");

  const stillHeld = io.MANAGED_SECRETS.filter((secret) =>
    io.keychainGet(secret.variable),
  ).map((secret) => secret.variable);
  if (stillHeld.length)
    io.warn(
      `${stillHeld.length} key(s) still in your login keychain: ${stillHeld.join(", ")}`,
      "ccfg broker seal",
    );
  else io.ok("no managed keys remain in the login keychain");
}

function commandBrokerUninstall(argv, io) {
  io.heading("Broker uninstall");
  sudo(["launchctl", "bootout", `system/${LABEL}`], { stdio: "ignore" });
  sudo(["rm", "-rf", PLIST, LIBEXEC, VAR_DIR]);
  sudo(["dscl", ".", "-delete", `/Users/${ACCOUNT}`], { stdio: "ignore" });
  sudo(["dscl", ".", "-delete", `/Groups/${ACCOUNT}`], { stdio: "ignore" });
  io.ok("daemon, files and account removed");
  io.warn(
    "~/.claude.json still points at 127.0.0.1",
    "restore it from ~/.claude/backups, then `ccfg keys set <VAR>` for each key",
  );
}

function commandBroker(argv, io) {
  const [subcommand, ...rest] = argv;
  if (subcommand === "install") return commandBrokerInstall(rest, io);
  if (subcommand === "status" || subcommand === undefined)
    return commandBrokerStatus(rest, io);
  if (subcommand === "seal") return commandBrokerSeal(rest, io);
  if (subcommand === "uninstall") return commandBrokerUninstall(rest, io);
  console.error(`unknown: broker ${subcommand}`);
  process.exit(2);
}

module.exports = {
  ACCOUNT,
  LABEL,
  LIBEXEC,
  VAR_DIR,
  PLIST,
  LOG_FILE,
  CONFIG_FILE,
  INSTALLED_NODE,
  INSTALLED_SCRIPT,
  DEFAULT_PORT,
  tamperableBy,
  selfContained,
  candidateInterpreters,
  chooseInterpreter,
  brokerRoutes,
  renderPlist,
  commandBroker,
};
