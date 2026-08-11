"use strict";

// Regression suite for ccfg-broker.
//
// Every case runs against a fake upstream on loopback that echoes back the
// headers it was handed, so the assertions are about what the broker actually
// sent -- not about what the code appears to do. Nothing here contacts a real
// provider or reads a real credential.
//
// Usage: node ~/.claude/tools/test-broker.js

process.env.CCFG_BROKER_ALLOW_HTTP = "1";
process.env.CCFG_BROKER_QUIET = "1";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const {
  createServer,
  loopbackHost,
  validateRoutes,
} = require("./ccfg-broker.js");
const {
  tamperableBy,
  selfContained,
  brokerRoutes,
  renderPlist,
} = require("./ccfg-broker-install.js");

/** The message validateRoutes refuses with, or null when it accepts. */
function rejectionFrom(routes) {
  try {
    validateRoutes(routes);
    return null;
  } catch (error) {
    return error.message;
  }
}

const SECRET = "ctx7sk-" + "f".repeat(30);
const TOKEN = "t".repeat(43);

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
    `[FAIL] ${label}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`,
  );
}

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
  );
}

/** Upstream that mirrors what it received, and tries to echo a credential back. */
const upstream = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    response.writeHead(200, {
      "content-type": "application/json",
      // A hostile or careless upstream reflecting the key must not reach the caller.
      "x-api-key": SECRET,
      "set-cookie": "session=abc",
      "www-authenticate": "Bearer realm=x",
    });
    response.end(JSON.stringify({ received: request.headers, body }));
  });
});

function request(
  port,
  path,
  { headers = {}, method = "POST", body = "" } = {},
) {
  return new Promise((resolve, reject) => {
    const call = http.request(
      { host: "127.0.0.1", port, path, method, headers },
      (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text,
          }),
        );
      },
    );
    call.on("error", reject);
    call.end(body);
  });
}

