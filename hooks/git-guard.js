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
// switch, because authorising a deploy must not also authorise a repo
// deletion.

const fs = require("fs");
const os = require("os");
const path = require("path");
const io = require("./lib/hook-io");
const paths = require("./lib/paths");
const commitMessage = require("./lib/commit-message");
const { isForeignRepository } = require("./lib/repository-trust");

const EVENT = "PreToolUse";

// Appended to every refusal. Set once script files have been read, so that a
// refusal caused by a line inside one says where that line came from.
let refusalNote = "";

function refuse(reason) {
  io.deny(EVENT, reason + refusalNote);
}

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

// The lookarounds keep a here-string (`<<<`) from reading as a heredoc, which
// would take its first word for a terminator and drop every line after it.
const HEREDOC_START = /(?<!<)<<(?!<)-?\s*['"]?(\w+)['"]?/;

// Leading env assignments and wrappers must be consumed before testing for `git`,
// or a prefix like `FOO=1 git push --force` skips every rule below.
const COMMAND_PREFIX =
  /^(?:(?:sudo|env|command|nohup|time|nice|xargs|exec)\s+|[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;

// `/usr/bin/git` and `./node_modules/.bin/vercel` run the program their last
// component names.
const PROGRAM_DIRECTORY = /^[^\s'"$]*\//;

const SHELL = /^(?:(?:ba|z|da|k)?sh|fish)\b/;

// What is left of `$(...)` once the splitter has cut at its parenthesis.
const RUN_TIME_MARKER = "$";

/**
 * Separate heredoc bodies from the rest of the command.
 *
 * A body is dropped from the text so that a document which merely mentions
 * git is ignored. Each is handed back beside the command that reads it,
 * because a body fed to a shell is a script, and because a credential path in
 * a body is read by that command and no other.
 */
function splitHeredocs(command) {
  const kept = [];
  const heredocs = [];
  let terminator = null;
  let open = null;
  for (const line of command.split("\n")) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      else open.lines.push(line);
      continue;
    }
    kept.push(line);
    const match = HEREDOC_START.exec(line);
    if (!match) continue;
    terminator = match[1];
    open = {
      reader: splitCommands(line.slice(0, match.index)).pop() || "",
      lines: [],
    };
    heredocs.push(open);
  }
  return {
    text: kept.join("\n"),
    heredocs: heredocs.map(({ reader, lines }) => ({
      reader,
      body: lines.join("\n"),
    })),
  };
}

/** Bodies of the heredocs that feed a shell, each of which is a script. */
function shellHeredocs(command) {
  return splitHeredocs(command)
    .heredocs.filter(({ reader }) =>
      SHELL.test(bareCommand(stripQuotes(reader))),
    )
    .map(({ body }) => body);
}

const QUOTED_WORD_PART = /^[\w./:@%+=,~-]+$/;

/**
 * Blank out quoted prose so `echo "git push"` is not read as a git invocation.
 *
 * A quoted piece with no space in it is one word or part of one, and the shell
 * runs `'git' "push"` and `gi""t pu''sh` exactly as it runs `git push`, so
 * those are unwrapped instead. A backslash before a letter is dropped for the
 * same reason.
 */
function stripQuotes(segment) {
  return segment
    .replace(
      /'([^']*)'|"((?:[^"\\]|\\.)*)"/g,
      (quoted, single, double, offset) => {
        const content = single === undefined ? double : single;
        if (QUOTED_WORD_PART.test(content)) return content;
        const before = segment[offset - 1];
        const after = segment[offset + quoted.length];
        const insideWord =
          (before !== undefined && /\S/.test(before)) ||
          (after !== undefined && /\S/.test(after));
        return content === "" && insideWord ? "" : quoted[0] + quoted[0];
      },
    )
    .replace(/\\(\w)/g, "$1");
}

/**
 * Split a command line on separators that are not inside quotes.
 *
 * `&&`, `||` and `;` cover POSIX shells; a bare `&` is how cmd.exe chains.
 * Quote tracking is the point: splitting the raw text first would tear
 * `echo 'a && gh repo delete x'` into a fragment that reads as a real
 * invocation, because the quotes that made it inert end up in another segment.
 */
