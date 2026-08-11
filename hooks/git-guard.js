"use strict";

// PreToolUse(Bash): block irreversible git operations, warn on review-guide violations.
//
// Blocks: --no-verify, commit, push, force-push, hard reset, untracked-file
// deletion, whole-home staging, staged high-confidence credentials, and the
// outward-facing non-git commands (gh, npm publish, vercel, supabase) that
// publish or destroy state outside this machine.
// Warns: logic staged without tests, oversized diffs, malformed commit subjects.
//
// Every block has a narrow, per-invocation escape (CLAUDE_ALLOW_*=1) typed into
// the command itself. Escapes are deliberately per-family, never one blanket
// switch -- authorising a deploy must not also authorise a repo deletion.

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
  // The three this config actually carries. None matched the patterns above:
  // `ctx7sk-` has no word boundary before `sk-`, and the other two are opaque.
  [/\bctx7sk-[A-Za-z0-9-]{20,}/, "Context7 API key"],
  [/\bAQ\.[A-Za-z0-9_-]{30,}/, "Google API key"],
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
 * Split a command line on separators that are not inside quotes.
 *
 * `&&`, `||` and `;` cover POSIX shells; a bare `&` is how cmd.exe chains.
 * Quote tracking is the point: splitting the raw text first would tear
 * `echo 'a && gh repo delete x'` into a fragment that reads as a real
 * invocation, because the quotes that made it inert end up in another segment.
 */
function splitCommands(command) {
  const text = stripHeredocs(command);
  const segments = [];
  let current = "";
  let quote = null;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quote !== null) {
      current += character;
      // A backslash only escapes inside double quotes; in single quotes POSIX
      // treats it literally, so the closing quote still closes.
      if (character === quote && !(quote === '"' && text[index - 1] === "\\"))
        quote = null;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === "\\") {
      current += character + (text[index + 1] || "");
      index += 1;
      continue;
    }
    if (character === ";" || character === "\n") {
      segments.push(current);
      current = "";
      continue;
    }
    if (character === "&" || character === "|") {
      if (text[index + 1] === character) index += 1;
      segments.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  segments.push(current);

  return segments.map((segment) => segment.trim()).filter(Boolean);
}

// `npx vercel --prod` must be read as a vercel invocation, or every rule below
// is one `npx` away from bypass. Kept separate from COMMAND_PREFIX because a
// package runner names the program it runs, where `sudo`/`env` do not.
const RUNNER_PREFIX =
  /^(?:(?:npx|bunx)\s+(?:-y\s+|--yes\s+)?|pnpm\s+dlx\s+|yarn\s+dlx\s+)+/;

/** Strip leading env assignments and wrappers to expose the program being run. */
function bareCommand(segment) {
  return segment.trim().replace(COMMAND_PREFIX, "");
}

// Global options sit between `git` and the subcommand, and the ones listed here
// consume the token after them. Without this, `git -C /repo push` reads as a git
// invocation whose subcommand never matches /\bgit\s+push\b/ -- every rule below
// would be one `-C` away from bypass.
const GIT_GLOBAL_TAKING_VALUE =
  /^(?:-C|-c|--exec-path|--git-dir|--work-tree|--namespace|--super-prefix|--config-env)$/;

/** Normalise `git -C path -c k=v push` to `git push` so subcommand rules match. */
function stripGitGlobals(segment) {
  const rest = segment.split(/\s+/).slice(1);
  let index = 0;
  while (index < rest.length && rest[index].startsWith("-")) {
    index += GIT_GLOBAL_TAKING_VALUE.test(rest[index]) ? 2 : 1;
  }
  return ["git", ...rest.slice(index)].join(" ");
}

/** Return the segment from `git` onward if it really executes git, else null. */
function gitInvocation(segment) {
  const stripped = bareCommand(segment);
  return /^git\b/.test(stripped) ? stripGitGlobals(stripped) : null;
}

