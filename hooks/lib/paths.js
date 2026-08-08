"use strict";

// Path classification shared by the git and style hooks.
//
// Every matcher below runs against a forward-slash form of the path. Windows
// hands us `src\__tests__\a.test.ts`, which would silently miss every `/`-anchored
// pattern here and quietly reclassify test files as production logic.

const path = require("path");

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".java",
  ".cs",
  ".rb",
  ".swift",
  ".kt",
]);

// Extensions above plus the ones that count as "source was edited" for the
// self-review gate but are not expected to carry unit tests of their own.
const EDITED_SOURCE_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  ".sh",
  ".bash",
  ".sql",
  ".css",
  ".scss",
]);

const TEST_PATH =
  /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$/;

// Paths where absent tests are expected rather than a finding.
const TEST_EXEMPT = new RegExp(
  "(^|/)(migrations?|__generated__|generated|vendor|node_modules|\\.next|dist|build)/" +
    "|\\.d\\.ts$" +
    "|(^|/)(page|layout|loading|error|not-found|route|middleware)\\.(t|j)sx?$",
);

/** Forward-slash form, so one set of patterns works on every platform. */
function normalize(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function extensionOf(filePath) {
  return path.extname(normalize(filePath)).toLowerCase();
}

function isTestPath(filePath) {
  return TEST_PATH.test(normalize(filePath));
}

function isTestExempt(filePath) {
  return TEST_EXEMPT.test(normalize(filePath));
}

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(extensionOf(filePath));
}

function isEditedSourceFile(filePath) {
  return EDITED_SOURCE_EXTENSIONS.has(extensionOf(filePath));
}

/**
 * Compare two paths as the running platform's filesystem would. Windows and
 * macOS treat case as insignificant, so a literal string compare would let
 * `C:\Users\me` slip past a guard keyed on `C:\Users\Me`.
 */
function samePath(left, right) {
  const canonical = (value) =>
    path
      .resolve(String(value || ""))
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");
  const a = canonical(left);
  const b = canonical(right);
  return process.platform === "win32" || process.platform === "darwin"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

module.exports = {
  SOURCE_EXTENSIONS,
  normalize,
  extensionOf,
  isTestPath,
  isTestExempt,
  isSourceFile,
  isEditedSourceFile,
  samePath,
};
