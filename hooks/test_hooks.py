#!/usr/bin/env python3
"""Exercise the three installed hooks against realistic inputs."""

import json
import os
import subprocess
import tempfile
import shutil
import textwrap

HOME = os.path.expanduser("~")
GUARD = f"{HOME}/.claude/hooks/git-guard.py"
STYLE = f"{HOME}/.claude/hooks/style-check.py"
STOP = f"{HOME}/.claude/hooks/review-reminder.py"

PUSH = "git" + " push"          # assembled so this file's own text is not a literal
NOVERIFY = "git" + " commit --no-verify -m 'x'"
HARD = "git" + " reset --hard HEAD~1"
CLEAN = "git" + " clean -fd"


def run(script, payload, env=None):
    done = subprocess.run(
        ["python3", script], input=json.dumps(payload), capture_output=True, text=True,
        timeout=30, env={**os.environ, **(env or {})},
    )
    out = done.stdout.strip()
    verdict = "allow"
    reason = ""
    if out:
        try:
            data = json.loads(out)
            spec = data.get("hookSpecificOutput", {})
            if spec.get("permissionDecision") == "deny":
                verdict, reason = "DENY", spec["permissionDecisionReason"]
            elif spec.get("additionalContext"):
                verdict, reason = "warn", spec["additionalContext"]
            elif data.get("decision") == "block":
                verdict, reason = "BLOCK", data["reason"]
        except json.JSONDecodeError:
            verdict, reason = "?raw", out
    return verdict, reason, done.returncode


def bash(cmd, cwd):
    return {"tool_name": "Bash", "cwd": cwd, "tool_input": {"command": cmd}}


def header(title):
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def check(label, verdict, expected, reason=""):
    ok = "PASS" if verdict == expected else "**FAIL**"
    print(f"[{ok}] {label:<52} -> {verdict}")
    if verdict != expected:
        print(f"        expected {expected}; reason: {reason[:200]}")


repo = tempfile.mkdtemp(prefix="hooktest-")
subprocess.run(["git", "init", "-q", repo], check=True)
subprocess.run(["git", "-C", repo, "config", "user.email", "t@t.t"], check=True)
subprocess.run(["git", "-C", repo, "config", "user.name", "T"], check=True)
os.makedirs(f"{repo}/src", exist_ok=True)

header("PreToolUse(Bash) -- blocking cases")
for label, cmd, expected in [
    ("plain push", PUSH + " origin main", "DENY"),
    ("push after a passing test", "npm test && " + PUSH, "DENY"),
    ("force push", PUSH + " --force origin main", "DENY"),
    ("commit --no-verify", NOVERIFY, "DENY"),
    ("reset --hard", HARD, "DENY"),
    ("clean -fd", CLEAN, "DENY"),
]:
    verdict, reason, _ = run(GUARD, bash(cmd, repo))
    check(label, verdict, expected, reason)

header("PreToolUse(Bash) -- env-prefix must not bypass the guard")
for label, cmd in [
    ("unrelated env var before push", "FOO=1 " + PUSH),
    ("env var before force-push", "DEBUG=true " + PUSH + " --force"),
    ("sudo before reset --hard", "sudo " + HARD),
    ("env wrapper before clean", "env " + CLEAN),
]:
    verdict, reason, _ = run(GUARD, bash(cmd, repo))
    check(label, verdict, "DENY", reason)

header("PreToolUse(Bash) -- push escape hatch")
verdict, reason, _ = run(GUARD, bash("CLAUDE_ALLOW_PUSH=1 " + PUSH + " origin main", repo))
check("explicit escape allows a plain push", verdict, "allow", reason)

verdict, reason, _ = run(GUARD, bash("CLAUDE_ALLOW_PUSH=1 " + PUSH + " --force origin main", repo))
check("escape does NOT permit force-push", verdict, "DENY", reason)

verdict, reason, _ = run(GUARD, bash("CLAUDE_ALLOW_PUSH=0 " + PUSH + " origin main", repo))
check("wrong escape value still blocks", verdict, "DENY", reason)

header("PreToolUse(Bash) -- must NOT block (false-positive guard)")
for label, cmd in [
    ("git status", "git status"),
    ("git log", "git log --oneline -20"),
    ("echoing the command as a string", f'echo "how to: {PUSH} origin main"'),
    ("grepping docs for the phrase", f"grep -r '{PUSH}' docs/"),
    ("writing it inside a heredoc", f"cat <<'EOF' > notes.md\nRun {PUSH} yourself.\nEOF"),
    ("a python file that mentions it", f"python3 -c \"print('{PUSH}')\""),
    ("npm run build", "npm run build"),
]:
    verdict, reason, _ = run(GUARD, bash(cmd, repo))
    check(label, verdict, "allow", reason)

header("PreToolUse(Bash) -- commit warnings")
with open(f"{repo}/src/calc.ts", "w") as f:
    f.write("export function add(a: number, b: number) {\n  return a + b;\n}\n")
subprocess.run(["git", "-C", repo, "add", "src/calc.ts"], check=True)

verdict, reason, _ = run(GUARD, bash('git commit -m "Added a calculator helper."', repo))
check("logic staged, no tests + bad subject", verdict, "warn", reason)
print(textwrap.indent(reason, "        "))

os.makedirs(f"{repo}/src/__tests__", exist_ok=True)
with open(f"{repo}/src/__tests__/calc.test.ts", "w") as f:
    f.write("test('adds', () => { expect(1).toBe(1) })\n")
