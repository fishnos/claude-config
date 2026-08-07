#!/usr/bin/env python3
"""PreToolUse(Bash) guard: block irreversible git operations, warn on review-guide violations.

Blocks outright: --no-verify, push, force-push, hard reset, untracked-file deletion,
whole-home staging, and staged high-confidence secrets.
Warns without blocking: logic staged without tests, oversized diffs, malformed subjects.

Never blocks on its own failure -- any internal error exits 0 and lets the command through.
"""

import json
import os
import re
import subprocess
import sys

SOURCE_EXTENSIONS = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs",
    ".c", ".cc", ".cpp", ".h", ".hpp", ".java", ".cs", ".rb", ".swift", ".kt",
}

# Files that are tests rather than logic needing tests.
TEST_PATH = re.compile(r"(^|/)(tests?|__tests__|spec)/|[._-](test|spec)\.[a-z]+$|(^|/)test_[^/]+\.py$")

# Paths where a missing test is expected rather than a warning.
TEST_EXEMPT = re.compile(
    r"(^|/)(migrations?|__generated__|generated|vendor|node_modules|\.next|dist|build)/"
    r"|\.d\.ts$|(^|/)(page|layout|loading|error|not-found|route|middleware)\.(t|j)sx?$"
    r"|\.gen\.(t|j)sx?$|(^|/)types/(database|supabase)\.ts$"
)

BLOCKING_SECRETS = [
    (re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY"), "private key"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "AWS access key id"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}"), "GitHub token"),
    (re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}"), "OpenAI-style API key"),
    (re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}"), "Anthropic API key"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}"), "Slack token"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\."), "JWT"),
    (re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}"), "GitLab token"),
]

SOFT_SECRET = re.compile(
    r"""(?ix)\b(api[_-]?key|secret|password|passwd|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*["'][^"'\s]{12,}["']"""
)


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def warn(message):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "additionalContext": message,
        }
    }))
    print(message, file=sys.stderr)
    sys.exit(0)


def git(args, cwd):
    """Run a read-only git command; return stdout or '' on any failure."""
    try:
        done = subprocess.run(
            ["git"] + args, cwd=cwd, capture_output=True, text=True, timeout=10
        )
        return done.stdout if done.returncode == 0 else ""
    except Exception:
        return ""


HEREDOC_START = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?")


def strip_heredocs(command):
    """Drop heredoc bodies so documentation or scripts that merely mention git are ignored."""
    lines = command.split("\n")
    kept = []
    terminator = None
    for line in lines:
        if terminator is not None:
            if line.strip() == terminator:
                terminator = None
            continue
        kept.append(line)
        match = HEREDOC_START.search(line)
        if match:
            terminator = match.group(1)
    return "\n".join(kept)


def strip_quotes(segment):
    """Blank out quoted content so `echo "git push"` is not read as a git invocation."""
    segment = re.sub(r"'[^']*'", "''", segment)
    segment = re.sub(r'"[^"]*"', '""', segment)
    return segment


# Leading env assignments and wrappers must be consumed before testing for `git`, or a
# prefix like `FOO=1 git push --force` would skip every rule below.
COMMAND_PREFIX = re.compile(
    r"^(?:(?:sudo|env|command|nohup|time|nice|xargs)\s+|[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+"
)


def git_invocation(segment):
    """Return the segment from `git` onward if it really executes git, else None."""
    stripped = COMMAND_PREFIX.sub("", segment.strip())
    return stripped if re.match(r"^git\b", stripped) else None


def split_commands(command):
    """Split a shell line on separators so `foo && git push` is still inspected."""
    command = strip_heredocs(command)
    return [segment.strip() for segment in re.split(r"&&|\|\||;|\n|\|", command) if segment.strip()]


def check_blocking(raw_segment, cwd, push_authorized):
    # Match against the segment with quoted content blanked out, so a git command named
    # inside a string argument is never mistaken for one being executed.
    segment = git_invocation(strip_quotes(raw_segment))
    if segment is None:
        return

    if re.search(r"(^|\s)(--no-verify|-n\s|-n$)", segment) and re.search(r"\bgit\s+(commit|push)\b", segment):
        deny(
            "Blocked: --no-verify skips the hooks the repo installed on purpose.\n"
            "Fix the failing check instead. If the hook itself is wrong, fix the hook.\n"
            "(google-cl-author / git-workflow: never bypass verification.)"
        )

    if re.search(r"\bgit\s+push\b", segment):
        if re.search(r"(--force\b|(?<![\w-])-f\b)", segment) and "--force-with-lease" not in segment:
            deny(
                "Blocked: plain force-push silently discards commits anyone else pushed.\n"
                "If history genuinely must be rewritten, use:\n"
                "  git push --force-with-lease --force-if-includes\n"
                "and never on a shared or under-review branch."
            )
        if push_authorized:
            return
        deny(
            "Blocked: pushing is yours to do, not mine (CLAUDE.md: never commit, never push).\n"
            "Run it yourself with `! git push ...`, or -- when you have explicitly asked for a\n"
            "push -- prefix the command with the per-invocation escape:\n"
            "  CLAUDE_ALLOW_PUSH=1 git push origin <branch>\n"
            "Force-push stays blocked either way; use --force-with-lease --force-if-includes."
        )

    if re.search(r"\bgit\s+reset\b.*--hard", segment):
        deny(
            "Blocked: `git reset --hard` throws away uncommitted work with no undo.\n"
            "Safer options: `git stash` to shelve it, `git restore <path>` for one file,\n"
            "or `git revert <sha>` to undo a commit that already exists in history."
        )

    if re.search(r"\bgit\s+clean\b.*(-[a-z]*f)", segment):
        deny(
            "Blocked: `git clean -f` permanently deletes untracked files -- git has no record of them.\n"
            "Run `git clean -n` first and confirm the list, then run the delete yourself."
        )

    if re.search(r"\bgit\s+add\b\s+(-A|--all|\.)\s*$", segment):
        home = os.path.expanduser("~")
        if os.path.realpath(cwd) == os.path.realpath(home):
            deny(
                f"Blocked: `git add -A` from your home directory ({home}) would stage everything under it.\n"
                "cd into the actual project first."
            )


