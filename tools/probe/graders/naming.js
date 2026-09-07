"use strict";

// Does this code abbreviate its identifiers?
//
// Grades against the system dictionary rather than a blocklist, because the
// interesting violations are novel: an earlier blocklist-based version passed
// `wSum` and `getWtdAvgPos` while catching `cfg`, which made the rule look far
// more effective than it was.
//
// Three defects found the hard way, all fixed here:
//   - web2 contains every single letter as an entry, so `wSum` graded clean
//   - web2 has no plurals or participles, so `groups` and `flushed` graded dirty
//   - identifiers already present in the prompt's fixture were counted against
//     the model, which had not written them

const fs = require("fs");

const DICTIONARY_FILE = "/usr/share/dict/words";

// Real words this config uses that a 1934 dictionary does not carry, plus the
// loop counters its style guide explicitly exempts.
//
// Every entry must be a word a careful engineer would spell out in full, never a
// shortening. `debounce` and `timeout` belong here because web2 predates them;
// `cfg` and `ctx` never can, because admitting them is the violation.
const ALLOWED = new Set([
  "i", "j", "k",
  "config", "configuration", "json", "async", "await", "const", "let",
  "api", "url", "uri", "id", "ids", "http", "https", "html", "css", "js",
  "util", "utils", "src", "cli", "ui", "db", "sql", "uuid", "regex",
  "callback", "async", "promise", "boolean", "int", "float", "enum",
  "todo", "readme", "npm", "node", "typescript", "javascript",
  // Vocabulary that postdates web2 (1934) but is spelled out in full.
  "debounce", "debounced", "throttle", "throttled", "timeout", "timeouts",
  "timestamp", "payload", "middleware", "endpoint", "endpoints", "webhook",
  "auth", "token", "tokens", "cache", "cached", "queue", "queued", "parser",
  "parsed", "schema", "validator", "serialize", "serialized", "normalize",
  "normalized", "pending", "resolved", "rejected", "retries", "retried",
  "backoff", "chunked", "slug", "slugify", "lowercase", "uppercase",
  "whitespace", "metadata", "namespace", "runtime", "filename", "pathname",
  "hostname", "username", "keyword", "keywords", "boolean", "nullable",
  "override", "overrides", "overridden", "config", "configs", "iterator",
  "iterable", "accumulator", "predicate", "formatter", "handler", "handlers",
]);

// Stripped in this order; the longest suffix that leaves a known word wins.
const SUFFIXES = ["ings", "edly", "ing", "ies", "ed", "es", "s", "er", "ers", "ly", "able", "ness", "ment"];

let dictionary = null;

function loadDictionary() {
  if (dictionary !== null) return dictionary;
  dictionary = new Set();
  let contents;
  try {
    contents = fs.readFileSync(DICTIONARY_FILE, "utf8");
  } catch {
    return dictionary;
  }
  for (const line of contents.split("\n")) {
    const word = line.trim().toLowerCase();
    // Single letters are dictionary entries in web2 and would let `wSum` pass.
    if (word.length > 1) dictionary.add(word);
  }
  return dictionary;
}

function isWord(candidate) {
  const words = loadDictionary();
  if (ALLOWED.has(candidate)) return true;
  if (words.has(candidate)) return true;
  for (const suffix of SUFFIXES) {
    if (!candidate.endsWith(suffix)) continue;
    const stem = candidate.slice(0, -suffix.length);
    if (stem.length < 2) continue;
    if (words.has(stem) || ALLOWED.has(stem)) return true;
    // doubled final consonant: flipped -> flip, running -> run
    if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      const undoubled = stem.slice(0, -1);
      if (words.has(undoubled) || ALLOWED.has(undoubled)) return true;
    }
    // dropped terminal e: merged -> merge, flushing -> flush
    if (words.has(stem + "e") || ALLOWED.has(stem + "e")) return true;
    // y turned to i before the suffix: supplied -> supply, tries -> try
    if (stem.endsWith("i")) {
      const restored = stem.slice(0, -1) + "y";
      if (words.has(restored) || ALLOWED.has(restored)) return true;
    }
  }
  return false;
}

function splitIdentifier(identifier) {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_$]+/)
    .filter((part) => part.length > 0 && !/^\d+$/.test(part))
    .map((part) => part.toLowerCase());
}

const DECLARATION =
  /\b(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)|\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)|([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:=>|=\s*function)/g;

/**
 * Identifiers the model declared, minus any the prompt already contained.
 *
 * The exclusion matters: a task that hands the model a file using `cfg` and asks
 * it to extend that file will otherwise score the model for the fixture's sins.
 */
function declaredIdentifiers(output, fixtureText = "") {
  const alreadyPresent = new Set();
  let fixtureMatch;
  DECLARATION.lastIndex = 0;
  while ((fixtureMatch = DECLARATION.exec(fixtureText)) !== null) {
    const name = fixtureMatch[1] || fixtureMatch[2] || fixtureMatch[3];
    if (name) alreadyPresent.add(name);
  }

  const found = new Set();
  let match;
  DECLARATION.lastIndex = 0;
  while ((match = DECLARATION.exec(output)) !== null) {
    const name = match[1] || match[2] || match[3];
    if (name && !alreadyPresent.has(name)) found.add(name);
  }
  return [...found];
}

/** Every declared identifier containing a part that is not a word. */
function grade(output, fixtureText = "") {
  const violations = [];
  for (const identifier of declaredIdentifiers(output, fixtureText)) {
    const parts = splitIdentifier(identifier);
    if (parts.length === 0) continue;
    if (parts.some((part) => !isWord(part))) violations.push(identifier);
  }
  return { violations };
}

module.exports = { grade, isWord, splitIdentifier, declaredIdentifiers };