subprocess.run(["git", "-C", repo, "add", "src/__tests__/calc.test.ts"], check=True)
verdict, reason, _ = run(GUARD, bash('git commit -m "Add a calculator helper"', repo))
check("tests staged + good subject -> silent", verdict, "allow", reason)

header("PreToolUse(Bash) -- staged secret")
with open(f"{repo}/src/config.ts", "w") as f:
    # Split so this fixture is not itself a literal the scanner flags when committed.
    f.write("export const KEY = '" + "AKIA" + "IOSFODNN7EXAMPLE';\n")
subprocess.run(["git", "-C", repo, "add", "src/config.ts"], check=True)
verdict, reason, _ = run(GUARD, bash('git commit -m "Add config"', repo))
check("AWS key in staged diff", verdict, "DENY", reason)
print(textwrap.indent(reason, "        "))

header("PreToolUse(Bash) -- amend still scans for secrets")
subprocess.run(["git", "-C", repo, "reset", "-q"], check=True)
with open(f"{repo}/src/creds.ts", "w") as f:
    f.write("export const T = 'ghp_" + "a" * 36 + "';\n")
subprocess.run(["git", "-C", repo, "add", "src/creds.ts"], check=True)
verdict, reason, _ = run(GUARD, bash("git commit --amend --no-edit", repo))
check("secret staged behind --amend", verdict, "DENY", reason)

subprocess.run(["git", "-C", repo, "reset", "-q"], check=True)
with open(f"{repo}/src/plain.ts", "w") as f:
    f.write("export const N = 1;\n")
subprocess.run(["git", "-C", repo, "add", "src/plain.ts"], check=True)
verdict, reason, _ = run(GUARD, bash("git commit --amend --no-edit", repo))
check("clean amend -> no test/size nagging", verdict, "allow", reason)

header("PostToolUse(Edit|Write) -- style check")
bad_ts = f"{repo}/src/bad.ts"
with open(bad_ts, "w") as f:
    f.write(
        "// @ts-ignore\n"
        "var count = 0;\n"
        "if (count == '0') { count = 1; }\n"
        "describe.only('suite', () => {});\n"
    )
verdict, reason, _ = run(STYLE, {"tool_name": "Write", "tool_input": {"file_path": bad_ts}})
check("ts-ignore + var + == + .only", verdict, "warn", reason)
print(textwrap.indent(reason, "        "))

good_ts = f"{repo}/src/good.ts"
with open(good_ts, "w") as f:
    f.write("const count = 0;\nexport function value(): number {\n  return count;\n}\n")
verdict, reason, _ = run(STYLE, {"tool_name": "Write", "tool_input": {"file_path": good_ts}})
check("clean file -> silent", verdict, "allow", reason)

bad_py = f"{repo}/src/bad.py"
with open(bad_py, "w") as f:
    f.write("def f(items=[]):\n    try:\n        pass\n    except:\n        pass\n")
verdict, reason, _ = run(STYLE, {"tool_name": "Write", "tool_input": {"file_path": bad_py}})
check("bare except + mutable default", verdict, "warn", reason)

verdict, reason, _ = run(STYLE, {"tool_name": "Write", "tool_input": {"file_path": f"{repo}/README.md"}})
check("markdown ignored", verdict, "allow", reason)

header("Stop -- self-review reminder")
transcript = f"{repo}/transcript.jsonl"
with open(transcript, "w") as f:
    f.write(json.dumps({"message": {"content": [
        {"type": "tool_use", "name": "Edit", "input": {"file_path": "/x/app/page.tsx"}}]}}) + "\n")

# Markers go to a scratch dir; touching the real one would re-arm the live session.
markers = {"CLAUDE_REVIEW_MARKER_DIR": f"{repo}/markers"}

verdict, reason, _ = run(STOP, {"session_id": "sess-A", "transcript_path": transcript}, markers)
check("code was edited -> fires once", verdict, "BLOCK", reason)

verdict, reason, _ = run(STOP, {"session_id": "sess-A", "transcript_path": transcript}, markers)
check("same session again -> silent", verdict, "allow", reason)

verdict, reason, _ = run(STOP, {"session_id": "sess-B", "transcript_path": transcript,
                                "stop_hook_active": True}, markers)
check("stop_hook_active -> silent", verdict, "allow", reason)

docs_only = f"{repo}/docs.jsonl"
with open(docs_only, "w") as f:
    f.write(json.dumps({"message": {"content": [
        {"type": "tool_use", "name": "Write", "input": {"file_path": "/x/NOTES.md"}}]}}) + "\n")
verdict, reason, _ = run(STOP, {"session_id": "sess-C", "transcript_path": docs_only}, markers)
check("docs only -> silent", verdict, "allow", reason)

live_markers = os.path.expanduser("~/.claude/cache/review-reminder")
before = set(os.listdir(live_markers)) if os.path.isdir(live_markers) else set()
run(STOP, {"session_id": "sess-D", "transcript_path": transcript}, markers)
after = set(os.listdir(live_markers)) if os.path.isdir(live_markers) else set()
check("suite never touches the live marker dir", "allow" if before == after else "MUTATED",
      "allow", f"before={before} after={after}")

header("Malformed input -- must never block")
for label, payload in [
    ("empty object", {}),
    ("no tool_input", {"tool_name": "Bash"}),
    ("non-Bash tool", {"tool_name": "Read", "tool_input": {"file_path": "/x"}}),
]:
    verdict, reason, code = run(GUARD, payload)
    check(f"{label} (exit {code})", verdict, "allow", reason)

shutil.rmtree(repo, ignore_errors=True)
print("\ntemp repo removed; live marker cache untouched")
