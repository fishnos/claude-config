"use strict";

// Regression suite for the hooks in ../hooks.
//
// Runs on macOS, Linux and Windows: no shell invocations, no POSIX-only paths, and
// the hooks are spawned with process.execPath rather than a `node` on PATH.
// Usage: node ~/.claude/tools/test-hooks.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOOKS = path.join(__dirname, "..", "hooks");
const GUARD = path.join(HOOKS, "git-guard.js");
const STYLE = path.join(HOOKS, "style-check.js");
const STOP = path.join(HOOKS, "review-reminder.js");

// Assembled so this file is not itself a literal the secret scanner flags.
const PUSH = "git" + " push";
const NOVERIFY = "git" + " commit --no-verify -m 'x'";
const HARD = "git" + " reset --hard HEAD~1";
const CLEAN = "git" + " clean -fd";
const AWS_KEY = "AKIA" + "IOSFODNN7EXAMPLE";
const GH_TOKEN = "ghp_" + "a".repeat(36);

let passed = 0;
let failed = 0;

function run(script, payload, env) {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, ...(env || {}) },
    windowsHide: true,
  });
  const out = (result.stdout || "").trim();
  if (!out) return { verdict: "allow", reason: "", code: result.status };
  let data;
  try {
    data = JSON.parse(out);
  } catch {
    return { verdict: "?raw", reason: out, code: result.status };
  }
  const spec = data.hookSpecificOutput || {};
  if (spec.permissionDecision === "deny") {
    return {
      verdict: "DENY",
      reason: spec.permissionDecisionReason,
      code: result.status,
    };
  }
  if (spec.additionalContext) {
    return {
      verdict: "warn",
      reason: spec.additionalContext,
      code: result.status,
    };
  }
  if (data.decision === "block") {
    return { verdict: "BLOCK", reason: data.reason, code: result.status };
  }
  return { verdict: "allow", reason: "", code: result.status };
}

function git(args, cwd) {
  spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
}

// run() collapses a reply to one verdict; a banner test needs the raw fields,
// because systemMessage and additionalContext travel side by side.
function runJson(script, payload, env) {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, ...(env || {}) },
    windowsHide: true,
  });
  try {
    return JSON.parse((result.stdout || "").trim());
  } catch {
    return {};
  }
}

function readTextOrEmpty(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function makeRepository(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(["init", "-q", "."], root);
  return root;
}

// The config repository may hold a real working record. Captured here and
// compared at the end, so no case can write into it unnoticed.
const configRepositoryState = path.join(__dirname, "..", ".claude", "state.md");
const configRepositoryStateBefore = readTextOrEmpty(configRepositoryState);

function bash(command, cwd) {
  return { tool_name: "Bash", cwd, tool_input: { command } };
}

function header(title) {
  console.log("\n" + "=".repeat(72) + "\n" + title + "\n" + "=".repeat(72));
}

// POSIX file modes and the sh shim have no Windows equivalent, and the broker
// runs under launchd. A case that cannot apply is skipped by name and counted,
// so the total stays constant across platforms and a silent gap is impossible.
let skipped = 0;
function skip(label, reason) {
  skipped += 1;
  console.log(`[SKIP] ${label}\n       ${reason}`);
}

function check(label, verdict, expected, reason) {
  const ok = verdict === expected;
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `[${ok ? "PASS" : "**FAIL**"}] ${label.padEnd(52)} -> ${verdict}`,
  );
  if (!ok)
    console.log(
      `        expected ${expected}; reason: ${String(reason).slice(0, 200)}`,
    );
}

const repo = fs.mkdtempSync(path.join(os.tmpdir(), "hooktest-"));
git(["init", "-q", "."], repo);
git(["config", "user.email", "t@t.t"], repo);
git(["config", "user.name", "T"], repo);
fs.mkdirSync(path.join(repo, "src"), { recursive: true });

const write = (relative, contents) => {
  const target = path.join(repo, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
};

header("PreToolUse(Bash): blocking cases");
for (const [label, command] of [
  ["plain push", PUSH + " origin main"],
  ["push after a passing test", "npm test && " + PUSH],
  ["force push", PUSH + " --force origin main"],
  ["commit --no-verify", NOVERIFY],
  ["reset --hard", HARD],
  ["clean -fd", CLEAN],
]) {
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(label, verdict, "DENY", reason);
}

header("PreToolUse(Bash): env-prefix must not bypass the guard");
for (const [label, command] of [
  ["unrelated env var before push", "FOO=1 " + PUSH],
  ["env var before force-push", "DEBUG=true " + PUSH + " --force"],
  ["sudo before reset --hard", "sudo " + HARD],
  ["env wrapper before clean", "env " + CLEAN],
]) {
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(label, verdict, "DENY", reason);
}

header("PreToolUse(Bash): cmd.exe chaining");
for (const [label, command] of [
  ["single & chain (cmd.exe) before push", "dir & " + PUSH],
  ["single & chain before reset --hard", "echo hi & " + HARD],
]) {
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(label, verdict, "DENY", reason);
}

header("PreToolUse(Bash): push escape hatch");
{
  let r = run(
    GUARD,
    bash("CLAUDE_ALLOW_PUSH=1 " + PUSH + " origin main", repo),
  );
  check("explicit escape allows a plain push", r.verdict, "allow", r.reason);
  r = run(
    GUARD,
    bash("CLAUDE_ALLOW_PUSH=1 " + PUSH + " --force origin main", repo),
  );
  check("escape does NOT permit force-push", r.verdict, "DENY", r.reason);
  r = run(GUARD, bash("CLAUDE_ALLOW_PUSH=0 " + PUSH + " origin main", repo));
  check("wrong escape value still blocks", r.verdict, "DENY", r.reason);
}

header("PreToolUse(Bash): must NOT block (false-positive guard)");
for (const [label, command] of [
  ["git status", "git status"],
  ["git log", "git log --oneline -20"],
  ["echoing the command as a string", `echo "how to: ${PUSH} origin main"`],
  ["grepping docs for the phrase", `grep -r '${PUSH}' docs/`],
  [
    "writing it inside a heredoc",
    `cat <<'EOF' > notes.md\nRun ${PUSH} yourself.\nEOF`,
  ],
  ["a node script that mentions it", `node -e "console.log('${PUSH}')"`],
  ["npm run build", "npm run build"],
]) {
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(label, verdict, "allow", reason);
}

header("PreToolUse(Bash): commit warnings");
write(
  "src/calc.ts",
  "export function add(a: number, b: number) {\n  return a + b;\n}\n",
);
git(["add", "src/calc.ts"], repo);
{
  const r = run(
    GUARD,
    bash(
      'CLAUDE_ALLOW_COMMIT=1 git commit -m "Added a calculator helper."',
      repo,
    ),
  );
  check("logic staged, no tests + bad subject", r.verdict, "DENY", r.reason);
  console.log(
    String(r.reason)
      .split("\n")
      .map((l) => "        " + l)
      .join("\n"),
  );
}
write(
  "src/__tests__/calc.test.ts",
  "test('adds', () => { expect(1).toBe(1) })\n",
);
git(["add", "src/__tests__/calc.test.ts"], repo);
{
  const r = run(
    GUARD,
    bash('CLAUDE_ALLOW_COMMIT=1 git commit -m "Add a calculator helper"', repo),
  );
  check("tests staged + good subject -> silent", r.verdict, "allow", r.reason);
}

header("PreToolUse(Bash): staged secret");
write("src/config.ts", `export const KEY = '${AWS_KEY}';\n`);
git(["add", "src/config.ts"], repo);
{
  const r = run(
    GUARD,
    bash('CLAUDE_ALLOW_COMMIT=1 git commit -m "Add config"', repo),
  );
  check("AWS key in staged diff", r.verdict, "DENY", r.reason);
}

header("PreToolUse(Bash): amend still scans for secrets");
git(["reset", "-q"], repo);
write("src/creds.ts", `export const T = '${GH_TOKEN}';\n`);
git(["add", "src/creds.ts"], repo);
{
  const r = run(
    GUARD,
    bash("CLAUDE_ALLOW_COMMIT=1 git commit --amend --no-edit", repo),
  );
  check("secret staged behind --amend", r.verdict, "DENY", r.reason);
}
git(["reset", "-q"], repo);
write("src/plain.ts", "export const N = 1;\n");
git(["add", "src/plain.ts"], repo);
{
  const r = run(
    GUARD,
    bash("CLAUDE_ALLOW_COMMIT=1 git commit --amend --no-edit", repo),
  );
  check("clean amend -> no test/size nagging", r.verdict, "allow", r.reason);
}

header("PostToolUse(Edit|Write): style check");
{
  const badTs = write(
    "src/bad.ts",
    '// @ts-ignore\nvar count = 0;\nif (count == "0") { count = 1; }\ndescribe.only("suite", () => {});\n',
  );
  const r = run(STYLE, {
    tool_name: "Write",
    tool_input: { file_path: badTs },
  });
  check("ts-ignore + var + == + .only", r.verdict, "warn", r.reason);

  const goodTs = write(
    "src/good.ts",
    "const count = 0;\nexport function value(): number {\n  return count;\n}\n",
  );
  const good = run(STYLE, {
    tool_name: "Write",
    tool_input: { file_path: goodTs },
  });
  check("clean file -> silent", good.verdict, "allow", good.reason);

  // CRLF must not defeat the multiline anchors.
  const crlf = write("src/crlf.ts", "const a = 1;\r\nvar b = 2;\r\n");
  const crlfResult = run(STYLE, {
    tool_name: "Write",
    tool_input: { file_path: crlf },
  });
  check(
    "CRLF file still flags var",
    crlfResult.verdict,
    "warn",
    crlfResult.reason,
  );

  const badPy = write(
    "src/bad.py",
    "def f(items=[]):\n    try:\n        pass\n    except:\n        pass\n",
  );
  const py = run(STYLE, {
    tool_name: "Write",
    tool_input: { file_path: badPy },
  });
  check("bare except + mutable default", py.verdict, "warn", py.reason);

  const md = write("README.md", "# hi\n");
  const mdResult = run(STYLE, {
    tool_name: "Write",
    tool_input: { file_path: md },
  });
  check("markdown ignored", mdResult.verdict, "allow", mdResult.reason);

  // A test file may suppress types, but never disable its own suite.
  const testSuppression = write(
    "src/__tests__/mock.test.ts",
    "// @ts-ignore\nconst m = {} as S;\n",
  );
  const suppression = run(STYLE, {
    tool_name: "Write",
    tool_input: { file_path: testSuppression },
  });
  check(
    "@ts-ignore tolerated in tests",
    suppression.verdict,
    "allow",
    suppression.reason,
  );

  const testOnly = write(
    "src/__tests__/only.test.ts",
    'describe.only("x", () => {});\n',
  );
  const only = run(STYLE, {
    tool_name: "Write",
    tool_input: { file_path: testOnly },
  });
  check(".only never tolerated in tests", only.verdict, "warn", only.reason);
}

header("Stop: self-review reminder");
{
  const transcript = path.join(repo, "transcript.jsonl");
  fs.writeFileSync(
    transcript,
    JSON.stringify({
      message: {
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: { file_path: "/x/app/page.tsx" },
          },
        ],
      },
    }) + "\n",
  );
  // Markers go to a scratch dir; touching the real one would re-arm the live session.
  const markers = { CLAUDE_REVIEW_MARKER_DIR: path.join(repo, "markers") };

  let r = run(
    STOP,
    { session_id: "sess-A", transcript_path: transcript },
    markers,
  );
  check("code was edited -> fires once", r.verdict, "BLOCK", r.reason);

  r = run(STOP, { session_id: "sess-A", transcript_path: transcript }, markers);
  check("same session again -> silent", r.verdict, "allow", r.reason);

  r = run(
    STOP,
    {
      session_id: "sess-B",
      transcript_path: transcript,
      stop_hook_active: true,
    },
    markers,
  );
  check("stop_hook_active -> silent", r.verdict, "allow", r.reason);

  const docsOnly = path.join(repo, "docs.jsonl");
  fs.writeFileSync(
    docsOnly,
    JSON.stringify({
      message: {
        content: [
          {
            type: "tool_use",
            name: "Write",
            input: { file_path: "/x/NOTES.md" },
          },
        ],
      },
    }) + "\n",
  );
  r = run(STOP, { session_id: "sess-C", transcript_path: docsOnly }, markers);
  check("docs only -> silent", r.verdict, "allow", r.reason);

  // Windows-style transcript path must classify identically.
  const winTranscript = path.join(repo, "win.jsonl");
  fs.writeFileSync(
    winTranscript,
    JSON.stringify({
      message: {
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: { file_path: "C:\\repo\\src\\main.ts" },
          },
        ],
      },
    }) + "\n",
  );
  r = run(
    STOP,
    { session_id: "sess-W", transcript_path: winTranscript },
    markers,
  );
  check("backslash path counts as source", r.verdict, "BLOCK", r.reason);

  const live = path.join(
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
    "cache",
    "review-reminder",
  );
  const listing = () =>
    fs.existsSync(live) ? fs.readdirSync(live).sort().join(",") : "";
  const before = listing();
  run(STOP, { session_id: "sess-D", transcript_path: transcript }, markers);
  check(
    "suite never touches the live marker dir",
    before === listing() ? "allow" : "MUTATED",
    "allow",
    `before=${before} after=${listing()}`,
  );
}

header("commit-message: lint() policy");
{
  const { lint } = require(path.join(HOOKS, "lib", "commit-message.js"));
  const has = (message, fragment) =>
    lint(message).some((problem) => problem.includes(fragment));

  const good =
    "Make the standards hooks cross-platform\n\n" +
    "The hooks shipped as Python, which does not run on Windows. Node was\n" +
    "already this repo's answer to the same problem.\n";

  check(
    "clean message -> no problems",
    lint(good).length === 0 ? "ok" : "problems",
    "ok",
    JSON.stringify(lint(good)),
  );
  check(
    "61-char subject flagged",
    has("A".repeat(61), "chars (target 50)") ? "ok" : "missed",
    "ok",
  );
  check(
    "73-char subject hits ceiling",
    has("A".repeat(73), "hard ceiling") ? "ok" : "missed",
    "ok",
  );
  check(
    "trailing period flagged",
    has("Add a thing.", "trailing period") ? "ok" : "missed",
    "ok",
  );
  check(
    "past tense flagged",
    has("Added a thing", "imperative") ? "ok" : "missed",
    "ok",
  );
  check(
    "50-char subject accepted",
    lint("A".repeat(50)).length === 0 ? "ok" : "problems",
    "ok",
  );
  check(
    "effect-led subject flagged",
    has("Stop warning about the broker's own token", "opens with the effect")
      ? "ok"
      : "missed",
    "ok",
  );
  check(
    "the same change named as work is accepted",
    lint("Exempt broker tokens from the secret warning").length === 0
      ? "ok"
      : "problems",
    "ok",
    JSON.stringify(lint("Exempt broker tokens from the secret warning")),
  );
  // "Make X do Y" is the one result-shaped opener that reads as the work itself,
  // and the clean fixture above already depends on it staying accepted.
  check(
    "a Make subject is not flagged",
    has("Make the standards hooks cross-platform", "opens with the effect")
      ? "flagged"
      : "ok",
    "ok",
  );
  check(
    "missing blank second line",
    has("Subject\nBody here", "Second line must be blank") ? "ok" : "missed",
    "ok",
  );
  check(
    "over-wide body line",
    has("Subject\n\n" + "word ".repeat(20), "exceed 72") ? "ok" : "missed",
    "ok",
  );
  check(
    "unwrappable URL not flagged",
    has("Subject\n\nhttps://example.com/" + "y".repeat(90), "exceed 72")
      ? "flagged"
      : "ok",
    "ok",
  );
  check(
    "40-line body flagged as long",
    has("Subject\n\n" + "line\n".repeat(40), "Body is") ? "ok" : "missed",
    "ok",
  );
  check(
    "16-line body not flagged",
    has("Subject\n\n" + "line\n".repeat(16), "Body is") ? "flagged" : "ok",
    "ok",
  );
  check(
    "comment lines ignored",
    lint("# comment\nAdd a retry to the upload client").length === 0
      ? "ok"
      : "problems",
    "ok",
    JSON.stringify(lint("# comment\nAdd a retry to the upload client")),
  );
  check(
    "placeholder noun flagged",
    has("Fix the login bug", "stands in for the thing") ? "ok" : "missed",
    "ok",
  );
  check(
    "counted placeholder flagged",
    has("Repair three faults found while chasing one bug", "counts what it")
      ? "ok"
      : "missed",
    "ok",
  );
  // The escape that keeps the rule from punishing a subject that does name the
  // thing. Without it the noun list would reject every honest mention of a bug.
  check(
    "placeholder beside an anchor is accepted",
    lint("Repair the bug in resolveTargetPath").length === 0
      ? "ok"
      : "problems",
    "ok",
    JSON.stringify(lint("Repair the bug in resolveTargetPath")),
  );
  // A relative clause is the same withholding with no noun to catch it, and a
  // compound subject hides it: the anchor sits in the half that is already fine.
  check(
    "vague clause flagged",
    has(
      "Split the README and track what a clone missed",
      "stands in for the thing",
    )
      ? "ok"
      : "missed",
    "ok",
  );
  check(
    "vague clause flagged on its own",
    has("Track what a clone missed", "stands in for the thing")
      ? "ok"
      : "missed",
    "ok",
  );
  check(
    "a clause naming its subject is accepted",
    lint("Explain what resolveTargetPath returns").length === 0
      ? "ok"
      : "problems",
    "ok",
    JSON.stringify(lint("Explain what resolveTargetPath returns")),
  );
  // Every clause is judged, so a concrete first half no longer covers for a
  // vague second half. A compound subject that is concrete throughout must
  // still pass, or the split would reject ordinary work.
  check(
    "a concrete compound subject is accepted",
    lint("Rename UserRecord and drop the unused email column").length === 0
      ? "ok"
      : "problems",
    "ok",
    JSON.stringify(lint("Rename UserRecord and drop the unused email column")),
  );
  check("empty message flagged", has("", "empty") ? "ok" : "missed", "ok");
}

header("commit-message: classify() splits judgment calls from rule violations");
{
  const { classify } = require(path.join(HOOKS, "lib", "commit-message.js"));

  const body35 = classify(
    "Exempt broker tokens from the secret warning\n\n" + "line\n".repeat(35),
  );
  check(
    "35-line body is advisory, not blocking",
    body35.blocking.length === 0 &&
      body35.advisory.some((problem) => problem.includes("Body is"))
      ? "ok"
      : "wrong",
    "ok",
    JSON.stringify(body35),
  );

  const subject55 = classify("A".repeat(55));
  check(
    "55-char subject is advisory, not blocking",
    subject55.blocking.length === 0 &&
      subject55.advisory.some((problem) =>
        problem.includes("chars (target 50)"),
      )
      ? "ok"
      : "wrong",
    "ok",
    JSON.stringify(subject55),
  );

  const subject75 = classify("A".repeat(75));
  check(
    "75-char subject is blocking",
    subject75.blocking.some((problem) => problem.includes("hard ceiling"))
      ? "ok"
      : "missed",
    "ok",
    JSON.stringify(subject75),
  );
}

header("commit-message: extract() sources");
{
  const { extract } = require(path.join(HOOKS, "lib", "commit-message.js"));
  fs.writeFileSync(
    path.join(repo, "msg.txt"),
    "Add a thing\n\nBecause of reasons.\n",
  );

  const got = (command) => {
    const found = extract(command, repo);
    return found === null ? null : found.text.split("\n")[0];
  };

  check("-m inline", got('git commit -m "Add a thing"'), "Add a thing", "");
  check(
    "-m single quotes",
    got("git commit -m 'Add a thing'"),
    "Add a thing",
    "",
  );
  check(
    "--message=",
    got('git commit --message="Add a thing"'),
    "Add a thing",
    "",
  );
  check("-F relative path", got("git commit -F msg.txt"), "Add a thing", "");
  check(
    "--file= relative",
    got("git commit --file=msg.txt"),
    "Add a thing",
    "",
  );
  check(
    "-F absolute path",
    got(`git commit -F ${path.join(repo, "msg.txt")}`),
    "Add a thing",
    "",
  );
  check("-F - (stdin) skipped", got("git commit -F -"), null, "");
  check("-F missing file skipped", got("git commit -F nope.txt"), null, "");
  check("no message flag skipped", got("git commit"), null, "");
  check("--fixup skipped", got("git commit --fixup=abc123"), null, "");
  check("--squash skipped", got("git commit --squash=abc123"), null, "");
  check("-C reuse skipped", got("git commit -C HEAD"), null, "");
  check("--amend alone skipped", got("git commit --amend"), null, "");

  // The shell composes this value at runtime; the hook only ever sees the
  // literal `$(cat <<'EOF' ...)` source, which is not a message to judge.
  const heredocCommand =
    "git commit -m \"$(cat <<'EOF'\nSubject here\n\nBody.\nEOF\n)\"";
  check("heredoc -m form skipped", got(heredocCommand), null, "");
  check(
    "backtick-composed -m form skipped",
    got('git commit -m "`generate-message`"'),
    null,
    "",
  );
}

header("PreToolUse(Bash): message passed by file is linted");
{
  git(["reset", "-q"], repo);
  write("src/lint.ts", "export const q = 1;\n");
  write("src/__tests__/lint.test.ts", "test('x', () => {});\n");
  git(["add", "src/lint.ts", "src/__tests__/lint.test.ts"], repo);

  fs.writeFileSync(
    path.join(repo, "bad.txt"),
    "Added a thing that should have been imperative.\n",
  );
  let r = run(GUARD, bash("CLAUDE_ALLOW_COMMIT=1 git commit -F bad.txt", repo));
  check("-F with bad subject is denied", r.verdict, "DENY", r.reason);

  fs.writeFileSync(
    path.join(repo, "ok.txt"),
    "Add a retry to the upload client\n\nBecause of reasons.\n",
  );
  r = run(GUARD, bash("CLAUDE_ALLOW_COMMIT=1 git commit -F ok.txt", repo));
  check("-F with good subject stays silent", r.verdict, "allow", r.reason);

  r = run(GUARD, bash("CLAUDE_ALLOW_COMMIT=1 git commit -F absent.txt", repo));
  check("-F with missing file stays silent", r.verdict, "allow", r.reason);

  r = run(GUARD, bash("CLAUDE_ALLOW_COMMIT=1 git commit --fixup=HEAD", repo));
  check("--fixup not linted", r.verdict, "allow", r.reason);

  // A correct message the parser cannot see must not be denied for a reason
  // that misdescribes it (it used to report "Second line must be blank").
  const heredocCommit =
    "CLAUDE_ALLOW_COMMIT=1 git commit -m \"$(cat <<'EOF'\nSubject here\n\nBody.\nEOF\n)\"";
  r = run(GUARD, bash(heredocCommit, repo));
  check("heredoc commit form is not denied", r.verdict, "allow", r.reason);
}

header("hook-io: output integrity");
{
  // A payload far larger than one pipe buffer, which exercises the short-write loop
  // in emit(). A regression to process.stdout.write() + process.exit() truncates
  // here on any platform where pipe writes are asynchronous.
  const libPath = path.join(HOOKS, "lib", "hook-io.js").replace(/\\/g, "\\\\");
  const size = 2000000;
  const result = spawnSync(
    process.execPath,
    ["-e", `require("${libPath}").deny("PreToolUse","X".repeat(${size}))`],
    {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    },
  );
  let intact = false;
  try {
    const parsed = JSON.parse((result.stdout || "").trim());
    intact = parsed.hookSpecificOutput.permissionDecisionReason.length === size;
  } catch {
    intact = false;
  }
  check(
    "2MB deny reason survives intact",
    intact ? "allow" : "TRUNCATED",
    "allow",
    `stdout was ${(result.stdout || "").length} bytes`,
  );
}

header("PreToolUse(Bash): commit is blocked without the escape");
for (const [label, command] of [
  ["plain commit", 'git commit -m "Add a thing"'],
  ["amend", "git commit --amend --no-edit"],
  ["env prefix before commit", 'FOO=1 git commit -m "Add a thing"'],
  ["chained after a build", 'npm run build && git commit -m "Add a thing"'],
]) {
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(label, verdict, "DENY", reason);
}
{
  const r = run(GUARD, bash("git commit --dry-run", repo));
  check("--dry-run is not a commit", r.verdict, "allow", r.reason);
}

header("PreToolUse(Bash): git global options must not bypass the guard");
for (const [label, command] of [
  ["-C before push", "git -C " + repo + " " + PUSH],
  ["--no-pager before push", "git --no-pager " + PUSH],
  ["-c config before push", "git -c user.email=x@y.z " + PUSH],
  ["--git-dir= before push", "git --git-dir=" + repo + "/.git " + PUSH],
  ["-C before commit", "git -C " + repo + ' commit -m "Add a thing"'],
  ["-C before reset --hard", "git -C " + repo + " reset --hard HEAD~1"],
]) {
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(label, verdict, "DENY", reason);
}

header("PreToolUse(Bash): outward-facing commands are blocked");
for (const [label, command] of [
  ["gh repo delete", "gh repo delete owner/thing --yes"],
  ["gh repo archive", "gh repo archive owner/thing"],
  ["gh pr merge", "gh pr merge 12 --squash"],
  ["gh release create", "gh release create v1.0.0"],
  ["gh api mutating method", "gh api -X DELETE repos/owner/thing"],
  ["gh api --method POST", "gh api --method POST repos/owner/thing/issues"],
  ["npm publish", "npm publish"],
  ["pnpm publish", "pnpm publish --access public"],
  ["vercel env add", "vercel env add SECRET production"],
  ["vercel env rm", "vercel env rm SECRET production"],
  ["vercel --prod", "vercel --prod"],
  ["vercel deploy --prod", "vercel deploy --prod"],
  ["npx vercel --prod (runner prefix)", "npx vercel --prod"],
  ["npx -y vercel --prod", "npx -y vercel --prod"],
  ["vercel promote", "vercel promote dpl_abc"],
  ["vercel rollback", "vercel rollback"],
  ["supabase db push", "supabase db push"],
  ["supabase db reset", "supabase db reset"],
  [
    "supabase migration repair",
    "supabase migration repair --status reverted 123",
  ],
  ["env prefix before publish", "CI=1 npm publish"],
  ["chained after a build", "npm run build && vercel --prod"],
]) {
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(label, verdict, "DENY", reason);
}

header("PreToolUse(Bash): outward escapes are per-family, not blanket");
{
  let r = run(
    GUARD,
    bash("CLAUDE_ALLOW_GH=1 gh repo delete owner/thing", repo),
  );
  check("matching escape allows it", r.verdict, "allow", r.reason);
  r = run(
    GUARD,
    bash("CLAUDE_ALLOW_DEPLOY=1 gh repo delete owner/thing", repo),
  );
  check("wrong-family escape still blocks", r.verdict, "DENY", r.reason);
  r = run(GUARD, bash("CLAUDE_ALLOW_DEPLOY=1 vercel --prod", repo));
  check("deploy escape allows a deploy", r.verdict, "allow", r.reason);
  r = run(GUARD, bash("CLAUDE_ALLOW_PUBLISH=1 npm publish", repo));
  check("publish escape allows publish", r.verdict, "allow", r.reason);
  r = run(GUARD, bash("CLAUDE_ALLOW_DB=1 supabase db push", repo));
  check("db escape allows db push", r.verdict, "allow", r.reason);
  r = run(GUARD, bash("CLAUDE_ALLOW_GH=0 gh repo delete owner/thing", repo));
  check("wrong escape value still blocks", r.verdict, "DENY", r.reason);
}

