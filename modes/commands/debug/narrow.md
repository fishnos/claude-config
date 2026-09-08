---
description: Shrink a failing case to the smallest input that still fails
argument-hint: "[optional: the failing test, command, or symptom]"
---

Narrow the failure named in `$ARGUMENTS`, or the one under discussion if that
is empty, to the smallest case that still fails.

Work by halving, not by reading. Cut the input, the configuration, or the code
path in half, run it, and keep the half that still fails. Repeat until removing
anything at all makes the failure go away. Run the case at every step; a
narrowing you reasoned about but did not execute is a guess wearing a smaller
hat.

Report three things and stop:

1. The smallest failing case, as something I can run myself.
2. The nearest passing case, and the single difference between the two.
3. What that difference rules out.

Do not propose a fix. This mode reproduces before it theorises, and the diagnosis
is a separate step that starts from what you found here.
