#!/usr/bin/env node
"use strict";

// ccfg-broker -- holds MCP API keys so the agent never can.
//
// Runs as a dedicated service account (_ccfgbroker) under launchd. Claude Code
// points at http://127.0.0.1:<port>/<route> with no credential in its config;
// this process adds the real key and forwards to a pinned upstream. The key
// therefore lives in a uid the agent cannot read, and the agent keeps the
// capability (it can call the API) without the disclosure (it never sees the
// key). Reading it requires root, and root requires the operator's password.
//
// Why a 0600 file rather than the account's keychain: an unattended daemon has
// to unlock its keychain at boot, which means storing that passphrase beside
// the ciphertext -- no better than the file, with more moving parts. The
// boundary in both designs is the uid, plus FileVault at rest.
//
// Zero dependencies, matching the rest of this config: it must run on a machine
// where nothing is installed, and every dependency here would be a dependency
// running next to a credential.

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const CONFIG_FILE =
  process.env.CCFG_BROKER_CONFIG || "/usr/local/var/ccfg-broker/config.json";

// Bodies are MCP JSON-RPC, which is small. A cap stops a local process from
// pinning the daemon's memory, and nothing legitimate comes close to it.
const MAX_BODY_BYTES = 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 120000;

// Never forwarded upstream: the caller does not get to choose how this proxy
// authenticates. Without this, anything on the machine could supply its own
// credential -- or overwrite ours -- and use the route as an open relay.
const STRIPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "x-api-key",
  "x-goog-api-key",
  "context7_api_key",
  "host",
  "connection",
  "content-length",
  "x-ccfg-token",
]);

// Never returned downstream: an upstream that echoes a credential back must not
// hand it to the caller through us.
const STRIPPED_RESPONSE_HEADERS = new Set([
  "authorization",
  "www-authenticate",
  "proxy-authenticate",
  "set-cookie",
  "x-api-key",
  "x-goog-api-key",
  "context7_api_key",
]);

function readConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  if (!config.routes || typeof config.routes !== "object")
    throw new Error("config has no routes");
  if (!config.token) throw new Error("config has no token");
  validateRoutes(config.routes);
  return config;
}

/**
 * Refuse to start on a route that would leak the key it carries.
 *
 * A plaintext upstream would put the credential on the wire in the clear, and a
 * misconfigured one is not something to discover at request time -- the daemon
 * fails loudly at boot instead, where launchd and `ccfg doctor` will show it.
 */
function validateRoutes(routes) {
  const allowPlaintext = process.env.CCFG_BROKER_ALLOW_HTTP === "1";
  for (const [name, route] of Object.entries(routes)) {
    if (!route.upstream || !route.header || !route.secret)
      throw new Error(`route ${name} is missing upstream, header or secret`);
    const url = new URL(route.upstream);
    if (url.protocol !== "https:" && !allowPlaintext)
      throw new Error(`route ${name} has a non-https upstream`);
  }
}

/** Log a line with no body, no headers, and no query string -- any of which can carry a secret. */
function log(fields) {
  if (process.env.CCFG_BROKER_QUIET === "1") return;
  process.stdout.write(
    JSON.stringify({ at: new Date().toISOString(), ...fields }) + "\n",
  );
}

function refuse(response, status, message) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: message }));
}

/**
 * Reject a Host header that is not loopback.
 *
 * A browser can be induced to resolve an attacker's domain to 127.0.0.1 (DNS
 * rebinding) and then reach a localhost service using the victim's network
 * position. Binding to loopback does not stop that; checking the Host does.
 */
function loopbackHost(hostHeader, port) {
  if (!hostHeader) return false;
  const allowed = [
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
    "127.0.0.1",
    "localhost",
  ];
  return allowed.includes(hostHeader.toLowerCase());
}

