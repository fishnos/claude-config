---
name: git-workflow
description: Industry-standard version control — atomic commits, commit message anatomy, Conventional Commits, git trailers, branching models, rebase vs merge, PR hygiene, SemVer, changelogs, tags, signing, and history-recovery. Use before writing any commit message, when splitting work into commits, when choosing a branch strategy or merge method, when versioning or releasing, when a rebase/merge/force-push decision comes up, or when history needs repairing. Carries the Conventional Commits, SemVer, and Keep a Changelog specs in references/.
---

# Git workflow

Version control has one job: make the history of a project answerable. Every rule below serves a question someone will ask later — _what changed_, _why_, _when did this break_, _can I safely undo it_.

Pair with `google-cl-author` for how large a change should be and how to survive review. This skill covers the mechanics.

## Commit granularity

**One commit = one logical, self-contained change.** It builds, it passes tests, and reverting it removes exactly one thing. This is what makes `bisect`, `revert`, `cherry-pick`, and blame archaeology work; a repo of "wip" commits has none of those tools available.

- Never mix a refactor with a behavior change. Refactor in one commit, change behavior in the next.
- Never mix formatting with logic. A reformat that hides a one-line logic change is how bugs ship.
- Tests go in the same commit as the code they cover.
- Unrelated fixes you notice along the way go in their own commits, not tacked onto the current one.

Staging tools for splitting work you've already written: `git add -p` for hunks, `git stash -k` to test only what's staged, `git commit --fixup <sha>` + `git rebase -i --autosquash` to fold a fix into the commit it belongs to.

## Commit message anatomy

The near-universal convention, from the Linux kernel through GitHub tooling:

```
<subject: max 50 chars, imperative mood, no trailing period>
<blank line>
<body: wrapped at 72 chars, explains WHY>
<blank line>
<trailers: Key: value>
```

**Subject line.** Imperative mood — "Add retry to the upload client", not "Added" / "Adding" / "Adds". The test: the subject should complete the sentence _"If applied, this commit will \___."_ Capitalize the first word, no period. 50 characters is the target so it isn't truncated in `git log --oneline`, GitHub UI, or `git shortlog`; 72 is a hard ceiling.

**Body.** Explains **why** the change exists and what it does at a level the diff can't show: the problem, the approach, the alternatives rejected, the known shortcomings. The diff already says what changed line by line — don't restate it. Wrap at 72 characters, because git indents log output by 4 and terminals are 80. Omit the body only when the subject genuinely says everything.

**Never** use `-m` for a commit that needs a body. Write it in the editor.

## Conventional Commits

The dominant machine-readable convention, and what release automation reads. Spec in `references/conventional-commits-1.0.0.md`.

```
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

Types — `feat` and `fix` are specified; the rest are the de-facto Angular set:

| Type       | Meaning                                  |
| ---------- | ---------------------------------------- |
| `feat`     | New capability for users of the code     |
| `fix`      | Bug fix                                  |
| `docs`     | Documentation only                       |
| `test`     | Adding or correcting tests only          |
| `refactor` | Neither fixes a bug nor adds a feature   |
| `perf`     | Improves performance                     |
| `build`    | Build system or dependencies             |
| `ci`       | CI configuration and scripts             |
| `style`    | Formatting only, no code meaning changed |
| `chore`    | Maintenance with no src/test change      |
| `revert`   | Reverts a previous commit                |

Rules that matter:

- Scope is a noun in parens naming a section of the codebase: `feat(auth):`, `fix(parser):`.
- Description follows `: ` (colon **and** space) and is imperative, lowercase, no period.
- **Breaking changes** are signalled two ways, and either is sufficient: a `!` before the colon (`feat(api)!: drop v1 endpoints`), or a `BREAKING CHANGE: <description>` footer. Use both when the break needs explanation. `BREAKING CHANGE` must be uppercase; `BREAKING-CHANGE` is a synonym.
- Everything except `BREAKING CHANGE` is case-insensitive to parsers.
- Footers use git-trailer format: a token, then `: ` or ` #`, then a value. Tokens use hyphens instead of spaces (`Reviewed-by`, not `Reviewed by`).

**SemVer mapping:** `fix` → PATCH, `feat` → MINOR, any breaking change → MAJOR. This is the entire reason the convention pays for itself — `release-please`, `semantic-release`, and `changesets` compute the next version and generate the changelog from the log.

### Reconciling with Google style

Google doesn't use Conventional Commits; their CL descriptions are a plain imperative sentence plus a why-body. The two agree on everything that matters — imperative subject, blank line, body that explains why. Conventional Commits just adds a machine-readable prefix.

