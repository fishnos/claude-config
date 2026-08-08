"use strict";

// PostToolUse(Edit|Write): flag style-guide violations a formatter cannot fix.
//
// Only patterns that are unambiguous in the Google style guides, or that silently
// break a test suite. High precision on purpose -- a noisy hook gets ignored.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");
const paths = require("./lib/paths");

const EVENT = "PostToolUse";
const MAX_BYTES = 400000;

const WEB_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const PYTHON_EXTENSIONS = new Set([".py"]);

// [pattern, message, toleratedInTestFiles]. The style guide permits suppressions in
// tests to build partial mocks; nothing excuses a stray `.only`.
const WEB_RULES = [
  [
    /@ts-(ignore|nocheck)\b/,
    "@ts-ignore / @ts-nocheck are banned -- they hide the real error and leave the " +
      "surrounding types unpredictable. Fix the type, narrow with a guard, or use a " +
      "documented `unknown` cast.",
    true,
  ],
  [
    /^\s*var\s+[A-Za-z_$]/m,
    "`var` is function-scoped and causes scoping bugs. Use `const`, or `let` when reassigned.",
    false,
  ],
  [/^\s*debugger\s*;?\s*$/m, "`debugger` statement must not ship.", false],
  [
    /\b(describe|it|test)\.only\s*\(|^\s*(fdescribe|fit)\s*\(/m,
    "`.only` silently disables every other test in the file -- CI will pass while " +
      "covering almost nothing. Remove before committing.",
    false,
  ],
  [
    /(?<![=!<>])(?<!=)==(?!=)\s*(?!null\b)/,
    "Loose `==` coerces types unpredictably. Use `===` (only `== null` is allowed, to " +
      "catch null and undefined together). Regex-based, so check for a false positive " +
      "inside a string, comment, or regex literal.",
    false,
  ],
];

const PYTHON_RULES = [
  [
    /^\s*except\s*:/m,
    "Bare `except:` catches SystemExit and KeyboardInterrupt too. Catch a specific " +
      "exception type, or `except Exception:` if you truly mean all errors.",
    false,
  ],
  [
    /def\s+\w+\s*\([^)]*=\s*(\[\]|\{\}|set\(\))/,
    "Mutable default argument -- it is created once and shared across every call. " +
      "Default to `None` and build the container inside the function.",
    false,
  ],
  [
    /^\s*from\s+[.\w]+\s+import\s+\*/m,
    "Wildcard import makes the namespace unknowable and breaks static analysis. " +
      "Import the names you use.",
    false,
  ],
];

io.run(() => {
  const payload = io.readPayload();
  if (!["Edit", "Write", "MultiEdit"].includes(payload.tool_name)) return;

  const filePath = (payload.tool_input && payload.tool_input.file_path) || "";
  if (!filePath) return;

  const extension = paths.extensionOf(filePath);
  const isWeb = WEB_EXTENSIONS.has(extension);
  if (!isWeb && !PYTHON_EXTENSIONS.has(extension)) return;

  let source;
  try {
    if (fs.statSync(filePath).size > MAX_BYTES) return;
    source = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  // CRLF files would otherwise leave a \r before every `$`, so multiline anchors
  // silently stop matching on checkouts made with autocrlf.
  source = source.replace(/\r\n/g, "\n");

  const isTest = paths.isTestPath(filePath);
  const rules = isWeb ? WEB_RULES : PYTHON_RULES;

  const findings = [];
  for (const [pattern, message, toleratedInTests] of rules) {
    if (isTest && toleratedInTests) continue;
    const match = pattern.exec(source);
    if (!match) continue;
    const line = source.slice(0, match.index).split("\n").length;
    findings.push(
      `- ${path.basename(paths.normalize(filePath))}:${line} -- ${message}`,
    );
  }

  if (findings.length > 0) {
    io.warn(
      EVENT,
      "Style-guide violations in the file just written (google-style):\n" +
        findings.join("\n") +
        "\nFix these now rather than leaving them for review. These checks are regex-based " +
        "and cannot tell code from a string literal or comment -- if a hit is fixture data or " +
        "an example, say so and move on rather than editing it.",
    );
  }
});
