---
description: Show or switch the active glitched mode without leaving the session
argument-hint: "[nothing | list | <mode> | diff A B | revert] [--color]"
allowed-tools: Bash(node:*), Bash(ccfg:*)
---

!`node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/tools/ccfg.js" mode $ARGUMENTS`

The block above is the output of `ccfg mode $ARGUMENTS`, already run. Do not run
it again.

Read it and say what it means, in one or two sentences. Which of these it was is
plain from the output:

- **A switch** (a `CARTRIDGE SWAP` banner). Name the mode it moved to and the
  dials whose values changed. Those are the lines with an arrow; a line
  without one did not move. Then follow the new posture for the rest of this session,
  starting with your next reply.
- **A status report** (dials with no banner). Say which mode is in force, or that
  none is, and stop. Nothing has changed.
- **A comparison** (`diff`). Say what working under the second mode would change
  relative to the first.
- **A refusal** (an error). Say what was refused and what would fix it. A mode
  that names a slash command with no file behind it, or one that tries to gate a
  tool no mode may gate, fails on purpose and changes nothing.

Two things to tell me only when they are actually true, because saying them every
time trains me to skip them:

- If the output carries `CORRUPTED`, as a `[CORRUPTED]` tag in the status view
  or as `~CORRUPTED` on the status line, the mode is half in force. The rules and
  the tool gates are live, but the hidden skills, the model, the effort level and
  the mode's own slash commands are fixed until a new session. Say so, and say
  that restarting is what clears it.
- If the switch changed which skills are visible, or the model, or the effort
  level, the same restart applies even without the `~CORRUPTED` mark, because
  this session loaded its skill list before the switch happened.

Do not re-run the command, do not read `mode.lock`, and do not summarise the
whole dial table back to me, since I can see it. Tell me what changed and what it
means for what you do next.