header("PreToolUse(Bash): outward false-positive guard (these run constantly)");
for (const [label, command] of [
  ["gh repo view", "gh repo view owner/thing"],
  ["gh repo list", "gh repo list"],
  ["gh pr view", "gh pr view 12"],
  ["gh pr list", "gh pr list --state open"],
  ["gh pr checks", "gh pr checks"],
  ["gh api read (default GET)", "gh api repos/owner/thing"],
  ["gh api graphql read", "gh api graphql -f query='{viewer{login}}'"],
  ["gh auth status", "gh auth status"],
  ["gh search issues", "gh search issues --repo owner/thing"],
  ["vercel env ls", "vercel env ls production"],
  ["vercel whoami", "vercel whoami"],
  ["vercel --version", "vercel --version"],
  ["vercel build --prod (local only)", "vercel build --prod"],
  ["vercel project inspect", "vercel project inspect thing"],
  ["supabase migration list", "supabase migration list"],
  ["npm install", "npm install"],
  ["npm run build", "npm run build"],
  ["npx tsc", "npx tsc --noEmit"],
  ["echoing a blocked command", 'echo "run npm publish yourself"'],
]) {
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(label, verdict, "allow", reason);
}

header("PreToolUse(Bash): outward warnings");
for (const [label, command] of [
  ["gh pr create", "gh pr create --title x --body y"],
  ["gh repo create", "gh repo create thing --public"],
]) {
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(label, verdict, "warn", reason);
}

header("PreToolUse(Bash): separators inside quotes are not separators");
{
  const chain = " " + "&".repeat(2) + " ";
  for (const [label, command] of [
    [
      "quoted chain mentioning a blocked command",
      `echo 'docs: gh pr create${chain}gh repo delete owner/thing'`,
    ],
    [
      "double-quoted chain mentioning a push",
      `echo "first commit${chain}${PUSH} origin main"`,
    ],
    [
      "writing a chained example into a file",
      `printf '%s' 'npm run build${chain}npm publish' > notes.txt`,
    ],
  ]) {
    const { verdict, reason } = run(GUARD, bash(command, repo));
    check(label, verdict, "allow", reason);
  }
  // The same text unquoted is a real chain and must still be caught.
  const live = run(GUARD, bash(`npm run build${chain}npm publish`, repo));
  check(
    "the same chain unquoted still denies",
    live.verdict,
    "DENY",
    live.reason,
  );
}

header("PreToolUse(Bash): a warning must never cut short the deny scan");
for (const [label, command] of [
  [
    "warn segment before a denied segment",
    "gh pr create --title x && gh repo delete owner/thing",
  ],
  [
    "warn segment before a denied push",
    "gh repo create thing && " + PUSH + " origin main",
  ],
  [
    "warn segment before a denied commit",
    'gh pr create --title x && git commit -m "Add a thing"',
  ],
  [
    "authorising one family does not clear another",
    "CLAUDE_ALLOW_GH=1 gh repo delete owner/thing && npm publish",
  ],
]) {
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(label, verdict, "DENY", reason);
}

header("PreToolUse(Bash): commit subject is a gate, not a warning");

const ALLOW = "CLAUDE_ALLOW_COMMIT=1 ";
const VAGUE_OK = "CLAUDE_ALLOW_VAGUE_SUBJECT=1 ";

for (const [label, subject] of [
  ["placeholder noun", "Fix the login bug"],
  ["counted placeholder", "Repair three faults found while chasing one bug"],
  ["effect-led subject", "Stop warning about missing tests"],
  ["trailing period", "Widen the supabase token wait."],
]) {
  const command = ALLOW + 'git commit -m "' + subject + '"';
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check("blocks: " + label, verdict, "DENY", reason);
}

for (const [label, subject] of [
  ["names the symbol", "Widen the wait when supabase calls a token early"],
  ["names the component", "Line the queue cards up with the column"],
]) {
  const command = ALLOW + 'git commit -m "' + subject + '"';
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(
    "allows: " + label,
    verdict === "DENY" ? "DENY" : "not-denied",
    "not-denied",
    reason,
  );
}

{
  const command = VAGUE_OK + ALLOW + 'git commit -m "Fix the login bug"';
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check("escape downgrades to warn", verdict, "warn", reason);
}

{
  const command = 'git commit -m "Fix the login bug"';
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check("unauthorized commit still denied first", verdict, "DENY", reason);
}

header("PreToolUse(Bash): judgment calls warn, rule violations deny");

// All lowercase after the opening word so CONCRETE_ANCHOR never matches, and
// long enough to slice a 40- and a 55-character vague subject from the same
// safe source rather than hand-counting characters.
const VAGUE_SOURCE =
  "Fix the login bug for the checkout page today please go review it now again soon and later";

{
  const subject = "A".repeat(55);
  const command = ALLOW + `git commit -m "${subject}"`;
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check("55-char subject with no other problem warns", verdict, "warn", reason);
}

{
  const subject = "Exempt broker tokens from the secret warning";
  const body = "line\n".repeat(35);
  const command = ALLOW + `git commit -m "${subject}\n\n${body}"`;
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check("35-line body warns", verdict, "warn", reason);
}

{
  const subject = "A".repeat(75);
  const command = ALLOW + `git commit -m "${subject}"`;
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check("75-char subject still denies", verdict, "DENY", reason);
}

{
  const subject = VAGUE_SOURCE.slice(0, 40);
  const command = ALLOW + `git commit -m "${subject}"`;
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check("vague 40-char subject still denies", verdict, "DENY", reason);
}

{
  const subject = VAGUE_SOURCE.slice(0, 55);
  const command = ALLOW + `git commit -m "${subject}"`;
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check("55-char AND vague subject denies", verdict, "DENY", reason);
  check(
    "its deny text carries no character-count advisory",
    /chars \(target 50\)/.test(String(reason)) ? "leaked" : "clean",
    "clean",
    reason,
  );
}

header("PostToolUse(Bash): evidence log");
{
  const EVIDENCE = path.join(HOOKS, "evidence-log.js");
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-"));
  const env = { CLAUDE_EVIDENCE_DIR: evidenceDir };
  const entriesFor = (sessionId) => {
    const file = path.join(evidenceDir, `${sessionId}.jsonl`);
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };
  const record = (sessionId, command, response) =>
    run(
      EVIDENCE,
      {
        session_id: sessionId,
        tool_name: "Bash",
        tool_input: { command },
        tool_response: response,
      },
      env,
    );

  record("e1", "npm run build", { exit_code: 0, stdout: "done" });
  const recorded = entriesFor("e1");
  check(
    "a bash command is recorded",
    recorded.length === 1 && recorded[0].command === "npm run build"
      ? "recorded"
      : "missing",
    "recorded",
    JSON.stringify(recorded),
  );
  check(
    "exit status is captured when the harness sends one",
    String(recorded[0] && recorded[0].exit),
    "0",
    JSON.stringify(recorded[0]),
  );
  // When a command ran is what the evidence gate orders against the worker's
  // last write, so a record without it cannot answer the question the gate asks.
  check(
    "when the command ran is recorded, as a parseable time",
    Number.isFinite(Date.parse((recorded[0] || {}).at)),
    true,
    JSON.stringify(recorded[0]),
  );
  check(
    "the response shape is recorded for later inspection",
    Array.isArray(recorded[0] && recorded[0].responseKeys)
      ? "captured"
      : "missing",
    "captured",
    JSON.stringify(recorded[0] && recorded[0].responseKeys),
  );

  // Alternate spellings must keep working: the shape is undocumented per-tool.
  record("e2", "false", { exitCode: 1 });
  check(
    "camelCase exit spelling is understood",
    String(entriesFor("e2")[0].exit),
    "1",
    "",
  );

  // The shape this harness actually sends, confirmed from a live invocation:
  // it carries no exit code at all. Unknown must stay unknown.
  record("e6", "ls", {
    stdout: "a\nb\n",
    stderr: "",
    interrupted: false,
    isImage: false,
    noOutputExpected: false,
  });
  const live = entriesFor("e6")[0];
  check(
    "no exit code from the harness records unknown, not success",
    String(live.exit),
    "null",
    JSON.stringify(live),
  );
  check(
    "output length is measured even without an exit code",
    String(live.outputLength),
    "4",
    JSON.stringify(live),
  );

  record("e7", "sleep 100", { stdout: "", stderr: "", interrupted: true });
  check(
    "an interrupted command is flagged",
    String(entriesFor("e7")[0].interrupted),
    "true",
    "",
  );

  run(
    EVIDENCE,
    { session_id: "e3", tool_name: "Read", tool_input: { file_path: "/x" } },
    env,
  );
  check(
    "non-Bash tools are not recorded",
    String(entriesFor("e3").length),
    "0",
    "",
  );

  record("e4", "echo " + "a".repeat(600), {});
  const long = entriesFor("e4")[0];
  check(
    "an oversized command is truncated",
    String(long.command.length),
    "400",
    "",
  );
  check("truncation is flagged", String(long.truncated), "true", "");

  record("e5", "", {});
  check(
    "an empty command is not recorded",
    String(entriesFor("e5").length),
    "0",
    "",
  );

  // The reminder's whole point is naming how much of the report was observed.
  const markers = {
    CLAUDE_REVIEW_MARKER_DIR: path.join(evidenceDir, "markers"),
  };
  const transcriptFile = path.join(evidenceDir, "t.jsonl");
  fs.writeFileSync(
    transcriptFile,
    JSON.stringify({
      message: {
        content: [
          { type: "tool_use", name: "Edit", input: { file_path: "/x/a.ts" } },
        ],
      },
    }) + "\n",
  );

  let reminder = run(
    STOP,
    { session_id: "e1", transcript_path: transcriptFile },
    { ...markers, ...env },
  );
  check(
    "reminder names the number of commands observed",
    /ran 1 shell command/.test(reminder.reason) ? "named" : "silent",
    "named",
    reminder.reason,
  );

  reminder = run(
    STOP,
    { session_id: "no-commands", transcript_path: transcriptFile },
    { ...markers, ...env },
  );
  check(
    "reminder says so when nothing was observed",
    /ran no shell commands/.test(reminder.reason) ? "named" : "silent",
    "named",
    reminder.reason,
  );

  fs.rmSync(evidenceDir, { recursive: true, force: true });
}

header("SessionStart: config-sentinel");
{
  const SENTINEL = path.join(HOOKS, "config-sentinel.js");

  const temporaryHomes = [];

  // A self-contained fake config dir, so the live one is never read or written.
  const makeConfig = (settings, claudeJson) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-"));
    temporaryHomes.push(home);
    const configDir = path.join(home, ".claude");
    fs.mkdirSync(path.join(configDir, "hooks"), { recursive: true });
    fs.writeFileSync(path.join(configDir, "hooks", "present.js"), "");
    fs.writeFileSync(
      path.join(configDir, "settings.json"),
      typeof settings === "string" ? settings : JSON.stringify(settings),
    );
    if (claudeJson)
      fs.writeFileSync(
        path.join(home, ".claude.json"),
        JSON.stringify(claudeJson),
      );
    return {
      home,
      env: { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: configDir },
    };
  };

  const bootstrap = (name) =>
    `node -e \"const p=require('path'),d=process.env.CLAUDE_CONFIG_DIR;require(p.join(d,'hooks','${name}'))\"`;
  const wired = {
    hooks: { PreToolUse: [{ hooks: [{ command: bootstrap("present.js") }] }] },
  };

  let fake = makeConfig(wired, { mcpServers: {} });
  let result = run(SENTINEL, {}, fake.env);
  check("clean config stays silent", result.verdict, "allow", result.reason);

  fake = makeConfig("{ not json", null);
  result = run(SENTINEL, {}, fake.env);
  check(
    "unparseable settings.json warns",
    result.verdict,
    "warn",
    result.reason,
  );

  fake = makeConfig(
    { hooks: { Stop: [{ hooks: [{ command: bootstrap("absent.js") }] }] } },
    { mcpServers: {} },
  );
  result = run(SENTINEL, {}, fake.env);
  check(
    "missing referenced hook warns",
    result.verdict === "warn" && /absent\.js/.test(result.reason)
      ? "warn"
      : result.verdict,
    "warn",
    result.reason,
  );

  fake = makeConfig(wired, {
    mcpServers: { demo: { headers: { DEMO_API_KEY: "x".repeat(40) } } },
  });
  result = run(SENTINEL, {}, fake.env);
  check(
    "plaintext MCP credential warns",
    result.verdict === "warn" && /demo\.DEMO_API_KEY/.test(result.reason)
      ? "warn"
      : result.verdict,
    "warn",
    result.reason,
  );

  fake = makeConfig(wired, {
    mcpServers: { demo: { headers: { DEMO_API_KEY: "${DEMO_API_KEY}" } } },
  });
  result = run(SENTINEL, {}, fake.env);
  check(
    "placeholder credential is fine",
    result.verdict,
    "allow",
    result.reason,
  );

  // The broker token is the protection, not a leak: warning about it told the
  // user to rotate a key that was already sealed, every single session.
  const brokered = {
    url: "http://127.0.0.1:8787/mcp",
    headers: { "x-ccfg-token": "t".repeat(40) },
  };

  fake = makeConfig(wired, { mcpServers: { demo: brokered } });
  result = run(SENTINEL, {}, fake.env);
  check("brokered server stays silent", result.verdict, "allow", result.reason);

  fake = makeConfig(wired, {
    mcpServers: {
      demo: {
        ...brokered,
        headers: { ...brokered.headers, DEMO_API_KEY: "x".repeat(40) },
      },
    },
  });
  result = run(SENTINEL, {}, fake.env);
  check(
    "brokered server still warns on a real key",
    result.verdict === "warn" && /demo\.DEMO_API_KEY/.test(result.reason)
      ? "warn"
      : result.verdict,
    "warn",
    result.reason,
  );

  // Off loopback the same header is a credential crossing the network.
  fake = makeConfig(wired, {
    mcpServers: {
      demo: { ...brokered, url: "https://mcp.example.com/mcp" },
    },
  });
  result = run(SENTINEL, {}, fake.env);
  check(
    "remote url with a broker token warns",
    result.verdict === "warn" && /demo\.x-ccfg-token/.test(result.reason)
      ? "warn"
      : result.verdict,
    "warn",
    result.reason,
  );

  // Neither the installer nor the daemon spells it this way, so a header that
  // only looks like the broker's earns no exemption, not even beside the real
  // one, where the server is genuinely brokered and the exemption does apply to
  // its neighbour.
  fake = makeConfig(wired, {
    mcpServers: {
      demo: {
        ...brokered,
        headers: { ...brokered.headers, "X-CCFG-Token": "t".repeat(40) },
      },
    },
  });
  result = run(SENTINEL, {}, fake.env);
  check(
    "a differently-cased broker header warns",
    result.verdict === "warn" &&
      /demo\.X-CCFG-Token/.test(result.reason) &&
      !/demo\.x-ccfg-token/.test(result.reason)
      ? "warn"
      : result.verdict,
    "warn",
    result.reason,
  );

  for (const home of temporaryHomes)
    fs.rmSync(home, { recursive: true, force: true });
}

header("UserPromptSubmit: repo-context");
{
  const CONTEXT = path.join(HOOKS, "repo-context.js");
  const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), "ctxcache-"));
  const env = { CLAUDE_CONFIG_DIR: cacheHome };

  let result = run(CONTEXT, { session_id: "s1", cwd: repo }, env);
  check(
    "emits branch and dirty count",
    result.verdict === "warn" && /Repo: branch /.test(result.reason)
      ? "warn"
      : result.verdict,
    "warn",
    result.reason,
  );

  result = run(CONTEXT, { session_id: "s1", cwd: repo }, env);
  check(
    "identical state repeats nothing",
    result.verdict,
    "allow",
    result.reason,
  );

  result = run(CONTEXT, { session_id: "s2", cwd: os.tmpdir() }, env);
  check("outside a repo stays silent", result.verdict, "allow", result.reason);

  // A lockfile above the repo root must not label the repo. This is the bug the
  // bounded walk exists to prevent: ~/package-lock.json labelling everything npm.
  const outerHome = fs.mkdtempSync(path.join(os.tmpdir(), "outer-"));
  fs.writeFileSync(path.join(outerHome, "package-lock.json"), "{}");
  const inner = path.join(outerHome, "inner");
  fs.mkdirSync(inner);
  git(["init", "-q", "."], inner);
  git(["config", "user.email", "t@t.t"], inner);
  git(["config", "user.name", "T"], inner);
  result = run(CONTEXT, { session_id: "s3", cwd: inner }, env);
  check(
    "lockfile above the repo root is ignored",
    result.verdict === "warn" && !/npm/.test(result.reason) ? "warn" : "LEAKED",
    "warn",
    result.reason,
  );

  fs.writeFileSync(path.join(inner, "package-lock.json"), "{}");
  result = run(CONTEXT, { session_id: "s4", cwd: inner }, env);
  check(
    "lockfile inside the repo is reported",
    result.verdict === "warn" && /npm/.test(result.reason) ? "warn" : "MISSED",
    "warn",
    result.reason,
  );

  fs.rmSync(cacheHome, { recursive: true, force: true });
  fs.rmSync(outerHome, { recursive: true, force: true });
}

header("ccfg: secret migration and doctor");
{
  const CCFG = path.join(HOOKS, "..", "tools", "ccfg.js");
  const PLAINTEXT = "ctx7sk-" + "b".repeat(30);

  const makeHome = () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-"));
    fs.mkdirSync(path.join(home, ".claude", "hooks"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude", "settings.json"),
      JSON.stringify({
        permissions: { allow: [], deny: ["Read(**/.env)"] },
        hooks: {},
      }),
    );
    fs.writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          context7: { type: "http", headers: { CONTEXT7_API_KEY: PLAINTEXT } },
        },
      }),
    );
    return home;
  };

  const ccfg = (home, args) =>
    spawnSync(process.execPath, [CCFG, ...args], {
      encoding: "utf8",
      timeout: 60000,
      windowsHide: true,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
        CLAUDE_SECRETS_BACKEND: "file",
        NO_COLOR: "1",
      },
    });

  let home = makeHome();
  let result = ccfg(home, ["doctor"]);
  check(
    "doctor fails while a key is plaintext",
    result.status === 1 ? "DENY" : "allow",
    "DENY",
    (result.stdout || "").slice(-200),
  );

  result = ccfg(home, ["keys", "migrate", "--dry-run"]);
  const afterDryRun = JSON.parse(
    fs.readFileSync(path.join(home, ".claude.json"), "utf8"),
  );
  check(
    "dry run changes nothing on disk",
    afterDryRun.mcpServers.context7.headers.CONTEXT7_API_KEY === PLAINTEXT
      ? "allow"
      : "MUTATED",
    "allow",
    "",
  );

  result = ccfg(home, ["keys", "migrate"]);
  const migrated = JSON.parse(
    fs.readFileSync(path.join(home, ".claude.json"), "utf8"),
  );
  check(
    "migrate replaces the literal with a placeholder",
    migrated.mcpServers.context7.headers.CONTEXT7_API_KEY ===
      "${CONTEXT7_API_KEY}"
      ? "allow"
      : "NOT REPLACED",
    "allow",
    JSON.stringify(migrated.mcpServers.context7.headers),
  );

  const secretsFile = path.join(home, ".claude", "secrets.env");
  check(
    "migrate saves the value before overwriting it",
    fs.existsSync(secretsFile) &&
      fs.readFileSync(secretsFile, "utf8").includes(PLAINTEXT)
      ? "allow"
      : "LOST",
    "allow",
    "",
  );
  if (process.platform === "win32") {
    skip(
      "secrets file is not world-readable",
      "POSIX mode bits; Windows uses ACLs",
    );
  } else {
    check(
      "secrets file is not world-readable",
      fs.existsSync(secretsFile) &&
        (fs.statSync(secretsFile).mode & 0o077) === 0
        ? "allow"
        : "TOO OPEN",
      "allow",
      "",
    );
  }
  check(
    "the type of key that was migrated is preserved",
    migrated.mcpServers.context7.type === "http" ? "allow" : "CLOBBERED",
    "allow",
    "",
  );

  result = ccfg(home, ["keys", "migrate"]);
  check(
    "re-running migrate is a no-op",
    /already indirect/.test(result.stdout || "") ? "allow" : "REPEATED",
    "allow",
    (result.stdout || "").slice(0, 200),
  );

  result = ccfg(home, ["keys", "list"]);
  check(
    "keys list never prints the whole secret",
    (result.stdout || "").includes(PLAINTEXT) ? "LEAKED" : "allow",
    "allow",
    "",
  );

  result = ccfg(home, ["nonsense-command"]);
  check(
    "unknown command exits non-zero",
    result.status === 2 ? "allow" : "WRONG CODE",
    "allow",
    String(result.status),
  );

  fs.rmSync(home, { recursive: true, force: true });
}

header("PostToolUse(Bash): evidence log is size-capped");
{
  const EVIDENCE = path.join(HOOKS, "evidence-log.js");
  const cappedDir = fs.mkdtempSync(path.join(os.tmpdir(), "evcap-"));
  const env = { CLAUDE_EVIDENCE_DIR: cappedDir };
  const file = path.join(cappedDir, "capped.jsonl");

  // 512KB is the cap; write past it, then confirm the next command is dropped
  // rather than growing the file forever.
  fs.writeFileSync(file, "x".repeat(520 * 1024) + "\n");
  const sizeBefore = fs.statSync(file).size;
  run(
    EVIDENCE,
    {
      session_id: "capped",
      tool_name: "Bash",
      tool_input: { command: "echo past-the-cap" },
      tool_response: {},
    },
    env,
  );
  check(
    "an oversized log stops accepting entries",
    String(fs.statSync(file).size),
    String(sizeBefore),
    "file grew past the cap",
  );

  const smallFile = path.join(cappedDir, "small.jsonl");
  run(
    EVIDENCE,
    {
      session_id: "small",
      tool_name: "Bash",
      tool_input: { command: "echo under-the-cap" },
      tool_response: {},
    },
    env,
  );
  check(
    "a log under the cap still accepts entries",
    fs.existsSync(smallFile) ? "appended" : "dropped",
    "appended",
    "",
  );

  fs.rmSync(cappedDir, { recursive: true, force: true });
}

header("ccfg: clean, backup and install");
{
  const CCFG = path.join(HOOKS, "..", "tools", "ccfg.js");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ccfgops-"));
  const configDir = path.join(home, ".claude");
  fs.mkdirSync(path.join(configDir, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(configDir, "hooks", "a.js"), "// hook\n");
  fs.writeFileSync(path.join(configDir, "settings.json"), "{}");
  fs.writeFileSync(path.join(configDir, "CLAUDE.md"), "# instructions\n");
  fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({}));

  const ccfg = (args) =>
    spawnSync(process.execPath, [CCFG, ...args], {
      encoding: "utf8",
      timeout: 60000,
      windowsHide: true,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CLAUDE_CONFIG_DIR: configDir,
        NO_COLOR: "1",
      },
    });

  // Aged well past the 7-day idle threshold the archiver requires.
  const staleLog = path.join(configDir, "bash-commands.log");
  fs.writeFileSync(staleLog, "old command history\n".repeat(500));
  const longAgo = Date.now() / 1000 - 30 * 24 * 3600;
  fs.utimesSync(staleLog, longAgo, longAgo);

  const oldCache = path.join(configDir, "paste-cache", "ancient");
  fs.mkdirSync(path.dirname(oldCache), { recursive: true });
  fs.writeFileSync(oldCache, "stale");
  fs.utimesSync(oldCache, longAgo, longAgo);

  const freshCache = path.join(configDir, "paste-cache", "recent");
  fs.writeFileSync(freshCache, "fresh");

  ccfg(["clean"]);
  check(
    "a dry run leaves the stale log alone",
    fs.existsSync(staleLog) ? "kept" : "removed",
    "kept",
    "",
  );

  ccfg(["clean", "--yes"]);
  check(
    "an idle log is archived, not deleted outright",
    fs.existsSync(staleLog + ".gz") ? "archived" : "lost",
    "archived",
    "",
  );
  check(
    "the uncompressed original is removed",
    fs.existsSync(staleLog) ? "kept" : "removed",
    "removed",
    "",
  );
  check(
    "an aged cache entry is pruned",
    fs.existsSync(oldCache) ? "kept" : "pruned",
    "pruned",
    "",
  );
  check(
    "a recent cache entry survives",
    fs.existsSync(freshCache) ? "kept" : "pruned",
    "kept",
    "",
  );

  const archived = fs.readFileSync(staleLog + ".gz");
  check(
    "the archive really holds the original bytes",
    require("zlib").gunzipSync(archived).toString().startsWith("old command"),
    true,
    "",
  );

  ccfg(["backup"]);
  const backupRoot = path.join(configDir, "backups");
  const snapshots = fs.existsSync(backupRoot)
    ? fs.readdirSync(backupRoot).filter((name) => name.startsWith("manual-"))
    : [];
  check(
    "backup writes a timestamped snapshot",
    String(snapshots.length),
    "1",
    JSON.stringify(snapshots),
  );
  const snapshot = path.join(backupRoot, snapshots[0] || "none");
  for (const artifact of ["settings.json", "CLAUDE.md", ".claude.json"]) {
    check(
      `backup captures ${artifact}`,
      fs.existsSync(path.join(snapshot, artifact)) ? "present" : "missing",
      "present",
      "",
    );
  }
  check(
    "backup captures the hooks directory",
    fs.existsSync(path.join(snapshot, "hooks", "a.js")) ? "present" : "missing",
    "present",
    "",
  );

  const installResult = ccfg(["install"]);
  check(
    "install exits cleanly",
    String(installResult.status),
    "0",
    (installResult.stderr || "").slice(0, 200),
  );
  const shim = path.join(home, ".local", "bin", "ccfg");
  check(
    "install writes the shim",
    fs.existsSync(shim) ? "present" : "missing",
    "present",
    "",
  );
  if (process.platform === "win32") {
    skip("the shim is executable", "no execute bit on Windows");
  } else {
    check(
      "the shim is executable",
      fs.existsSync(shim) && fs.statSync(shim).mode & 0o111 ? true : false,
      true,
      "",
    );
  }
  check(
    "install writes the shell shim",
    fs.existsSync(path.join(configDir, "shell-init.sh"))
      ? "present"
      : "missing",
    "present",
    "",
  );
  // The shim must launch the real CLI, not just exist.
  if (process.platform === "win32") {
    skip(
      "the installed shim actually runs ccfg",
      "the shim is a POSIX sh script",
    );
  } else {
    const viaShim = spawnSync(shim, ["help"], {
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, HOME: home, NO_COLOR: "1" },
    });
    check(
      "the installed shim actually runs ccfg",
      /manage this Claude Code configuration/.test(viaShim.stdout || "")
        ? "runs"
        : "broken",
      "runs",
      (viaShim.stderr || "").slice(0, 200),
    );
  }

  fs.rmSync(home, { recursive: true, force: true });
}