async function main() {
  const upstreamPort = await listen(upstream);

  const config = {
    port: 0,
    token: TOKEN,
    routes: {
      context7: {
        upstream: `http://127.0.0.1:${upstreamPort}/mcp`,
        header: "CONTEXT7_API_KEY",
        secret: "CONTEXT7_API_KEY",
      },
      unprovisioned: {
        upstream: `http://127.0.0.1:${upstreamPort}/mcp`,
        header: "X-Api-Key",
        secret: "NOT_STORED",
      },
    },
    secrets: { CONTEXT7_API_KEY: SECRET },
  };

  const broker = createServer(config);
  const port = await listen(broker);
  config.port = port;
  const auth = { "x-ccfg-token": TOKEN, host: `127.0.0.1:${port}` };

  console.log("Forwarding\n--------------------");

  const forwarded = await request(port, "/context7", {
    headers: { ...auth, "content-type": "application/json" },
    body: '{"jsonrpc":"2.0"}',
  });
  check("a valid call reaches the upstream", forwarded.status, 200);

  const seen = JSON.parse(forwarded.text).received;
  check("the broker adds the credential", seen["context7_api_key"], SECRET);
  check(
    "the request body is forwarded intact",
    JSON.parse(forwarded.text).body,
    '{"jsonrpc":"2.0"}',
  );
  check("content-type survives", seen["content-type"], "application/json");
  check(
    "the host is rewritten to the upstream",
    seen.host,
    `127.0.0.1:${upstreamPort}`,
  );
  check("the proxy token is not forwarded", seen["x-ccfg-token"], undefined);

  console.log("\nCaller cannot influence auth\n--------------------");

  const spoofed = await request(port, "/context7", {
    headers: {
      ...auth,
      authorization: "Bearer attacker",
      "x-api-key": "attacker-key",
      cookie: "a=b",
    },
    body: "{}",
  });
  const spoofedSeen = JSON.parse(spoofed.text).received;
  check(
    "a caller Authorization header is stripped",
    spoofedSeen.authorization,
    undefined,
  );
  check("a caller x-api-key is stripped", spoofedSeen["x-api-key"], undefined);
  check("a caller cookie is stripped", spoofedSeen.cookie, undefined);
  check(
    "the real credential still went out",
    spoofedSeen["context7_api_key"],
    SECRET,
  );

  console.log("\nThe secret never comes back\n--------------------");

  check(
    "an echoed x-api-key is stripped from the response",
    forwarded.headers["x-api-key"],
    undefined,
  );
  check("set-cookie is stripped", forwarded.headers["set-cookie"], undefined);
  check(
    "www-authenticate is stripped",
    forwarded.headers["www-authenticate"],
    undefined,
  );
  // Scoped to headers on purpose: this fake upstream mirrors request headers
  // into its response *body*, so the credential legitimately appears there.
  // What the broker controls, and what this asserts, is the headers it emits.
  check(
    "no response header carries the secret",
    JSON.stringify(forwarded.headers).includes(SECRET),
    false,
  );

  console.log("\nAccess control\n--------------------");

  const noToken = await request(port, "/context7", {
    headers: { host: `127.0.0.1:${port}` },
  });
  check("no token is rejected", noToken.status, 401);
  check("a rejection reveals no secret", noToken.text.includes(SECRET), false);

  const badToken = await request(port, "/context7", {
    headers: { ...auth, "x-ccfg-token": "w".repeat(43) },
  });
  check("a wrong token of equal length is rejected", badToken.status, 401);

  const shortToken = await request(port, "/context7", {
    headers: { ...auth, "x-ccfg-token": "short" },
  });
  check(
    "a wrong token of different length is rejected",
    shortToken.status,
    401,
  );

  const unknown = await request(port, "/not-a-route", { headers: auth });
  check("an unknown route is 404", unknown.status, 404);

  const unprovisioned = await request(port, "/unprovisioned", {
    headers: auth,
  });
  check("a route with no stored secret is 503", unprovisioned.status, 503);

  const rebound = await request(port, "/context7", {
    headers: { ...auth, host: "evil.example.com" },
  });
  check("a non-loopback Host is refused", rebound.status, 403);

  console.log("\nLimits\n--------------------");

  const huge = await request(port, "/context7", {
    headers: { ...auth },
    body: "x".repeat(1024 * 1024 + 64),
  });
  check("an oversized body is refused", huge.status, 413);

  const health = await request(port, "/health", {
    method: "GET",
    headers: { host: `127.0.0.1:${port}` },
  });
  check("health needs no token", health.status, 200);
  check("health leaks no secret", health.text.includes(SECRET), false);
  check(
    "health lists the routes",
    JSON.parse(health.text).routes.join(","),
    "context7,unprovisioned",
  );

  console.log("\nRoute validation\n--------------------");

  // A plaintext upstream would put the credential on the wire in the clear.
  // The daemon must refuse to start rather than discover this per request.
  delete process.env.CCFG_BROKER_ALLOW_HTTP;
  check(
    "an https upstream is accepted",
    rejectionFrom({
      good: { upstream: "https://x.test/mcp", header: "H", secret: "S" },
    }),
    null,
  );
  check(
    "a plaintext upstream is refused",
    rejectionFrom({
      bad: { upstream: "http://x.test/mcp", header: "H", secret: "S" },
    }),
    "route bad has a non-https upstream",
  );
  check(
    "a route with no upstream is refused",
    rejectionFrom({ bad: { header: "H", secret: "S" } }),
    "route bad is missing upstream, header or secret",
  );
  check(
    "a route with no secret is refused",
    rejectionFrom({ bad: { upstream: "https://x.test/mcp", header: "H" } }),
    "route bad is missing upstream, header or secret",
  );
  process.env.CCFG_BROKER_ALLOW_HTTP = "1";

  console.log("\nHost matching\n--------------------");

  check("loopback ipv4 accepted", loopbackHost("127.0.0.1:8787", 8787), true);
  check("localhost accepted", loopbackHost("localhost:8787", 8787), true);
  check(
    "a different port is refused",
    loopbackHost("127.0.0.1:9999", 8787),
    false,
  );
  check(
    "an external host is refused",
    loopbackHost("evil.example.com", 8787),
    false,
  );
  check("a missing host is refused", loopbackHost(undefined, 8787), false);

  broker.close();
  upstream.close();

  console.log("\nInstaller: interpreter trust\n--------------------");

  // The account boundary is only as good as the binary launchd executes. A
  // Homebrew prefix is owned by the logged-in user, so an interpreter there
  // could be swapped for one that prints the config -- and it would run as the
  // broker. This check is what refuses that install.
  const OTHER_UID = 99999;

  check(
    "a system binary is trusted",
    tamperableBy("/usr/bin/true", OTHER_UID),
    null,
  );

  check(
    "a binary owned by the excluded user is refused",
    String(tamperableBy("/usr/bin/true", 0)).includes("owned by uid 0"),
    true,
  );

  const ownedDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-owned-"));
  const ownedFile = path.join(ownedDir, "node");
  fs.writeFileSync(ownedFile, "");
  check(
    "a binary this user owns is refused",
    String(tamperableBy(ownedFile, process.getuid())).includes("owned by uid"),
    true,
  );

  // Ownership is not the only way in: write access to any parent directory is
  // write access to what it holds.
  const looseDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-loose-"));
  fs.chmodSync(looseDir, 0o777);
  const looseFile = path.join(looseDir, "node");
  fs.writeFileSync(looseFile, "");
  fs.chmodSync(looseFile, 0o755);
  check(
    "a binary in a world-writable directory is refused",
    String(tamperableBy(looseFile, OTHER_UID)).includes(
      "group- or world-writable",
    ),
    true,
  );

  check(
    "a system binary links only system libraries",
    selfContained("/bin/ls"),
    true,
  );

  fs.rmSync(ownedDir, { recursive: true, force: true });
  fs.rmSync(looseDir, { recursive: true, force: true });

  console.log("\nInstaller: routes and plist\n--------------------");

  const MANAGED = [
    {
      variable: "CONTEXT7_API_KEY",
      server: "context7",
      location: ["headers", "CONTEXT7_API_KEY"],
    },
    { variable: "STDIO_KEY", server: "shadcn", location: ["env", "STDIO_KEY"] },
  ];

  const live = {
    mcpServers: {
      context7: { type: "http", url: "https://mcp.context7.com/mcp" },
      shadcn: { type: "stdio" },
    },
  };

  check(
    "an https server becomes a route",
    JSON.stringify(brokerRoutes(MANAGED, live, null).context7),
    JSON.stringify({
      upstream: "https://mcp.context7.com/mcp",
      header: "CONTEXT7_API_KEY",
      secret: "CONTEXT7_API_KEY",
    }),
  );

  check(
    "a stdio server is not brokered",
    brokerRoutes(MANAGED, live, null).shadcn,
    undefined,
  );

  // Re-running the install must not pin the broker to itself: by then the live
  // config names loopback, and the real upstream is only in the stored config.
  const alreadyInstalled = {
    routes: {
      context7: {
        upstream: "https://mcp.context7.com/mcp",
        header: "CONTEXT7_API_KEY",
        secret: "CONTEXT7_API_KEY",
      },
    },
  };
  const brokered = {
    mcpServers: {
      context7: { type: "http", url: "http://127.0.0.1:8787/context7" },
    },
  };
  check(
    "reinstalling keeps the original upstream",
    brokerRoutes(MANAGED, brokered, alreadyInstalled).context7.upstream,
    "https://mcp.context7.com/mcp",
  );
  check(
    "a loopback url is never adopted as an upstream",
    brokerRoutes(MANAGED, brokered, null).context7,
    undefined,
  );

  const plist = renderPlist({
    nodePath: "/usr/local/libexec/ccfg-broker/node",
    scriptPath: "/usr/local/libexec/ccfg-broker/ccfg-broker.js",
  });
  check(
    "the daemon runs as the broker account",
    plist.includes("<string>_ccfgbroker</string>"),
    true,
  );
  check(
    "the daemon runs the root-owned interpreter",
    plist.includes("<string>/usr/local/libexec/ccfg-broker/node</string>"),
    true,
  );
  check(
    "the daemon restarts if it dies",
    plist.includes("<key>KeepAlive</key><true/>"),
    true,
  );

  console.log(`\nPASS ${passed}  FAIL ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