const NO_OP = ": ";

function splitCommands(command) {
  const text = splitHeredocs(command).text;
  const segments = [];
  let current = "";
  let quote = null;
  let insideBackticks = false;
  let openParentheses = 0;
  // The word glued to a closing parenthesis (`$(a)$b`, `$(a)$(b)`) carries on
  // the argument that parenthesis ended, so it is pushed as a no-op's
  // argument. It ends at the next space: `STAMP=$(date) git push` runs git.
  let gluedWord = false;
  const push = () => {
    segments.push(gluedWord && current !== "" ? NO_OP + current : current);
    current = "";
    gluedWord = false;
  };

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
    // A subshell, an unquoted `$(...)` and backticks each start a command of
    // their own, so they split here like any other separator.
    if (
      character === ";" ||
      character === "\n" ||
      character === "(" ||
      character === ")" ||
      character === "`"
    ) {
      if (character === "`") {
        // `$(` leaves a `$` behind as its own segment when it stands where a
        // program name goes. An opening backtick leaves nothing, so the same
        // marker is written for it.
        if (!insideBackticks && bareCommand(current) === "")
          segments.push(RUN_TIME_MARKER);
        insideBackticks = !insideBackticks;
      }
      // What follows two openings is an argument, not a program, so it
      // continues as the arguments of a no-op: the elements of an array
      // (`list=(`) and arithmetic (`$((`). A substitution inside either still
      // splits off and is read. A `)` that closes nothing is a `case` label,
      // and what follows that one is a command.
      let opensArguments = false;
      if (character === "(") {
        const arithmetic = current.endsWith("$") && text[index + 1] === "(";
        opensArguments = arithmetic || current.endsWith("=");
        openParentheses += arithmetic ? 2 : 1;
        if (arithmetic) index += 1;
      }
      const closes = character === ")" && openParentheses > 0;
      if (closes) openParentheses -= 1;
      push();
      gluedWord = closes;
      if (opensArguments) current = NO_OP;
      continue;
    }
    if (character === "&" || character === "|") {
      if (text[index + 1] === character) index += 1;
      push();
      continue;
    }
    if (gluedWord && /\s/.test(character)) push();
    current += character;
  }
  push();

  return segments.map((segment) => segment.trim()).filter(Boolean);
}

// `npx vercel --prod` must be read as a vercel invocation, or every rule below
// is one `npx` away from bypass. Kept separate from COMMAND_PREFIX because a
// package runner names the program it runs, where `sudo`/`env` do not.
const RUNNER_PREFIX =
  /^(?:(?:npx|bunx)\s+(?:-y\s+|--yes\s+)?|pnpm\s+dlx\s+|yarn\s+dlx\s+)+/;

// `{ git push; }` and `if git push; then` run the command exactly as the bare
// spelling does, so the opener is consumed before anything is tested.
const GROUP_OPENER = /^(?:(?:[{!]|if|then|elif|else|do|while|until)\s+)+/;

function withoutGroupOpener(segment) {
  return segment.trim().replace(GROUP_OPENER, "");
}

/** Strip leading env assignments and wrappers to expose the program being run. */
function bareCommand(segment) {
  let rest = withoutGroupOpener(segment);
  for (;;) {
    const shorter = rest
      .replace(COMMAND_PREFIX, "")
      .replace(PROGRAM_DIRECTORY, "");
    if (shorter === rest) return rest;
    rest = shorter;
  }
}

/**
 * True when `NAME=1` is typed as a prefix of this very command.
 *
 * Searching the whole command line for the text let a trailing comment, an
 * echoed string or an unrelated earlier command lift the block.
 */
function hasEscape(rawSegment, name) {
  const prefix = COMMAND_PREFIX.exec(withoutGroupOpener(rawSegment));
  return prefix !== null && prefix[0].split(/\s+/).includes(name + "=1");
}

const SHELL_RUNNING_A_STRING =
  /^(?:(?:ba|z|da|k)?sh|fish)\b(?=.*(?:\s-[A-Za-z]*c\b|<<<))/;
const EVAL = /^eval\s+/;
const QUOTED_STRING = /'([^']*)'|"((?:[^"\\]|\\.)*)"/g;
const MAX_NESTING = 4;