header("ccfg: secrets never reach argv, and backups get scrubbed");
{
  const CCFG = path.join(HOOKS, "..", "tools", "ccfg.js");
  const LIVE_KEY = "ctx7sk-" + "c".repeat(30);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ccfgsec-"));
  const configDir = path.join(home, ".claude");
  fs.mkdirSync(path.join(configDir, "backups", "old"), { recursive: true });
  fs.writeFileSync(path.join(configDir, "settings.json"), "{}");
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: { context7: { headers: { CONTEXT7_API_KEY: LIVE_KEY } } },
    }),
  );
  // A backup taken while the key was still plaintext, which the case migration
  // alone cannot fix, because it rewrites only the live file.
  const staleBackup = path.join(configDir, "backups", "old", "claude.json");
  fs.writeFileSync(
    staleBackup,
    JSON.stringify({
      mcpServers: { context7: { headers: { CONTEXT7_API_KEY: LIVE_KEY } } },
    }),
  );

  const ccfg = (args, options) =>
    spawnSync(process.execPath, [CCFG, ...args], {
      encoding: "utf8",
      timeout: 60000,
      windowsHide: true,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_SECRETS_BACKEND: "file",
        NO_COLOR: "1",
      },
      ...(options || {}),
    });

  const inlineAttempt = ccfg(["keys", "set", "CONTEXT7_API_KEY", LIVE_KEY]);
  check(
    "a secret passed on the command line is refused",
    String(inlineAttempt.status),
    "2",
    (inlineAttempt.stderr || "").slice(0, 120),
  );
  check(
    "the refusal explains the shell-history exposure",
    /shell history/.test(inlineAttempt.stderr || "") ? "explained" : "silent",
    "explained",
    (inlineAttempt.stderr || "").slice(0, 200),
  );
  check(
    "refusing does not store the value anyway",
    fs.existsSync(path.join(configDir, "secrets.env"))
      ? "stored"
      : "not stored",
    "not stored",
    "",
  );

  const piped = ccfg(["keys", "set", "CONTEXT7_API_KEY", "--stdin"], {
    input: LIVE_KEY + "\n",
  });
  check(
    "a piped secret is accepted",
    String(piped.status),
    "0",
    (piped.stderr || "").slice(0, 160),
  );
  check(
    "the piped value is stored without the trailing newline",
    (fs
      .readFileSync(path.join(configDir, "secrets.env"), "utf8")
      .match(/CONTEXT7_API_KEY="([^"]*)"/) || [])[1],
    LIVE_KEY,
    "",
  );

  // Order trap: after a rotation the file still holds the dead key, so a later
  // migrate must not overwrite the new value that was already stored.
  const NEW_KEY = "ctx7sk-" + "d".repeat(30);
  const rotated = ccfg(["keys", "set", "CONTEXT7_API_KEY", "--stdin"], {
    input: NEW_KEY + "\n",
  });
  check("a rotated value can be stored", String(rotated.status), "0", "");
  ccfg(["keys", "migrate"]);
  check(
    "migrate does not clobber a newer stored value",
    (fs
      .readFileSync(path.join(configDir, "secrets.env"), "utf8")
      .match(/CONTEXT7_API_KEY="([^"]*)"/) || [])[1],
    NEW_KEY,
    "the dead key from ~/.claude.json overwrote the rotated one",
  );
  check(
    "migrate still writes the placeholder",
    JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"))
      .mcpServers.context7.headers.CONTEXT7_API_KEY,
    "${CONTEXT7_API_KEY}",
    "",
  );

  // Two, not one: migrate takes its own backup of ~/.claude.json before
  // rewriting it, so the plaintext it removed survives in that copy too.
  const report = ccfg(["keys", "scrub"]);
  check(
    "scrub finds both the old backup and migrate's own",
    /2 file\(s\) still contain a live key/.test(report.stdout || "")
      ? "reported"
      : "missed",
    "reported",
    (report.stdout || "").slice(0, 300),
  );
  check(
    "scrub finds a key by shape after migrate forgot its value",
    /keys-migrate/.test(report.stdout || "") ? "found" : "missed",
    "found",
    (report.stdout || "").slice(0, 300),
  );
  check(
    "reporting does not modify the backup",
    fs.readFileSync(staleBackup, "utf8").includes(LIVE_KEY)
      ? "intact"
      : "changed",
    "intact",
    "",
  );

  ccfg(["keys", "scrub", "--yes"]);
  check(
    "scrub --yes removes the key from the backup",
    fs.readFileSync(staleBackup, "utf8").includes(LIVE_KEY)
      ? "still there"
      : "gone",
    "gone",
    "",
  );
  check(
    "the scrubbed backup is still valid JSON",
    typeof JSON.parse(fs.readFileSync(staleBackup, "utf8")) === "object"
      ? "valid"
      : "corrupted",
    "valid",
    "",
  );

  fs.rmSync(home, { recursive: true, force: true });
}

header("Credential reads: the Read deny rules do not bind Bash");

// The point of this block: `permissions.deny` entries only constrain the Read
// tool. Every one of these reaches the same file through a shell instead.
for (const [label, command] of [
  ["cat an ssh private key", "cat ~/.ssh/id_ed25519"],
  ["cat by absolute path", "cat /Users/someone/.ssh/id_rsa"],
  ["ssh directory listing", "ls -la ~/.ssh/"],
  ["aws credentials", "cat ~/.aws/credentials"],
  ["gcloud credentials", "grep -r token ~/.config/gcloud"],
  ["github cli token", "cat ~/.config/gh/hosts.yml"],
  ["docker registry auth", "cat ~/.docker/config.json"],
  ["npm token", "cat ~/.npmrc"],
  ["netrc", "head -5 ~/.netrc"],
  ["a pem file", "openssl rsa -in server.pem -text"],
  ["a p12 bundle", "cat cert.p12"],
  ["the ccfg secrets file", "cat ~/.claude/secrets.env"],
  ["a 21st token file", "cat ~/.config/21st/auth.json"],
  ["a dotenv", "cat .env"],
  ["a nested dotenv", "cat apps/web/.env.local"],
  ["a production dotenv", "cat .env.production"],
  // Readers other than cat, which is why this matches on the path.
  ["less", "less ~/.ssh/config"],
  [
    "node interpreter",
    `node -e "console.log(require('fs').readFileSync('/Users/x/.ssh/id_rsa','utf8'))"`,
  ],
  ["python interpreter", "python3 -c \"print(open('.env').read())\""],
  ["stdin redirection", "while read l; do echo $l; done < ~/.aws/credentials"],
  ["copy then read", "cp ~/.ssh/id_rsa /tmp/k"],
  ["archive exfiltration", "tar czf - ~/.ssh | base64"],
  ["base64 encode", "base64 ~/.npmrc"],
  ["strings", "strings ~/.docker/config.json"],
  ["grep across a dotenv", "grep KEY .env"],
  ["second segment of a chain", "echo hi && cat ~/.ssh/id_rsa"],
  // Read-only against Vercel, but it writes every live production secret into a
  // local .env file. Previously allowed; the credential rules now cover it.
  ["vercel env pull", "vercel env pull .env.local"],
  // Quoting is removed by the shell before the path is resolved, so these open
  // exactly the same files as the plain spellings above.
  ["single-quote splitting", "cat ~/.s''sh/id_rsa"],
  ["double-quote splitting", 'cat ~/".ssh"/id_rsa'],
  ["backslash escaping", "cat ~/.ss\\h/id_rsa"],
  ["quote-split dotenv", "cat .e''nv"],
  ["quoted keychain read", "security find-generic-password -s 'ccfg' -a X -w"],
  ["keychain read", "security find-generic-password -s ccfg -a X -w"],
  ["keychain dump", "security dump-keychain -a"],
  ["whole environment", "env"],
  ["environment piped to grep", "env | grep KEY"],
  ["printenv with no arguments", "printenv"],
  ["printenv of a named key", "printenv CONTEXT7_API_KEY"],
  [
    "expanding a key variable",
    'curl -H "x-api-key: $STITCH_API_KEY" https://x',
  ],
  ["expanding a braced key variable", 'echo "${SOME_API_KEY}"'],
]) {
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(label, verdict, "DENY", reason);
}

// Ordinary work must survive, or the guard gets disabled and protects nothing.
for (const [label, command] of [
  ["a dotenv template", "cat .env.example"],
  ["a dotenv sample", "cat config/.env.sample"],
  ["reading source", "cat src/index.ts"],
  ["package manifest", "cat package.json"],
  ["env with arguments is not a dump", "env NODE_ENV=test npm run build"],
  ["set with flags is not a dump", "set -euo pipefail"],
  ["a lowercase variable", "echo $api_key_note"],
  // `process.env` is not a dotenv path, and it appears in ordinary JavaScript
  // constantly. Over-blocking here would get the whole guard switched off.
  [
    "process.env in a node script",
    'node -e "console.log(process.env.NODE_ENV)"',
  ],
  ["process.env.HOME", 'node -e "console.log(process.env.HOME)"'],
  ["a variable named env", "echo $env_name"],
  ["a directory merely named config", "cat ~/.config/ghostty/config"],
  ["installing packages", "npm install --save-dev vitest"],
]) {
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(label, verdict, "allow", reason);
}

// The escape is typed per invocation and cannot be exported, matching every
// other CLAUDE_ALLOW_* in this guard.
{
  const { verdict, reason } = run(
    GUARD,
    bash("CLAUDE_ALLOW_SECRET_READ=1 cat ~/.ssh/id_rsa", repo),
  );
  check("the per-invocation escape works", verdict, "allow", reason);
}

header("Malformed input: must never block");
for (const [label, payload] of [
  ["empty object", {}],
  ["no tool_input", { tool_name: "Bash" }],
  ["non-Bash tool", { tool_name: "Read", tool_input: { file_path: "/x" } }],
]) {
  const { verdict, reason, code } = run(GUARD, payload);
  check(`${label} (exit ${code})`, verdict, "allow", reason);
}

header("lib/session-cache: one path builder for all four call sites");
{
  const { cachePath } = require(path.join(HOOKS, "lib", "session-cache.js"));
  const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), "session-cache-"));
  const env = { CLAUDE_CONFIG_DIR: cacheHome };
  const withEnv = (fn) => {
    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = cacheHome;
    try {
      return fn();
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    }
  };

  const traversal = withEnv(() => cachePath("constraints", "../../etc/passwd"));
  check(
    "a session id containing ../ resolves inside the cache directory",
    traversal.startsWith(path.join(cacheHome, "cache", "constraints"))
      ? "allow"
      : "escaped",
    "allow",
    traversal,
  );

  const slashed = withEnv(() => cachePath("constraints", "a/b/c"));
  check(
    "a session id containing / resolves inside the cache directory, not a subdirectory",
    path.dirname(slashed) === path.join(cacheHome, "cache", "constraints")
      ? "allow"
      : "escaped",
    "allow",
    slashed,
  );

  const empty = withEnv(() => cachePath("constraints", ""));
  check(
    "an empty session id resolves to unknown.md",
    path.basename(empty),
    "unknown.md",
    empty,
  );

  const dotdot = withEnv(() => cachePath("constraints", ".."));
  check(
    "a bare .. session id resolves to unknown.md",
    path.basename(dotdot),
    "unknown.md",
    dotdot,
  );

  // Checked before the create:true call below touches the kind's directory,
  // since both now share the "constraints" kind and a shared directory would
  // otherwise already exist by the time this runs.
  check(
    "create: false never makes the directory",
    fs.existsSync(
      path.dirname(withEnv(() => cachePath("constraints", "no-create-1"))),
    ),
    false,
    "",
  );

  const writerPath = withEnv(() =>
    cachePath("constraints", "agree-1", { create: true }),
  );
  const readerPath = withEnv(() => cachePath("constraints", "agree-1"));
  check("writer and reader agree on the same path", readerPath, writerPath, "");

  fs.rmSync(cacheHome, { recursive: true, force: true });
}

const captureHome = fs.mkdtempSync(path.join(os.tmpdir(), "capture-"));

header("UserPromptSubmit: captures standing constraints");

const CAPTURE = path.join(HOOKS, "constraint-capture.js");

// Captures land in the repository's working record, so these cases need a
// repository holding one. Each call starts from the scaffolded template unless
// the case is about what accumulates across turns.
const stateFileLibrary = require(path.join(HOOKS, "lib", "state-file.js"));
const captureRepository = makeRepository("capture-repo-");
const captureStatePath = path.join(captureRepository, ".claude", "state.md");
const captureTemplate = readTextOrEmpty(
  path.join(__dirname, "..", "skills", "repo-setup", "templates", "state.md"),
);
fs.mkdirSync(path.join(captureRepository, ".claude"));

function capture(prompt, sessionIdentifier, { fresh = true } = {}) {
  if (fresh) fs.writeFileSync(captureStatePath, captureTemplate);
  run(
    CAPTURE,
    {
      hook_event_name: "UserPromptSubmit",
      session_id: sessionIdentifier,
      prompt,
      cwd: captureRepository,
    },
    { CLAUDE_CONFIG_DIR: captureHome },
  );
  return stateFileLibrary.sectionBody(
    readTextOrEmpty(captureStatePath),
    "Unconfirmed",
  );
}

for (const [label, prompt] of [
  ["from now on", "From now on use pnpm, never npm"],
  ["until I confirm", "Don't delete any files until I confirm"],
  ["for the rest of", "For the rest of this session stay off the main branch"],
  ["never", "Never edit files under vendor/"],
]) {
  const text = capture(prompt, "constraint-" + label.replace(/\s+/g, "-"));
  check(
    "captures: " + label,
    text.includes(prompt) ? "allow" : "missing",
    "allow",
    text,
  );
}

for (const [label, prompt] of [
  ["plain request", "Add a test for the parser"],
  ["question", "What does this function do?"],
]) {
  const text = capture(prompt, "ignore-" + label.replace(/\s+/g, "-"));
  check("ignores: " + label, text === "" ? "allow" : "captured", "allow", text);
}

{
  const first = capture("Never edit files under vendor/", "accumulate-1");
  const second = capture("From now on use pnpm", "accumulate-1", {
    fresh: false,
  });
  const bullets = second.split("\n").filter((line) => line.startsWith("- "));
  check(
    "accumulates across turns",
    bullets.length === 2 ? "allow" : String(bullets.length),
    "allow",
    second,
  );
  check(
    "keeps the first",
    first.trim() !== "" ? "allow" : "empty",
    "allow",
    first,
  );
}

{
  const long = capture(
    "Never edit files under vendor/ or build/",
    "substring-1",
  );
  const short = capture("Never edit files under vendor/", "substring-1", {
    fresh: false,
  });
  const bullets = short.split("\n").filter((line) => line.startsWith("- "));
  check(
    "captures a constraint that is a substring of an existing one",
    bullets.length === 2 ? "allow" : String(bullets.length),
    "allow",
    short,
  );
}

{
  const prompt =
    "Add a test for the parser. Never touch the vendor directory. " +
    "Also check the README.";
  const text = capture(prompt, "sentence-scoped-1");
  check(
    "captures only the matching sentence",
    text.includes("Never touch the vendor directory.") &&
      !text.includes("Add a test for the parser") &&
      !text.includes("Also check the README")
      ? "allow"
      : "wrong",
    "allow",
    text,
  );
}

{
  // The exception lives in its own sentence, so capturing the trigger sentence
  // alone would store the exact inverse of the instruction.
  const prompt = "Never use the cache. Unless the flag is explicitly set.";
  const text = capture(prompt, "qualifier-attached-1");
  check(
    "a following exception stays attached to the rule it scopes",
    text.includes("Never use the cache. Unless the flag is explicitly set.")
      ? "allow"
      : "dropped",
    "allow",
    text,
  );
}

{
  const prompt = "Never touch the lockfile. Then run the installer.";
  const text = capture(prompt, "qualifier-attached-2");
  check(
    "an ordinary following sentence is not swept in",
    !text.includes("Then run the installer") ? "allow" : "swept",
    "allow",
    text,
  );
}

{
  // One sentence, no internal punctuation, so it survives sentence-splitting
  // as a single unit long enough to trip the truncation marker.
  const longSentence = "Never " + "x".repeat(450);
  const text = capture(longSentence, "long-sentence-1");
  check(
    "a sentence over MAX_LINE carries the truncation marker",
    text.includes("… (truncated)") ? "allow" : "missing",
    "allow",
    text,
  );
}

{
  // The working record is the only reader, so a repository without one is left
  // untouched rather than falling back to a file nothing reads.
  const noRecordRepository = makeRepository("capture-no-record-");
  const noRecordHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "capture-no-record-home-"),
  );
  const reply = run(
    CAPTURE,
    {
      hook_event_name: "UserPromptSubmit",
      session_id: "no-record-1",
      prompt: "From now on use pnpm, never npm",
      cwd: noRecordRepository,
    },
    { CLAUDE_CONFIG_DIR: noRecordHome },
  );
  check(
    "without a working record the hook stays silent",
    reply.verdict,
    "allow",
    reply.reason,
  );
  check(
    "without a working record no state file is created",
    fs.existsSync(path.join(noRecordRepository, ".claude", "state.md")),
    false,
    "",
  );
  check(
    "without a working record no constraints cache is created",
    fs.existsSync(path.join(noRecordHome, "cache", "constraints")),
    false,
    "",
  );
  fs.rmSync(noRecordRepository, { recursive: true, force: true });
  fs.rmSync(noRecordHome, { recursive: true, force: true });
}

header(
  "UserPromptSubmit: capture writes into Unconfirmed when a state file exists",
);
{
  const captureHook = path.join(HOOKS, "constraint-capture.js");
  const stateFile = require(path.join(HOOKS, "lib", "state-file.js"));
  const carryover = require(
    path.join(__dirname, "..", "probes", "state-carryover.js"),
  );
  const template = path.join(
    __dirname,
    "..",
    "skills",
    "repo-setup",
    "templates",
    "state.md",
  );
  const captureRoot = makeRepository("capture-state-");
  const captureStateHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "capture-state-home-"),
  );
  fs.mkdirSync(path.join(captureRoot, ".claude"));
  const statePath = path.join(captureRoot, ".claude", "state.md");
  fs.writeFileSync(statePath, carryover.STATE_FILE);
  const submit = (prompt) =>
    run(
      captureHook,
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "capture-state-1",
        prompt,
        cwd: captureRoot,
      },
      { CLAUDE_CONFIG_DIR: captureStateHome },
    );
  const unconfirmed = () =>
    stateFile.sectionBody(readTextOrEmpty(statePath), "Unconfirmed");

  submit("From now on use pnpm, never npm");
  check(
    "the captured sentence lands under Unconfirmed",
    unconfirmed(),
    "- From now on use pnpm, never npm",
    readTextOrEmpty(statePath),
  );
  check(
    "every other section is left byte for byte",
    stateFile.stateDigest(readTextOrEmpty(statePath)),
    stateFile.stateDigest(carryover.STATE_FILE),
    "",
  );
  check(
    "nothing is written to cache/constraints",
    fs.existsSync(path.join(captureStateHome, "cache", "constraints")),
    false,
    "",
  );

  submit("From now on use pnpm, never npm");
  check(
    "the same sentence is not added twice",
    unconfirmed(),
    "- From now on use pnpm, never npm",
    unconfirmed(),
  );
  submit("Never edit files under vendor/");
  check(
    "a second instruction joins the first",
    unconfirmed(),
    "- From now on use pnpm, never npm\n- Never edit files under vendor/",
    unconfirmed(),
  );

  // Compared as a boolean, not as two texts: a whole state file in the report
  // line puts arbitrary file content into this suite's stdout, which other tools
  // parse. It cost the validator its case count once already.
  const beforePlainRequest = readTextOrEmpty(statePath);
  submit("Add a test for the parser");
  check(
    "a plain request leaves the file alone",
    readTextOrEmpty(statePath) === beforePlainRequest,
    true,
    "",
  );

  fs.copyFileSync(template, statePath);
  submit("Never touch the lockfile");
  check(
    "under the template's comment the section reads as one bullet",
    unconfirmed(),
    "- Never touch the lockfile",
    readTextOrEmpty(statePath),
  );

  check(
    "no case wrote the config repository's state file",
    readTextOrEmpty(configRepositoryState) === configRepositoryStateBefore,
    true,
    "",
  );

  fs.rmSync(captureRoot, { recursive: true, force: true });
  fs.rmSync(captureStateHome, { recursive: true, force: true });
}

header(
  "UserPromptSubmit: capture ignores what the harness wrote, not the user",
);
{
  // Background task notifications, slash-command echoes and bash blocks all
  // arrive in the user-message position, so the hook sees them as prompts. Their
  // prose is somebody else's — a subagent's report, a command's output — and
  // storing it under Unconfirmed files it as an instruction the operator gave.
  const captureHook = path.join(HOOKS, "constraint-capture.js");
  const restoreHook = path.join(HOOKS, "state-restore.js");
  const stateFile = require(path.join(HOOKS, "lib", "state-file.js"));
  const template = path.join(
    __dirname,
    "..",
    "skills",
    "repo-setup",
    "templates",
    "state.md",
  );
  const harnessRoot = makeRepository("capture-harness-");
  const harnessHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "capture-harness-home-"),
  );
  fs.mkdirSync(path.join(harnessRoot, ".claude"));
  const statePath = path.join(harnessRoot, ".claude", "state.md");
  const submit = (prompt, sessionIdentifier) =>
    run(
      captureHook,
      {
        hook_event_name: "UserPromptSubmit",
        session_id: sessionIdentifier,
        prompt,
        cwd: harnessRoot,
      },
      { CLAUDE_CONFIG_DIR: harnessHome },
    );
  const unconfirmed = () =>
    stateFile.sectionBody(readTextOrEmpty(statePath), "Unconfirmed");

  // Shaped from the live reproduction, and deliberately awkward: the first
  // sentence carries no keyword, so before the fix the capture began mid-result
  // and carried the closing tag onto the stored line.
  const TASK_NOTIFICATION =
    "<task-notification>\n<task-id>afa397717a7cb37ab</task-id>\n" +
    "<status>completed</status>\n" +
    '<summary>Agent "Review the upload client" finished</summary>\n' +
    "<result>Two findings. Report: the reviewer found that the client never " +
    "retries a failed upload, and always logs the raw token.</result>\n" +
    "</task-notification>";

  fs.copyFileSync(template, statePath);
  submit(TASK_NOTIFICATION, "harness-notification-1");
  check(
    "a subagent's report is not filed as an instruction",
    unconfirmed(),
    "",
    readTextOrEmpty(statePath),
  );

  // Deviation 8's guard: an untouched template says nothing on startup. A single
  // captured line used to defeat it, so every later session opened on a banner
  // reading "(no goal recorded)" — built from prose the operator never wrote.
  check(
    "the notification leaves the template untouched",
    readTextOrEmpty(statePath) === readTextOrEmpty(template),
    true,
    "",
  );
  check(
    "the template still loads nothing at startup after a notification",
    JSON.stringify(
      runJson(
        restoreHook,
        {
          hook_event_name: "SessionStart",
          source: "startup",
          session_id: "harness-restore-1",
          cwd: harnessRoot,
        },
        { CLAUDE_CONFIG_DIR: harnessHome },
      ),
    ),
    "{}",
    "",
  );

  for (const [label, prompt] of [
    [
      "a bash block",
      "<bash-input>rm -rf build</bash-input>\n" +
        "<bash-stdout>Never removed: build is missing.</bash-stdout>",
    ],
    [
      "a slash-command echo",
      "<command-name>/mode</command-name>\n" +
        "<command-message>Never switch modes mid-session.</command-message>",
    ],
  ]) {
    fs.copyFileSync(template, statePath);
    submit(prompt, "harness-" + label.replace(/\s+/g, "-"));
    check("ignores " + label, unconfirmed(), "", readTextOrEmpty(statePath));
  }

  // The counterweight: the harness puts its own blocks around a real prompt, so
  // skipping the whole message whenever one appears would lose the instruction
  // the operator typed directly after a slash command.
  fs.copyFileSync(template, statePath);
  submit(
    "<command-name>/clear</command-name>\n<command-args></command-args>\n" +
      "From now on use pnpm, never npm",
    "harness-mixed-1",
  );
  check(
    "an instruction typed beside a command block is still captured",
    unconfirmed(),
    "- From now on use pnpm, never npm",
    readTextOrEmpty(statePath),
  );

  fs.rmSync(harnessRoot, { recursive: true, force: true });
  fs.rmSync(harnessHome, { recursive: true, force: true });
}

header("lib/transcript-tail: context size from the end of a transcript");
{
  const transcriptTail = require(path.join(HOOKS, "lib", "transcript-tail.js"));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-tail-"));
  const assistantEntry = (tokens, extra = {}) => ({
    type: "assistant",
    isSidechain: false,
    requestId: "request-" + tokens,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: tokens - 1002,
        cache_creation_input_tokens: 1000,
        output_tokens: 50,
      },
    },
    ...extra,
  });
  const boundary = {
    type: "system",
    subtype: "compact_boundary",
    compactMetadata: { trigger: "auto", preTokens: 368000 },
  };
  const writeTranscript = (name, entries, prefix = "") => {
    const file = path.join(scratch, name);
    fs.writeFileSync(
      file,
      prefix + entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );
    return file;
  };
  const latest = (file) => transcriptTail.latestContextTokens(file);

  check(
    "sums input, cache-read and cache-creation tokens",
    latest(writeTranscript("sum.jsonl", [assistantEntry(150000)])),
    150000,
    "",
  );
  check(
    "the latest main-thread turn wins",
    latest(
      writeTranscript("latest.jsonl", [
        assistantEntry(90000),
        assistantEntry(130000),
      ]),
    ),
    130000,
    "",
  );
  check(
    "a subagent turn is not the main thread",
    latest(
      writeTranscript("sidechain.jsonl", [
        assistantEntry(60000),
        assistantEntry(250000, { isSidechain: true }),
      ]),
    ),
    60000,
    "",
  );
  check(
    "a compaction after the last turn reads as 0",
    latest(
      writeTranscript("compacted.jsonl", [assistantEntry(368000), boundary]),
    ),
    0,
    "",
  );
  const filler =
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "x".repeat(300 * 1024) },
    }) + "\n";
  check(
    "finds the turn when earlier history exceeds the tail",
    latest(
      writeTranscript("long-history.jsonl", [assistantEntry(140000)], filler),
    ),
    140000,
    "",
  );
  check(
    "a transcript with no assistant turn reads as 0",
    latest(
      writeTranscript("no-turn.jsonl", [
        { type: "user", message: { role: "user", content: "hi" } },
      ]),
    ),
    0,
    "",
  );
  check(
    "a missing transcript reads as 0",
    latest(path.join(scratch, "absent.jsonl")),
    0,
    "",
  );

  const summary = transcriptTail.summarize(
    [
      assistantEntry(250000, { requestId: "a" }),
      assistantEntry(250000, { requestId: "a" }),
      assistantEntry(210000, { requestId: "b" }),
      assistantEntry(90000, { requestId: "c" }),
      boundary,
    ],
    200000,
  );
  check("summary keeps the peak", summary.peakTokens, 250000, "");
  check(
    "summary counts each request over the threshold once",
    summary.turnsOver,
    2,
    "",
  );
  check(
    "summary records the compaction trigger and size",
    summary.compactions
      .map((compaction) => `${compaction.trigger}:${compaction.preTokens}`)
      .join(","),
    "auto:368000",
    "",
  );

  const latestText = (file) => transcriptTail.latestAssistantText(file);
  check(
    "joins multiple text blocks in one reply",
    latestText(
      writeTranscript("multi-block.jsonl", [
        {
          type: "assistant",
          isSidechain: false,
          requestId: "request-multi",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "First paragraph." },
              { type: "tool_use", name: "Bash", input: {} },
              { type: "text", text: "Second paragraph." },
            ],
          },
        },
      ]),
    ),
    "First paragraph.\nSecond paragraph.",
    "",
  );
  check(
    "a reply with no text content reads as empty",
    latestText(
      writeTranscript("tool-only.jsonl", [
        {
          type: "assistant",
          isSidechain: false,
          requestId: "request-tool-only",
          message: {
            role: "assistant",
            content: [
              { type: "tool_use", name: "Bash", input: { command: "ls" } },
            ],
          },
        },
      ]),
    ),
    "",
    "",
  );
  check(
    "a trailing subagent reply is ignored in favor of the last main-thread text",
    latestText(
      writeTranscript("sidechain-text.jsonl", [
        {
          type: "assistant",
          isSidechain: false,
          requestId: "request-main",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Main thread reply." }],
          },
        },
        {
          type: "assistant",
          isSidechain: true,
          requestId: "request-side",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Subagent reply." }],
          },
        },
      ]),
    ),
    "Main thread reply.",
    "",
  );
  check(
    "an empty transcript reads as empty",
    latestText(writeTranscript("empty-text.jsonl", [])),
    "",
    "",
  );
  check(
    "a missing transcript reads as empty",
    latestText(path.join(scratch, "absent-text.jsonl")),
    "",
    "",
  );
  // Some entries carry message.content as a plain string rather than a list of
  // blocks; the reader must step past one to the last reply it can read.
  check(
    "an assistant entry whose content is not a list is skipped",
    latestText(
      writeTranscript("string-content.jsonl", [
        {
          type: "assistant",
          isSidechain: false,
          requestId: "request-blocks",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "The last readable reply." }],
          },
        },
        {
          type: "assistant",
          isSidechain: false,
          requestId: "request-string",
          message: { role: "assistant", content: "Plain string content." },
        },
      ]),
    ),
    "The last readable reply.",
    "",
  );
  check(
    "finds the reply when the tail begins mid-record",
    latestText(
      writeTranscript(
        "truncated-head.jsonl",
        [
          {
            type: "assistant",
            isSidechain: false,
            requestId: "request-truncated",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Reply after a cut fragment." }],
            },
          },
        ],
        filler,
      ),
    ),
    "Reply after a cut fragment.",
    "",
  );

  fs.rmSync(scratch, { recursive: true, force: true });
}

