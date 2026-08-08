"use strict";

// Regression suite for the three standards hooks.
//
// Runs on macOS, Linux and Windows: no shell invocations, no POSIX-only paths, and
// the hooks are spawned with process.execPath rather than a `node` on PATH.
// Usage: node ~/.claude/hooks/test-hooks.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOOKS = __dirname;
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

function bash(command, cwd) {
  return { tool_name: "Bash", cwd, tool_input: { command } };
}

function header(title) {
  console.log("\n" + "=".repeat(72) + "\n" + title + "\n" + "=".repeat(72));
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

header("PreToolUse(Bash) -- blocking cases");
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

header("PreToolUse(Bash) -- env-prefix must not bypass the guard");
for (const [label, command] of [
  ["unrelated env var before push", "FOO=1 " + PUSH],
  ["env var before force-push", "DEBUG=true " + PUSH + " --force"],
  ["sudo before reset --hard", "sudo " + HARD],
  ["env wrapper before clean", "env " + CLEAN],
]) {
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(label, verdict, "DENY", reason);
}

header("PreToolUse(Bash) -- cmd.exe chaining");
for (const [label, command] of [
  ["single & chain (cmd.exe) before push", "dir & " + PUSH],
  ["single & chain before reset --hard", "echo hi & " + HARD],
]) {
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(label, verdict, "DENY", reason);
}

header("PreToolUse(Bash) -- push escape hatch");
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

header("PreToolUse(Bash) -- must NOT block (false-positive guard)");
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

header("PreToolUse(Bash) -- commit warnings");
write(
  "src/calc.ts",
  "export function add(a: number, b: number) {\n  return a + b;\n}\n",
);
git(["add", "src/calc.ts"], repo);
{
  const r = run(
    GUARD,
    bash('git commit -m "Added a calculator helper."', repo),
  );
  check("logic staged, no tests + bad subject", r.verdict, "warn", r.reason);
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
  const r = run(GUARD, bash('git commit -m "Add a calculator helper"', repo));
  check("tests staged + good subject -> silent", r.verdict, "allow", r.reason);
}

header("PreToolUse(Bash) -- staged secret");
write("src/config.ts", `export const KEY = '${AWS_KEY}';\n`);
git(["add", "src/config.ts"], repo);
{
  const r = run(GUARD, bash('git commit -m "Add config"', repo));
  check("AWS key in staged diff", r.verdict, "DENY", r.reason);
}

header("PreToolUse(Bash) -- amend still scans for secrets");
git(["reset", "-q"], repo);
write("src/creds.ts", `export const T = '${GH_TOKEN}';\n`);
git(["add", "src/creds.ts"], repo);
{
  const r = run(GUARD, bash("git commit --amend --no-edit", repo));
  check("secret staged behind --amend", r.verdict, "DENY", r.reason);
}
git(["reset", "-q"], repo);
write("src/plain.ts", "export const N = 1;\n");
git(["add", "src/plain.ts"], repo);
{
  const r = run(GUARD, bash("git commit --amend --no-edit", repo));
  check("clean amend -> no test/size nagging", r.verdict, "allow", r.reason);
}

header("PostToolUse(Edit|Write) -- style check");
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

header("Stop -- self-review reminder");
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

header("commit-message -- lint() policy");
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
    lint("# comment\nAdd a thing").length === 0 ? "ok" : "problems",
    "ok",
    JSON.stringify(lint("# comment\nAdd a thing")),
  );
  check("empty message flagged", has("", "empty") ? "ok" : "missed", "ok");
}

header("commit-message -- extract() sources");
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
}

header("PreToolUse(Bash) -- message passed by file is linted");
{
  git(["reset", "-q"], repo);
  write("src/lint.ts", "export const q = 1;\n");
  write("src/__tests__/lint.test.ts", "test('x', () => {});\n");
  git(["add", "src/lint.ts", "src/__tests__/lint.test.ts"], repo);

  fs.writeFileSync(
    path.join(repo, "bad.txt"),
    "Added a thing that should have been imperative.\n",
  );
  let r = run(GUARD, bash("git commit -F bad.txt", repo));
  check("-F with bad subject now warns", r.verdict, "warn", r.reason);

  fs.writeFileSync(
    path.join(repo, "ok.txt"),
    "Add a thing\n\nBecause of reasons.\n",
  );
  r = run(GUARD, bash("git commit -F ok.txt", repo));
  check("-F with good subject stays silent", r.verdict, "allow", r.reason);

  r = run(GUARD, bash("git commit -F absent.txt", repo));
  check("-F with missing file stays silent", r.verdict, "allow", r.reason);

  r = run(GUARD, bash("git commit --fixup=HEAD", repo));
  check("--fixup not linted", r.verdict, "allow", r.reason);
}

header("hook-io -- output integrity");
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

header("Malformed input -- must never block");
for (const [label, payload] of [
  ["empty object", {}],
  ["no tool_input", { tool_name: "Bash" }],
  ["non-Bash tool", { tool_name: "Read", tool_input: { file_path: "/x" } }],
]) {
  const { verdict, reason, code } = run(GUARD, payload);
  check(`${label} (exit ${code})`, verdict, "allow", reason);
}

fs.rmSync(repo, { recursive: true, force: true });
console.log(`\ntemp repo removed; live marker cache untouched`);
console.log(`\nPASS ${passed}  FAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
