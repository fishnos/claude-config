#!/usr/bin/env python3
"""Stop hook: require one self-review pass before finishing a session that touched code.

Fires at most once per session, and only when source files were actually edited.
Two independent loop guards: the harness's own stop_hook_active flag, and a per-session
marker file. Any internal error exits 0 silently.
"""

import json
import os
import sys
import time

SOURCE_EXTENSIONS = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs",
    ".c", ".cc", ".cpp", ".h", ".hpp", ".java", ".cs", ".rb", ".swift",
    ".kt", ".sh", ".bash", ".sql", ".css", ".scss",
}

EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}

# Overridable so the test suite can point at a scratch directory instead of clearing the
# markers of whatever session is live -- doing that re-arms the reminder mid-session.
MARKER_DIR = os.environ.get("CLAUDE_REVIEW_MARKER_DIR") or os.path.expanduser(
    "~/.claude/cache/review-reminder"
)
MAX_TRANSCRIPT_BYTES = 4_000_000

REMINDER = """Before you report this work as done, run one self-review pass (google-code-review):

1. Re-read every line you changed, not just the parts you remember writing.
2. Design -- do the pieces interact sensibly, and does this belong here?
3. Complexity -- anything a reader could not follow quickly? Anything built for a
   requirement that does not exist yet?
4. Tests -- does a test actually fail if this code breaks? Are they in this change?
5. Naming -- every name says what it holds, spelled out.
6. Comments -- why, not what. Delete any comment that restates the code.
7. Style -- google-style is the authority for the language you just wrote.

Then say plainly what you verified and what you did not. If something is untested or
unfinished, say so explicitly rather than implying it works.

This reminder fires once per session; it will not fire again."""


MARKER_TTL_SECONDS = 7 * 24 * 3600


def prune_markers():
    """Markers accumulate one per session; drop the ones no live session can still match."""
    cutoff = time.time() - MARKER_TTL_SECONDS
    try:
        for name in os.listdir(MARKER_DIR):
            path = os.path.join(MARKER_DIR, name)
            if os.path.getmtime(path) < cutoff:
                os.remove(path)
    except Exception:
        pass


def already_fired(session_id):
    if not session_id:
        return False
    marker = os.path.join(MARKER_DIR, session_id)
    if os.path.exists(marker):
        return True
    try:
        os.makedirs(MARKER_DIR, exist_ok=True)
        with open(marker, "w") as handle:
            handle.write("1")
    except Exception:
        # Cannot record it -- stay silent rather than risk repeating.
        return True
    prune_markers()
    return False


def touched_source(transcript_path):
    if not transcript_path or not os.path.exists(transcript_path):
        return False
    try:
        if os.path.getsize(transcript_path) > MAX_TRANSCRIPT_BYTES:
            return False
        with open(transcript_path, "r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if '"name"' not in line:
                    continue
                try:
                    entry = json.loads(line)
                except Exception:
                    continue
                content = entry.get("message", {}).get("content")
                if not isinstance(content, list):
                    continue
                for block in content:
                    if not isinstance(block, dict) or block.get("type") != "tool_use":
                        continue
                    if block.get("name") not in EDIT_TOOLS:
                        continue
                    path = (block.get("input") or {}).get("file_path", "")
                    if os.path.splitext(path)[1] in SOURCE_EXTENSIONS:
                        return True
    except Exception:
        return False
    return False


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return

    if payload.get("stop_hook_active"):
        return
    if not touched_source(payload.get("transcript_path")):
        return
    if already_fired(payload.get("session_id")):
        return

    print(json.dumps({"decision": "block", "reason": REMINDER}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
