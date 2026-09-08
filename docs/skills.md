# Skills

What the skills encode, where they live, and how other agents share them.

## Engineering standards

`skills/` carries a set of skills that encode a single engineering bar, compiled from primary sources rather than summarized from memory. `CLAUDE.md` names the moment each one applies, so they trigger without being asked for.

| Skill                | Source                                                     | Applies when                                                    |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| `google-code-review` | google/eng-practices reviewer guide (7 pages, verbatim)    | Reviewing any diff, including self-review before claiming done |
| `google-cl-author`   | google/eng-practices CL author guide (3 pages, verbatim)   | Sizing a change, writing a description, answering review        |
| `google-style`       | google/styleguide: 10 language guides, full text          | Writing or editing code in any covered language                 |
| `google-testing`     | Software Engineering at Google, ch. 11-14                  | Writing or reviewing tests; choosing a test double              |
| `git-workflow`       | Conventional Commits 1.0.0, SemVer 2.0.0, Keep a Changelog | Commit messages, branching, merging, versioning, releases       |
| `react-testing`      | Testing Library + MSW v2 docs                              | React/Next.js tests                                             |
| `ros2-testing`       | ros2_documentation testing tutorials                       | ROS 2 unit, integration, simulation, and hardware-in-loop tests |

Each `SKILL.md` is the operational rules; `references/` holds the unabridged source for depth. `skills/google-style/references/` is ~1 MB of style-guide text, the bulk of this repo's size and the reason it is worth having offline.

Where Google's rules collide with framework requirements, the skill states the exception rather than leaving it to be discovered: `google-style` documents that Next.js `page.tsx`/`layout.tsx`/`route.ts` **must** use default exports despite the guide's blanket ban.


## Shared agent skills (~/.agents)

`~/.claude/skills/` is the **canonical** location for all skills. On this machine, `~/.agents/skills/<name>` entries are symlinks pointing here, so other AI agents share the same copies without divergence.

To recreate those links on a new machine (only needed if other agents use `~/.agents/skills`):

```sh
mkdir -p ~/.agents/skills
for d in ~/.claude/skills/*/; do
  n=$(basename "$d")
  ln -sfn "$HOME/.claude/skills/$n" "$HOME/.agents/skills/$n"
done
```

If you install a new skill with `npx skills add`, it lands in `~/.agents/skills` as a real directory. To bring it under version control: move it into `~/.claude/skills/`, symlink back (as above), commit.

On **Windows**, use a directory junction instead of a POSIX symlink:

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.agents\skills\<name>" -Target "$env:USERPROFILE\.claude\skills\<name>"
```

---

[← Back to README](../README.md)