function forwardableHeaders(incoming) {
  const headers = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (STRIPPED_REQUEST_HEADERS.has(name.toLowerCase())) continue;
    headers[name] = value;
  }
  return headers;
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let overflowed = false;

    request.on("data", (chunk) => {
      if (overflowed) return;
      total += chunk.length;
      if (total > limit) {
        // Buffered chunks are dropped so an oversized upload cannot cost more
        // than the cap, but the stream keeps draining. Destroying the socket
        // here instead would reach the caller as a connection reset rather than
        // a 413, which reads as "the broker crashed" -- measured, it did.
        overflowed = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () =>
      overflowed
        ? reject(new Error("body too large"))
        : resolve(Buffer.concat(chunks)),
    );
    request.on("error", reject);
  });
}

function proxy(route, secretValue, request, response, body) {
  const upstream = new URL(route.upstream);
  const headers = forwardableHeaders(request.headers);
  headers[route.header] = secretValue;
  headers["content-length"] = Buffer.byteLength(body);
  headers.host = upstream.host;

  // Chosen from the pinned URL rather than hardcoded, so the test suite can
  // stand a fake upstream on loopback. Config load rejects any non-https
  // upstream unless that test flag is set, so this cannot downgrade a real one.
  const transport = upstream.protocol === "http:" ? http : https;
  const outbound = transport.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || 443,
      // Pinned at config time. The caller names a route, never a URL, so this
      // can never be pointed at a server the caller controls.
      path: upstream.pathname + upstream.search,
      method: request.method,
      headers,
      timeout: UPSTREAM_TIMEOUT_MS,
    },
    (upstreamResponse) => {
      const safe = {};
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
        safe[name] = value;
      }
      response.writeHead(upstreamResponse.statusCode || 502, safe);
      // Piped rather than buffered: MCP streams responses as server-sent
      // events, and buffering would stall every streaming tool call.
      upstreamResponse.pipe(response);
      log({ route: route.name, status: upstreamResponse.statusCode });
    },
  );

  outbound.on("timeout", () => {
    outbound.destroy();
    if (!response.headersSent) refuse(response, 504, "upstream timeout");
  });
  outbound.on("error", (error) => {
    log({ route: route.name, error: error.code || "upstream error" });
    if (!response.headersSent) refuse(response, 502, "upstream unreachable");
  });

  outbound.end(body);
}

function createServer(config) {
  return http.createServer(async (request, response) => {
    if (!loopbackHost(request.headers.host, config.port)) {
      log({ reject: "host" });
      refuse(response, 403, "forbidden");
      return;
    }

    const name = (request.url || "").split("?")[0].replace(/^\/+|\/+$/g, "");

    if (name === "health") {
      // Deliberately reports no secret material -- only whether each route is
      // configured, which is what a health check needs to be useful.
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          routes: Object.keys(config.routes).sort(),
        }),
      );
      return;
    }

    // Compared with a constant-time check so a caller cannot recover the token
    // by measuring how long a rejection takes.
    const presented = Buffer.from(
      String(request.headers["x-ccfg-token"] || ""),
    );
    const expected = Buffer.from(String(config.token));
    const tokenOk =
      presented.length === expected.length &&
      crypto.timingSafeEqual(presented, expected);
    if (!tokenOk) {
      log({ reject: "token", route: name });
      refuse(response, 401, "unauthorized");
      return;
    }

    const route = config.routes[name];
    if (!route) {
      log({ reject: "route", route: name });
      refuse(response, 404, "no such route");
      return;
    }

    const secretValue = (config.secrets || {})[route.secret];
    if (!secretValue) {
      log({ reject: "secret-missing", route: name });
      refuse(response, 503, "route not provisioned");
      return;
    }

    let body;
    try {
      body = await readBody(request, MAX_BODY_BYTES);
    } catch {
      refuse(response, 413, "body too large");
      return;
    }

    proxy({ ...route, name }, secretValue, request, response, body);
  });
}

function main() {
  const config = readConfig();
  const server = createServer(config);
  server.listen(config.port, "127.0.0.1", () => {
    log({
      listening: `127.0.0.1:${config.port}`,
      routes: Object.keys(config.routes),
    });
  });

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

if (require.main === module) main();
else
  module.exports = {
    createServer,
    loopbackHost,
    forwardableHeaders,
    validateRoutes,
  };