def check_commit(raw_segment, cwd):
    segment = git_invocation(strip_quotes(raw_segment))
    if segment is None:
        return
    if not re.search(r"\bgit\s+commit\b", segment):
        return
    if re.search(r"--dry-run\b", segment):
        return

    # An amend still writes staged content into history, so it gets the secret scan.
    # Only the advisory checks below are skipped -- size and test coverage were already
    # judged on the commit being amended.
    is_amend = re.search(r"--amend\b", segment) is not None

    staged = [line for line in git(["diff", "--cached", "--name-only"], cwd).splitlines() if line]
    if not staged:
        return

    diff = git(["diff", "--cached", "-U0"], cwd)
    added = "\n".join(line for line in diff.splitlines() if line.startswith("+") and not line.startswith("+++"))

    for pattern, label in BLOCKING_SECRETS:
        if pattern.search(added):
            deny(
                f"Blocked: staged changes look like they contain a {label}.\n"
                "Secrets survive in git history even after deletion -- rotate the credential first,\n"
                "then unstage the file and add it to .gitignore.\n"
                "If this is a false positive (a fixture or example), say so and I'll note it."
            )

    if is_amend:
        return

    notes = []

    if SOFT_SECRET.search(added):
        notes.append("- A staged line looks like a hardcoded credential. Verify before committing.")

    logic = [
        f for f in staged
        if os.path.splitext(f)[1] in SOURCE_EXTENSIONS
        and not TEST_PATH.search(f)
        and not TEST_EXEMPT.search(f)
    ]
    tests = [f for f in staged if TEST_PATH.search(f)]
    if logic and not tests:
        preview = ", ".join(logic[:4]) + (" ..." if len(logic) > 4 else "")
        notes.append(
            f"- Logic staged with no tests: {preview}\n"
            "  Tests belong in the same commit as the code they cover (google-cl-author).\n"
            "  If tests genuinely don't apply here, say why in the commit body."
        )

    stat = git(["diff", "--cached", "--shortstat"], cwd)
    changed = re.search(r"(\d+) insertions?\(\+\)", stat)
    if changed and int(changed.group(1)) > 1000:
        notes.append(
            f"- {changed.group(1)} lines staged. Past ~1000 a reviewer is right to send it back;\n"
            "  see google-cl-author for splitting strategies."
        )

    # Read the message from the original text -- `segment` has quoted content blanked out.
    message = re.search(r"-m\s+(\"([^\"]*)\"|'([^']*)')", raw_segment)
    if message:
        subject = (message.group(2) or message.group(3) or "").split("\n")[0]
        problems = []
        if len(subject) > 72:
            problems.append(f"{len(subject)} chars (target 50, hard ceiling 72)")
        if subject.endswith("."):
            problems.append("trailing period")
        if re.match(r"^(added|adds|adding|fixed|fixes|fixing|updated|updates|updating|changed|removed)\b",
                    subject, re.I):
            problems.append("not imperative mood -- \"Add\", not \"Added\"/\"Adds\"")
        if problems:
            notes.append("- Commit subject: " + "; ".join(problems) + ". See git-workflow.")

    if notes:
        warn("Before this commit lands:\n" + "\n".join(notes))


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if payload.get("tool_name") != "Bash":
        sys.exit(0)

    command = payload.get("tool_input", {}).get("command", "")
    cwd = payload.get("cwd") or os.getcwd()
    if not command:
        sys.exit(0)

    # The escape is read from the command text, not the environment, so it must be typed
    # deliberately for each push and can never be exported once to disable the guard.
    push_authorized = "CLAUDE_ALLOW_PUSH=1" in command

    segments = split_commands(command)
    for segment in segments:
        check_blocking(segment, cwd, push_authorized)
    for segment in segments:
        check_commit(segment, cwd)

    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        # A broken guard must never block real work.
        sys.exit(0)