header("Repo setup: state file and graph findings");
{
  const repoAudit = require(path.join(HOOKS, "lib", "repo-audit.js"));
  const findingIds = (root) =>
    repoAudit.audit(root).map((finding) => finding.id);

  const bare = makeRepository("audit-bare-");
  check(
    "no state file raises state-file",
    findingIds(bare).includes("state-file"),
    true,
    findingIds(bare),
  );
  check(
    "no .gitignore line raises state-file-tracked",
    findingIds(bare).includes("state-file-tracked"),
    true,
    findingIds(bare),
  );
  check(
    "state-file, state-file-tracked and graph are the urgent findings",
    repoAudit
      .audit(bare)
      .filter((finding) => finding.urgent === true)
      .map((finding) => finding.id)
      .sort()
      .join(","),
    "graph,state-file,state-file-tracked",
    findingIds(bare),
  );

  const covered = makeRepository("audit-covered-");
  fs.mkdirSync(path.join(covered, ".claude"));
  fs.writeFileSync(
    path.join(covered, ".claude", "state.md"),
    "# Working state\n",
  );
  fs.writeFileSync(
    path.join(covered, ".gitignore"),
    "node_modules/\n/.claude/\n",
  );
  check(
    "a present state file clears state-file",
    findingIds(covered).includes("state-file"),
    false,
    findingIds(covered),
  );
  check(
    "a /.claude/ line clears state-file-tracked",
    findingIds(covered).includes("state-file-tracked"),
    false,
    findingIds(covered),
  );
  fs.writeFileSync(path.join(covered, ".gitignore"), ".claude/state.md\n");
  check(
    "the exact path clears state-file-tracked",
    findingIds(covered).includes("state-file-tracked"),
    false,
    findingIds(covered),
  );
  fs.writeFileSync(
    path.join(covered, ".gitignore"),
    ".claude/settings.local.json\n",
  );
  check(
    "an unrelated .claude line leaves state-file-tracked",
    findingIds(covered).includes("state-file-tracked"),
    true,
    findingIds(covered),
  );

  const setupHome = fs.mkdtempSync(path.join(os.tmpdir(), "repo-setup-home-"));
  const sessionStart = (root) =>
    runJson(
      path.join(HOOKS, "repo-setup.js"),
      { hook_event_name: "SessionStart", source: "startup", cwd: root },
      { CLAUDE_CONFIG_DIR: setupHome },
    );
  const firstStart = sessionStart(bare);
  const secondStart = sessionStart(bare);
  check(
    "urgent findings show a banner",
    String(firstStart.systemMessage).includes("state.md"),
    true,
    JSON.stringify(firstStart),
  );
  check(
    "the banner shows again on the next start",
    String(secondStart.systemMessage).includes("state.md"),
    true,
    JSON.stringify(secondStart),
  );
  check(
    "Claude gets the urgent findings as context",
    String((firstStart.hookSpecificOutput || {}).additionalContext).includes(
      "no .claude/state.md",
    ),
    true,
    JSON.stringify(firstStart),
  );

  repoAudit.writeState(setupHome, bare, {
    repo: bare,
    dismissed: ["graph", "state-file", "state-file-tracked"],
  });
  const afterDismissal = sessionStart(bare);
  check(
    "dismissed urgent findings raise no banner",
    afterDismissal.systemMessage,
    undefined,
    JSON.stringify(afterDismissal),
  );
  check(
    "a routine finding still reaches Claude once",
    String(
      (afterDismissal.hookSpecificOutput || {}).additionalContext,
    ).includes("no CLAUDE.md"),
    true,
    JSON.stringify(afterDismissal),
  );
  check(
    "the routine finding is not repeated inside the fortnight",
    JSON.stringify(sessionStart(bare)),
    "{}",
    "",
  );

  fs.rmSync(setupHome, { recursive: true, force: true });
  fs.rmSync(covered, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
}

header("/repo-setup context: one-step state file, ignore line and graph");
{
  const auditScript = path.join(
    __dirname,
    "..",
    "skills",
    "repo-setup",
    "audit.js",
  );
  const template = path.join(
    __dirname,
    "..",
    "skills",
    "repo-setup",
    "templates",
    "state.md",
  );
  const contextCases = [
    "context writes the state file from the template",
    "context builds the graph with graphify update <root>",
    "context never overwrites an existing state file",
    "context appends the .gitignore line exactly once",
    "the deep audit sees the ignore line through git",
    "context without graphify still exits 0",
    "context without graphify says so",
    "context ignores the archive exactly once",
    "context adds only the archive line where the state file is already ignored",
  ];
  if (process.platform === "win32") {
    for (const label of contextCases)
      skip(label, "the fake graphify is a POSIX shebang script");
  } else {
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-graphify-"));
    const fakeLog = path.join(fakeBin, "calls.jsonl");
    fs.writeFileSync(
      path.join(fakeBin, "graphify"),
      `#!${process.execPath}\nrequire("fs").appendFileSync(process.env.FAKE_GRAPHIFY_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");\n`,
      { mode: 0o755 },
    );
    const pathWithoutGraphify = String(process.env.PATH)
      .split(path.delimiter)
      .filter((directory) => !fs.existsSync(path.join(directory, "graphify")))
      .join(path.delimiter);
    const runContext = (root, withGraphify) =>
      spawnSync(process.execPath, [auditScript, "context", root], {
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          FAKE_GRAPHIFY_LOG: fakeLog,
          PATH: withGraphify
            ? fakeBin + path.delimiter + pathWithoutGraphify
            : pathWithoutGraphify,
        },
      });

    const fresh = makeRepository("context-action-");
    const firstRun = runContext(fresh, true);
    check(
      contextCases[0],
      readTextOrEmpty(path.join(fresh, ".claude", "state.md")),
      readTextOrEmpty(template),
      firstRun.stdout + firstRun.stderr,
    );
    check(
      contextCases[1],
      readTextOrEmpty(fakeLog).trim(),
      JSON.stringify(["update", fresh]),
      firstRun.stdout,
    );

    fs.writeFileSync(
      path.join(fresh, ".claude", "state.md"),
      "# Working state\n\n## Goal\n\nkeep me\n",
    );
    runContext(fresh, true);
    check(
      contextCases[2],
      readTextOrEmpty(path.join(fresh, ".claude", "state.md")).includes(
        "keep me",
      ),
      true,
      "",
    );
    check(
      contextCases[3],
      readTextOrEmpty(path.join(fresh, ".gitignore"))
        .split("\n")
        .filter((line) => line === ".claude/state.md").length,
      1,
      readTextOrEmpty(path.join(fresh, ".gitignore")),
    );
    check(
      "context ignores the archive exactly once",
      readTextOrEmpty(path.join(fresh, ".gitignore"))
        .split("\n")
        .filter((line) => line === ".claude/state.archive.md").length,
      1,
      readTextOrEmpty(path.join(fresh, ".gitignore")),
    );
    const stateOnlyRoot = makeRepository("context-state-only-");
    fs.writeFileSync(
      path.join(stateOnlyRoot, ".gitignore"),
      ".claude/state.md\n",
    );
    runContext(stateOnlyRoot, true);
    check(
      "context adds only the archive line where the state file is already ignored",
      readTextOrEmpty(path.join(stateOnlyRoot, ".gitignore")),
      ".claude/state.md\n.claude/state.archive.md\n",
      "",
    );
    fs.rmSync(stateOnlyRoot, { recursive: true, force: true });
    const deepReport = spawnSync(
      process.execPath,
      [auditScript, "--json", fresh],
      { encoding: "utf8", windowsHide: true },
    );
    let trackedStatus = "unparsed";
    try {
      trackedStatus = JSON.parse(deepReport.stdout).checks.find(
        (row) => row.id === "state-file-tracked",
      ).status;
    } catch {
      // Left as "unparsed" so the check below reports it.
    }
    check(
      contextCases[4],
      trackedStatus,
      "ok",
      deepReport.stdout.slice(0, 200),
    );

    const noGraphifyRoot = makeRepository("context-no-graphify-");
    const withoutGraphify = runContext(noGraphifyRoot, false);
    check(contextCases[5], withoutGraphify.status, 0, withoutGraphify.stderr);
    check(
      contextCases[6],
      withoutGraphify.stdout.includes("graphify is not on PATH"),
      true,
      withoutGraphify.stdout,
    );

    for (const directory of [fakeBin, fresh, noGraphifyRoot])
      fs.rmSync(directory, { recursive: true, force: true });
  }
}

header(
  "/repo-setup audit: with git unavailable, each file keeps its own approximation",
);
{
  const auditScript = path.join(
    __dirname,
    "..",
    "skills",
    "repo-setup",
    "audit.js",
  );
  // An absolute node and a PATH with no git on it: every git call fails, which
  // is the only way to reach the filesystem approximations.
  const withoutGit = (args) =>
    spawnSync(process.execPath, [auditScript, ...args], {
      encoding: "utf8",
      windowsHide: true,
      env: { HOME: os.homedir(), PATH: path.join(os.tmpdir(), "no-git-here") },
    });

  // `*.md` is a pattern only the instruction file's approximation reads, so
  // this fails if the state file's narrower one is ever used in its place.
  const patternRoot = makeRepository("no-git-instructions-");
  fs.writeFileSync(path.join(patternRoot, ".gitignore"), "*.md\n");
  fs.writeFileSync(path.join(patternRoot, "CLAUDE.md"), "x\n");
  const patternReport = withoutGit(["--json", patternRoot]);
  let instructionRow = "unparsed";
  try {
    instructionRow = JSON.parse(patternReport.stdout).checks[0].id;
  } catch {
    // Left as "unparsed" so the check below reports it.
  }
  check(
    "without git, a CLAUDE.md a wildcard ignores is still flagged",
    instructionRow,
    "instructions-ignored",
    patternReport.stdout.slice(0, 200) + patternReport.stderr,
  );

  const listedRoot = makeRepository("no-git-archive-");
  fs.writeFileSync(path.join(listedRoot, ".gitignore"), ".claude/state.md\n");
  withoutGit(["context", listedRoot]);
  check(
    "without git, context reads the ignore file and adds only the archive line",
    readTextOrEmpty(path.join(listedRoot, ".gitignore")),
    ".claude/state.md\n.claude/state.archive.md\n",
    "",
  );

  for (const directory of [patternRoot, listedRoot])
    fs.rmSync(directory, { recursive: true, force: true });
}

header("/repo-setup audit: a ! exception in .gitignore is not an ignore");
{
  const auditScript = path.join(
    __dirname,
    "..",
    "skills",
    "repo-setup",
    "audit.js",
  );
  const auditRow = (gitignore, id) => {
    const root = makeRepository("audit-exception-");
    fs.writeFileSync(path.join(root, ".gitignore"), gitignore);
    fs.writeFileSync(path.join(root, "CLAUDE.md"), "# CLAUDE.md\n");
    fs.mkdirSync(path.join(root, ".claude"));
    fs.writeFileSync(path.join(root, ".claude", "state.md"), "# state\n");
    const report = spawnSync(process.execPath, [auditScript, "--json", root], {
      encoding: "utf8",
      windowsHide: true,
    });
    fs.rmSync(root, { recursive: true, force: true });
    try {
      const row = JSON.parse(report.stdout).checks.find((candidate) =>
        candidate.id.startsWith(id),
      );
      return `${row.id}:${row.status}`;
    } catch {
      return "unparsed: " + report.stdout.slice(0, 120) + report.stderr;
    }
  };

  check(
    "an excepted CLAUDE.md counts as tracked",
    auditRow("*.md\n!CLAUDE.md\n", "instructions"),
    "instructions:ok",
    "",
  );
  check(
    "an ignored CLAUDE.md is still flagged",
    auditRow("*.md\n", "instructions"),
    "instructions-ignored:broken",
    "",
  );
  check(
    "an excepted state file counts as tracked",
    auditRow(".claude/*\n!.claude/state.md\n", "state-file-tracked"),
    "state-file-tracked:broken",
    "",
  );
  check(
    "an ignored state file counts as ignored",
    auditRow(".claude/state.md\n", "state-file-tracked"),
    "state-file-tracked:ok",
    "",
  );
}

header(
  "SessionStart: state-restore loads .claude/state.md by how the session started",
);
{
  const restoreHook = path.join(HOOKS, "state-restore.js");
  const carryover = require(
    path.join(__dirname, "..", "probes", "state-carryover.js"),
  );
  const template = path.join(
    __dirname,
    "..",
    "skills",
    "repo-setup",
    "templates",
    "state.md",
  );
  const restoreRoot = makeRepository("state-restore-");
  const restoreHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "state-restore-home-"),
  );
  fs.mkdirSync(path.join(restoreRoot, ".claude"));
  const statePath = path.join(restoreRoot, ".claude", "state.md");
  fs.writeFileSync(statePath, carryover.STATE_FILE);
  const start = (source, cwd = restoreRoot) =>
    runJson(
      restoreHook,
      { hook_event_name: "SessionStart", source, session_id: "restore-1", cwd },
      { CLAUDE_CONFIG_DIR: restoreHome },
    );
  const contextOf = (reply) =>
    String((reply.hookSpecificOutput || {}).additionalContext || "");

  const cleared = start("clear");
  check(
    "clear loads the file",
    contextOf(cleared).includes("worker_threads pool for row formatting"),
    true,
    contextOf(cleared).slice(0, 200),
  );
  check(
    "clear opens with the preamble the probe measured",
    contextOf(cleared).startsWith(carryover.CLEAR_PREAMBLE),
    true,
    contextOf(cleared).slice(0, 200),
  );
  check(
    "clear shows no banner",
    cleared.systemMessage,
    undefined,
    JSON.stringify(cleared).slice(0, 200),
  );

  const halfHourAgo = new Date(Date.now() - 30 * 60000);
  fs.utimesSync(statePath, halfHourAgo, halfHourAgo);
  const compacted = contextOf(start("compact"));
  check(
    "compact says the file wins over the summary",
    compacted.includes("the file wins"),
    true,
    compacted.slice(0, 300),
  );
  check(
    "compact says how stale the file was",
    compacted.includes("30 minutes before the compaction"),
    true,
    compacted.slice(0, 300),
  );

  const started = start("startup");
  const banner = String(started.systemMessage);
  check(
    "startup banner names the goal",
    banner.startsWith("Resuming: Streaming CSV export for ledger-export"),
    true,
    banner,
  );
  check(
    "startup banner names the next step",
    banner.includes("Next: backpressure in writeExport"),
    true,
    banner,
  );
  check(
    "startup banner gives the age",
    banner.includes("(updated 30 minutes ago)"),
    true,
    banner,
  );
  check(
    "startup asks Claude to confirm before continuing",
    contextOf(started).includes("confirm with the user"),
    true,
    contextOf(started).slice(0, 300),
  );

  check("resume loads nothing", JSON.stringify(start("resume")), "{}", "");
  check("fork loads nothing", JSON.stringify(start("fork")), "{}", "");
  check(
    "a subdirectory of the repository finds the file",
    contextOf(start("clear", path.join(restoreRoot, ".claude"))).includes(
      "worker_threads",
    ),
    true,
    "",
  );

  fs.writeFileSync(statePath, "START_MARKER" + "x".repeat(8990) + "END_MARKER");
  const oversized = contextOf(start("clear"));
  check(
    "an oversized file is capped at 8,000 characters",
    oversized.includes("START_MARKER") && !oversized.includes("END_MARKER"),
    true,
    oversized.length,
  );
  check(
    "the cap leaves a visible note",
    oversized.includes("over the 8,000 that load"),
    true,
    oversized.slice(-200),
  );

  // A file past the cap is cut by section, most needed first, so a long
  // history cannot push the goal's neighbours and the hot files out of view.
  fs.writeFileSync(
    statePath,
    [
      "# Working state",
      "## Goal",
      "GOAL_MARKER",
      "## Decisions",
      "DECISIONS_MARKER " + "d".repeat(3000),
      "## Progress",
      "- Next: NEXT_MARKER",
      "- " + "p".repeat(12000) + " PROGRESS_TAIL_MARKER",
      "## Hot files",
      "HOT_FILES_MARKER",
    ].join("\n\n"),
  );
  const bySection = contextOf(start("clear"));
  check(
    "an oversized file still loads the hot files after a long progress log",
    bySection.includes("GOAL_MARKER") && bySection.includes("HOT_FILES_MARKER"),
    true,
    bySection.slice(0, 300),
  );
  check(
    "room a cut section leaves unused goes to the sections ranked after it",
    bySection.includes("DECISIONS_MARKER"),
    true,
    bySection.slice(-600),
  );
  check(
    "a section cut to fit keeps its newest lines, at the top",
    bySection.includes("NEXT_MARKER") &&
      !bySection.includes("PROGRESS_TAIL_MARKER"),
    true,
    bySection.slice(-600),
  );
  check(
    "the cut names what was left out and where finished work goes",
    bySection.includes("Progress") &&
      bySection.includes(".claude/state.archive.md"),
    true,
    bySection.slice(-600),
  );

  fs.copyFileSync(template, statePath);
  check(
    "an untouched template loads nothing on startup",
    JSON.stringify(start("startup")),
    "{}",
    "",
  );

  const templated = contextOf(start("clear"));
  check(
    "a clear onto an untouched template says the template is untouched",
    templated.includes("still the untouched template"),
    true,
    templated.slice(0, 300),
  );
  check(
    "a clear onto an untouched template names the file it read",
    templated.includes(statePath),
    true,
    templated.slice(0, 300),
  );

  fs.rmSync(statePath);
  const missing = contextOf(start("clear"));
  check(
    "a clear with no record says nothing was carried across",
    missing.includes("Nothing was carried across"),
    true,
    missing.slice(0, 300),
  );
  check(
    "a clear with no record names the file that would hold one",
    missing.includes(statePath),
    true,
    missing.slice(0, 300),
  );
  check(
    "a clear with no record says how to create one",
    missing.includes("/repo-setup context"),
    true,
    missing.slice(0, 300),
  );
  check(
    "a clear with no record forbids guessing at earlier work",
    missing.includes("do not guess"),
    true,
    missing.slice(0, 300),
  );
  check(
    "a compaction with no record says so too",
    contextOf(start("compact")).includes("Nothing was carried across"),
    true,
    "",
  );
  check(
    "startup with no record stays silent",
    JSON.stringify(start("startup")),
    "{}",
    "",
  );
  check(
    "a missing record shows no banner",
    start("clear").systemMessage,
    undefined,
    JSON.stringify(start("clear")).slice(0, 200),
  );

  const outsideRepository = fs.mkdtempSync(
    path.join(os.tmpdir(), "state-restore-bare-"),
  );
  const bare = contextOf(start("clear", outsideRepository));
  check(
    "a clear outside any repository says there is nowhere to keep a record",
    bare.includes("not inside a git repository"),
    true,
    bare.slice(0, 300),
  );
  check(
    "a clear outside any repository names the directory it looked in",
    bare.includes(outsideRepository),
    true,
    bare.slice(0, 300),
  );
  check(
    "resume outside any repository still loads nothing",
    JSON.stringify(start("resume", outsideRepository)),
    "{}",
    "",
  );
  check(
    "with no configuration record there is nowhere to point",
    bare.includes("restart there"),
    false,
    bare.slice(0, 400),
  );

  fs.mkdirSync(path.join(restoreHome, ".claude"), { recursive: true });
  const configRecord = path.join(restoreHome, ".claude", "state.md");
  fs.writeFileSync(configRecord, carryover.STATE_FILE);
  const pointed = contextOf(start("clear", outsideRepository));
  check(
    "a clear outside any repository names the configuration record that does exist",
    pointed.includes(restoreHome),
    true,
    pointed.slice(0, 400),
  );
  check(
    "the pointer says to restart there rather than loading the record",
    pointed.includes("restart there"),
    true,
    pointed.slice(0, 400),
  );
  check(
    "the pointer carries none of the record's contents",
    pointed.includes("worker_threads pool for row formatting"),
    false,
    pointed.slice(0, 400),
  );
  check(
    "the pointer still says nothing was carried across",
    pointed.includes("Nothing was carried across"),
    true,
    pointed.slice(0, 400),
  );

  check(
    "a session already in the configuration directory is not told to restart there",
    contextOf(start("clear", restoreHome)).includes("restart there"),
    false,
    contextOf(start("clear", restoreHome)).slice(0, 400),
  );

  // The pointer answers "you are nowhere" and not "you are somewhere without a
  // record". A repository that simply keeps none is a different problem, and the
  // configuration directory's record is not its answer.
  const otherRepository = makeRepository("state-restore-other-");
  check(
    "a repository keeping no record is not pointed at the configuration one",
    contextOf(start("clear", otherRepository)).includes("restart there"),
    false,
    contextOf(start("clear", otherRepository)).slice(0, 400),
  );
  fs.rmSync(otherRepository, { recursive: true, force: true });

  fs.writeFileSync(configRecord, fs.readFileSync(template, "utf8"));
  check(
    "an untouched configuration template is not offered as a record",
    contextOf(start("clear", outsideRepository)).includes("restart there"),
    false,
    contextOf(start("clear", outsideRepository)).slice(0, 400),
  );

  fs.rmSync(configRecord);
  fs.rmSync(outsideRepository, { recursive: true, force: true });
  fs.rmSync(restoreRoot, { recursive: true, force: true });
  fs.rmSync(restoreHome, { recursive: true, force: true });
}

header("UserPromptSubmit: context-gauge zones and staleness");
{
  const gaugeHook = path.join(HOOKS, "context-gauge.js");
  const carryover = require(
    path.join(__dirname, "..", "probes", "state-carryover.js"),
  );
  const gaugeRoot = makeRepository("context-gauge-");
  const emptyRoot = makeRepository("context-gauge-empty-");
  const gaugeHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "context-gauge-home-"),
  );
  fs.mkdirSync(path.join(gaugeRoot, ".claude"));
  const statePath = path.join(gaugeRoot, ".claude", "state.md");
  fs.writeFileSync(statePath, carryover.STATE_FILE);

  let transcriptCount = 0;
  const transcriptAt = (tokens) => {
    transcriptCount += 1;
    const file = path.join(gaugeHome, `transcript-${transcriptCount}.jsonl`);
    fs.writeFileSync(
      file,
      JSON.stringify({
        type: "assistant",
        isSidechain: false,
        requestId: `request-${transcriptCount}`,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          usage: {
            input_tokens: 2,
            cache_read_input_tokens: tokens - 2,
            cache_creation_input_tokens: 0,
          },
        },
      }) + "\n",
    );
    return file;
  };
  const prompt = (sessionIdentifier, tokens, cwd = gaugeRoot) =>
    run(
      gaugeHook,
      {
        hook_event_name: "UserPromptSubmit",
        session_id: sessionIdentifier,
        transcript_path: transcriptAt(tokens),
        cwd,
        prompt: "next",
      },
      { CLAUDE_CONFIG_DIR: gaugeHome },
    );

  check(
    "green zone at 50K is silent",
    prompt("zone-green", 50000).verdict,
    "allow",
    "",
  );
  const amber = prompt("zone-amber", 150000);
  check("amber zone at 150K warns", amber.verdict, "warn", amber.reason);
  check(
    "the amber line gives the size and zone",
    String(amber.reason).includes("150K tokens (amber zone"),
    true,
    amber.reason,
  );
  check(
    "the amber line asks for the clear suggestion at a stopping point",
    String(amber.reason).includes("good point to clear"),
    true,
    amber.reason,
  );
  check(
    "the amber line names the directory the clear must run from",
    String(amber.reason).includes(gaugeRoot),
    true,
    amber.reason,
  );
  const red = prompt("zone-red", 250000);
  check(
    "red zone at 250K says compaction is near",
    String(red.reason).includes("red zone, automatic compaction is near"),
    true,
    red.reason,
  );

  const staleReplies = Array.from({ length: 9 }, () =>
    prompt("stale-1", 50000),
  );
  check(
    "no staleness line after 7 unchanged turns",
    staleReplies[7].verdict,
    "allow",
    staleReplies[7].reason,
  );
  check(
    "the staleness line comes after 8 unchanged turns",
    String(staleReplies[8].reason).includes("has not changed in 8 turns"),
    true,
    staleReplies[8].reason,
  );
  fs.appendFileSync(statePath, "\n- Recorded mid-test.\n");
  check(
    "editing the file resets the count",
    prompt("stale-1", 50000).verdict,
    "allow",
    "",
  );
  fs.writeFileSync(statePath, carryover.STATE_FILE);

  check(
    "silent with no state file, even at 150K",
    prompt("no-state", 150000, emptyRoot).verdict,
    "allow",
    "",
  );

  const stateFile = require(path.join(HOOKS, "lib", "state-file.js"));
  const zones = require(path.join(HOOKS, "lib", "context-zones.js"));
  check(
    "the gauge records the digest the gate compares",
    (zones.readGaugeState(gaugeHome, "zone-amber") || {}).stateDigest,
    stateFile.stateDigest(carryover.STATE_FILE),
    "",
  );
  const withCapture = carryover.STATE_FILE.replace(
    "## Unconfirmed\n",
    "## Unconfirmed\n\n- From now on use pnpm\n",
  );
  check(
    "the digest ignores what sits under Unconfirmed",
    stateFile.stateDigest(withCapture),
    stateFile.stateDigest(carryover.STATE_FILE),
    "",
  );
  check(
    "the digest sees a change anywhere else",
    stateFile.stateDigest(
      carryover.STATE_FILE.replace(
        "- In progress: nothing.",
        "- In progress: the writer.",
      ),
    ) === stateFile.stateDigest(carryover.STATE_FILE),
    false,
    "",
  );

  for (const directory of [gaugeRoot, emptyRoot, gaugeHome])
    fs.rmSync(directory, { recursive: true, force: true });
}

