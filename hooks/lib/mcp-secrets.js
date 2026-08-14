"use strict";

// MCP credential classification, shared by the SessionStart sentinel and ccfg.
//
// Both need the same answer to "is this header a leaked key?", and both used to
// decide it independently: ccfg learned about the broker, the sentinel did not,
// and every session opened with a warning telling the user to rotate keys that
// were already sealed. A single definition here is the only thing that keeps a
// warning the user cannot act on from coming back.

const PLACEHOLDER = /^\$\{[A-Z0-9_]+\}$/;

// The header the broker hands an agent in place of the upstream key.
const BROKER_HEADER = "x-ccfg-token";

const LOOPBACK_URL = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//;

/**
 * Whether a server's requests go through the local key broker.
 *
 * Read from the server entry rather than the broker's own config, which is
 * deliberately unreadable by this user: a check that needed that file would be
 * admitting the isolation does not hold. A loopback url carrying the proxy
 * token is enough to tell, and it is what the agent itself sees.
 */
function isBrokered(server) {
  if (!server || typeof server.url !== "string") return false;
  return (
    LOOPBACK_URL.test(server.url) &&
    Boolean(server.headers && server.headers[BROKER_HEADER])
  );
}

/**
 * Whether one header or env entry is a credential sitting in the clear.
 *
 * The broker token names itself like a secret and is one, but it is the
 * mechanism protecting the upstream key rather than a key that escaped: it only
 * works against loopback, and rotating it protects nothing. Pointed anywhere
 * else it is a real credential on the wire, so the exemption is tied to the
 * server being brokered, not to the header name.
 *
 * Matched exactly, in the one spelling the installer writes and the daemon
 * reads. A differently-cased copy is something neither of them produced, and
 * warning about it is the safe way to be wrong.
 */
function isExposedSecret(server, key, value) {
  if (typeof value !== "string" || value.length < 16) return false;
  if (PLACEHOLDER.test(value)) return false;
  if (!/(key|token|secret|password)/i.test(key)) return false;
  return !(isBrokered(server) && key === BROKER_HEADER);
}

/** `server.KEY` for every MCP credential stored as a literal, worst case first. */
function plaintextSecrets(claudeJson) {
  const servers = (claudeJson && claudeJson.mcpServers) || {};
  const exposed = [];
  for (const [name, server] of Object.entries(servers)) {
    for (const container of [server.headers, server.env]) {
      for (const [key, value] of Object.entries(container || {}))
        if (isExposedSecret(server, key, value)) exposed.push(`${name}.${key}`);
    }
  }
  return exposed;
}

// isExposedSecret stays internal: the two callers want a whole-config verdict
// or a whole-server one, and neither has a single header in hand.
module.exports = { isBrokered, plaintextSecrets };