**Follow the repository's existing convention.** Run `git log --oneline -30` before writing the first commit in an unfamiliar repo and match what's there. Introducing a new format into a repo that doesn't use it is noise, not rigor.

## Git trailers

Structured key-value metadata in the last paragraph. Git parses them natively (`git interpret-trailers`), and forges index them.

| Trailer                                     | Use                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Co-authored-by: Name <email>`              | Additional authors; GitHub/GitLab credit them on the commit                                                  |
| `Signed-off-by: Name <email>`               | Developer Certificate of Origin attestation — `git commit -s`. Required by the kernel, Docker, CNCF projects |
| `Reviewed-by:` / `Acked-by:` / `Tested-by:` | Kernel-style review attribution                                                                              |
| `Refs: #123`                                | References an issue without closing it                                                                       |
| `Fixes: #123` / `Closes: #123`              | Auto-closes the issue on merge (GitHub/GitLab)                                                               |
| `BREAKING CHANGE:`                          | Conventional Commits breaking marker                                                                         |

`Signed-off-by` is a _legal_ attestation of origin (DCO). It is **not** a cryptographic signature — that's `-S`. Don't conflate them.

## Branching

**Trunk-based development is the modern default** and what DORA research associates with high-performing teams. One long-lived branch (`main`), short-lived feature branches measured in hours or days, merged continuously behind feature flags when incomplete. Long-lived branches are where merge pain, drift, and integration bugs come from.

| Model                | Shape                                                                    | Use when                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Trunk-based**      | `main` + branches living <1–2 days, feature flags for incomplete work    | Continuous delivery. The default.                                                                                                                            |
| **GitHub Flow**      | `main` always deployable; branch → PR → review → merge → deploy          | Web services, SaaS. Trunk-based with PRs formalized.                                                                                                         |
| **Release branches** | Trunk plus `release/x.y` cut for stabilization, fixes cherry-picked back | Versioned software supporting multiple releases at once                                                                                                      |
| **git-flow**         | `develop` + `main` + `feature/` + `release/` + `hotfix/`                 | Legacy. Its author has publicly recommended against it for continuously-delivered software. Use only for shipped, versioned, multi-version-support products. |

Branch naming: `<type>/<short-description>` in kebab-case — `feat/oauth-pkce`, `fix/upload-retry`, `chore/bump-next-16`. Add a ticket ID when the tracker requires it: `feat/PROJ-482-oauth-pkce`. Never work directly on `main`.

## Rebase vs merge

**The golden rule of rebasing: never rebase commits that exist outside your repository** — anything others may have based work on. Rebasing rewrites SHAs; anyone who pulled the old commits gets a divergent history and a painful recovery.

Safe and encouraged:

- `git rebase main` on **your own unshared feature branch**, to keep history linear and replay your work on current trunk.
- `git rebase -i` to clean up your own unpushed commits before review — squash the "fix typo" commits, reorder, reword.
- `git pull --rebase` (set `pull.rebase true`) instead of generating merge bubbles on every pull.

Use merge when:

- Integrating a completed, reviewed branch into `main`.
- The branch is shared with anyone else.
- The history's shape is itself information you want to keep.

**PR merge methods** — pick one per repo and stay consistent:

| Method               | Result                                 | Trade-off                                                                                                                             |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Squash and merge** | One commit per PR on main              | Cleanest trunk, best when PR commits are messy. Loses intra-PR granularity, so `bisect` lands on whole features. Most common default. |
| **Rebase and merge** | Each commit replayed onto main, linear | Keeps granularity _and_ linearity. Requires the author to have curated their commits.                                                 |
| **Merge commit**     | Preserves branch topology              | Full fidelity, noisiest graph. Correct for long-running integration branches.                                                         |

If your repo squashes, the **PR title becomes the commit subject** — so the PR title must follow the commit convention, not be a casual sentence.

## Pull request hygiene

- **Small.** ~100 lines is comfortable; ~1000 is a rejection. See `google-cl-author` for splitting strategies.
- **Description says what and why**, links the issue, notes how it was verified, and shows before/after for anything visual.
- **Draft PRs** for work in progress — don't request review on something unfinished.
- **Stacked PRs** to avoid blocking yourself: branch the next PR off the current one, note the dependency.
- **Rebase before requesting review** so the reviewer sees the change against current trunk.
- **Never force-push a branch under active review** — it destroys the reviewer's diff-since-last-look. If you must, say so in a comment.
- Re-request review after addressing comments; don't leave it ambiguous.
- CI must be green before merge. A red PR is not ready, regardless of whether the failure "is related."

## Versioning

SemVer 2.0.0 (`references/semver-2.0.0.md`). `MAJOR.MINOR.PATCH`:

- **MAJOR** — incompatible API changes.
- **MINOR** — backward-compatible functionality.
- **PATCH** — backward-compatible bug fixes.

Incrementing MINOR resets PATCH to 0; incrementing MAJOR resets both. No leading zeroes. `0.y.z` means anything may change at any time — nothing is stable until `1.0.0`, which is the act of declaring a public API.

Pre-release: `1.0.0-alpha.1`, ASCII alphanumerics and hyphens, **lower** precedence than the associated release. Build metadata: `1.0.0+20130313144700`, **ignored** for precedence.

Precedence compares major, minor, patch, then pre-release identifiers — numeric identifiers numerically, alphanumeric ones lexically in ASCII order.

Note: **SemVer's promises are about your public API.** Say what your public API is — a CLI surface, a library export list, a wire protocol, a config schema — or the version number means nothing to consumers.

## Changelogs

Keep a Changelog (`references/keep-a-changelog.md`). `CHANGELOG.md` at repo root, newest release first, an `[Unreleased]` section at the top, ISO 8601 dates (`2026-08-07`).

Six change types, deliberately only six:

`Added` · `Changed` · `Deprecated` · `Removed` · `Fixed` · `Security`

- `Fixed` = the behavior was wrong and is now correct. `Changed` = it worked as intended and now works differently. `Security` = addresses a vulnerability; lead with the CVE when there is one.
- Mark breaks inline with `**Breaking:**` under `Changed` or `Removed` — don't collect them into a separate section.
- **A changelog is for humans.** A dump of `git log` is not a changelog; it's a diff of a diff. Curate: drop what users can't observe.
- Dependencies are not a change type. Describe the _effect_ on users under the right type, or omit it.

Automate it from Conventional Commits (`release-please`, `semantic-release`, `changesets`) when the log is disciplined enough to support it — then still read the output before shipping.

## Tags and releases

- **Annotated tags for releases**, always: `git tag -a v1.2.0 -m "Release 1.2.0"`. Annotated tags are real objects with a tagger, date, and message; lightweight tags are just a pointer and carry no provenance.
- Prefix with `v` (`v1.2.0`) — near-universal, and what most release tooling expects.
- `git push --tags` or `git push origin v1.2.0`; tags don't travel with a normal push.
- Sign release tags: `git tag -s`.

## Signing

Commit signing proves who authored a commit — the `Author` field is free text anyone can set.

SSH signing (git ≥ 2.34) is the low-friction option, reusing an existing key:

```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
git config --global tag.gpgsign true
```

GPG remains standard where a web of trust matters. Either way, upload the public key to the forge so commits show as Verified.

## Safety rules

- **Never `--force`.** Use `--force-with-lease --force-if-includes`, which refuses when someone else has pushed since your last fetch. Plain `--force` silently discards their work.
- **Never rewrite history on a shared branch** — `main`, `develop`, release branches, anything under review.
- **Never `--no-verify`.** Hooks exist because someone decided that check must not be skipped. If a hook is wrong, fix the hook.
- **Never commit secrets.** They persist in history after deletion — rotate the credential first, _then_ scrub. Prevent with `.gitignore`, `.env` discipline, and a secret scanner in pre-commit.
- **Never `git add -A` blind.** Review with `git status` and `git diff --staged` before every commit.
- **`git revert`, not `git reset`, on published commits.** Revert adds a new commit that undoes the change and keeps the record honest. Reset rewrites.
- Large binaries go to Git LFS or out of the repo. Git stores every version of every blob forever.

## Repair

- `git reflog` — the safety net. Nearly anything "lost" in the last 90 days is recoverable from here, including after a bad reset or rebase.
- `git reset --hard <sha-from-reflog>` to return to a known-good state.
- `git bisect start / bad / good`, or `git bisect run <script>` to automate — finds the introducing commit in log₂(n) steps. Only works if commits are atomic and each one builds.
- `git log -S'<string>'` (pickaxe) to find the commit that introduced or removed a string. `git log -L` to follow a function's evolution.
- `git blame -w -C` ignores whitespace and follows moved code.

## Client-side hooks

- **pre-commit framework** (language-agnostic, `.pre-commit-config.yaml`) — the general standard; runs formatters, linters, and secret scanners across languages.
- **husky + lint-staged** — JS/TS ecosystem; runs checks only on staged files.
- **commitlint** — enforces Conventional Commits at commit time.

Hooks are not a substitute for CI; they're a fast local echo of it. CI is the authority because hooks can be bypassed and aren't installed by default on a fresh clone.

## Reference material

- `references/conventional-commits-1.0.0.md` — full spec
- `references/semver-2.0.0.md` — full spec
- `references/keep-a-changelog.md` — full spec