header(
  "Stop: clear-gate holds a clear suggestion until the state file changes",
);
{
  const gaugeHook = path.join(HOOKS, "context-gauge.js");
  const gateHook = path.join(HOOKS, "clear-gate.js");
  const carryover = require(
    path.join(__dirname, "..", "probes", "state-carryover.js"),
  );
  const zones = require(path.join(HOOKS, "lib", "context-zones.js"));
  const gateRoot = makeRepository("clear-gate-");
  const noStateRoot = makeRepository("clear-gate-empty-");
  const gateHome = fs.mkdtempSync(path.join(os.tmpdir(), "clear-gate-home-"));
  const environment = { CLAUDE_CONFIG_DIR: gateHome };
  fs.mkdirSync(path.join(gateRoot, ".claude"));
  const statePath = path.join(gateRoot, ".claude", "state.md");
  fs.writeFileSync(statePath, carryover.STATE_FILE);
  const suggestion = "Tests pass. good point to clear: `/clear`, then `go`";

  let transcriptCount = 0;
  const transcriptAt = (tokens, text = "ok") => {
    transcriptCount += 1;
    const file = path.join(gateHome, `transcript-${transcriptCount}.jsonl`);
    fs.writeFileSync(
      file,
      JSON.stringify({
        type: "assistant",
        isSidechain: false,
        requestId: `request-${transcriptCount}`,
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
          usage: {
            input_tokens: 2,
            cache_read_input_tokens: tokens - 2,
            cache_creation_input_tokens: 0,
          },
        },
      }) + "\n",
    );
    return file;
  };
  const startTurn = (sessionIdentifier, tokens) =>
    run(
      gaugeHook,
      {
        hook_event_name: "UserPromptSubmit",
        session_id: sessionIdentifier,
        transcript_path: transcriptAt(tokens),
        cwd: gateRoot,
        prompt: "next",
      },
      environment,
    );
  const stop = (sessionIdentifier, tokens, overrides = {}) =>
    run(
      gateHook,
      {
        hook_event_name: "Stop",
        session_id: sessionIdentifier,
        transcript_path: transcriptAt(tokens),
        cwd: gateRoot,
        stop_hook_active: false,
        last_assistant_message: suggestion,
        ...overrides,
      },
      environment,
    );

  startTurn("gate-unchanged", 150000);
  const held = stop("gate-unchanged", 150000);
  check(
    "holds a clear suggestion when the file did not change this turn",
    held.verdict,
    "BLOCK",
    held.reason,
  );
  check(
    "the hold says what to do",
    String(held.reason).includes(
      "update .claude/state.md before suggesting a clear",
    ),
    true,
    held.reason,
  );
  check(
    "never blocks twice in a row",
    stop("gate-unchanged", 150000, { stop_hook_active: true }).verdict,
    "allow",
    "",
  );

  // context-gauge.js writes the suggestion and this gate recognises it, and
  // nothing else holds those two wordings together. Take the gauge's own line
  // rather than a copy of it, so that changing either side without the other
  // fails here instead of silently retiring the gate.
  const gaugeLine = String(startTurn("gate-gauge-wording", 150000).reason);
  const quotedSuggestion = (gaugeLine.match(/"(good point to clear[^"]*)"/) ||
    [])[1];
  check(
    "the amber line carries a suggestion the gate can be given",
    typeof quotedSuggestion === "string" && quotedSuggestion.length > 0,
    true,
    gaugeLine,
  );
  const heldOnGaugeWording = stop("gate-gauge-wording", 150000, {
    last_assistant_message: quotedSuggestion,
  });
  check(
    "the gate holds the exact suggestion the gauge asks for",
    heldOnGaugeWording.verdict,
    "BLOCK",
    heldOnGaugeWording.reason,
  );

  // The harness is expected to set stop_hook_active on the retry, but the gauge's
  // own per-turn record is the second, independent guard: a Stop that omits the
  // flag entirely must still not hold twice for the same turn.
  startTurn("gate-loop-guard", 150000);
  const loopGuardPayload = () => ({
    hook_event_name: "Stop",
    session_id: "gate-loop-guard",
    transcript_path: transcriptAt(150000),
    cwd: gateRoot,
    last_assistant_message: suggestion,
  });
  const firstLoopGuardStop = run(gateHook, loopGuardPayload(), environment);
  check(
    "holds on the first stop of a turn",
    firstLoopGuardStop.verdict,
    "BLOCK",
    firstLoopGuardStop.reason,
  );
  const secondLoopGuardStop = run(gateHook, loopGuardPayload(), environment);
  check(
    "a second stop in the same turn is allowed even without stop_hook_active",
    secondLoopGuardStop.verdict,
    "allow",
    secondLoopGuardStop.reason,
  );

  startTurn("gate-updated", 150000);
  fs.appendFileSync(statePath, "\n- Recorded before the clear.\n");
  check(
    "lets it through when the file changed this turn",
    stop("gate-updated", 150000).verdict,
    "allow",
    "",
  );

  // Updated is not enough when the file has outgrown what a clear loads: the
  // session after the clear would get only part of it.
  const underCapState = fs.readFileSync(statePath, "utf8");
  startTurn("gate-oversized", 150000);
  fs.appendFileSync(statePath, "\n- " + "x".repeat(9000) + "\n");
  const heldOversized = stop("gate-oversized", 150000);
  check(
    "holds a clear suggestion when the updated file is over the load cap",
    heldOversized.verdict,
    "BLOCK",
    heldOversized.reason,
  );
  check(
    "the oversize hold says where finished entries go",
    String(heldOversized.reason).includes(".claude/state.archive.md"),
    true,
    heldOversized.reason,
  );
  check(
    "the oversize hold holds only once a turn",
    stop("gate-oversized", 150000).verdict,
    "allow",
    "",
  );
  startTurn("gate-oversized-unchanged", 150000);
  const heldBoth = String(stop("gate-oversized-unchanged", 150000).reason);
  check(
    "one hold asks for both the update and the trim",
    heldBoth.includes("update .claude/state.md") &&
      heldBoth.includes(".claude/state.archive.md"),
    true,
    heldBoth,
  );
  fs.writeFileSync(statePath, underCapState);

  startTurn("gate-green", 50000);
  check(
    "ignores a suggestion in the green zone",
    stop("gate-green", 50000).verdict,
    "allow",
    "",
  );

  startTurn("gate-plain-reply", 150000);
  check(
    "ignores a reply that suggests no clear",
    stop("gate-plain-reply", 150000, { last_assistant_message: "Tests pass." })
      .verdict,
    "allow",
    "",
  );

  startTurn("gate-fallback", 150000);
  const fromTranscript = run(
    gateHook,
    {
      hook_event_name: "Stop",
      session_id: "gate-fallback",
      transcript_path: transcriptAt(150000, suggestion),
      cwd: gateRoot,
    },
    environment,
  );
  check(
    "reads the suggestion from the transcript when the payload lacks it",
    fromTranscript.verdict,
    "BLOCK",
    fromTranscript.reason,
  );

  // \b alone matched "/clear" inside an ordinary path (hooks/clear-gate.js),
  // because the boundary it checks sits after "clear", not before the slash.
  startTurn("gate-path-mention-1", 150000);
  check(
    "a file path containing /clear is not a suggestion",
    stop("gate-path-mention-1", 150000, {
      last_assistant_message:
        "I finished hooks/clear-gate.js and the tests pass.",
    }).verdict,
    "allow",
    "",
  );
  startTurn("gate-path-mention-2", 150000);
  check(
    "a doc path containing /clear is not a suggestion",
    stop("gate-path-mention-2", 150000, {
      last_assistant_message: "See docs/clear-gate.md for details.",
    }).verdict,
    "allow",
    "",
  );

  // The earlier two cases are caught by what precedes the slash. These are not:
  // /clear-gate and /clear/x begin exactly the way a bare command does, so only
  // what follows the command separates them. The hook's own name leads because
  // the session most likely to write it is the one editing this file.
  startTurn("gate-hook-name", 150000);
  check(
    "the hook's own command spelling is not a suggestion",
    stop("gate-hook-name", 150000, {
      last_assistant_message: "The /clear-gate hook now holds the stop.",
    }).verdict,
    "allow",
    "",
  );
  startTurn("gate-hook-doc", 150000);
  check(
    "a doc path starting with a slash is not a suggestion",
    stop("gate-hook-doc", 150000, {
      last_assistant_message: "See /clear-gate.md for details.",
    }).verdict,
    "allow",
    "",
  );
  startTurn("gate-rooted-path", 150000);
  check(
    "a directory path starting with slash-clear is not a suggestion",
    stop("gate-rooted-path", 150000, {
      last_assistant_message: "Read /clear/notes.md before continuing.",
    }).verdict,
    "allow",
    "",
  );

  // The counterweight to those three: a full stop straight after the command is
  // sentence punctuation, not a file extension, and must still fire.
  startTurn("gate-sentence-final", 150000);
  check(
    "a suggestion ending the sentence still fires",
    stop("gate-sentence-final", 150000, {
      last_assistant_message: "Record the state, then run /clear.",
    }).verdict,
    "BLOCK",
    "",
  );

  startTurn("gate-real-suggestion-1", 150000);
  check(
    "the gauge's own suggested wording still fires",
    stop("gate-real-suggestion-1", 150000, {
      last_assistant_message: suggestion,
    }).verdict,
    "BLOCK",
    "",
  );
  startTurn("gate-real-suggestion-2", 150000);
  check(
    "a bare slash-command suggestion still fires",
    stop("gate-real-suggestion-2", 150000, {
      last_assistant_message: "Run /clear now.",
    }).verdict,
    "BLOCK",
    "",
  );

  // Emphasis marks around the command are not path characters, so a suggestion
  // wearing them is a real suggestion.
  startTurn("gate-emphasised", 150000);
  check(
    "an emphasised /clear is still a suggestion",
    stop("gate-emphasised", 150000, {
      last_assistant_message: "Consider _/clear_ to reset.",
    }).verdict,
    "BLOCK",
    "",
  );

  // Observed live 2026-09-16: a reply quoting a commit message that mentioned
  // /clear was held as a suggestion. Quoted text sits in a fence or a
  // blockquote, and the gauge's own suggestion never does.
  startTurn("gate-fenced-quote", 150000);
  check(
    "a /clear inside a fenced block is a quotation, not a suggestion",
    stop("gate-fenced-quote", 150000, {
      last_assistant_message:
        "Suggested message:\n\n```\nMake the gate hold a /clear suggestion\n```\n",
    }).verdict,
    "allow",
    "",
  );
  startTurn("gate-blockquote", 150000);
  check(
    "a /clear inside a blockquote is a quotation, not a suggestion",
    stop("gate-blockquote", 150000, {
      last_assistant_message:
        "You wrote:\n> then run /clear and go\nDone as asked.",
    }).verdict,
    "allow",
    "",
  );
  startTurn("gate-after-fence", 150000);
  check(
    "a suggestion after a fenced block still fires",
    stop("gate-after-fence", 150000, {
      last_assistant_message:
        "```\nnode tools/ccfg.js test\n```\n" + suggestion,
    }).verdict,
    "BLOCK",
    "",
  );

  // A config directory that is really a file: mkdirSync under it fails with
  // ENOTDIR, which is the cheapest way to make the write fail on every platform.
  const notADirectory = path.join(gateHome, "not-a-directory");
  fs.writeFileSync(notADirectory, "");
  check(
    "writeGaugeState reports a write that could not land",
    zones.writeGaugeState(notADirectory, "blocked-session", { turn: 1 }),
    false,
    "",
  );
  check(
    "writeGaugeState reports a write that landed",
    zones.writeGaugeState(gateHome, "write-probe", { turn: 1 }),
    true,
    "",
  );

  // The hold is only safe to make once the held-turn marker is on disk: without
  // it the gate has no memory of holding and would hold again on the next stop.
  const degradeCase = "an unrecordable hold degrades to letting it through";
  if (process.platform === "win32") {
    skip(degradeCase, "chmod does not make a file unwritable on Windows");
  } else if (process.getuid && process.getuid() === 0) {
    skip(degradeCase, "root ignores the read-only bit");
  } else {
    startTurn("gate-unrecordable", 150000);
    const recordPath = path.join(
      gateHome,
      "cache",
      "context-gauge",
      "gate-unrecordable.json",
    );
    fs.chmodSync(recordPath, 0o444);
    const degraded = stop("gate-unrecordable", 150000);
    fs.chmodSync(recordPath, 0o644);
    check(degradeCase, degraded.verdict, "allow", degraded.reason);
  }

  check(
    "lets it through where there is no state file",
    stop("gate-unchanged", 150000, { cwd: noStateRoot }).verdict,
    "allow",
    "",
  );
  check(
    "lets it through when the gauge never saw the turn start",
    stop("gate-never-started", 150000).verdict,
    "allow",
    "",
  );

  for (const directory of [gateRoot, noStateRoot, gateHome])
    fs.rmSync(directory, { recursive: true, force: true });
}

header("SessionStart: graph-refresh rebuilds a stale graph in the background");
{
  const refreshHook = path.join(HOOKS, "graph-refresh.js");
  const refreshCases = [
    "a stale graph starts graphify update <root>",
    "the rebuild writes one log per repository",
    "a current graph starts nothing",
    "a missing graph starts nothing",
    "without graphify on PATH the hook stays silent",
    "without graphify on PATH no log is written",
    "the clear gate lets an updated suggestion through",
    "the clear gate starts a refresh when it does",
  ];
  if (process.platform === "win32") {
    for (const label of refreshCases)
      skip(label, "the fake graphify is a POSIX shebang script");
  } else {
    const fakeBin = fs.mkdtempSync(
      path.join(os.tmpdir(), "refresh-fake-graphify-"),
    );
    const fakeLog = path.join(fakeBin, "calls.jsonl");
    fs.writeFileSync(
      path.join(fakeBin, "graphify"),
      `#!${process.execPath}\nrequire("fs").appendFileSync(process.env.FAKE_GRAPHIFY_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");\n`,
      { mode: 0o755 },
    );
    const refreshHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "graph-refresh-home-"),
    );
    const pathWithoutGraphify = String(process.env.PATH)
      .split(path.delimiter)
      .filter((directory) => !fs.existsSync(path.join(directory, "graphify")))
      .join(path.delimiter);
    const environmentFor = (withGraphify) => ({
      ...process.env,
      CLAUDE_CONFIG_DIR: refreshHome,
      CLAUDE_GRAPH_REFRESH_FOREGROUND: "1",
      FAKE_GRAPHIFY_LOG: fakeLog,
      PATH: withGraphify
        ? fakeBin + path.delimiter + pathWithoutGraphify
        : pathWithoutGraphify,
    });
    const recordedCalls = () =>
      readTextOrEmpty(fakeLog).split("\n").filter(Boolean);
    const committedRepository = (prefix) => {
      const root = makeRepository(prefix);
      git(
        [
          "-c",
          "user.email=t@t.t",
          "-c",
          "user.name=T",
          "commit",
          "--allow-empty",
          "-q",
          "-m",
          "init",
        ],
        root,
      );
      return root;
    };
    const writeGraph = (root, offsetMs) => {
      const graph = path.join(root, "graphify-out", "graph.json");
      fs.mkdirSync(path.dirname(graph), { recursive: true });
      fs.writeFileSync(graph, "{}");
      const when = new Date(Date.now() + offsetMs);
      fs.utimesSync(graph, when, when);
    };
    const startSession = (root, withGraphify) =>
      spawnSync(process.execPath, [refreshHook], {
        input: JSON.stringify({
          hook_event_name: "SessionStart",
          source: "startup",
          cwd: root,
        }),
        encoding: "utf8",
        env: environmentFor(withGraphify),
        windowsHide: true,
      });
    const logExists = (root) => {
      const digest = require("crypto")
        .createHash("sha1")
        .update(root)
        .digest("hex")
        .slice(0, 12);
      return fs.existsSync(
        path.join(
          refreshHome,
          "cache",
          "graph-refresh",
          `${path.basename(root)}-${digest}.log`,
        ),
      );
    };

    const stale = committedRepository("refresh-stale-");
    writeGraph(stale, -3600000);
    startSession(stale, true);
    check(
      refreshCases[0],
      recordedCalls().join("|"),
      JSON.stringify(["update", stale]),
      recordedCalls(),
    );
    check(refreshCases[1], logExists(stale), true, "");

    fs.rmSync(fakeLog, { force: true });
    const current = committedRepository("refresh-current-");
    writeGraph(current, 3600000);
    startSession(current, true);
    check(refreshCases[2], recordedCalls().length, 0, recordedCalls());
    const missing = committedRepository("refresh-missing-");
    startSession(missing, true);
    check(refreshCases[3], recordedCalls().length, 0, recordedCalls());

    const noGraphify = committedRepository("refresh-no-graphify-");
    writeGraph(noGraphify, -3600000);
    const silent = startSession(noGraphify, false);
    check(refreshCases[4], silent.stdout.trim(), "", silent.stdout);
    check(refreshCases[5], logExists(noGraphify), false, "");

    // The gate refreshes whenever a graph exists: this session's edits are
    // uncommitted, so HEAD's log has not moved and a staleness test would skip.
    const carryover = require(
      path.join(__dirname, "..", "probes", "state-carryover.js"),
    );
    const gateRoot = committedRepository("refresh-gate-");
    writeGraph(gateRoot, 3600000);
    fs.mkdirSync(path.join(gateRoot, ".claude"));
    fs.writeFileSync(
      path.join(gateRoot, ".claude", "state.md"),
      carryover.STATE_FILE,
    );
    const transcript = path.join(refreshHome, "gate-transcript.jsonl");
    fs.writeFileSync(
      transcript,
      JSON.stringify({
        type: "assistant",
        isSidechain: false,
        requestId: "request-gate",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          usage: {
            input_tokens: 2,
            cache_read_input_tokens: 149998,
            cache_creation_input_tokens: 0,
          },
        },
      }) + "\n",
    );
    const hookPayload = (extra) =>
      JSON.stringify({
        session_id: "refresh-gate-1",
        transcript_path: transcript,
        cwd: gateRoot,
        ...extra,
      });
    spawnSync(process.execPath, [path.join(HOOKS, "context-gauge.js")], {
      input: hookPayload({ prompt: "next" }),
      encoding: "utf8",
      env: environmentFor(true),
    });
    fs.appendFileSync(
      path.join(gateRoot, ".claude", "state.md"),
      "\n- Recorded before the clear.\n",
    );
    const gateReply = spawnSync(
      process.execPath,
      [path.join(HOOKS, "clear-gate.js")],
      {
        input: hookPayload({
          stop_hook_active: false,
          last_assistant_message: "good point to clear: `/clear`, then `go`",
        }),
        encoding: "utf8",
        env: environmentFor(true),
      },
    );
    check(refreshCases[6], gateReply.stdout.trim(), "", gateReply.stdout);
    check(
      refreshCases[7],
      recordedCalls().join("|"),
      JSON.stringify(["update", gateRoot]),
      recordedCalls(),
    );

    for (const directory of [
      fakeBin,
      refreshHome,
      stale,
      current,
      missing,
      noGraphify,
      gateRoot,
    ])
      fs.rmSync(directory, { recursive: true, force: true });
  }

  const worktreeRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "refresh-worktree-"),
  );
  const worktreeGitDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "refresh-worktree-gitdir-"),
  );
  fs.writeFileSync(
    path.join(worktreeRoot, ".git"),
    `gitdir: ${worktreeGitDirectory}\n`,
  );
  const graphRefresh = require(path.join(HOOKS, "lib", "graph-refresh.js"));
  check(
    "a worktree's .git file is followed to its HEAD log",
    graphRefresh.headLogPath(worktreeRoot),
    path.join(worktreeGitDirectory, "logs", "HEAD"),
    "",
  );
  fs.rmSync(worktreeRoot, { recursive: true, force: true });
  fs.rmSync(worktreeGitDirectory, { recursive: true, force: true });
}

header("context-report counts the operator's work, not the probe harness");
{
  const tail = require(path.join(HOOKS, "lib", "transcript-tail.js"));

  const entriesWithCwd = tail.parseLines(
    [
      JSON.stringify({ type: "summary", summary: "no cwd on this one" }),
      JSON.stringify({ type: "user", cwd: "/Users/someone/project" }),
      JSON.stringify({ type: "user", cwd: "/elsewhere" }),
    ].join("\n"),
  );
  check(
    "sessionCwd takes the first working directory a transcript records",
    tail.sessionCwd(entriesWithCwd),
    "/Users/someone/project",
    "",
  );
  check(
    "sessionCwd is null when no entry records one",
    tail.sessionCwd(tail.parseLines(JSON.stringify({ type: "summary" }))),
    null,
    "",
  );

  const under = (child, parent) => tail.isUnderDirectory(child, parent);
  check(
    "a subdirectory counts as under the directory",
    under("/Users/someone/project", "/Users/someone"),
    true,
    "",
  );
  check(
    "the directory itself counts as under it",
    under("/Users/someone", "/Users/someone"),
    true,
    "",
  );
  check(
    "a sibling sharing the opening characters does not count",
    under("/Users/someone-else/project", "/Users/someone"),
    false,
    "",
  );
  check(
    "a temporary folder does not count",
    under("/private/tmp/claude-501/scratchpad", "/Users/someone"),
    false,
    "",
  );
  check(
    "a missing working directory does not count",
    under(null, "/Users/someone"),
    false,
    "",
  );

  // End to end, to prove the tool applies the filter rather than only owning it.
  const reportHome = fs.mkdtempSync(path.join(os.tmpdir(), "report-home-"));
  const reportConfig = fs.mkdtempSync(path.join(os.tmpdir(), "report-config-"));
  const turn = (tokens) =>
    JSON.stringify({
      type: "assistant",
      requestId: `r${tokens}`,
      message: { usage: { input_tokens: tokens } },
    });
  const writeTranscript = (project, cwd, tokens) => {
    const directory = path.join(reportConfig, "projects", project);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "session.jsonl"),
      [JSON.stringify({ type: "user", cwd }), turn(tokens)].join("\n") + "\n",
    );
  };
  writeTranscript("real", path.join(reportHome, "Desktop", "project"), 250000);
  writeTranscript("probe", "/private/tmp/claude-501/scratchpad", 90000);

  const report = spawnSync(
    process.execPath,
    [path.join(__dirname, "context-report.js"), "--since", "2000-01-01"],
    {
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: reportConfig,
        HOME: reportHome,
        USERPROFILE: reportHome,
      },
    },
  );
  const reportText = String(report.stdout || "");
  check(
    "the report counts only the session that ran under the home directory",
    /Sessions modified since [\d-]+: 1\b/.test(reportText),
    true,
    reportText.slice(0, 300),
  );
  check(
    "the report says how many it left out",
    reportText.includes("1 excluded: ran elsewhere"),
    true,
    reportText.slice(0, 300),
  );
  check(
    "the excluded session does not reach the buckets",
    /under 100K\s+0\b/.test(reportText),
    true,
    reportText.slice(0, 400),
  );
  check(
    "the kept session does reach its bucket",
    /200K to 400K\s+1\b/.test(reportText),
    true,
    reportText.slice(0, 400),
  );

  fs.rmSync(reportHome, { recursive: true, force: true });
  fs.rmSync(reportConfig, { recursive: true, force: true });
}

header("SKILL-INDEX.md catalogs plugin skills, not only personal ones");
{
  const skillIndex = require(path.join(HOOKS, "lib", "skill-index.js"));
  const indexHome = fs.mkdtempSync(path.join(os.tmpdir(), "skill-index-"));
  const writeSkill = (directory, name, frontmatter) => {
    const target = path.join(directory, name);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(
      path.join(target, "SKILL.md"),
      `---\n${frontmatter}\n---\n\nbody\n`,
    );
  };

  writeSkill(
    path.join(indexHome, "skills"),
    "alpha",
    "name: alpha\ndescription: A personal skill.",
  );
  const demoInstall = path.join(indexHome, "cache", "demo", "1.0.0");
  const routerInstall = path.join(indexHome, "cache", "router", "2.0.0");
  const offInstall = path.join(indexHome, "cache", "off-plugin", "1.0.0");
  writeSkill(
    path.join(demoInstall, "skills"),
    "one",
    "name: one\ndescription: The first plugin skill.",
  );
  writeSkill(
    path.join(demoInstall, "skills"),
    "two",
    "name: two\ndescription: The second plugin skill.",
  );
  writeSkill(
    path.join(routerInstall, "skills"),
    "child",
    "name: child\ndescription: Picked by a router.\ndisable-model-invocation: true",
  );
  writeSkill(
    path.join(offInstall, "skills"),
    "three",
    "name: three\ndescription: Should not appear.",
  );

  fs.mkdirSync(path.join(indexHome, "plugins"), { recursive: true });
  fs.writeFileSync(
    path.join(indexHome, "plugins", "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "demo@market": [{ scope: "user", installPath: demoInstall }],
        "router@market": [{ scope: "user", installPath: routerInstall }],
        "off-plugin@market": [{ scope: "user", installPath: offInstall }],
        "vanished@market": [
          { scope: "user", installPath: path.join(indexHome, "cache", "gone") },
        ],
      },
    }),
  );
  fs.writeFileSync(
    path.join(indexHome, "settings.json"),
    JSON.stringify({
      enabledPlugins: { "demo@market": true, "off-plugin@market": false },
    }),
  );

  const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = indexHome;
  let counts;
  try {
    counts = skillIndex.build();
  } catch (error) {
    counts = { error: String(error && error.message) };
  }
  const indexText = readTextOrEmpty(path.join(indexHome, "SKILL-INDEX.md"));

  check(
    "an enabled plugin's skill is listed under its invocation name",
    indexText.includes("### `/demo:one`"),
    true,
    counts.error || indexText.slice(0, 200),
  );
  check(
    "a plugin skill carries its description",
    indexText.includes("The first plugin skill."),
    true,
    "",
  );
  check(
    "a disabled plugin contributes nothing",
    indexText.includes("off-plugin:three"),
    false,
    "",
  );
  // Sliced with a leading newline, because splitting on "## " would also split
  // at every "### " entry heading and cut the section off before its entries.
  const sectionOf = (title) => {
    const rest = indexText.slice(indexText.indexOf(`## ${title}`) + 3);
    const end = rest.search(/\n## /);
    return end === -1 ? rest : rest.slice(0, end);
  };
  check(
    "a plugin skill hidden by its author lands in hidden children",
    sectionOf("Hidden children").includes("/router:child"),
    true,
    sectionOf("Hidden children").slice(0, 300),
  );
  check(
    "a personal skill is still listed",
    indexText.includes("### `/alpha`"),
    true,
    "",
  );
  check(
    "the intro says how many came from plugins",
    indexText.includes("3 of them from enabled plugins"),
    true,
    indexText.slice(0, 700),
  );
  check(
    "a plugin whose install path is gone does not stop the build",
    counts.error,
    undefined,
    counts.error,
  );
  check("a fresh index is not stale", skillIndex.isStale(), false, "");

  // collect() used to abandon the whole catalog when this directory was missing.
  fs.renameSync(
    path.join(indexHome, "skills"),
    path.join(indexHome, "skills-aside"),
  );
  skillIndex.build();
  check(
    "no personal skills directory still catalogs the plugins",
    readTextOrEmpty(path.join(indexHome, "SKILL-INDEX.md")).includes(
      "### `/demo:one`",
    ),
    true,
    "",
  );
  fs.renameSync(
    path.join(indexHome, "skills-aside"),
    path.join(indexHome, "skills"),
  );
  skillIndex.build();

  const later = new Date(Date.now() + 2000);
  writeSkill(
    path.join(demoInstall, "skills"),
    "four",
    "name: four\ndescription: Added after the build.",
  );
  fs.utimesSync(
    path.join(demoInstall, "skills", "four", "SKILL.md"),
    later,
    later,
  );
  check(
    "a new plugin skill makes the index stale",
    skillIndex.isStale(),
    true,
    "",
  );

  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
  fs.rmSync(indexHome, { recursive: true, force: true });
}