/** Command text this segment hands to another shell: `-c` strings, eval, `"$(...)"`. */
function nestedCommands(rawSegment) {
  const nested = [];
  const target = bareCommand(stripQuotes(rawSegment));
  const runsItsStrings =
    SHELL_RUNNING_A_STRING.test(target) || EVAL.test(target);

  for (const match of rawSegment.matchAll(QUOTED_STRING)) {
    const single = match[1];
    const double =
      match[2] === undefined
        ? undefined
        : match[2].replace(/\\(["$`\\])/g, "$1");
    if (runsItsStrings) nested.push(single === undefined ? double : single);
    // Only double quotes expand a substitution. Handing the whole string back
    // to the splitter lets its parenthesis and backtick rules find the command.
    // A backslash-escaped backtick or dollar is literal text, so it is dropped
    // first: a message that merely quotes a command must not read as running it.
    if (match[2] !== undefined) {
      const live = match[2].replace(/\\[`$]/g, "");
      // The leading no-op keeps a string that opens with its substitution
      // from reading as a command whose program is that substitution.
      if (/\$\(|`/.test(live)) nested.push(": " + live);
    }
  }
  if (EVAL.test(target)) nested.push(bareCommand(rawSegment).replace(EVAL, ""));
  return nested;
}

// Programs whose job is to start another program named later in their own
// arguments, after flags this guard cannot count: `timeout -s KILL 5 git push`,
// `xargs -I{} git push`, `find . -exec git push \;`.
const LAUNCHER =
  /^(?:sudo|doas|env|command|builtin|nohup|time|nice|xargs|exec|timeout|find|watch|parallel|stdbuf|caffeinate)$/;
const GUARDED_PROGRAM =
  /^(?:git|gh|npm|pnpm|yarn|bun|npx|bunx|vercel|supabase|rg|tree|uniq|eval|(?:ba|z|da|k)?sh|fish)$/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Split a segment into words on unquoted whitespace, quotes left in place. */
function shellWords(segment) {
  return segment.match(/(?:'[^']*'|"(?:[^"\\]|\\.)*"|\\.|[^\s'"\\])+/g) || [];
}

/**
 * The commands a launcher on this segment may start.
 *
 * Which argument is the program depends on flags that differ per launcher, so
 * every guarded program name after the launcher is taken as a possible start.
 * Leading assignments are carried over, because that is where an escape sits.
 */
function launchedCommands(rawSegment) {
  const words = shellWords(withoutGroupOpener(rawSegment));
  const program = (word) => bareCommand(stripQuotes(word));
  let first = 0;
  while (first < words.length && ASSIGNMENT.test(words[first])) first += 1;
  if (first >= words.length || !LAUNCHER.test(program(words[first]))) return [];

  const assignments = words.slice(0, first);
  const launched = [];
  for (let index = first + 1; index < words.length; index += 1) {
    if (GUARDED_PROGRAM.test(program(words[index])))
      launched.push([...assignments, ...words.slice(index)].join(" "));
  }
  return launched;
}

/** Every command the line runs, including those wrapped for another shell. */
function allCommands(command, depth = 0) {
  const segments = splitCommands(command).flatMap((segment) => [
    segment,
    ...launchedCommands(segment),
  ]);
  if (depth >= MAX_NESTING) return segments;
  const scripts = shellHeredocs(command).concat(
    segments.flatMap(nestedCommands),
  );
  return segments.concat(
    scripts.flatMap((script) => allCommands(script, depth + 1)),
  );
}

// Global options sit between `git` and the subcommand, and the ones listed here
// consume the token after them. Without this, `git -C /repo push` reads as a git
// invocation whose subcommand never matches /\bgit\s+push\b/, and every rule
// below would then be one `-C` away from bypass.
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
      "GET) is not blocked. Only the mutating methods are.",
  ],
  [
    /^gh\s+api\b(?!\s+graphql\b)(?=.*\s(?:-f|-F|--field|--raw-field|--input)\b)(?!.*(?:-X\s*|--method[= ])GET\b)/,
    "CLAUDE_ALLOW_GH",
    "Passing a field or a body makes `gh api` send a POST unless the method says\n" +
      "otherwise, so this is a writing call. Add `-X GET` if it is a read.\n" +
      "GraphQL is exempt: every query there carries a field.",
  ],
  // settings.json lets rg, tree, uniq and the read-only git subcommands run
  // with no prompt because they only read. Each has one spelling that writes a
  // file, runs a program or deletes a branch, and a permission rule matches a
  // prefix, so it cannot tell the two apart. This is where they are told apart.
  [
    /^rg\b.*\s--pre(?:=|\s)/,
    "CLAUDE_ALLOW_LOCAL_WRITE",
    "`rg --pre` runs a program of your choosing on every file searched.",
  ],
  [
    /^tree\b.*\s-o(?:\s|$)/,
    "CLAUDE_ALLOW_LOCAL_WRITE",
    "`tree -o` writes its listing over the named file.",
  ],
  [
    /^git\b.*\s--output(?:=|\s)/,
    "CLAUDE_ALLOW_LOCAL_WRITE",
    "`--output` makes a read-only git command write over the named file.",
  ],
  [
    /^git\b.*\bbranch\b.*\s(?:-D|-d|--delete|-M|-f|--force)(?:\s|$)/,
    "CLAUDE_ALLOW_LOCAL_WRITE",
    "This deletes, overwrites or force-moves a branch. A deleted branch's\n" +
      "commits are only reachable through the reflog afterwards.",
  ],
  [
    /^uniq(?:\s+-[a-zA-Z]+(?:\s+\d+)?|\s+--\S+)*\s+(?!\d+\s)[^-\s]\S*\s+[^-\s]/,
    "CLAUDE_ALLOW_LOCAL_WRITE",
    "A second file name tells `uniq` to write its output over that file.",
  ],
  [
    /^(?:npm|pnpm|yarn|bun)\s+publish\b/,
    "CLAUDE_ALLOW_PUBLISH",
    "Publishing to a registry is permanent: a version number can never be\n" +
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
 * binds the Read tool, so `cat ~/.ssh/id_ed25519` walks straight past it. This
 * hook is where the gap closes, because every Bash command arrives here first.
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
// `process.env.HOME` appears in ordinary JavaScript constantly, and the
// lookbehind is what keeps it from reading as a dotenv path. A real dotenv path
// is preceded by a separator (space, quote, slash) or starts the token, while
// `process.env` is preceded by an identifier character.
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
 * plain spelling, because the shell strips the quotes and backslashes first.
 * Matching
 * only the literal text would make the whole check one apostrophe from useless.
 * Measured: the quoted form read a fixture file before this existed.
 */
function collapseQuoting(command) {
  return command.replace(/['"\\]/g, "");
}

/** What credential material `text` names, as phrases for the refusal. */
function credentialsNamed(text) {
  const forms = [text, collapseQuoting(text)];
  const matches = (pattern) => forms.some((form) => pattern.test(form));

  const named = [];
  for (const [pattern, describe] of CREDENTIAL_PATTERNS)
    if (matches(pattern)) named.push(describe);
  if (forms.some(mentionsLiveEnvFile)) named.push("a .env file");
  for (const [pattern, describe] of ENV_DUMP)
    if (matches(pattern)) named.push(describe);
  return named;
}

/**
 * Refuse a credential read unless the command doing the reading carries the
 * escape itself.
 *
 * A command is judged together with the heredocs it reads. The whole line is
 * searched as well, for a path the splitter cut in two: what turns up only
 * there belongs to no command, so no single command's escape can cover it.
 */
function checkSecretRead(command) {
  const { heredocs } = splitHeredocs(command);
  const commands = splitCommands(command).map((segment) => {
    const bodies = heredocs
      .filter(
        ({ reader }) =>
          segment.startsWith(reader) &&
          segment.slice(reader.length).trimStart().startsWith("<<"),
      )
      .map(({ body }) => body);
    return {
      escaped: hasEscape(segment, SECRET_READ_ESCAPE),
      named: credentialsNamed([segment, ...bodies].join("\n")),
    };
  });
  const unescaped = commands.filter(({ escaped }) => !escaped);
  if (unescaped.length === 0) return;

  const namedByCommands = commands.flatMap(({ named }) => named);
  const reasons = unescaped
    .flatMap(({ named }) => named)
    .concat(
      credentialsNamed(command).filter(
        (named) => !namedByCommands.includes(named),
      ),
    );

  if (reasons.length === 0) return;
  refuse(
    `Blocked: this command touches ${[...new Set(reasons)].join(", ")}.\n\n` +
      "Credential material is not read through the shell. A `permissions.deny`\n" +
      "rule only binds the Read tool, so this hook is what actually enforces it.\n\n" +
      "If you genuinely need it, run it yourself with `! <command>`. When you\n" +
      "have explicitly asked for it, prefix this one invocation with:\n" +
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
    "This creates a repository on GitHub. Check the visibility flag: `--public`\n" +
      "cannot be taken back once the code is indexed.",
  ],
];

/** Normalise a segment to the program it actually runs, past wrappers and runners. */
function outwardTarget(rawSegment) {
  return bareCommand(stripQuotes(rawSegment)).replace(RUNNER_PREFIX, "");
}

function checkOutward(rawSegment) {
  const segment = outwardTarget(rawSegment);
  if (!segment) return;

  for (const [pattern, escape, explanation] of OUTWARD_DENIED) {
    if (!pattern.test(segment)) continue;
    // `continue`, not `return`: authorising one family must not skip the checks
    // for every other family in the same segment.
    if (hasEscape(rawSegment, escape)) continue;
    refuse(
      `Blocked: ${explanation}\n\n` +
        "Run it yourself with `! <command>`. When you have explicitly asked for\n" +
        `it, prefix this one invocation with: ${escape}=1`,
    );
  }

  // The rule above exempts GraphQL because a query carries a field too. What
  // tells a write from a read there is the query text, which only the raw
  // segment still holds, and a query kept in a file cannot be read at all.
  if (
    /^gh\s+api\s+graphql\b/.test(segment) &&
    !hasEscape(rawSegment, "CLAUDE_ALLOW_GH") &&
    /\bmutation\b|=@|\s--input\b/.test(rawSegment)
  ) {
    refuse(
      "Blocked: this GraphQL call is a mutation, or takes its query from a file\n" +
        "this guard cannot read, so it may write to GitHub.\n\n" +
        "Run it yourself with `! <command>`. When you have explicitly asked for\n" +
        "it, prefix this one invocation with: CLAUDE_ALLOW_GH=1",
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

function checkBlocking(rawSegment, cwd) {
  const segment = gitInvocation(stripQuotes(rawSegment));
  if (segment === null) return;
  const pushAuthorized = hasEscape(rawSegment, "CLAUDE_ALLOW_PUSH");

  if (/\s-c\s+alias\./.test(collapseQuoting(rawSegment))) {
    refuse(
      "Blocked: a one-off alias (`git -c alias.x=...`) can stand in for any git\n" +
        "subcommand, so nothing below could tell what this runs. Spell the\n" +
        "subcommand out.",
    );
  }

  if (
    /(^|\s)(--no-verify|-n\s|-n$)/.test(segment) &&
    /\bgit\s+(commit|push)\b/.test(segment)
  ) {
    refuse(
      "Blocked: --no-verify skips the hooks the repo installed on purpose.\n" +
        "Fix the failing check instead. If the hook itself is wrong, fix the hook.\n" +
        "(google-cl-author / git-workflow: never bypass verification.)",
    );
  }

  if (/\bgit\s+push\b/.test(segment)) {
    if (
      // `git push origin +main` forces that one ref without any flag.
      /(--force\b|(?<![\w-])-f\b|\s\+\S)/.test(segment) &&
      !segment.includes("--force-with-lease")
    ) {
      refuse(
        "Blocked: plain force-push silently discards commits anyone else pushed.\n" +
          "If history genuinely must be rewritten, use:\n" +
          "  git push --force-with-lease --force-if-includes\n" +
          "and never on a shared or under-review branch.",
      );
    }
    if (pushAuthorized) return;
    refuse(
      "Blocked: pushing is yours to do, not mine (CLAUDE.md: never commit, never push).\n" +
        "Run it yourself with `! git push ...`. When you have explicitly asked for a\n" +
        "push, prefix the command with the per-invocation escape:\n" +
        "  CLAUDE_ALLOW_PUSH=1 git push origin <branch>\n" +
        "Force-push stays blocked either way; use --force-with-lease --force-if-includes.",
    );
  }

  if (/\bgit\s+reset\b.*--hard/.test(segment)) {
    refuse(
      "Blocked: `git reset --hard` throws away uncommitted work with no undo.\n" +
        "Safer options: `git stash` to shelve it, `git restore <path>` for one file,\n" +
        "or `git revert <sha>` to undo a commit that already exists in history.",
    );
  }

  if (/\bgit\s+clean\b.*-[a-z]*f/.test(segment)) {
    refuse(
      "Blocked: `git clean -f` permanently deletes untracked files, and git has no record of them.\n" +
        "Run `git clean -n` first and confirm the list, then run the delete yourself.",
    );
  }

  if (
    /\bgit\s+add\b\s+(-A|--all|\.)\s*$/.test(segment) &&
    paths.samePath(cwd, os.homedir())
  ) {
    refuse(
      `Blocked: \`git add -A\` from your home directory (${os.homedir()}) would stage everything under it.\n` +
        "cd into the actual project first.",
    );
  }
}

/**
 * Refuse a commit that must not land, and return the notes for one that may.
 *
 * The notes are returned rather than emitted for the reason `outwardWarnings`
 * gives: emitting ends the process, and the question asked about a stranger's
 * repository comes after this.
 */
function checkCommit(rawSegment, cwd) {
  const segment = gitInvocation(stripQuotes(rawSegment));
  if (segment === null) return [];
  const commitAuthorized = hasEscape(rawSegment, "CLAUDE_ALLOW_COMMIT");
  const subjectOverride = hasEscape(rawSegment, "CLAUDE_ALLOW_VAGUE_SUBJECT");
  if (!/\bgit\s+commit\b/.test(segment)) return [];
  if (/--dry-run\b/.test(segment)) return [];

  // Denying here rather than in settings.json is deliberate: a permission rule
  // matches a literal prefix, so `git -C /repo commit` and `FOO=1 git commit`
  // both walk straight past it. This sees the same command every other rule does.
  if (!commitAuthorized) {
    refuse(
      "Blocked: committing is yours to do, not mine (CLAUDE.md: never commit, never push).\n" +
        "Stage the work and hand it over. When you have explicitly asked for a\n" +
        "commit, prefix the command with the per-invocation escape:\n" +
        '  CLAUDE_ALLOW_COMMIT=1 git commit -m "..."\n' +
        "The escape still runs the secret scan and the review checks; it only lifts this block.",
    );
  }

  // An amend still writes staged content into history, so it gets the secret scan.
  // Only the advisory checks are skipped, because size and coverage were judged
  // already.
  const isAmend = /--amend\b/.test(segment);

  const staged = io
    .git(["diff", "--cached", "--name-only"], cwd)
    .split("\n")
    .filter(Boolean);
  if (staged.length === 0) return [];

  const diff = io.git(["diff", "--cached", "-U0"], cwd);
  const added = diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n");

  for (const [pattern, label] of BLOCKING_SECRETS) {
    if (pattern.test(added)) {
      refuse(
        `Blocked: staged changes look like they contain a ${label}.\n` +
          "Secrets survive in git history even after deletion. Rotate the credential first,\n" +
          "then unstage the file and add it to .gitignore.\n" +
          "If this is a false positive (a fixture or example), say so and I'll note it.",
      );
    }
  }

  if (isAmend) return [];

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

  // Read from the original text, because `segment` has quoted content blanked out.
  // Covers -m and -F alike; passing the message by file is the common case for
  // anything with a body, and used to skip these checks entirely.
  const message = commitMessage.extract(rawSegment, cwd);
  if (message) {
    const { blocking, advisory } = commitMessage.classify(message.text);
    // Blocking findings are rule violations: every convention they check is
    // written down. Advisory findings are judgment calls a human has to weigh
    // (a long body, a subject past the target but under the hard ceiling), so
    // they only ever reach the warning notes below, never the deny.
    if (blocking.length > 0 && !subjectOverride) {
      refuse(
        "Blocked: this commit message breaks a convention you wrote down.\n" +
          blocking.map((problem) => `- ${problem}`).join("\n") +
          "\n\nRewrite the message. See git-workflow. If the message is right " +
          "and the check is wrong, prefix this one invocation with:\n" +
          "  CLAUDE_ALLOW_VAGUE_SUBJECT=1 git commit ...",
      );
    }
    for (const problem of [...blocking, ...advisory]) {
      notes.push(`- ${problem} See git-workflow.`);
    }
  }

  return notes;
}

// Each of these runs code the repository chose: a `package.json` script, or a
// binary and config that `npx` finds in `node_modules` before it looks anywhere
// else. `settings.json` pre-approves several, which is right at home and wrong
// in a clone of somebody else's work.
const PROJECT_SCRIPT =
  /^(?:npm\s+(?:run|run-script|test|t|start|exec|x)\b|(?:pnpm|yarn|bun)\s+(?:run|build|lint|test|start|exec)\b|(?:npx|bunx)\s+\S)/;

function runsProjectScript(rawSegment) {
  return PROJECT_SCRIPT.test(bareCommand(stripQuotes(rawSegment)));
}

const CHANGE_DIRECTORY = /^(?:cd|pushd)\s+(\S+)/;

/**
 * The session directory plus every directory the line moves into.
 *
 * Each `cd` is resolved against the one before it. A target the shell works
 * out at run time (`cd "$dir"`) cannot be followed, and `lost` says so.
 */
function directoriesVisited(segments, cwd) {
  const visited = [cwd];
  let lost = false;
  for (const segment of segments) {
    const match = CHANGE_DIRECTORY.exec(bareCommand(stripQuotes(segment)));
    if (match === null) continue;
    if (/[$`'"]|^-$/.test(match[1])) {
      lost = true;
      continue;
    }
    const target = match[1].replace(/^~(?=\/|$)/, os.homedir());
    visited.push(path.resolve(visited[visited.length - 1], target));
  }
  return { visited, lost };
}

const SCRIPT_FILE_ARGUMENT =
  /^(?:(?:(?:ba|z|da|k)?sh|fish)(?:\s+-[A-Za-z]+)*|source|\.)\s+([^\s-]\S*)/;
const LARGEST_SCRIPT_READ = 256 * 1024;
// A script's comment lines are not commands. Its first line (`#!/bin/sh`)
// would otherwise read as a shell started with no script.
const COMMENT_LINE = /^[ \t]*#.*$/gm;

/**
 * The script files this line hands to a shell, as `{ name, text }`.
 *
 * `bash release.sh` runs whatever the file holds, so the file is read and its
 * lines judged like the rest. A name is tried against every directory the
 * line visits. A file that is missing, unreadable or very large is skipped:
 * the guard reads what it can and does not refuse what it cannot.
 */
function scriptFilesRun(segments, directories) {
  const files = [];
  for (const segment of segments) {
    const match = SCRIPT_FILE_ARGUMENT.exec(bareCommand(stripQuotes(segment)));
    if (match === null) continue;
    const name = match[1].replace(/^~(?=\/|$)/, os.homedir());
    for (const directory of directories) {
      const file = path.resolve(directory, name);
      try {
        if (fs.statSync(file).size > LARGEST_SCRIPT_READ) continue;
        files.push({
          name: match[1],
          text: fs.readFileSync(file, "utf8").replace(COMMENT_LINE, ""),
        });
        break;
      } catch {
        // Not in this directory; the next one is tried.
      }
    }
  }
  return files;
}

// A whole word that is a variable or a substitution, standing where the
// program name goes: `$tool push`, `"$(echo git)" push`. `$HOME/bin/tool` is
// not one, because the name itself is spelled out.
const RUN_TIME_PROGRAM = /^(?:\$$|"?\$\{?\w+\}?"?(?:\s|$)|"(?:\$\(|`))/;

function namesProgramAtRunTime(rawSegment) {
  return RUN_TIME_PROGRAM.test(bareCommand(rawSegment));
}

// A shell given only single-letter flags and no script reads its commands
// from standard input: `curl ... | sh -s`. A heredoc or here-string leaves its
// `<<` on the segment, so those do not match and are read as scripts instead.
const SHELL_READING_INPUT =
  /^(?:(?:ba|z|da|k)?sh|fish)(?:\s+-(?![A-Za-z]*c\b)[A-Za-z]+)*$/;

function readsCommandsFromInput(rawSegment) {
  return SHELL_READING_INPUT.test(bareCommand(stripQuotes(rawSegment)));
}

/** Reasons to hand this line to the operator, none of them a refusal. */
function questions(segments, directories) {
  const asked = [];
  if (segments.some(namesProgramAtRunTime)) {
    asked.push(
      "The program this command runs is named by a variable or a substitution,\n" +
        "so it is only known once the shell runs it and none of the rules here\n" +
        "could be applied. Approve it only if you can see what it expands to.",
    );
  }
  if (segments.some(readsCommandsFromInput)) {
    asked.push(
      "A shell here takes its commands from a pipe, so what it runs is only\n" +
        "known once the program before it has produced them, and none of the\n" +
        "rules here could be applied.",
    );
  }
  if (!segments.some(runsProjectScript)) return asked;
  if (directories.lost) {
    asked.push(
      "This line changes directory to a place only known once the shell runs\n" +
        "it, then runs code that directory's repository supplies (a package\n" +
        "script, or a binary and config from its `node_modules`). Approve it\n" +
        "only if you know where it lands and trust that repository.",
    );
  }
  if (directories.visited.some(isForeignRepository)) {
    asked.push(
      "This repository's `origin` belongs to someone else, and this command\n" +
        "runs code the repository supplies (a package script, or a binary and\n" +
        "config from its `node_modules`). Approve it only if you trust the\n" +
        "repository. To stop being asked for an owner, add `host/owner` on a\n" +
        "line of `local/trusted-owners.txt` in the config directory.",
    );
  }
  return asked;
}

io.run(() => {
  const payload = io.readPayload();
  if (payload.tool_name !== "Bash") return;

  const command = (payload.tool_input && payload.tool_input.command) || "";
  if (!command) return;
  const cwd = payload.cwd || process.cwd();

  // Escapes are read from the command text, not the environment, so each must be
  // typed deliberately per invocation and can never be exported to disable the guard.
  const typed = allCommands(command);
  const directories = directoriesVisited(typed, cwd);
  const scripts = scriptFilesRun(typed, directories.visited);
  const segments = typed.concat(
    scripts.flatMap(({ text }) => allCommands(text)),
  );
  if (scripts.length > 0) {
    refusalNote =
      "\n\nThis line runs " +
      scripts.map(({ name }) => "`" + name + "`").join(", ") +
      ", which was read as part of it. The refused command may be in there.";
  }

  // Every deny pass runs to completion before anything is allowed to emit, so a
  // warning in one segment can never cut short the scan of a later one.
  // First, and against the whole command as well as per segment: a credential
  // path can be split across a redirection or buried in an interpreter string,
  // where segment-level parsing would lose it.
  checkSecretRead(command);

  for (const segment of segments) checkBlocking(segment, cwd);
  for (const segment of segments) checkOutward(segment);
  const commitNotes = segments.flatMap((segment) => checkCommit(segment, cwd));

  const warnings = [];
  if (commitNotes.length > 0)
    warnings.push("Before this commit lands:\n" + commitNotes.join("\n"));
  const outward = segments.flatMap(outwardWarnings);
  if (outward.length > 0)
    warnings.push("Before this runs:\n" + outward.join("\n"));

  // After every deny pass, because asking exits the process just as a warning
  // does, and a question must never stand in for a refusal.
  const asked = questions(segments, directories);
  if (asked.length > 0) io.ask(EVENT, asked.concat(warnings).join("\n\n"));

  if (warnings.length > 0) io.warn(EVENT, warnings.join("\n\n"));
});
