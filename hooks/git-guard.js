"use strict";

// PreToolUse(Bash): block irreversible git operations, warn on review-guide violations.
//
// Blocks: --no-verify, push, force-push, hard reset, untracked-file deletion,
// whole-home staging, and staged high-confidence credentials.
// Warns: logic staged without tests, oversized diffs, malformed commit subjects.

const os = require("os");
const io = require("./lib/hook-io");
const paths = require("./lib/paths");
const commitMessage = require("./lib/commit-message");

const EVENT = "PreToolUse";

const BLOCKING_SECRETS = [
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY/, "private key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/, "GitHub token"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/, "OpenAI-style API key"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./, "JWT"],
  [/\bglpat-[A-Za-z0-9_-]{20,}/, "GitLab token"],
];

const SOFT_SECRET =
  /\b(api[_-]?key|secret|password|passwd|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*["'][^"'\s]{12,}["']/i;

const HEREDOC_START = /<<-?\s*['"]?(\w+)['"]?/;

// Leading env assignments and wrappers must be consumed before testing for `git`,
// or a prefix like `FOO=1 git push --force` skips every rule below.
const COMMAND_PREFIX =
  /^(?:(?:sudo|env|command|nohup|time|nice|xargs)\s+|[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;

/** Drop heredoc bodies so docs or scripts that merely mention git are ignored. */
function stripHeredocs(command) {
  const kept = [];
  let terminator = null;
  for (const line of command.split("\n")) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    kept.push(line);
    const match = HEREDOC_START.exec(line);
    if (match) terminator = match[1];
  }
  return kept.join("\n");
}

/** Blank out quoted content so `echo "git push"` is not read as a git invocation. */
function stripQuotes(segment) {
  return segment.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
}

/**
 * Split a command line on separators. `&&`, `||` and `;` cover POSIX shells;
 * a bare `&` is how cmd.exe chains, and is alternated last so `&&` wins.
 */
function splitCommands(command) {
  return stripHeredocs(command)
    .split(/&&|\|\||;|\n|\||&/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/** Return the segment from `git` onward if it really executes git, else null. */
function gitInvocation(segment) {
  const stripped = segment.trim().replace(COMMAND_PREFIX, "");
  return /^git\b/.test(stripped) ? stripped : null;
}

function checkBlocking(rawSegment, cwd, pushAuthorized) {
  const segment = gitInvocation(stripQuotes(rawSegment));
  if (segment === null) return;

  if (
    /(^|\s)(--no-verify|-n\s|-n$)/.test(segment) &&
    /\bgit\s+(commit|push)\b/.test(segment)
  ) {
    io.deny(
      EVENT,
      "Blocked: --no-verify skips the hooks the repo installed on purpose.\n" +
        "Fix the failing check instead. If the hook itself is wrong, fix the hook.\n" +
        "(google-cl-author / git-workflow: never bypass verification.)",
    );
  }

  if (/\bgit\s+push\b/.test(segment)) {
    if (
      /(--force\b|(?<![\w-])-f\b)/.test(segment) &&
      !segment.includes("--force-with-lease")
    ) {
      io.deny(
        EVENT,
        "Blocked: plain force-push silently discards commits anyone else pushed.\n" +
          "If history genuinely must be rewritten, use:\n" +
          "  git push --force-with-lease --force-if-includes\n" +
          "and never on a shared or under-review branch.",
      );
    }
    if (pushAuthorized) return;
    io.deny(
      EVENT,
      "Blocked: pushing is yours to do, not mine (CLAUDE.md: never commit, never push).\n" +
        "Run it yourself with `! git push ...`, or -- when you have explicitly asked for a\n" +
        "push -- prefix the command with the per-invocation escape:\n" +
        "  CLAUDE_ALLOW_PUSH=1 git push origin <branch>\n" +
        "Force-push stays blocked either way; use --force-with-lease --force-if-includes.",
    );
  }

  if (/\bgit\s+reset\b.*--hard/.test(segment)) {
    io.deny(
      EVENT,
      "Blocked: `git reset --hard` throws away uncommitted work with no undo.\n" +
        "Safer options: `git stash` to shelve it, `git restore <path>` for one file,\n" +
        "or `git revert <sha>` to undo a commit that already exists in history.",
    );
  }

  if (/\bgit\s+clean\b.*-[a-z]*f/.test(segment)) {
    io.deny(
      EVENT,
      "Blocked: `git clean -f` permanently deletes untracked files -- git has no record of them.\n" +
        "Run `git clean -n` first and confirm the list, then run the delete yourself.",
    );
  }

  if (
    /\bgit\s+add\b\s+(-A|--all|\.)\s*$/.test(segment) &&
    paths.samePath(cwd, os.homedir())
  ) {
    io.deny(
      EVENT,
      `Blocked: \`git add -A\` from your home directory (${os.homedir()}) would stage everything under it.\n` +
        "cd into the actual project first.",
    );
  }
}

function checkCommit(rawSegment, cwd) {
  const segment = gitInvocation(stripQuotes(rawSegment));
  if (segment === null) return;
  if (!/\bgit\s+commit\b/.test(segment)) return;
  if (/--dry-run\b/.test(segment)) return;

  // An amend still writes staged content into history, so it gets the secret scan.
  // Only the advisory checks are skipped -- size and coverage were judged already.
  const isAmend = /--amend\b/.test(segment);

  const staged = io
    .git(["diff", "--cached", "--name-only"], cwd)
    .split("\n")
    .filter(Boolean);
  if (staged.length === 0) return;

  const diff = io.git(["diff", "--cached", "-U0"], cwd);
  const added = diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n");

  for (const [pattern, label] of BLOCKING_SECRETS) {
    if (pattern.test(added)) {
      io.deny(
        EVENT,
        `Blocked: staged changes look like they contain a ${label}.\n` +
          "Secrets survive in git history even after deletion -- rotate the credential first,\n" +
          "then unstage the file and add it to .gitignore.\n" +
          "If this is a false positive (a fixture or example), say so and I'll note it.",
      );
    }
  }

  if (isAmend) return;

  const notes = [];

  if (SOFT_SECRET.test(added)) {
    notes.push(
      "- A staged line looks like a hardcoded credential. Verify before committing.",
    );
  }

  const logic = staged.filter(
    (file) =>
      paths.isSourceFile(file) &&
      !paths.isTestPath(file) &&
      !paths.isTestExempt(file),
  );
  const tests = staged.filter((file) => paths.isTestPath(file));
  if (logic.length > 0 && tests.length === 0) {
    const preview =
      logic.slice(0, 4).join(", ") + (logic.length > 4 ? " ..." : "");
    notes.push(
      `- Logic staged with no tests: ${preview}\n` +
        "  Tests belong in the same commit as the code they cover (google-cl-author).\n" +
        "  If tests genuinely don't apply here, say why in the commit body.",
    );
  }

  const shortstat = io.git(["diff", "--cached", "--shortstat"], cwd);
  const insertions = /(\d+) insertions?\(\+\)/.exec(shortstat);
  if (insertions && Number(insertions[1]) > 1000) {
    notes.push(
      `- ${insertions[1]} lines staged. Past ~1000 a reviewer is right to send it back;\n` +
        "  see google-cl-author for splitting strategies.",
    );
  }

  // Read from the original text -- `segment` has quoted content blanked out.
  // Covers -m and -F alike; passing the message by file is the common case for
  // anything with a body, and used to skip these checks entirely.
  const message = commitMessage.extract(rawSegment, cwd);
  if (message) {
    for (const problem of commitMessage.lint(message.text)) {
      notes.push(`- ${problem} See git-workflow.`);
    }
  }

  if (notes.length > 0) {
    io.warn(EVENT, "Before this commit lands:\n" + notes.join("\n"));
  }
}

io.run(() => {
  const payload = io.readPayload();
  if (payload.tool_name !== "Bash") return;

  const command = (payload.tool_input && payload.tool_input.command) || "";
  if (!command) return;
  const cwd = payload.cwd || process.cwd();

  // The escape is read from the command text, not the environment, so it must be
  // typed deliberately per push and can never be exported to disable the guard.
  const pushAuthorized = command.includes("CLAUDE_ALLOW_PUSH=1");

  const segments = splitCommands(command);
  for (const segment of segments) checkBlocking(segment, cwd, pushAuthorized);
  for (const segment of segments) checkCommit(segment, cwd);
});