// Two throwaway configuration directories, one per strictness. The dispatch
// gate and every gate after it read `settings.verify` out of `mode.lock`, so a
// case that wants a denial and a case that wants a pass differ only by which of
// these it points CLAUDE_CONFIG_DIR at. Tasks 5 to 8 reuse both.
const crewConfig = (verify) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `crew-${verify}-`));
  fs.writeFileSync(
    path.join(directory, "mode.lock"),
    JSON.stringify({
      mode: "test",
      codename: "TESTER",
      settings: { verify },
      deniedTools: [],
      subagents: null,
    }),
  );
  return directory;
};
const testedConfig = crewConfig("tested");
const noneConfig = crewConfig("none");
const workerEnv = { CLAUDE_CONFIG_DIR: testedConfig };
const noneEnv = { CLAUDE_CONFIG_DIR: noneConfig };

header("PreToolUse(Agent): the dispatch hook");
{
  // Stripping the sentence that states the scope of consent out of otherwise
  // identical prompts took Claude Code from 0.0% to 17.1% out-of-scope actions
  // (p = 2.4e-4, arxiv 2605.18583). The hook buys that sentence back by
  // refusing a dispatch without one, and staples a run token on so the report
  // that comes back can be joined to the dispatch that asked for it.
  const DISPATCH = path.join(HOOKS, "agent-dispatch.js");

  const dispatch = (prompt, subagentType) => ({
    tool_name: "Agent",
    hook_event_name: "PreToolUse",
    session_id: "s1",
    cwd: repo,
    tool_input: { prompt, subagent_type: subagentType || "implementer" },
  });

  // A dispatch with no scope line is refused where proof is required.
  check(
    "a dispatch with no scope line is denied at verify: tested",
    run(DISPATCH, dispatch("Go fix the parser."), workerEnv).verdict,
    "DENY",
  );
  check(
    "a dispatch with no scope line is allowed at verify: none",
    run(DISPATCH, dispatch("Go fix the parser."), noneEnv).verdict,
    "allow",
  );
  check(
    "a dispatch with a scope line is allowed",
    run(DISPATCH, dispatch("Scope: src/a.js\nGo fix the parser."), workerEnv)
      .verdict,
    "allow",
  );

  // The rewritten prompt carries a token the original did not.
  const rewritten = runJson(
    DISPATCH,
    dispatch("Scope: src/a.js\nFix it."),
    workerEnv,
  );
  const updated = (rewritten.hookSpecificOutput || {}).updatedInput || {};
  check("the dispatch is rewritten", typeof updated.prompt, "string");
  check(
    "the rewritten prompt carries a run token",
    /RUN [0-9a-f]{8}/.test(updated.prompt || ""),
    true,
  );
  check(
    "the rewritten prompt keeps the original",
    (updated.prompt || "").includes("Fix it."),
    true,
  );
  check(
    "the rewritten prompt carries the contract",
    (updated.prompt || "").includes("STATE"),
    true,
  );

  // The run record is opened with the declared scope. The last line, not the
  // first: several cases above dispatch under the same session, and the record
  // under test is the one the rewrite just opened.
  const recordLines = fs
    .readFileSync(path.join(testedConfig, "cache", "crew", "s1.jsonl"), "utf8")
    .trim()
    .split("\n");
  const record = JSON.parse(recordLines[recordLines.length - 1]);
  check(
    "the run record keeps the declared scope",
    record.scope.join(","),
    "src/a.js",
  );
  check("the run record keeps the role", record.role, "implementer");
  check(
    "the run record token matches the prompt",
    (updated.prompt || "").includes(record.token),
    true,
  );

  // The case above passes against a hard-coded constant, because a constant
  // matches itself. Two dispatches minting the same token would join every
  // report to whichever run happened to be first, so the tokens have to differ.
  const secondToken = (
    (
      (
        runJson(DISPATCH, dispatch("Scope: src/b.js\nFix it."), workerEnv)
          .hookSpecificOutput || {}
      ).updatedInput || {}
    ).prompt || ""
  ).match(/RUN ([0-9a-f]{8})/);
  check(
    "two dispatches mint different tokens",
    secondToken !== null && secondToken[1] !== record.token,
    true,
  );

  // The denial says what to add, because a bare refusal invites a second attempt
  // by another route.
  const denial = run(DISPATCH, dispatch("Go fix the parser."), workerEnv);
  check(
    "the denial shows the scope line format",
    String(denial.reason).includes("Scope:"),
    true,
  );

  // A non-dispatch tool call is not this hook's business.
  check(
    "a Bash call passes through the dispatch hook",
    run(DISPATCH, bash("ls", repo), workerEnv).verdict,
    "allow",
  );

  // Task is the other spelling of a dispatch. Gating one and not the other
  // leaves the rule enforceable by whichever name the dispatcher happens to use.
  const asTask = dispatch("Go fix the parser.");
  asTask.tool_name = "Task";
  check(
    "a Task dispatch is gated the same way",
    run(DISPATCH, asTask, workerEnv).verdict,
    "DENY",
  );

  // The declaration has to be a line of its own: a sentence mentioning the word
  // is not consent, and reading it as consent would let any prose defeat the gate.
  check(
    "the word inside a sentence is not a declaration",
    run(
      DISPATCH,
      dispatch("Fix the parser and mind the Scope: of it."),
      workerEnv,
    ).verdict,
    "DENY",
  );

  // A re-fired event must not mint a second token for one dispatch: the report
  // would then carry a token no gate could match to the run that asked for it.
  check(
    "a prompt that already carries a run token is left alone",
    JSON.stringify(
      runJson(
        DISPATCH,
        dispatch("RUN abcd1234\nScope: src/a.js\nFix it."),
        workerEnv,
      ),
    ),
    "{}",
  );
}

header("The run record round-trips what the gates read back");
{
  // Every later gate reads this module rather than the hook, so its four callers
  // are exercised here directly: a run opened by the dispatch hook, a path
  // written by the trace hook, and the two lookups the finish gates do.
  const recordHome = fs.mkdtempSync(path.join(os.tmpdir(), "crewrec-"));
  const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = recordHome;
  const crewRecord = require(path.join(HOOKS, "lib", "crew-record.js"));

  crewRecord.openRun({
    sessionId: "rec1",
    token: "0f0f0f0f",
    role: "reviewer",
    scope: ["src/a.js"],
    head: "abc123",
  });
  crewRecord.appendPath("rec1", "agent-7", "src/a.js");
  crewRecord.appendPath("rec1", "agent-8", "src/other.js");

  const found = crewRecord.findRun("rec1", "0f0f0f0f");
  check("a run is found by its token", found && found.role, "reviewer");
  check(
    "a token no dispatch minted finds nothing",
    crewRecord.findRun("rec1", "deadbeef"),
    null,
  );
  check(
    "a worker's paths come back under its own agent id",
    crewRecord.pathsFor("rec1", "agent-7").join(","),
    "src/a.js",
  );
  check(
    "one worker's paths do not include another's",
    crewRecord.pathsFor("rec1", "agent-8").join(","),
    "src/other.js",
  );

  // Past the cap the record stops accepting lines rather than growing forever.
  const capped = crewRecord.recordFile("rec2");
  fs.mkdirSync(path.dirname(capped), { recursive: true });
  fs.writeFileSync(
    capped,
    "x".repeat(crewRecord.MAX_RECORD_BYTES + 1024) + "\n",
  );
  const sizeBefore = fs.statSync(capped).size;
  crewRecord.openRun({
    sessionId: "rec2",
    token: "11112222",
    role: "implementer",
    scope: ["src/a.js"],
    head: null,
  });
  check(
    "an oversized run record stops accepting lines",
    String(fs.statSync(capped).size),
    String(sizeBefore),
    "the record grew past the cap",
  );

  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
  fs.rmSync(recordHome, { recursive: true, force: true });
}

header("PreToolUse(any tool): the worker guard");
{
  // The evidence gate is only worth having if a worker cannot author the
  // evidence. The `implementer` role carries Bash and Write, so a tool
  // allowlist cannot deliver that: a redirect, a heredoc or a node one-liner
  // all reach cache/evidence/. The guard keys on agent_id, which a worker's
  // payload carries and the main session's does not.
  const AGENT_GUARD = path.join(HOOKS, "agent-guard.js");
  const evidenceFile = path.join(testedConfig, "cache", "evidence", "s1.jsonl");
  const recordFile = path.join(testedConfig, "cache", "crew", "s1.jsonl");

  const asWorker = (payload) => ({
    ...payload,
    agent_id: "a6e0a6f2",
    agent_type: "implementer",
  });

  check(
    "a worker writing the evidence log is denied",
    run(
      AGENT_GUARD,
      asWorker({
        tool_name: "Write",
        session_id: "s1",
        tool_input: { file_path: evidenceFile },
      }),
      workerEnv,
    ).verdict,
    "DENY",
  );
  check(
    "the main session writing the evidence log is allowed",
    run(
      AGENT_GUARD,
      {
        tool_name: "Write",
        session_id: "s1",
        tool_input: { file_path: evidenceFile },
      },
      workerEnv,
    ).verdict,
    "allow",
  );
  check(
    "a worker redirecting into the evidence log is denied",
    run(
      AGENT_GUARD,
      asWorker(bash(`echo x > ${evidenceFile}`, repo)),
      workerEnv,
    ).verdict,
    "DENY",
  );
  check(
    "a worker heredoc into the evidence log is denied",
    run(
      AGENT_GUARD,
      asWorker(bash(`cat <<'EOF' > ${evidenceFile}\nx\nEOF`, repo)),
      workerEnv,
    ).verdict,
    "DENY",
  );
  check(
    "a worker node one-liner into the evidence log is denied",
    run(
      AGENT_GUARD,
      asWorker(
        bash(
          `node -e "require('fs').writeFileSync('${evidenceFile}','x')"`,
          repo,
        ),
      ),
      workerEnv,
    ).verdict,
    "DENY",
  );
  check(
    "a worker writing the run record is denied",
    run(
      AGENT_GUARD,
      asWorker({
        tool_name: "Write",
        session_id: "s1",
        tool_input: { file_path: recordFile },
      }),
      workerEnv,
    ).verdict,
    "DENY",
  );
  check(
    "a worker READING the evidence log is allowed",
    run(
      AGENT_GUARD,
      asWorker({
        tool_name: "Read",
        session_id: "s1",
        tool_input: { file_path: evidenceFile },
      }),
      workerEnv,
    ).verdict,
    "allow",
  );
  check(
    "a worker writing its own repository is allowed",
    run(
      AGENT_GUARD,
      asWorker({
        tool_name: "Write",
        session_id: "s1",
        tool_input: { file_path: path.join(repo, "src", "a.js") },
      }),
      workerEnv,
    ).verdict,
    "allow",
  );

  // A multi-file edit carries its targets in an array, so a guard that only
  // reads tool_input.file_path lets the same write through under another tool.
  check(
    "a worker editing the evidence log through MultiEdit is denied",
    run(
      AGENT_GUARD,
      asWorker({
        tool_name: "MultiEdit",
        session_id: "s1",
        tool_input: {
          edits: [
            { file_path: path.join(repo, "src", "a.js") },
            { file_path: evidenceFile },
          ],
        },
      }),
      workerEnv,
    ).verdict,
    "DENY",
  );

  // A relative path is the same write spelled differently, and the payload
  // carries the working directory it is relative to.
  check(
    "a worker writing a relative path into the record is denied",
    run(
      AGENT_GUARD,
      asWorker({
        tool_name: "Write",
        session_id: "s1",
        cwd: testedConfig,
        tool_input: { file_path: path.join("cache", "crew", "s1.jsonl") },
      }),
      workerEnv,
    ).verdict,
    "DENY",
  );

  // The logger itself runs in the main session and writes through Bash-shaped
  // work, so the shell half of the guard must not fire without an agent_id.
  check(
    "the main session redirecting into the evidence log is allowed",
    run(AGENT_GUARD, bash(`echo x > ${evidenceFile}`, repo), workerEnv).verdict,
    "allow",
  );

  // The evidence log moves with CLAUDE_EVIDENCE_DIR, and a guard that hardcodes
  // cache/evidence/ would protect the wrong directory wherever it is moved.
  {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "crewev-"));
    check(
      "a worker writing a relocated evidence log is denied",
      run(
        AGENT_GUARD,
        asWorker({
          tool_name: "Write",
          session_id: "s1",
          tool_input: { file_path: path.join(elsewhere, "s1.jsonl") },
        }),
        { ...workerEnv, CLAUDE_EVIDENCE_DIR: elsewhere },
      ).verdict,
      "DENY",
    );
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
}

header("PostToolUse(Edit/Write): the trace hook");
{
  // What a worker touched is attributed per agent_id, never by diffing the
  // checkout: two workers running in one repository would otherwise inherit
  // each other's writes and both fail the scope gate for the other's work.
  const TRACE = path.join(HOOKS, "subagent-trace.js");

  const asWorker = (payload) => ({
    ...payload,
    agent_id: "a6e0a6f2",
    agent_type: "implementer",
  });

  const readRecordLines = (configDir, sessionId) => {
    const file = path.join(configDir, "cache", "crew", sessionId + ".jsonl");
    return readTextOrEmpty(file)
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));
  };

  const writeCall = (target, workingDirectory) => ({
    tool_name: "Write",
    session_id: "s2",
    cwd: workingDirectory || repo,
    tool_input: { file_path: target },
  });

  run(TRACE, asWorker(writeCall(path.join(repo, "src", "a.js"))), workerEnv);
  run(TRACE, writeCall(path.join(repo, "src", "b.js")), workerEnv);

  const traced = readRecordLines(testedConfig, "s2").filter(
    (line) => line.kind === "path",
  );
  check("a worker write is traced", traced.length, 1);
  check(
    "the traced path is the file written",
    traced[0] && traced[0].path.endsWith("a.js"),
    true,
  );
  check(
    "the traced path carries its agent",
    traced[0] && traced[0].agentId,
    "a6e0a6f2",
  );
  check(
    "a main-session write is not traced",
    traced.some((line) => line.path.endsWith("b.js")),
    false,
  );

  // The scope gate compares what was touched against patterns a dispatcher
  // wrote by hand ("src/a.js"), so the record holds the repository-relative
  // spelling rather than a temporary absolute path no pattern could match.
  check(
    "the traced path is relative to the repository",
    traced[0] && traced[0].path,
    path.join("src", "a.js"),
  );

  run(
    TRACE,
    asWorker({ ...bash("echo hi", repo), session_id: "s2" }),
    workerEnv,
  );
  const afterBash = readRecordLines(testedConfig, "s2").filter(
    (line) => line.kind === "path",
  );
  check("a Bash call that writes nothing traces nothing", afterBash.length, 1);

  // Reading is most of what a worker does, and a read changes no file, so a
  // read in the record would charge the worker for a file it only looked at.
  run(
    TRACE,
    asWorker({
      tool_name: "Read",
      session_id: "s2",
      cwd: repo,
      tool_input: { file_path: path.join(repo, "src", "a.js") },
    }),
    workerEnv,
  );
  check(
    "a read traces nothing",
    readRecordLines(testedConfig, "s2").filter((line) => line.kind === "path")
      .length,
    1,
  );

  // Edit is how a worker changes a file that already exists, and it was the
  // untested half of the pair until this case existed.
  run(
    TRACE,
    asWorker({
      tool_name: "Edit",
      session_id: "s2",
      cwd: repo,
      tool_input: {
        file_path: path.join(repo, "src", "edited.js"),
        old_string: "a",
        new_string: "b",
      },
    }),
    workerEnv,
  );
  check(
    "an edit is traced",
    readRecordLines(testedConfig, "s2").some(
      (line) => line.kind === "path" && line.path.endsWith("edited.js"),
    ),
    true,
  );

  // A relative file_path is what a worker actually sends most of the time.
  run(TRACE, asWorker(writeCall(path.join("src", "rel.js"))), workerEnv);
  check(
    "a relative path is resolved against the working directory",
    readRecordLines(testedConfig, "s2").some(
      (line) =>
        line.kind === "path" && line.path === path.join("src", "rel.js"),
    ),
    true,
  );

  // A worker often runs with its working directory below the repository root,
  // and a path resolved against the wrong base loses the prefix every scope
  // pattern is written with.
  run(
    TRACE,
    asWorker(writeCall("nested.js", path.join(repo, "src"))),
    workerEnv,
  );
  check(
    "a path relative to a nested directory keeps its repository prefix",
    readRecordLines(testedConfig, "s2").some(
      (line) =>
        line.kind === "path" && line.path === path.join("src", "nested.js"),
    ),
    true,
  );

  // A worker's first write often creates the directory it lands in, so the
  // file and its parent are both absent when the path is recorded.
  run(
    TRACE,
    asWorker(writeCall(path.join(repo, "fresh", "deep", "new.js"))),
    workerEnv,
  );
  check(
    "a write into a directory that does not exist yet stays relative",
    readRecordLines(testedConfig, "s2").some(
      (line) =>
        line.kind === "path" &&
        line.path === path.join("fresh", "deep", "new.js"),
    ),
    true,
  );

  // An empty error string is not a failure, and reading it as one would drop
  // a write that really happened.
  run(
    TRACE,
    asWorker({
      ...writeCall(path.join(repo, "src", "blank-error.js")),
      tool_response: { error: "" },
    }),
    workerEnv,
  );
  check(
    "an empty error string does not count as a failure",
    readRecordLines(testedConfig, "s2").some(
      (line) => line.kind === "path" && line.path.endsWith("blank-error.js"),
    ),
    true,
  );

  // Outside any repository there is nothing to be relative to, and dropping
  // the write would hide it from the scope gate entirely.
  {
    const looseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "crewloose-"));
    run(
      TRACE,
      asWorker(writeCall(path.join(looseDirectory, "x.js"), looseDirectory)),
      workerEnv,
    );
    check(
      "a write outside a repository is traced by absolute path",
      readRecordLines(testedConfig, "s2").some(
        (line) =>
          line.kind === "path" &&
          line.path === path.join(looseDirectory, "x.js"),
      ),
      true,
    );
    fs.rmSync(looseDirectory, { recursive: true, force: true });
  }

  // PostToolUse fires after a call that errored too, and a write that failed
  // changed nothing. Charging the worker for it would fail the scope gate for
  // a file that still holds exactly what it held before.
  run(
    TRACE,
    asWorker({
      ...writeCall(path.join(repo, "src", "failed.js")),
      tool_response: { success: false, error: "permission denied" },
    }),
    workerEnv,
  );
  check(
    "a failed write traces nothing",
    readRecordLines(testedConfig, "s2").some(
      (line) => line.kind === "path" && line.path.endsWith("failed.js"),
    ),
    false,
  );

  // The success field is not guaranteed to be present on every build, so its
  // absence must not be read as failure.
  run(
    TRACE,
    asWorker({
      ...writeCall(path.join(repo, "src", "quiet.js")),
      tool_response: { filePath: path.join(repo, "src", "quiet.js") },
    }),
    workerEnv,
  );
  check(
    "a response with no success field is still traced",
    readRecordLines(testedConfig, "s2").some(
      (line) => line.kind === "path" && line.path.endsWith("quiet.js"),
    ),
    true,
  );

  const secondWorker = {
    ...asWorker(writeCall(path.join(repo, "src", "c.js"))),
    agent_id: "b111",
  };
  run(TRACE, secondWorker, workerEnv);
  const bothWorkers = readRecordLines(testedConfig, "s2").filter(
    (line) => line.kind === "path",
  );
  check(
    "two workers keep separate traces",
    new Set(bothWorkers.map((line) => line.agentId)).size,
    2,
  );
}

header("SubagentStart: the brief hook");
{
  // A worker's agent file is written when the mode is applied, so a worker
  // dispatched after a later switch would read the previous posture's rules.
  // This hook injects the band the mode makes primary AT SPAWN, which is the
  // one thing the generated file cannot carry.
  const BRIEF = path.join(HOOKS, "subagent-brief.js");

  const ruleFile = (id, setting, primaryAt, worker, body) =>
    `---\nid: ${id}\nsetting: ${setting}\nprimary_at: ${primaryAt}\nworker: ${worker}\n---\n\n${body}\n`;

  const posture = {
    verify: "tested",
    claims: "labeled",
    process: "light",
    asking: "sometimes",
    code: "polished",
    subagents: "few",
    voice: "caveman",
  };

  // A throwaway config carrying its own rule corpus, so what the hook renders
  // is decided by this block rather than by whichever mode the operator has in
  // force while the suite runs.
  const briefConfigs = [];
  const briefConfig = (ruleFiles, lock) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "crewbrief-"));
    briefConfigs.push(directory);
    if (lock !== null)
      fs.writeFileSync(path.join(directory, "mode.lock"), JSON.stringify(lock));
    const rulesDirectory = path.join(directory, "modes", "rules");
    fs.mkdirSync(rulesDirectory, { recursive: true });
    for (const [name, text] of Object.entries(ruleFiles))
      fs.writeFileSync(path.join(rulesDirectory, name), text);
    return directory;
  };

  const lock = { mode: "test", codename: "TESTER", settings: posture };
  const fullConfig = briefConfig(
    {
      // The corpus loads in filename order, so the rule this posture leaves
      // standing is read first. A band sliced in that order would carry it,
      // and only the mode's own ordering keeps it out.
      "a-standing.md": ruleFile(
        "brief-standing",
        "asking",
        "always",
        "brief",
        "STANDING-RULE body.",
      ),
      "b-primary.md": ruleFile(
        "brief-primary",
        "verify",
        "tested",
        "brief",
        "PRIMARY-RULE body.",
      ),
      "c-not-for-workers.md": ruleFile(
        "worker-none",
        "verify",
        "tested",
        "n/a",
        "EXCLUDED-NA body.",
      ),
      "d-gated.md": ruleFile(
        "worker-gated",
        "verify",
        "tested",
        "gate:scope",
        "EXCLUDED-GATE body.",
      ),
    },
    lock,
  );
  const briefEnv = { CLAUDE_CONFIG_DIR: fullConfig };

  const started = {
    hook_event_name: "SubagentStart",
    agent_id: "a1",
    agent_type: "implementer",
    session_id: "s3",
    cwd: repo,
  };

  const reply = run(BRIEF, started, briefEnv);
  check("the brief hook injects context", reply.verdict, "warn", reply.reason);
  check("the brief names the mode", reply.reason.includes("TESTER"), true);
  check(
    "the brief names the posture",
    reply.reason.includes("verify: tested"),
    true,
  );
  check("the brief names the role", reply.reason.includes("implementer"), true);
  check(
    "the brief carries the rule band",
    reply.reason.includes("Rules for this run"),
    true,
  );
  check("the brief is capped", reply.reason.length <= 8000, true);

  // The whole point of rendering at spawn: the band is the mode's primary band,
  // not the corpus in filename order.
  check(
    "the brief carries a rule this mode makes primary",
    reply.reason.includes("PRIMARY-RULE"),
    true,
  );
  check(
    "a brief rule this mode leaves standing stays out",
    reply.reason.includes("STANDING-RULE"),
    false,
  );
  check(
    "a rule classified n/a stays out of the brief",
    reply.reason.includes("EXCLUDED-NA"),
    false,
  );
  check(
    "a rule a gate enforces stays out of the brief",
    reply.reason.includes("EXCLUDED-GATE"),
    false,
  );

  // Built-in agent types (Explore, general-purpose, code-simplifier) cannot be
  // given an agent file at all, so this injection is the only rules they ever
  // see. The operator decided on 2026-09-15 that they are briefed anyway.
  check(
    "an unknown agent type still gets the band",
    run(
      BRIEF,
      { ...started, agent_type: "general-purpose" },
      briefEnv,
    ).reason.includes("Rules for this run"),
    true,
  );

  // No mode applied means no posture to brief from. Staying silent matches
  // hooks/mode-inject.js, which also says nothing when the lock is missing.
  const lockless = briefConfig(
    {
      "a-primary.md": ruleFile("brief-one", "verify", "tested", "brief", "X."),
    },
    null,
  );
  check(
    "no mode applied means no brief",
    run(BRIEF, started, { CLAUDE_CONFIG_DIR: lockless }).verdict,
    "allow",
  );

  // An empty band must inject nothing rather than a heading with no rules
  // under it, which would read to a worker as a posture that wants nothing.
  const nothingForWorkers = briefConfig(
    {
      "a-none.md": ruleFile("worker-none", "verify", "tested", "n/a", "NA."),
    },
    lock,
  );
  check(
    "a corpus with no brief rules says nothing",
    run(BRIEF, started, { CLAUDE_CONFIG_DIR: nothingForWorkers }).verdict,
    "allow",
  );

  // A corpus that grew wrong must not flood a worker's context. Truncating
  // keeps the fault visible instead of silently spending the whole budget.
  const oversized = briefConfig(
    {
      "a-huge.md": ruleFile(
        "brief-huge",
        "verify",
        "tested",
        "brief",
        "HUGE ".repeat(4000),
      ),
    },
    lock,
  );
  const cut = run(BRIEF, started, { CLAUDE_CONFIG_DIR: oversized });
  check(
    "an oversized band is truncated",
    cut.reason.endsWith("[rules truncated]"),
    true,
  );
  check("the truncated brief is still capped", cut.reason.length <= 8000, true);

  for (const directory of briefConfigs)
    fs.rmSync(directory, { recursive: true, force: true });
}

