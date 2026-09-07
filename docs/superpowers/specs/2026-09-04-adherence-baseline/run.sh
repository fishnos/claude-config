#!/bin/bash
# One trial: arm x task x replicate. Prints the raw commit message to a file.
S="$(cd "$(dirname "$0")" && pwd)"
ARM="$1"; TID="$2"; REP="$3"
OUT="$S/out/${TID}__${ARM}__r${REP}.txt"
[ -s "$OUT" ] && exit 0   # idempotent: never pay twice for the same cell
DIFF=$(node -e 'const t=require(process.argv[1]).find(x=>x.id===process.argv[2]);process.stdout.write(t.diff)' "$S/tasks.json" "$TID")
PROMPT="Write a git commit message for this change. Output only the commit message itself -- no commentary, no code fences, no explanation.

$DIFF"
cd "$S"
if [ -s "$S/arms/${ARM}.md" ]; then
  claude -p "$PROMPT" --safe-mode --max-turns 1 --append-system-prompt-file "$S/arms/${ARM}.md" > "$OUT" 2>"$OUT.err"
else
  claude -p "$PROMPT" --safe-mode --max-turns 1 > "$OUT" 2>"$OUT.err"
fi
