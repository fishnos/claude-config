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
    bash(
      'CLAUDE_ALLOW_COMMIT=1 git commit -m "Added a calculator helper."',
      repo,
    ),
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
  const r = run(
    GUARD,
    bash('CLAUDE_ALLOW_COMMIT=1 git commit -m "Add a calculator helper"', repo),
  );
  check("tests staged + good subject -> silent", r.verdict, "allow", r.reason);
}

header("PreToolUse(Bash) -- staged secret");
write("src/config.ts", `export const KEY = '${AWS_KEY}';\n`);
git(["add", "src/config.ts"], repo);
{
  const r = run(
    GUARD,
    bash('CLAUDE_ALLOW_COMMIT=1 git commit -m "Add config"', repo),
  );
  check("AWS key in staged diff", r.verdict, "DENY", r.reason);
}

header("PreToolUse(Bash) -- amend still scans for secrets");
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
  let r = run(GUARD, bash("CLAUDE_ALLOW_COMMIT=1 git commit -F bad.txt", repo));
  check("-F with bad subject now warns", r.verdict, "warn", r.reason);

  fs.writeFileSync(
    path.join(repo, "ok.txt"),
    "Add a thing\n\nBecause of reasons.\n",
  );
  r = run(GUARD, bash("CLAUDE_ALLOW_COMMIT=1 git commit -F ok.txt", repo));
  check("-F with good subject stays silent", r.verdict, "allow", r.reason);

  r = run(GUARD, bash("CLAUDE_ALLOW_COMMIT=1 git commit -F absent.txt", repo));
  check("-F with missing file stays silent", r.verdict, "allow", r.reason);

  r = run(GUARD, bash("CLAUDE_ALLOW_COMMIT=1 git commit --fixup=HEAD", repo));
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

header("PreToolUse(Bash) -- commit is blocked without the escape");
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

header("PreToolUse(Bash) -- git global options must not bypass the guard");
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

header("PreToolUse(Bash) -- outward-facing commands are blocked");
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

header("PreToolUse(Bash) -- outward escapes are per-family, not blanket");
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

header(
  "PreToolUse(Bash) -- outward false-positive guard (these run constantly)",
);
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

header("PreToolUse(Bash) -- outward warnings");
for (const [label, command] of [
  ["gh pr create", "gh pr create --title x --body y"],
  ["gh repo create", "gh repo create thing --public"],
]) {
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check(label, verdict, "warn", reason);
}

header("PreToolUse(Bash) -- separators inside quotes are not separators");
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

header("PreToolUse(Bash) -- a warning must never cut short the deny scan");
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

header("PostToolUse(Bash) -- evidence log");
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

header("SessionStart -- config-sentinel");
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

  for (const home of temporaryHomes)
    fs.rmSync(home, { recursive: true, force: true });
}

header("UserPromptSubmit -- repo-context");
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

header("ccfg -- secret migration and doctor");
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
  check(
    "secrets file is not world-readable",
    fs.existsSync(secretsFile) && (fs.statSync(secretsFile).mode & 0o077) === 0
      ? "allow"
      : "TOO OPEN",
    "allow",
    "",
  );
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

header("PostToolUse(Bash) -- evidence log is size-capped");
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

header("ccfg -- clean, backup and install");
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
  check(
    "the shim is executable",
    fs.existsSync(shim) && fs.statSync(shim).mode & 0o111 ? true : false,
    true,
    "",
  );
  check(
    "install writes the shell shim",
    fs.existsSync(path.join(configDir, "shell-init.sh"))
      ? "present"
      : "missing",
    "present",
    "",
  );
  // The shim must launch the real CLI, not just exist.
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

  fs.rmSync(home, { recursive: true, force: true });
}

header("ccfg -- secrets never reach argv, and backups get scrubbed");
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
  // A backup taken while the key was still plaintext -- the case migration alone
  // cannot fix, because it rewrites only the live file.
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

header("Credential reads -- the Read deny rules do not bind Bash");

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