header("SubagentStop and SubagentHandback: the gate runner");
{
  // A worker's report arrives at one of two places, measured on 2.1.273: in auto
  // mode the parent already has it when the worker calls SubagentHandback, and
  // SubagentStop fires afterwards, so a block there only sends the worker back
  // to a hand-back the harness refuses. The runner answers at both points: a
  // deny withholds the report at the hand-back, a block sends it back at the
  // stop, and the two share one two-refusal bound per worker.
  const GATE = path.join(HOOKS, "subagent-gate.js");

  const gateLines = (configDir, sessionId) => {
    const file = path.join(configDir, "cache", "crew", sessionId + ".jsonl");
    return readTextOrEmpty(file)
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));
  };

  // A dispatched run for the reports below to join.
  const gateRecord = path.join(testedConfig, "cache", "crew", "s4.jsonl");
  fs.mkdirSync(path.dirname(gateRecord), { recursive: true });
  fs.appendFileSync(
    gateRecord,
    JSON.stringify({
      kind: "run",
      token: "abcd1234",
      role: "implementer",
      scope: ["src/a.js"],
    }) + "\n",
  );
  fs.appendFileSync(
    gateRecord,
    JSON.stringify({
      kind: "run",
      token: "beef0001",
      role: "typoed",
      scope: ["src/a.js"],
    }) + "\n",
  );
  // The same dispatch under the loose posture, so a case there fails for its
  // posture and not for a token that joins nothing.
  const looseRecord = path.join(noneConfig, "cache", "crew", "s4.jsonl");
  fs.mkdirSync(path.dirname(looseRecord), { recursive: true });
  fs.appendFileSync(
    looseRecord,
    JSON.stringify({
      kind: "run",
      token: "abcd1234",
      role: "implementer",
      scope: ["src/a.js"],
    }) + "\n",
  );

  // A worker transcript whose first user line is the dispatch prompt, the layout
  // measured on 2.1.273. The second refusal quotes its RUN line from here.
  const parentTranscript = path.join(testedConfig, "projects", "s4.jsonl");
  const workerTranscript = (agentId) =>
    path.join(
      testedConfig,
      "projects",
      "s4",
      "subagents",
      `agent-${agentId}.jsonl`,
    );
  const writeWorkerTranscript = (agentId) => {
    fs.mkdirSync(path.dirname(workerTranscript(agentId)), { recursive: true });
    fs.writeFileSync(
      workerTranscript(agentId),
      JSON.stringify({
        type: "user",
        version: "2.1.273",
        message: {
          role: "user",
          content: "Scope: src/a.js\nFix it.\n\nRUN abcd1234",
        },
      }) + "\n",
    );
  };

  const SHAPED =
    "Did it.\n\nRUN abcd1234\nSTATE done\nTOUCHED src/a.js\nEVIDENCE node tools/test-hooks.js";
  const SHAPED_TYPOED = SHAPED.replace("abcd1234", "beef0001");

  // Each scenario uses its own agent id, because refusals are counted per agent.
  const stopped = (agentId, message) => ({
    hook_event_name: "SubagentStop",
    agent_id: agentId,
    agent_type: "implementer",
    session_id: "s4",
    last_assistant_message: message,
    agent_transcript_path: workerTranscript(agentId),
    stop_hook_active: false,
  });
  const handingBack = (agentId, message) => ({
    hook_event_name: "PreToolUse",
    tool_name: "SubagentHandback",
    agent_id: agentId,
    agent_type: "implementer",
    session_id: "s4",
    transcript_path: parentTranscript,
    tool_input: { message },
  });
  const handedBack = (agentId, success) => ({
    hook_event_name: "PostToolUse",
    tool_name: "SubagentHandback",
    agent_id: agentId,
    agent_type: "implementer",
    session_id: "s4",
    transcript_path: parentTranscript,
    tool_input: { message: SHAPED },
    tool_response: { success },
  });

  // Outside auto mode the report is the worker's last message.
  check(
    "a prose-only finish is blocked",
    run(GATE, stopped("stop-prose", "All done, everything works."), workerEnv)
      .verdict,
    "BLOCK",
  );
  check(
    "the block shows the template",
    run(GATE, stopped("stop-template", "All done."), workerEnv).reason.includes(
      "STATE",
    ),
    true,
  );
  check(
    "the block names the gate that refused",
    run(GATE, stopped("stop-named", "All done."), workerEnv).reason.includes(
      "finish-shape",
    ),
    true,
  );
  check(
    "a shape refusal says only the block is missing",
    run(
      GATE,
      stopped("stop-only-shape", "All done."),
      workerEnv,
    ).reason.includes("Nothing about the work itself needs to change"),
    true,
  );
  check(
    "a finish with the shape is allowed",
    run(GATE, stopped("stop-shaped", SHAPED), workerEnv).verdict,
    "allow",
  );
  check(
    "a finish block on one comma-separated line is allowed",
    run(
      GATE,
      stopped(
        "stop-one-line",
        "Did it.\n\nRUN abcd1234, STATE done, TOUCHED src/a.js, EVIDENCE node tools/test-hooks.js",
      ),
      workerEnv,
    ).verdict,
    "allow",
  );
  check(
    "a finish with an unknown STATE word is blocked",
    run(
      GATE,
      stopped("stop-state", "RUN abcd1234\nSTATE finished\nTOUCHED src/a.js"),
      workerEnv,
    ).verdict,
    "BLOCK",
  );
  check(
    "a finish whose token matches no run is blocked",
    run(
      GATE,
      stopped("stop-token", "RUN ffffffff\nSTATE done\nTOUCHED src/a.js"),
      workerEnv,
    ).verdict,
    "BLOCK",
  );
  check(
    "a blocked finish is recorded as a refusal",
    gateLines(testedConfig, "s4").some(
      (line) =>
        line.kind === "mark" &&
        line.mark === "refusal" &&
        line.agentId === "stop-prose",
    ),
    true,
  );

  // The bound: the second refusal quotes the RUN line, and there is no third.
  writeWorkerTranscript("stop-twice");
  run(GATE, stopped("stop-twice", "All done."), workerEnv);
  check(
    "the second block quotes the exact RUN line",
    run(GATE, stopped("stop-twice", "All done."), workerEnv).reason.includes(
      "RUN abcd1234",
    ),
    true,
  );
  check(
    "there is no third block",
    run(GATE, stopped("stop-twice", "All done."), workerEnv).verdict,
    "allow",
  );
  run(GATE, stopped("stop-no-transcript", "All done."), workerEnv);
  check(
    "a missing transcript leaves the second block on the template",
    run(
      GATE,
      stopped("stop-no-transcript", "All done."),
      workerEnv,
    ).reason.includes("STATE"),
    true,
  );

  // In auto mode the report is the hand-back message, and a refusal is a deny
  // that withholds it from the parent.
  check(
    "a hand-back with no finish block is denied",
    run(GATE, handingBack("back-prose", "All done."), workerEnv).verdict,
    "DENY",
  );
  check(
    "the hand-back denial shows the template",
    run(
      GATE,
      handingBack("back-template", "All done."),
      workerEnv,
    ).reason.includes("STATE"),
    true,
  );
  check(
    "a hand-back with the finish block is allowed",
    run(GATE, handingBack("back-shaped", SHAPED), workerEnv).verdict,
    "allow",
  );
  writeWorkerTranscript("back-twice");
  run(GATE, handingBack("back-twice", "All done."), workerEnv);
  check(
    "the second hand-back denial quotes the exact RUN line",
    run(
      GATE,
      handingBack("back-twice", "All done."),
      workerEnv,
    ).reason.includes("RUN abcd1234"),
    true,
  );

  // A delivered report is not gated again at the stop that follows it.
  run(GATE, handedBack("back-delivered", true), workerEnv);
  check(
    "a delivered hand-back is recorded",
    gateLines(testedConfig, "s4").some(
      (line) =>
        line.kind === "mark" &&
        line.mark === "delivered" &&
        line.agentId === "back-delivered",
    ),
    true,
  );
  check(
    "a delivered hand-back excuses the stop that follows",
    run(
      GATE,
      stopped("back-delivered", "Task complete and handed back to caller."),
      workerEnv,
    ).verdict,
    "allow",
  );
  run(GATE, handedBack("back-refused", false), workerEnv);
  check(
    "a hand-back that was not delivered does not excuse the stop",
    run(
      GATE,
      stopped("back-refused", "Task complete and handed back to caller."),
      workerEnv,
    ).verdict,
    "BLOCK",
  );

  // Denials at the hand-back and blocks at the stop share one count.
  run(GATE, handingBack("back-shared", "All done."), workerEnv);
  run(GATE, handingBack("back-shared", "All done."), workerEnv);
  check(
    "a worker denied twice at hand-back is not blocked at stop",
    run(GATE, stopped("back-shared", "All done."), workerEnv).verdict,
    "allow",
  );

  check(
    "a call with no agent_id passes through",
    run(
      GATE,
      { ...handingBack("unused", "All done."), agent_id: undefined },
      workerEnv,
    ).verdict,
    "allow",
  );
  check(
    "a tool other than the hand-back passes through",
    run(
      GATE,
      { ...handingBack("back-other", "All done."), tool_name: "Write" },
      workerEnv,
    ).verdict,
    "allow",
  );
  run(
    GATE,
    { ...handedBack("back-write", true), tool_name: "Write" },
    workerEnv,
  );
  check(
    "a finished write is not mistaken for a delivered hand-back",
    gateLines(testedConfig, "s4").some(
      (line) => line.kind === "mark" && line.agentId === "back-write",
    ),
    false,
  );

  // A worker that copied the contract's own parenthetical, or added a remark
  // after its state word, said the right thing. Refusing that would spend a
  // round trip teaching it punctuation.
  check(
    "a RUN line carrying the contract's parenthetical still joins",
    run(
      GATE,
      stopped(
        "stop-parenthetical",
        "RUN abcd1234  (repeat this line unchanged at the end of your report)\nSTATE done\nTOUCHED src/a.js",
      ),
      workerEnv,
    ).verdict,
    "allow",
  );
  check(
    "a STATE word followed by a remark still reads as that state",
    run(
      GATE,
      stopped(
        "stop-remark",
        "RUN abcd1234\nSTATE done (both suites green)\nTOUCHED src/a.js",
      ),
      workerEnv,
    ).verdict,
    "allow",
  );

  // The bound lives in the record, so a record that can no longer be appended to
  // cannot carry it. Refusing regardless risks a loop with nothing to stop it.
  {
    const fullRecord = path.join(testedConfig, "cache", "crew", "s5.jsonl");
    fs.writeFileSync(
      fullRecord,
      JSON.stringify({ kind: "note", filler: "x".repeat(600 * 1024) }) + "\n",
    );
    const atCeiling = run(
      GATE,
      { ...stopped("stop-full", "All done."), session_id: "s5" },
      workerEnv,
    );
    check("a full run record refuses nothing", atCeiling.verdict, "warn");
    check(
      "the unrefused report says why it was let through",
      atCeiling.reason.includes("size ceiling"),
      true,
    );
  }

  // The role file decides which gates run. A role that names none is gated on
  // nothing, which is how a posture stays a posture rather than a hard-coded
  // list; a role that names a gate no module provides says so instead of
  // dropping it silently, because a gate that quietly stops running is the
  // failure this whole design exists to prevent.
  const roleDirectory = path.join(testedConfig, "modes", "roles");
  fs.mkdirSync(roleDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(roleDirectory, "shapeless.md"),
    "---\nid: shapeless\ndescription: Gated on nothing.\ntools: Read\n---\n\nBody.\n",
  );
  fs.writeFileSync(
    path.join(roleDirectory, "typoed.md"),
    "---\nid: typoed\ndescription: Names a gate that does not exist.\ntools: Read\ngates: finish-shape, no-such-gate\n---\n\nBody.\n",
  );
  check(
    "a role that names no gate lets a prose finish through",
    run(
      GATE,
      { ...stopped("role-none", "All done."), agent_type: "shapeless" },
      workerEnv,
    ).verdict,
    "allow",
  );
  // This report's token joins the run whose role is `typoed`, while its payload
  // still says `implementer`: the warning below can only appear if the record's
  // role won, so it pins that order as well as the missing module.
  const typoed = run(GATE, stopped("role-typo", SHAPED_TYPOED), workerEnv);
  check(
    "a gate no module provides warns instead of refusing",
    typoed.verdict,
    "warn",
  );
  check(
    "a gate no module provides is named",
    typoed.reason.includes("no-such-gate"),
    true,
  );

  // At verify: none every gate still runs, and a failure is carried as a warning
  // rather than a refusal: a gate that does not run leaves the conformance log
  // with nothing to record.
  const noneStop = run(GATE, stopped("none-stop", "All done."), noneEnv);
  check("at verify: none no finish is not blocked", noneStop.verdict, "warn");
  check(
    "the warning at verify: none still shows the template",
    noneStop.reason.includes("STATE"),
    true,
  );
  const noneBack = run(GATE, handingBack("none-back", "All done."), noneEnv);
  check("at verify: none no hand-back is not denied", noneBack.verdict, "warn");
  check(
    "a shaped finish at verify: none says nothing",
    run(GATE, stopped("none-shaped", SHAPED), noneEnv).verdict,
    "allow",
  );
  check(
    "a warning at verify: none is not counted as a refusal",
    gateLines(noneConfig, "s4").some(
      (line) => line.kind === "mark" && line.mark === "refusal",
    ),
    false,
  );
}

header(
  "The scope gate: what a worker touched against what it was sent to touch",
);
{
  // The dispatcher's scope line is the sentence that keeps a worker inside its
  // area: stripping it took out-of-scope actions from 0% to 17.1%. This gate is
  // what makes the line binding. It reads the paths the trace hook recorded,
  // which no worker can write, so it needs nothing from the model beyond naming
  // a deviation when it had a reason to step outside.
  const scopeGate = require(path.join(HOOKS, "subagent", "gates", "scope.js"));
  const GATE_RUNNER = path.join(HOOKS, "subagent-gate.js");
  // A gate that wrongly passes carries no reason, and reading `.includes` off
  // that would crash the suite where it should fail one case and carry on.
  const reasonOf = (result) => String((result && result.reason) || "");

  check("the gate is named scope", scopeGate.id, "scope");
  check(
    "the gate refuses from verify: tested upward",
    scopeGate.minimumVerify,
    "tested",
  );

  check(
    "a worker inside its scope passes",
    scopeGate.check({
      scope: ["src/a.js"],
      touched: ["src/a.js"],
      finish: { deviations: [] },
    }).ok,
    true,
  );
  check(
    "a worker outside its scope fails",
    scopeGate.check({
      scope: ["src/a.js"],
      touched: ["src/a.js", "src/b.js"],
      finish: { deviations: [] },
    }).ok,
    false,
  );
  check(
    "the failure names the offending path",
    reasonOf(
      scopeGate.check({
        scope: ["src/a.js"],
        touched: ["src/b.js"],
        finish: { deviations: [] },
      }),
    ).includes("src/b.js"),
    true,
  );
  check(
    "the failure names every offending path",
    reasonOf(
      scopeGate.check({
        scope: ["src/a.js"],
        touched: ["src/b.js", "src/c.js"],
        finish: { deviations: [] },
      }),
    ).includes("src/c.js"),
    true,
  );
  check(
    "the failure quotes the scope it was measured against",
    reasonOf(
      scopeGate.check({
        scope: ["src/a.js"],
        touched: ["src/b.js"],
        finish: { deviations: [] },
      }),
    ).includes("src/a.js"),
    true,
  );

  check(
    "a named deviation passes",
    scopeGate.check({
      scope: ["src/a.js"],
      touched: ["src/a.js", "src/b.js"],
      finish: { deviations: ["src/b.js: the import had to move with it"] },
    }).ok,
    true,
  );
  check(
    "a deviation with no reason fails",
    scopeGate.check({
      scope: ["src/a.js"],
      touched: ["src/b.js"],
      finish: { deviations: ["src/b.js"] },
    }).ok,
    false,
  );
  check(
    "a deviation separated by a dash passes",
    scopeGate.check({
      scope: ["src/a.js"],
      touched: ["src/b.js"],
      finish: { deviations: ["src/b.js - the import moved with it"] },
    }).ok,
    true,
  );
  check(
    "a deviation written as a sentence passes",
    scopeGate.check({
      scope: ["src/a.js"],
      touched: ["src/b.js"],
      finish: {
        deviations: ["had to touch src/b.js too, the import followed the move"],
      },
    }).ok,
    true,
  );
  check(
    "a deviation for one path does not excuse another",
    scopeGate.check({
      scope: ["src/a.js"],
      touched: ["src/b.js", "src/c.js"],
      finish: { deviations: ["src/b.js: the import moved with it"] },
    }).ok,
    false,
  );
  check(
    "the unexcused path is the one named",
    reasonOf(
      scopeGate.check({
        scope: ["src/a.js"],
        touched: ["src/b.js", "src/c.js"],
        finish: { deviations: ["src/b.js: the import moved with it"] },
      }),
    ).includes("src/b.js"),
    false,
  );

  check(
    "a directory scope covers its files",
    scopeGate.check({
      scope: ["hooks/"],
      touched: ["hooks/a.js", "hooks/lib/b.js"],
      finish: { deviations: [] },
    }).ok,
    true,
  );
  check(
    "a directory scope without a trailing slash covers its files",
    scopeGate.check({
      scope: ["hooks"],
      touched: ["hooks/a.js"],
      finish: { deviations: [] },
    }).ok,
    true,
  );
  check(
    "a glob scope covers its matches",
    scopeGate.check({
      scope: ["hooks/*.js"],
      touched: ["hooks/a.js"],
      finish: { deviations: [] },
    }).ok,
    true,
  );
  check(
    "a glob does not cross a directory boundary",
    scopeGate.check({
      scope: ["hooks/*.js"],
      touched: ["hooks/lib/b.js"],
      finish: { deviations: [] },
    }).ok,
    false,
  );
  check(
    "a double star crosses more than one directory boundary",
    scopeGate.check({
      scope: ["hooks/**/*.js"],
      touched: ["hooks/lib/deep/b.js"],
      finish: { deviations: [] },
    }).ok,
    true,
  );
  // The rule the whole gate turns on: segments, never string prefixes.
  check(
    "a scope does not cover a sibling whose name merely starts the same",
    scopeGate.check({
      scope: ["src/a"],
      touched: ["src/ab.js"],
      finish: { deviations: [] },
    }).ok,
    false,
  );

  check(
    "touching nothing passes",
    scopeGate.check({
      scope: ["src/a.js"],
      touched: [],
      finish: { deviations: [] },
    }).ok,
    true,
  );

  // The refusal is written into a worker's context, so its length cannot follow
  // the number of files the worker happened to write.
  const fourteenPaths = Array.from(
    { length: 14 },
    (unused, index) => `src/out${index}.js`,
  );
  check(
    "a long list of offending paths is counted rather than spelled out",
    reasonOf(
      scopeGate.check({
        scope: ["src/a.js"],
        touched: fourteenPaths,
        finish: { deviations: [] },
      }),
    ).includes("and 2 more"),
    true,
  );
  check(
    "the paths past the cap are not named",
    reasonOf(
      scopeGate.check({
        scope: ["src/a.js"],
        touched: fourteenPaths,
        finish: { deviations: [] },
      }),
    ).includes("src/out13.js"),
    false,
  );
  // A dispatch that declared no scope is refused by the dispatch hook under any
  // posture that wants one. Where it is allowed, the scope genuinely is whatever
  // the work turns out to need, so there is nothing here to measure against.
  check(
    "an undeclared scope checks nothing",
    scopeGate.check({
      scope: ["(undeclared)"],
      touched: ["src/b.js"],
      finish: { deviations: [] },
    }).ok,
    true,
  );
  check(
    "a run record with no scope at all checks nothing",
    scopeGate.check({
      scope: [],
      touched: ["src/b.js"],
      finish: { deviations: [] },
    }).ok,
    true,
  );

  // End to end through the runner, which is the only thing that proves the
  // runner picks this module by the name a role gives and hands it the paths
  // from the record rather than the paths the report claims.
  fs.writeFileSync(
    path.join(testedConfig, "modes", "roles", "scoped.md"),
    "---\nid: scoped\ndescription: Gated on shape and scope.\ntools: Write\ngates: finish-shape, scope\n---\n\nBody.\n",
  );
  const scopeRecord = path.join(testedConfig, "cache", "crew", "s4.jsonl");
  fs.appendFileSync(
    scopeRecord,
    JSON.stringify({
      kind: "run",
      token: "cafe0002",
      role: "scoped",
      scope: ["src/a.js"],
    }) + "\n",
  );
  fs.appendFileSync(
    scopeRecord,
    JSON.stringify({
      kind: "path",
      agentId: "scope-wired",
      path: "src/b.js",
    }) + "\n",
  );
  fs.appendFileSync(
    scopeRecord,
    JSON.stringify({
      kind: "path",
      agentId: "scope-excused",
      path: "src/b.js",
    }) + "\n",
  );
  const wiredReport =
    "Did it.\n\nRUN cafe0002\nSTATE done\nTOUCHED src/a.js\nEVIDENCE node tools/test-hooks.js";
  const wired = run(
    GATE_RUNNER,
    {
      hook_event_name: "SubagentStop",
      agent_id: "scope-wired",
      agent_type: "scoped",
      session_id: "s4",
      last_assistant_message: wiredReport,
      stop_hook_active: false,
    },
    workerEnv,
  );
  check(
    "a write outside the scope is blocked through the runner",
    wired.verdict,
    "BLOCK",
  );
  check(
    "the block through the runner names the path the record holds",
    reasonOf(wired).includes("src/b.js"),
    true,
  );
  // The scope reason asks for a Deviations line or an undone write; a closing
  // line saying the work needs no change would tell the worker to ignore it.
  check(
    "a scope refusal does not say the work needs no change",
    reasonOf(wired).includes("Nothing about the work"),
    false,
  );
  check(
    "a scope refusal asks for what its reason names",
    reasonOf(wired).includes("Do what the reason above asks"),
    true,
  );
  const wiredAgain = run(
    GATE_RUNNER,
    {
      hook_event_name: "SubagentStop",
      agent_id: "scope-wired",
      agent_type: "scoped",
      session_id: "s4",
      last_assistant_message: wiredReport,
      stop_hook_active: false,
    },
    workerEnv,
  );
  check(
    "a second scope refusal still asks for what its reason names",
    reasonOf(wiredAgain).includes("refused this report again") &&
      reasonOf(wiredAgain).includes("Do what the reason above asks"),
    true,
  );
  check(
    "a deviation in the report reaches the gate through the runner",
    run(
      GATE_RUNNER,
      {
        hook_event_name: "SubagentStop",
        agent_id: "scope-excused",
        agent_type: "scoped",
        session_id: "s4",
        last_assistant_message:
          wiredReport +
          "\n\nDeviations: src/b.js, the import followed the move",
        stop_hook_active: false,
      },
      workerEnv,
    ).verdict,
    "allow",
  );
}