/**
 * Irreversible or outward-facing commands that are not git.
 *
 * Precision matters more than coverage here: `gh repo view`, `gh api repos/...`
 * (a GET), `vercel env ls` and `supabase migration list` are all read-only and
 * run constantly, so every pattern names the mutating verb explicitly rather
 * than matching the binary.
 */
const OUTWARD_DENIED = [
  [
    /^gh\s+repo\s+(?:delete|archive|rename|transfer)\b/,
    "CLAUDE_ALLOW_GH",
    "This destroys or renames a repository on GitHub. There is no local undo, and\n" +
      "forks, links and clones elsewhere break immediately.",
  ],
  [
    /^gh\s+pr\s+merge\b/,
    "CLAUDE_ALLOW_GH",
    "Merging a pull request lands code in a shared branch. That is a review\n" +
      "decision, not a mechanical one (CLAUDE.md: never commit, never push).",
  ],
  [
    /^gh\s+release\s+(?:create|delete)\b/,
    "CLAUDE_ALLOW_GH",
    "A release is public the moment it exists, and deleting one breaks anything\n" +
      "already pinned to it.",
  ],
  [
    /^gh\s+api\b(?=.*(?:-X\s*|--method[= ])(?:POST|PUT|PATCH|DELETE))/i,
    "CLAUDE_ALLOW_GH",
    "This is a writing call to the GitHub API. Read-only `gh api` (the default\n" +
      "GET) is not blocked -- only the mutating methods are.",
  ],
  [
    /^(?:npm|pnpm|yarn|bun)\s+publish\b/,
    "CLAUDE_ALLOW_PUBLISH",
    "Publishing to a registry is permanent -- a version number can never be\n" +
      "reused, even after unpublishing.",
  ],
  [
    /^vercel\b(?=.*\benv\s+(?:add|rm|remove)\b)/,
    "CLAUDE_ALLOW_DEPLOY",
    "This writes or deletes a deployment environment variable, usually a live\n" +
      "credential. `vercel env ls` and `vercel env pull` are not blocked.",
  ],
  [
    /^vercel\b(?=.*\b(?:promote|rollback)\b)/,
    "CLAUDE_ALLOW_DEPLOY",
    "This changes which build is serving production traffic.",
  ],
  [
    /^vercel\b(?!.*\bbuild\b)(?=.*--prod\b)/,
    "CLAUDE_ALLOW_DEPLOY",
    "This ships to production. A local `vercel build --prod` is not blocked.",
  ],
  [
    /^supabase\s+db\s+(?:push|reset)\b/,
    "CLAUDE_ALLOW_DB",
    "This mutates a real database schema. CLAUDE.md: verify a migration against a\n" +
      "real database before calling it done, and never apply ad-hoc.",
  ],
  [
    /^supabase\s+migration\s+repair\b/,
    "CLAUDE_ALLOW_DB",
    "Repairing migration history rewrites what the remote believes it has applied.\n" +
      "Getting it wrong desynchronises schema from code silently.",
  ],
];

/**
 * Credential material that must not be read through a shell.
 *
 * settings.json already denies these paths, but a `permissions.deny` entry only
 * binds the Read tool -- `cat ~/.ssh/id_ed25519` walks straight past it. This is
 * where that gap closes, because every Bash command arrives here first.
 *
 * Matched against the whole command rather than per-segment, so redirection
 * (`< ~/.aws/credentials`), interpreters (`node -e "...readFileSync..."`) and
 * archive tricks (`tar czf - ~/.ssh`) are all covered by naming the path rather
 * than trying to enumerate the readers.
 *
 * This is a floor, not a boundary. Anything with code execution as this user can
 * eventually reach these files; what this buys is that it cannot happen by
 * accident, in passing, or without the operator seeing a refusal.
 */
