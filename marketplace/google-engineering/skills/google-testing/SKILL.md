---
name: google-testing
description: Google's testing discipline — test sizes and scopes, the 80/15/5 mix, testing behaviors not methods, DAMP over DRY, preferring real implementations over mocks, and avoiding brittle change-detector tests. Use when writing or reviewing any test, deciding what to test or at what level, choosing between a real object, a fake, and a mock, debugging a flaky or brittle test, or judging whether a change has adequate test coverage. From Software Engineering at Google and Testing on the Toilet.
---

# Google testing discipline

Tests exist so the system can be **changed** safely. That is the whole justification: a test's value is measured by the future changes it makes safe, not by the lines it covers today.

**The Beyoncé Rule** — _if you liked it, you should have put a test on it._ Any behavior you don't want broken needs a test. If it isn't tested, the next person is free to break it and CI will agree with them.

Tests ship in the **same change** as the code they cover. A change that alters logic without touching tests is incomplete.

## Size: what a test is allowed to do

Size is about **resources and determinism**, not about how much code runs. Enforce it — it's what keeps a suite fast and non-flaky.

| Size       | Allowed                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Small**  | Single process. **No sleeping, no I/O, no blocking calls.** No network, no disk. Heavyweight dependencies replaced with test doubles. |
| **Medium** | Multiple processes, threads, blocking calls, network calls **to `localhost` only**. Single machine.                                   |
| **Large**  | Everything above plus multi-machine. Reserved for genuine end-to-end validation.                                                      |

Most tests should be small. Small tests are fast and deterministic, so they can run on every change; large tests are slow and flaky, so they run rarely and catch problems late.

**Never `sleep()` in a test.** Inject a fake clock, or wait on a real condition. A sleep is either flaky or slow, usually both.

## Scope: how much code a test validates

Different axis from size. Narrow = one class or method. Medium = a few components interacting. Broad = a large slice or emergent system behavior.

Target mix: **~80% narrow unit tests, ~15% medium integration tests, ~5% end-to-end.** Shape varies by product, but an hourglass — many unit, many E2E, nothing between — means integration bugs get caught slowly and expensively. An ice cream cone (mostly E2E) means a slow, flaky suite nobody trusts.

## Properties every test needs

- **Hermetic.** The test contains everything needed to set up, run, and tear down its environment. No dependency on external state, on other tests, or on execution order.
- **Deterministic.** Same input, same result, always. A flaky test is worse than no test — it trains people to ignore failures.
- **No logic.** No conditionals, no loops, no computed expected values. A test with logic needs its own test. Expected values are written out literally, even when repetitive.
- **Fast**, so it actually gets run.
- **Complete and concise.** The body contains everything a reader needs to understand it, and nothing irrelevant. Push noise into well-named helpers; keep the meaningful values inline.

## Test behaviors, not methods

One method often has many behaviors, and one behavior often spans methods. Structure tests around behaviors — a behavior is _given_ some state, _when_ an action occurs, _then_ some outcome.

```
// Method-driven: one bloated test that fails for a dozen unrelated reasons.
test('processTransaction', ...)

// Behavior-driven: each failure names its own cause.
test('transfer fails when the source account has insufficient funds', ...)
test('transfer records a timestamped entry in both ledgers', ...)
```

Name the test after the behavior, not the method under test. When it fails, the name alone should tell you what broke — a good name means you rarely have to open the test to understand a failure.

Keep one behavior per test. Assertions should be narrow: assert the specific thing the behavior promises, not a full object dump. Broad assertions fail for reasons unrelated to what's being tested.

Write clear failure output. The message should say what was expected, what happened, and enough context to act — not `expected true, got false`.

## DAMP, not DRY

Production code is DRY. **Test code is DAMP** — Descriptive And Meaningful Phrases. Duplication in tests is often _good_, because a test must be readable in isolation without chasing helpers and shared setup up the file.

Prefer explicit, literal construction over shared fixtures and clever factories. Where a helper genuinely helps, it should make the _relevant_ values more visible, not hide them:

```
// Hides the thing the test is about.
const user = createTestUser();

// Names the thing the test is about, defaults the rest.
const user = newUser().withBalance(0).build();
```

DRY still applies to mechanical setup that carries no meaning for the test.

## Test through public APIs

Test the unit the way its callers use it. "Unit" means a reasonable public surface, not necessarily one class — testing every private helper directly is how suites become impossible to refactor.

**Don't test implementation details.** A test that asserts _how_ something is done rather than _what_ it produces is a **change-detector test**: it fails on every refactor, never catches a real bug, and its only signal is "the code changed" — which you already knew. Change-detector tests cost more than they return; delete them.

The check: _if I rewrite the internals but keep the behavior, does this test still pass?_ If no, it's testing the wrong thing.

## Test doubles

Order of preference:

1. **The real implementation.** Default to it. Real objects give real confidence, and the test survives internal changes. Use it whenever it's fast, deterministic, and has simple construction.
2. **A fake** — a lightweight working implementation of the same contract (in-memory database, in-memory queue). Fakes preserve behavior, so tests stay valid across refactors. Ideally the fake is written and maintained by the owner of the real thing, and verified against it by contract tests.
3. **Stubbing** — hardcoding return values. Fine in small doses to force a specific path (an error case). Overused, it fills the test with implementation knowledge and becomes unclear and brittle.
4. **Interaction testing (mocks)** — asserting that a function was called, with what, how many times. **Last resort.**

**Why mocks are the last resort:** a mocked collaborator can't tell you it changed. Mock `client(url, {data})`, and when the real client switches to `{body}`, the test still passes and production breaks. The test is now asserting a contract that no longer exists. Heavy mocking also couples the test to the call sequence, so any refactor rewrites the tests.

Rules:

- **Prefer state testing over interaction testing.** Assert what the system _is_ afterward, not which calls occurred. State survives refactors; call sequences don't.
- **Don't mock what you don't own.** For third-party APIs, wrap them or use a fake the vendor provides. Mocks of external APIs encode your _belief_ about their behavior, which drifts from the truth silently.
- Use interaction testing when state isn't observable, or when the _call itself_ is the behavior under test (a payment was charged exactly once, an audit event was emitted).
- Never assert on calls you don't care about. `verify` everything and your test breaks on every unrelated change.

For HTTP specifically: intercept at the network boundary with a mock server rather than stubbing your HTTP client — you keep the client's real behavior (URL construction, headers, serialization, error handling) in the test path. See `react-testing` for the JS/TS version of this.

## Coverage

Coverage is a diagnostic, not a goal. High coverage with change-detector tests is worse than moderate coverage with behavior tests. Ask "what behavior would break silently?" — not "what line is uncovered?"

## Reviewing tests

Tests are code that must be maintained; hold them to the same bar. When reviewing:

- Will this test actually **fail** when the code breaks? Try to imagine the bug it catches.
- Will it produce **false failures** when the code changes but the behavior doesn't?
- Is each assertion simple, useful, and about one behavior?
- Are behaviors split across separate test methods rather than lumped together?
- Is there logic in the test?
- Does the failure message tell you what went wrong?
- Are mocks used where a real object or fake would work?