header("The evidence gate: a claim of done against the commands that ran");
{
  // "Claimed a verification it never ran" is the failure this gate answers, and
  // the hard half of it is not the lie. It is the honest report written after
  // the suite ran and the code then changed again, and only the ordering of the
  // two catches that. So the gate reads two records no worker may write: the
  // evidence log, which hooks/evidence-log.js appends from real Bash calls, and
  // the run record's path lines, which say when the worker last wrote code.
  const evidenceGate = require(
    path.join(HOOKS, "subagent", "gates", "evidence.js"),
  );
  const GATE_RUNNER = path.join(HOOKS, "subagent-gate.js");
  // A gate that wrongly passes carries no reason, and reading `.includes` off
  // that would crash the suite where it should fail one case and carry on.
  const reasonOf = (result) => String((result && result.reason) || "");

  check("the gate is named evidence", evidenceGate.id, "evidence");
  check(
    "the gate refuses from verify: tested upward",
    evidenceGate.minimumVerify,
    "tested",
  );

  check(
    "a cited command that ran passes at claims: sourced",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
      log: [{ command: "node tools/test-hooks.js", at: 200 }],
      lastWriteAt: 100,
    }).ok,
    true,
  );
  check(
    "a cited command absent from the log fails at claims: sourced",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
      log: [],
      lastWriteAt: 100,
    }).ok,
    false,
  );
  check(
    "the same case passes at claims: labeled",
    evidenceGate.check({
      settings: { claims: "labeled" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
      log: [],
      lastWriteAt: 100,
    }).ok,
    true,
  );
  // The case that carries the gate: running the suite and then editing the code
  // is exactly the shape of a false completion claim that is not a lie.
  check(
    "a command that ran BEFORE the last write fails",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
      log: [{ command: "node tools/test-hooks.js", at: 50 }],
      lastWriteAt: 100,
    }).ok,
    false,
  );
  check(
    "STATE done with no evidence fails at claims: labeled",
    evidenceGate.check({
      settings: { claims: "labeled" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: [] },
      log: [],
      lastWriteAt: 100,
    }).ok,
    false,
  );
  check(
    "STATE blocked with no evidence passes",
    evidenceGate.check({
      settings: { claims: "labeled" },
      touched: ["hooks/a.js"],
      finish: { state: "blocked", evidence: [] },
      log: [],
      lastWriteAt: 100,
    }).ok,
    true,
  );
  check(
    "STATE rejected with no evidence passes",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: { state: "rejected", evidence: [] },
      log: [],
      lastWriteAt: 100,
    }).ok,
    true,
  );
  check(
    "a docs-only change needs no command",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["docs/hooks.md"],
      finish: { state: "done", evidence: [] },
      log: [],
      lastWriteAt: 100,
    }).ok,
    true,
  );
  check(
    "the failure quotes the command it could not find",
    reasonOf(
      evidenceGate.check({
        settings: { claims: "sourced" },
        touched: ["hooks/a.js"],
        finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
        log: [],
        lastWriteAt: 100,
      }),
    ).includes("node tools/test-hooks.js"),
    true,
  );
  check(
    "a report with no evidence at all names the code it claims to have proved",
    reasonOf(
      evidenceGate.check({
        settings: { claims: "sourced" },
        touched: ["hooks/a.js"],
        finish: { state: "done", evidence: [] },
        log: [],
        lastWriteAt: 100,
      }),
    ).includes("hooks/a.js"),
    true,
  );

  // The claims dial decides how much of this gate applies. At `loose` an
  // unlabelled claim is what the posture asks for, so there is nothing to check.
  check(
    "at claims: loose nothing is checked",
    evidenceGate.check({
      settings: { claims: "loose" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: [] },
      log: [],
      lastWriteAt: 100,
    }).ok,
    true,
  );
  // Every mode in modes/*.json sets `claims`, so a lock without one is damaged
  // or hand-written. It reads as the middle posture rather than the weakest,
  // because a gate that quietly checks nothing is the failure this design is
  // built to prevent.
  check(
    "a lock with no claims dial still asks for evidence",
    evidenceGate.check({
      settings: {},
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: [] },
      log: [],
      lastWriteAt: 100,
    }).ok,
    false,
  );
  check(
    "a lock with no claims dial does not read the log",
    evidenceGate.check({
      settings: {},
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
      log: [],
      lastWriteAt: 100,
    }).ok,
    true,
  );

  // What counts as runtime code, which is the only thing a command can verify.
  check(
    "a markdown file outside docs is not runtime code",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["README.md"],
      finish: { state: "done", evidence: [] },
      log: [],
      lastWriteAt: 100,
    }).ok,
    true,
  );
  check(
    "mode data is not runtime code",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["modes/build.json"],
      finish: { state: "done", evidence: [] },
      log: [],
      lastWriteAt: 100,
    }).ok,
    true,
  );
  check(
    "one runtime path beside prose still asks for a command",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["docs/hooks.md", "hooks/a.js"],
      finish: { state: "done", evidence: [] },
      log: [],
      lastWriteAt: 100,
    }).ok,
    false,
  );

  // How a citation is matched against the log. The log holds the command as the
  // harness executed it, which is routinely longer than the part the worker
  // means, so the executed text may contain the citation and never the reverse:
  // a citation that contains the executed command claims more than ran.
  check(
    "a cd prefix in the executed command still matches the citation",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
      log: [
        { command: "cd /tmp/work && node tools/test-hooks.js", at: 200 },
        { command: "git status", at: 150 },
      ],
      lastWriteAt: 100,
    }).ok,
    true,
  );
  check(
    "a citation claiming more than the log holds fails",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: {
        state: "done",
        evidence: ["node tools/test-hooks.js && npx prettier --check ."],
      },
      log: [{ command: "node tools/test-hooks.js", at: 200 }],
      lastWriteAt: 100,
    }).ok,
    false,
  );
  check(
    "extra whitespace in either text does not matter",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node  tools/test-hooks.js"] },
      log: [{ command: "node tools/test-hooks.js", at: 200 }],
      lastWriteAt: 100,
    }).ok,
    true,
  );
  // hooks/evidence-log.js cuts a command at 400 characters and flags it, so a
  // long citation can only ever match the front of what was stored.
  check(
    "a truncated log entry matches the citation it begins",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: {
        state: "done",
        evidence: ["node tools/test-hooks.js --filter=" + "x".repeat(500)],
      },
      log: [
        {
          command: "node tools/test-hooks.js --filter=" + "x".repeat(360),
          truncated: true,
          at: 200,
        },
      ],
      lastWriteAt: 100,
    }).ok,
    true,
  );
  check(
    "an untruncated entry the citation only begins does not match",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node tools/test-hooks.js --all"] },
      log: [{ command: "node tools/test-hooks.js", truncated: false, at: 200 }],
      lastWriteAt: 100,
    }).ok,
    false,
  );

  // A run that was cut short or came back non-zero proves nothing, whatever the
  // report says it proved. An unknown exit stays unknown: this harness reports
  // none at all (hooks/evidence-log.js), so treating null as failure would
  // refuse every honest report on it.
  check(
    "an interrupted run is not proof",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
      log: [
        { command: "node tools/test-hooks.js", interrupted: true, at: 200 },
      ],
      lastWriteAt: 100,
    }).ok,
    false,
  );
  check(
    "a run that exited non-zero is not proof",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
      log: [{ command: "node tools/test-hooks.js", exit: 1, at: 200 }],
      lastWriteAt: 100,
    }).ok,
    false,
  );
  check(
    "an unknown exit is still proof the command ran",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
      log: [{ command: "node tools/test-hooks.js", exit: null, at: 200 }],
      lastWriteAt: 100,
    }).ok,
    true,
  );

  // Ordering, case by case.
  check(
    "a re-run after the write excuses the earlier stale run",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
      log: [
        { command: "node tools/test-hooks.js", at: 50 },
        { command: "node tools/test-hooks.js", at: 200 },
      ],
      lastWriteAt: 100,
    }).ok,
    true,
  );
  check(
    "one stale citation among two fresh ones fails",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: {
        state: "done",
        evidence: ["node tools/test-hooks.js", "npx prettier --check ."],
      },
      log: [
        { command: "node tools/test-hooks.js", at: 200 },
        { command: "npx prettier --check .", at: 50 },
      ],
      lastWriteAt: 100,
    }).ok,
    false,
  );
  check(
    "the stale refusal quotes the command that went first",
    reasonOf(
      evidenceGate.check({
        settings: { claims: "sourced" },
        touched: ["hooks/a.js"],
        finish: {
          state: "done",
          evidence: ["node tools/test-hooks.js", "npx prettier --check ."],
        },
        log: [
          { command: "node tools/test-hooks.js", at: 200 },
          { command: "npx prettier --check .", at: 50 },
        ],
        lastWriteAt: 100,
      }),
    ).includes("npx prettier --check ."),
    true,
  );
  // A write and a command inside the same millisecond cannot be put in order,
  // so the benefit of the doubt goes to the worker.
  check(
    "a command in the same millisecond as the write is not stale",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
      log: [{ command: "node tools/test-hooks.js", at: 100 }],
      lastWriteAt: 100,
    }).ok,
    true,
  );
  // Both of these are older logs and older records rather than dishonest
  // reports, and a refusal a worker cannot act on is worse than a loose pass.
  check(
    "a log entry with no time is not called stale",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
      log: [{ command: "node tools/test-hooks.js" }],
      lastWriteAt: 100,
    }).ok,
    true,
  );
  check(
    "no last write time at all skips the ordering check",
    evidenceGate.check({
      settings: { claims: "sourced" },
      touched: ["hooks/a.js"],
      finish: { state: "done", evidence: ["node tools/test-hooks.js"] },
      log: [{ command: "node tools/test-hooks.js", at: 50 }],
      lastWriteAt: null,
    }).ok,
    true,
  );

  // End to end through the runner, which is the only thing that proves the
  // runner reads the evidence log, builds the last write time out of the run
  // record, and hands this gate a LIST of cited commands rather than one string.
  const sourcedConfig = fs.mkdtempSync(path.join(os.tmpdir(), "crew-sourced-"));
  const sourcedEnv = { CLAUDE_CONFIG_DIR: sourcedConfig };
  fs.writeFileSync(
    path.join(sourcedConfig, "mode.lock"),
    JSON.stringify({
      mode: "test",
      codename: "TESTER",
      settings: { verify: "tested", claims: "sourced" },
      deniedTools: [],
      subagents: null,
    }),
  );
  fs.mkdirSync(path.join(sourcedConfig, "modes", "roles"), { recursive: true });
  fs.writeFileSync(
    path.join(sourcedConfig, "modes", "roles", "sourced.md"),
    "---\nid: sourced\ndescription: Gated on shape and evidence.\ntools: Write\ngates: finish-shape, evidence\n---\n\nBody.\n",
  );

  const sourcedRecord = path.join(sourcedConfig, "cache", "crew", "s6.jsonl");
  fs.mkdirSync(path.dirname(sourcedRecord), { recursive: true });
  const appendRecord = (entry) =>
    fs.appendFileSync(sourcedRecord, JSON.stringify(entry) + "\n");
  appendRecord({
    kind: "run",
    token: "cafe0003",
    role: "sourced",
    scope: ["hooks/a.js"],
    at: "2026-09-18T11:58:00.000Z",
  });
  const wroteAt = (agentId, at) =>
    appendRecord({ kind: "path", agentId, path: "hooks/a.js", at });
  wroteAt("ev-fresh", "2026-09-18T11:59:00.000Z");
  wroteAt("ev-missing", "2026-09-18T11:59:00.000Z");
  wroteAt("ev-two", "2026-09-18T11:59:00.000Z");
  wroteAt("ev-last-line", "2026-09-18T11:59:00.000Z");
  wroteAt("ev-stale", "2026-09-18T12:05:00.000Z");

  const sourcedLog = path.join(sourcedConfig, "cache", "evidence", "s6.jsonl");
  fs.mkdirSync(path.dirname(sourcedLog), { recursive: true });
  for (const entry of [
    {
      command: "node tools/test-hooks.js",
      at: "2026-09-18T12:00:00.000Z",
      interrupted: false,
      exit: null,
    },
    {
      command: "npx prettier --check hooks",
      at: "2026-09-18T12:00:10.000Z",
      interrupted: false,
      exit: null,
    },
  ]) {
    fs.appendFileSync(sourcedLog, JSON.stringify(entry) + "\n");
  }

  const reported = (agentId, evidenceLines) =>
    run(
      GATE_RUNNER,
      {
        hook_event_name: "SubagentStop",
        agent_id: agentId,
        agent_type: "sourced",
        session_id: "s6",
        last_assistant_message:
          "Did it.\n\nRUN cafe0003\nSTATE done\nTOUCHED hooks/a.js\n" +
          evidenceLines,
        stop_hook_active: false,
      },
      sourcedEnv,
    );

  check(
    "a command the log holds passes through the runner",
    reported("ev-fresh", "EVIDENCE node tools/test-hooks.js").verdict,
    "allow",
  );
  const missing = reported("ev-missing", "EVIDENCE npx vitest run");
  check(
    "a command the log never saw is blocked through the runner",
    missing.verdict,
    "BLOCK",
  );
  check(
    "the block through the runner quotes the command",
    reasonOf(missing).includes("npx vitest run"),
    true,
  );
  check(
    "a command that ran before the record's last write is blocked",
    reported("ev-stale", "EVIDENCE node tools/test-hooks.js").verdict,
    "BLOCK",
  );
  // One EVIDENCE line citing two commands: a parser that handed the gate the
  // whole line as one string would find no command matching it and block, so
  // this passing is what proves the citation reaches the gate as a list.
  check(
    "two commands cited on one line are both checked",
    reported(
      "ev-two",
      "EVIDENCE node tools/test-hooks.js, npx prettier --check hooks",
    ).verdict,
    "allow",
  );
  // The parser's documented rule is that the last occurrence of a field wins, so
  // a second EVIDENCE line replaces the first rather than adding to it. Pinned
  // here because this gate is the first thing that reads the field.
  const lastLine = reported(
    "ev-last-line",
    "EVIDENCE node tools/test-hooks.js\nEVIDENCE npx vitest run",
  );
  check("a second EVIDENCE line replaces the first", lastLine.verdict, "BLOCK");
  check(
    "the block names the command on the last line",
    reasonOf(lastLine).includes("npx vitest run"),
    true,
  );

  fs.rmSync(sourcedConfig, { recursive: true, force: true });
}

{
  // The blind review gate. A reviewer worker sees the diff and never the brief,
  // because a reviewer told what the change was meant to do argues toward it.
  //
  // The sharpest finding in the survey is what this gate must NOT be asked to
  // do: on false completion claims no model-judge configuration exceeded an
  // AUROC of 0.65 (the area under the receiver operating characteristic curve,
  // a 0.5-to-1 score where 0.5 is a coin flip), because judges anchor on
  // confident closing language, which is exactly what a false success produces.
  // So this gate judges code quality and the evidence gate judges claims.
  const blindReview = require(path.join(HOOKS, "lib", "blind-review.js"));

  check(
    "the review gate asks for a diff and nothing else",
    blindReview
      .buildPrompt({
        diff: "--- a/src/a.js\n+++ b/src/a.js\n+const x = 1;",
        brief: "SECRET BRIEF TEXT",
      })
      .includes("SECRET BRIEF TEXT"),
    false,
  );
  check(
    "the review prompt carries the diff",
    blindReview
      .buildPrompt({
        diff: "+const x = 1;",
        brief: "b",
      })
      .includes("+const x = 1;"),
    true,
  );
  check(
    "a review finding does not block on its own",
    blindReview.interpret({
      findings: [{ severity: "Nit", text: "name it better" }],
    }).ok,
    true,
  );
  check(
    "a blocking severity blocks",
    blindReview.interpret({
      findings: [{ severity: "Blocking", text: "this drops the error" }],
    }).ok,
    false,
  );
  // The advisory labels are matched the way a reviewer actually writes them, so
  // the `Nit:` of the role file's own wording is the same severity as `nit`.
  check(
    "an advisory label survives its trailing colon and its case",
    blindReview.interpret({
      findings: [{ severity: "nit:", text: "name it better" }],
    }).ok,
    true,
  );
  // Fail-closed on vocabulary: the list names what ships, so anything off it
  // blocks. A finding with no severity at all is the case that matters, because
  // it is what a reviewer produces when it forgets the labelling instruction,
  // and reading that as advisory would let the gate quietly stop working.
  check(
    "a finding with no severity blocks",
    blindReview.interpret({ findings: [{ text: "this drops the error" }] }).ok,
    false,
  );
  // From the survey's mechanism 3: a guardrail that silently degrades to "no
  // reviewer, therefore fine" is worse than no guardrail at all.
  check(
    "no reviewer available is a gate failure, not a pass",
    blindReview.interpret(null).ok,
    false,
  );
  // A clean review says so by coming back with an empty list of findings. An
  // answer with no list at all is a malformed review rather than a quiet
  // approval, and reading it as approval is the same silent degradation the
  // case above exists to prevent.
  check(
    "a review with no findings list is not a clean review",
    blindReview.interpret({}).ok,
    false,
  );
  check(
    "a review that found nothing passes",
    blindReview.interpret({ findings: [] }).ok,
    true,
  );
  check(
    "the review prompt asks for one finding per labelled line",
    blindReview.buildPrompt({ diff: "x" }).includes("`Blocking:`"),
    true,
  );
  check(
    "the review prompt names the clean line",
    blindReview.buildPrompt({ diff: "x" }).includes("Findings: none"),
    true,
  );
  check(
    "a Blocking line is read as a blocking finding",
    JSON.stringify(blindReview.parseFindings("Blocking: drops the error")),
    JSON.stringify([{ severity: "Blocking", text: "drops the error" }]),
  );
  check(
    "a lower-case label is read under its canonical spelling",
    JSON.stringify(blindReview.parseFindings("nit: rename rows")),
    JSON.stringify([{ severity: "Nit", text: "rename rows" }]),
  );
  check(
    "every finding line in a report is read",
    blindReview.parseFindings(
      "Intro.\nOptional: split it\nFYI: tests not read\nBlocking: leaks",
    ).length,
    3,
  );
  check(
    "Findings: none alone is a clean review",
    JSON.stringify(
      blindReview.parseFindings("Looked at all of it.\nFindings: none"),
    ),
    "[]",
  );
  check(
    "a finding line beside Findings: none still counts",
    blindReview.parseFindings("Findings: none\nBlocking: leaks").length,
    1,
  );
  check(
    "a report with no finding line and no clean line is unreadable",
    blindReview.parseFindings("Looks fine to me."),
    null,
  );
  check(
    "a report written only in an unknown label is unreadable",
    blindReview.parseFindings("Critical: this leaks"),
    null,
  );
  check(
    "a label in the middle of a sentence is not a finding",
    blindReview.parseFindings("I would call this Blocking: maybe."),
    null,
  );
  check(
    "a parsed clean review passes interpret",
    blindReview.interpret({
      findings: blindReview.parseFindings("Findings: none"),
    }).ok,
    true,
  );
  check(
    "a parsed blocking review fails interpret",
    blindReview.interpret({
      findings: blindReview.parseFindings("Blocking: leaks"),
    }).ok,
    false,
  );
}

// --- the conformance log: what a real dispatch confirmed about this harness ---
//
// Every gate in this design rests on something measured about Claude Code once,
// on one build. The reader below turns the run record into a verdict per
// assumption, so a harness update that breaks one shows up as "contradicted"
// rather than as a gate that quietly stops firing.
{
  const conformance = require(path.join(__dirname, "conformance.js"));

  check(
    "an unobserved assumption reads not yet observed",
    conformance.summarise([])[0].state,
    "not yet observed",
  );
  const stateOf = (entries, id) =>
    conformance.summarise(entries).find((row) => row.id === id).state;

  check(
    "a token returned in the report confirms updatedInput",
    stateOf(
      [
        { kind: "run", token: "abcd1234" },
        {
          kind: "finish",
          point: "SubagentStop",
          token: "abcd1234",
          tokenSource: "report",
          build: "2.1.273",
        },
      ],
      "updated-input",
    ),
    "confirmed",
  );
  check(
    "a token read from the transcript also confirms updatedInput",
    stateOf(
      [
        { kind: "run", token: "abcd1234" },
        {
          kind: "finish",
          point: "SubagentHandback",
          token: "abcd1234",
          tokenSource: "transcript",
          transcriptFound: true,
          build: "2.1.273",
        },
      ],
      "updated-input",
    ),
    "confirmed",
  );
  // A token no dispatch minted proves nothing about updatedInput: a worker that
  // invents eight hex characters would otherwise confirm the assumption for it.
  check(
    "a token no run minted confirms nothing",
    stateOf(
      [
        { kind: "run", token: "abcd1234" },
        {
          kind: "finish",
          point: "SubagentStop",
          token: "ffffffff",
          tokenSource: "report",
          build: "2.1.273",
        },
      ],
      "updated-input",
    ),
    "not yet observed",
  );
  check(
    "a finish with no token anywhere contradicts updatedInput",
    stateOf(
      [
        { kind: "run", token: "abcd1234" },
        {
          kind: "finish",
          point: "SubagentStop",
          token: null,
          tokenSource: null,
          transcriptFound: true,
          transcriptRead: true,
          build: "2.1.273",
        },
      ],
      "updated-input",
    ),
    "contradicted",
  );
  // A transcript that was there and held nothing readable is not the harness
  // dropping the prompt: a prompt longer than the gate's prefix read leaves no
  // parseable line, and blaming the harness for that would be a false alarm.
  check(
    "a transcript nothing could be read from contradicts nothing",
    stateOf(
      [
        { kind: "run", token: "abcd1234" },
        {
          kind: "finish",
          point: "SubagentStop",
          token: null,
          tokenSource: null,
          transcriptFound: true,
          transcriptRead: false,
          build: "2.1.273",
        },
      ],
      "updated-input",
    ),
    "not yet observed",
  );
  // A missing transcript is not evidence about the token: the file that would
  // have carried it was never there, which is the other assumption's business.
  check(
    "a missing transcript contradicts nothing about the token",
    stateOf(
      [
        { kind: "run", token: "abcd1234" },
        {
          kind: "finish",
          point: "SubagentHandback",
          token: null,
          tokenSource: null,
          transcriptFound: false,
        },
      ],
      "updated-input",
    ),
    "not yet observed",
  );
  check(
    "the build is carried through",
    conformance
      .summarise([
        { kind: "run", token: "a" },
        {
          kind: "finish",
          point: "SubagentStop",
          token: "a",
          tokenSource: "report",
          build: "2.1.273",
        },
      ])
      .find((row) => row.id === "updated-input").build,
    "2.1.273",
  );
  check(
    "a path line confirms agent_id",
    stateOf([{ kind: "path", agentId: "a1" }], "agent-id"),
    "confirmed",
  );
  check(
    "a token parsed from a hand-back report confirms the report arrives",
    stateOf(
      [
        {
          kind: "finish",
          point: "SubagentHandback",
          token: "a",
          tokenSource: "report",
        },
      ],
      "report-arrives",
    ),
    "confirmed",
  );
  // The record spells a gate's decision as a mark, so the reader reads marks.
  check(
    "a delivery after a hand-back refusal confirms the retry",
    stateOf(
      [
        {
          kind: "mark",
          agentId: "a1",
          mark: "refusal",
          point: "SubagentHandback",
        },
        { kind: "mark", agentId: "a1", mark: "delivered" },
      ],
      "handback-retry",
    ),
    "confirmed",
  );
  // A delivery with no refusal before it is the ordinary case and says nothing
  // about whether a denied hand-back is ever retried.
  check(
    "a delivery on its own does not confirm the retry",
    stateOf(
      [{ kind: "mark", agentId: "a1", mark: "delivered" }],
      "handback-retry",
    ),
    "not yet observed",
  );
  // Only a hand-back answers the layout question. At the stop the harness hands
  // over `agent_transcript_path` itself, so a transcript found there says
  // nothing about the path this design derives beside the parent's.
  check(
    "a transcript found at the stop says nothing about the derived path",
    stateOf(
      [
        {
          kind: "finish",
          point: "SubagentStop",
          token: null,
          tokenSource: null,
          transcriptFound: true,
        },
      ],
      "transcript-layout",
    ),
    "not yet observed",
  );
  check(
    "a missing derived transcript contradicts the layout",
    stateOf(
      [
        {
          kind: "finish",
          point: "SubagentHandback",
          token: null,
          tokenSource: null,
          transcriptFound: false,
        },
      ],
      "transcript-layout",
    ),
    "contradicted",
  );
  // Later evidence wins. A harness that changes back, or an assumption broken
  // only on one build, would otherwise read as permanently contradicted.
  check(
    "a later observation replaces an earlier verdict",
    stateOf(
      [
        { kind: "run", token: "abcd1234" },
        {
          kind: "finish",
          point: "SubagentStop",
          token: null,
          tokenSource: null,
          transcriptFound: true,
          build: "2.1.272",
        },
        {
          kind: "finish",
          point: "SubagentStop",
          token: "abcd1234",
          tokenSource: "report",
          build: "2.1.273",
        },
      ],
      "updated-input",
    ),
    "confirmed",
  );
  // Whether a role's tools: list actually restricts a worker cannot be answered
  // from this record: a path line records neither the tool that wrote it nor the
  // worker's role. Tracking it would report an untested assumption as confirmed.
  check(
    "the tool restriction is not tracked",
    conformance.summarise([]).some((row) => row.id === "tools-restrict"),
    false,
  );
}

// --- the gate runner writes the finish line the reader counts -----------------
{
  const GATE_FINISH = path.join(HOOKS, "subagent-gate.js");
  const finishes = (sessionId) =>
    readTextOrEmpty(
      path.join(testedConfig, "cache", "crew", sessionId + ".jsonl"),
    )
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line))
      .filter((line) => line.kind === "finish");

  const workerTranscriptAt = (agentId) =>
    path.join(
      testedConfig,
      "projects",
      "s7",
      "subagents",
      `agent-${agentId}.jsonl`,
    );
  const writeTranscriptAt = (agentId) => {
    fs.mkdirSync(path.dirname(workerTranscriptAt(agentId)), {
      recursive: true,
    });
    fs.writeFileSync(
      workerTranscriptAt(agentId),
      JSON.stringify({
        type: "user",
        version: "2.1.273",
        message: {
          role: "user",
          content: "Scope: src/a.js\nFix it.\n\nRUN abcd1234",
        },
      }) + "\n",
    );
  };

  const logRecord = path.join(testedConfig, "cache", "crew", "s7.jsonl");
  fs.mkdirSync(path.dirname(logRecord), { recursive: true });
  fs.writeFileSync(
    logRecord,
    JSON.stringify({
      kind: "run",
      token: "abcd1234",
      role: "implementer",
      scope: ["src/a.js"],
    }) + "\n",
  );

  writeTranscriptAt("log-shaped");
  run(
    GATE_FINISH,
    {
      hook_event_name: "SubagentStop",
      agent_id: "log-shaped",
      agent_type: "implementer",
      session_id: "s7",
      last_assistant_message:
        "Did it.\n\nRUN abcd1234\nSTATE done\nTOUCHED src/a.js\nEVIDENCE node tools/test-hooks.js",
      agent_transcript_path: workerTranscriptAt("log-shaped"),
      stop_hook_active: false,
    },
    workerEnv,
  );
  const shapedFinish = finishes("s7").find(
    (line) => line.agentId === "log-shaped",
  );
  check("a report read at the stop is recorded", Boolean(shapedFinish), true);
  check(
    "the finish records the token the report carried",
    shapedFinish && shapedFinish.token,
    "abcd1234",
  );
  check(
    "the finish records where the token came from",
    shapedFinish && shapedFinish.tokenSource,
    "report",
  );
  check(
    "the finish records the build from the worker transcript",
    shapedFinish && shapedFinish.build,
    "2.1.273",
  );
  check(
    "the finish records which point the report arrived at",
    shapedFinish && shapedFinish.point,
    "SubagentStop",
  );

  // A prose-only report leaves the token out, and the transcript still has it.
  writeTranscriptAt("log-prose");
  run(
    GATE_FINISH,
    {
      hook_event_name: "SubagentStop",
      agent_id: "log-prose",
      agent_type: "implementer",
      session_id: "s7",
      last_assistant_message: "All done, everything works.",
      agent_transcript_path: workerTranscriptAt("log-prose"),
      stop_hook_active: false,
    },
    workerEnv,
  );
  const proseFinish = finishes("s7").find(
    (line) => line.agentId === "log-prose",
  );
  check(
    "a token found only in the transcript is recorded as such",
    proseFinish && proseFinish.tokenSource,
    "transcript",
  );
  check(
    "the transcript that carried it is recorded as found",
    proseFinish && proseFinish.transcriptFound,
    true,
  );
  check(
    "the transcript that carried it is recorded as read",
    proseFinish && proseFinish.transcriptRead,
    true,
  );

  // A dispatch prompt longer than the gate's prefix read leaves no whole line
  // inside it, so nothing parses. The file was still there, and the record has
  // to keep those two facts apart: read as "the prompt never arrived" this
  // would have the conformance log report harness drift over a long prompt.
  {
    const agentId = "log-oversized";
    fs.mkdirSync(path.dirname(workerTranscriptAt(agentId)), {
      recursive: true,
    });
    fs.writeFileSync(
      workerTranscriptAt(agentId),
      JSON.stringify({
        type: "user",
        version: "2.1.273",
        message: {
          role: "user",
          content: "x".repeat(200 * 1024) + "\\n\\nRUN abcd1234",
        },
      }) + "\n",
    );
    run(
      GATE_FINISH,
      {
        hook_event_name: "SubagentStop",
        agent_id: agentId,
        agent_type: "implementer",
        session_id: "s7",
        last_assistant_message: "All done, everything works.",
        agent_transcript_path: workerTranscriptAt(agentId),
        stop_hook_active: false,
      },
      workerEnv,
    );
    const oversizedFinish = finishes("s7").find(
      (line) => line.agentId === agentId,
    );
    check(
      "a transcript too long to scan is still recorded as found",
      oversizedFinish && oversizedFinish.transcriptFound,
      true,
    );
    check(
      "a transcript too long to scan is recorded as unread",
      oversizedFinish && oversizedFinish.transcriptRead,
      false,
    );
    check(
      "a transcript too long to scan yields no token",
      oversizedFinish && oversizedFinish.token,
      null,
    );
  }

  // A hand-back whose derived transcript is not there: the layout assumption is
  // the one this case exists to contradict, and nothing may read as confirmed.
  run(
    GATE_FINISH,
    {
      hook_event_name: "PreToolUse",
      tool_name: "SubagentHandback",
      agent_id: "log-missing",
      agent_type: "implementer",
      session_id: "s7",
      transcript_path: path.join(testedConfig, "projects", "s7.jsonl"),
      tool_input: { message: "All done." },
    },
    workerEnv,
  );
  const missingFinish = finishes("s7").find(
    (line) => line.agentId === "log-missing",
  );
  check(
    "a hand-back with no transcript records it missing",
    missingFinish && missingFinish.transcriptFound,
    false,
  );
  check(
    "a missing transcript carries no build",
    missingFinish && missingFinish.build,
    null,
  );
  check(
    "a missing transcript is recorded as unread",
    missingFinish && missingFinish.transcriptRead,
    false,
  );
}

fs.rmSync(repo, { recursive: true, force: true });
fs.rmSync(testedConfig, { recursive: true, force: true });
fs.rmSync(noneConfig, { recursive: true, force: true });
fs.rmSync(captureHome, { recursive: true, force: true });
fs.rmSync(captureRepository, { recursive: true, force: true });
console.log(`\ntemp repo removed; live marker cache untouched`);
console.log(`\nPASS ${passed}  SKIP ${skipped}  FAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