const CREDENTIAL_PATTERNS = [
  [/\.ssh\b/, "an SSH directory"],
  [/\bid_(?:rsa|dsa|ecdsa|ed25519)\b/, "an SSH private key"],
  [/\.aws\b/, "AWS credentials"],
  [/\.config\/gcloud\b/, "Google Cloud credentials"],
  [/\.config\/gh\b/, "a GitHub CLI token"],
  [/\.docker\b/, "Docker registry credentials"],
  [/\.gnupg\b/, "a GPG keyring"],
  [/\.netrc\b/, "a .netrc"],
  [/\.npmrc\b/, "an npm token"],
  [/\.(?:pem|p12|pfx)\b/, "a private key or certificate bundle"],
  [/\bsecrets\.env\b/, "the ccfg secrets file"],
  [/\bcredentials\.json\b/, "a credentials file"],
  [/\.config\/21st\b/, "a 21st.dev token"],
  [
    /\bsecurity\s+(?:find-generic-password|find-internet-password|dump-keychain)\b/,
    "the macOS keychain",
  ],
];

// `.env.example` and friends are templates by convention, hold no live values,
// and are read constantly during ordinary scaffolding. Blocking them would cost
// something real and buy nothing.
// The lookbehind is what keeps `process.env.HOME` -- which appears in ordinary
// JavaScript constantly -- from reading as a dotenv path. A real one is preceded
// by a separator (space, quote, slash) or starts the token; `process.env` is
// preceded by an identifier character.
const ENV_FILE = /(?<![A-Za-z0-9_])\.env(?:\.[A-Za-z0-9_-]+)*/g;
const ENV_TEMPLATE = /(?:example|sample|template|dist)$/i;

function mentionsLiveEnvFile(command) {
  for (const match of command.matchAll(ENV_FILE)) {
    if (!ENV_TEMPLATE.test(match[0])) return true;
  }
  return false;
}

/**
 * Ways to print the environment, which after `shell-init.sh` runs holds every
 * MCP key. The variable pattern is by shape rather than by name so it keeps
 * working when a new secret is added to ccfg without anyone updating this list.
 */
const ENV_DUMP = [
  [
    /(?:^|[;&|]\s*)(?:env|printenv|export\s+-p|set)\s*(?:$|[|>&;])/,
    "printing the whole environment",
  ],
  [
    /\bprintenv\s+[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*/i,
    "printing a credential variable",
  ],
  [
    /\$\{?[A-Z0-9_]*(?:API_KEY|_TOKEN|_SECRET|_PASSWORD)[A-Z0-9_]*\}?/,
    "expanding a credential variable",
  ],
];

const SECRET_READ_ESCAPE = "CLAUDE_ALLOW_SECRET_READ";

/**
 * Remove quoting so the patterns see the path the kernel will resolve.
 *
 * `cat ~/.s''sh/id_rsa` and `cat ~/.ss\h/id_rsa` open the same file as the
 * plain spelling -- the shell strips the quotes and backslashes first. Matching
 * only the literal text would make the whole check one apostrophe from useless.
 * Measured: the quoted form read a fixture file before this existed.
 */
function collapseQuoting(command) {
  return command.replace(/['"\\]/g, "");
}

function checkSecretRead(command) {
  if (command.includes(SECRET_READ_ESCAPE + "=1")) return;

  const forms = [command, collapseQuoting(command)];
  const matches = (pattern) => forms.some((form) => pattern.test(form));

  const reasons = [];
  for (const [pattern, describe] of CREDENTIAL_PATTERNS)
    if (matches(pattern)) reasons.push(describe);
  if (forms.some(mentionsLiveEnvFile)) reasons.push("a .env file");
  for (const [pattern, describe] of ENV_DUMP)
    if (matches(pattern)) reasons.push(describe);

  if (reasons.length === 0) return;
  io.deny(
    EVENT,
    `Blocked: this command touches ${[...new Set(reasons)].join(", ")}.\n\n` +
      "Credential material is not read through the shell. A `permissions.deny`\n" +
      "rule only binds the Read tool, so this hook is what actually enforces it.\n\n" +
      "If you genuinely need it, run it yourself with `! <command>`, or -- when\n" +
      "you have explicitly asked for it -- prefix this one invocation with:\n" +
      `  ${SECRET_READ_ESCAPE}=1 <command>`,
  );
}

const OUTWARD_WARNED = [
  [
    /^gh\s+pr\s+create\b/,
    "Opening a pull request notifies reviewers and is visible immediately.\n" +
      "Confirm the branch, base and description are what you intend.",
  ],
  [
    /^gh\s+repo\s+create\b/,
    "This creates a repository on GitHub. Check the visibility flag -- `--public`\n" +
      "cannot be taken back once the code is indexed.",
  ],
];

/** Normalise a segment to the program it actually runs, past wrappers and runners. */
function outwardTarget(rawSegment) {
  return bareCommand(stripQuotes(rawSegment)).replace(RUNNER_PREFIX, "");
}

function checkOutward(rawSegment, command) {
  const segment = outwardTarget(rawSegment);
  if (!segment) return;

  for (const [pattern, escape, explanation] of OUTWARD_DENIED) {
    if (!pattern.test(segment)) continue;
    // `continue`, not `return`: authorising one family must not skip the checks
    // for every other family in the same segment.
    if (command.includes(escape + "=1")) continue;
    io.deny(
      EVENT,
      `Blocked: ${explanation}\n\n` +
        "Run it yourself with `! <command>`, or -- when you have explicitly asked\n" +
        `for it -- prefix this one invocation with: ${escape}=1`,
    );
  }
}

/**
 * Warnings are collected rather than emitted, because io.warn exits the process.
 * Emitting one mid-scan would end the scan: `gh pr create && gh repo delete`
 * would warn about the first segment and never reach the deny on the second.
 */
function outwardWarnings(rawSegment) {
  const segment = outwardTarget(rawSegment);
  if (!segment) return [];
  return OUTWARD_WARNED.filter(([pattern]) => pattern.test(segment)).map(
    ([, explanation]) => explanation,
  );
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

function checkCommit(rawSegment, cwd, commitAuthorized) {
  const segment = gitInvocation(stripQuotes(rawSegment));
  if (segment === null) return;
  if (!/\bgit\s+commit\b/.test(segment)) return;
  if (/--dry-run\b/.test(segment)) return;

  // Denying here rather than in settings.json is deliberate: a permission rule
  // matches a literal prefix, so `git -C /repo commit` and `FOO=1 git commit`
  // both walk straight past it. This sees the same command every other rule does.
  if (!commitAuthorized) {
    io.deny(
      EVENT,
      "Blocked: committing is yours to do, not mine (CLAUDE.md: never commit, never push).\n" +
        "Stage the work and hand it over, or -- when you have explicitly asked for a\n" +
        "commit -- prefix the command with the per-invocation escape:\n" +
        '  CLAUDE_ALLOW_COMMIT=1 git commit -m "..."\n' +
        "The escape still runs the secret scan and the review checks; it only lifts this block.",
    );
  }

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

  // Escapes are read from the command text, not the environment, so each must be
  // typed deliberately per invocation and can never be exported to disable the guard.
  const pushAuthorized = command.includes("CLAUDE_ALLOW_PUSH=1");
  const commitAuthorized = command.includes("CLAUDE_ALLOW_COMMIT=1");

  // Every deny pass runs to completion before anything is allowed to emit, so a
  // warning in one segment can never cut short the scan of a later one.
  // First, and against the whole command rather than per segment: a credential
  // path can be split across a redirection or buried in an interpreter string,
  // where segment-level parsing would lose it.
  checkSecretRead(command);

  const segments = splitCommands(command);
  for (const segment of segments) checkBlocking(segment, cwd, pushAuthorized);
  for (const segment of segments) checkOutward(segment, command);
  for (const segment of segments) checkCommit(segment, cwd, commitAuthorized);

  const warnings = segments.flatMap(outwardWarnings);
  if (warnings.length > 0)
    io.warn(EVENT, "Before this runs:\n" + warnings.join("\n"));
});
