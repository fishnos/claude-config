---
name: react-testing
description: Testing React with Testing Library the way it's meant to be used — query priority, user-event, integration over unit, testing custom hooks, and mocking the network with MSW instead of fetch. Use when writing or reviewing React/Next.js tests, testing a component, custom hook, form, or async data flow, choosing between unit/integration/E2E for a frontend change, or fixing tests that break on every refactor.
---

# React testing

> The more your tests resemble the way your software is used, the more confidence they can give you.

That single rule generates most of what follows. Tests are automation of manual verification, so write the test that does what you'd do by hand: render the thing, interact with it as a user, assert on what a user can observe.

Pair this with `google-testing` for the general discipline (sizes, doubles, DAMP, behavior naming). This skill is the React/TS-specific application.

## Where to spend effort

Weight toward **integration** tests — several components working together through real user flows. They catch the most real bugs per unit of maintenance.

- **Static** (TypeScript, ESLint) — free, catches typos and type errors. Cheapest layer; make it strict.
- **Unit** — pure logic, formatters, reducers, complex custom hooks. Cheap and precise.
- **Integration** — a page or feature rendered with its real child components, real state, real client code, network mocked at the boundary. **Most of your effort goes here.**
- **E2E** (Playwright) — a handful of critical paths through the real app. Slow, flaky, expensive; irreplaceable for what only they can prove.

Avoid shallow rendering and testing components in isolation with every child stubbed. A component that only works when its children are fake isn't known to work.

## Queries: use what the user uses

Priority order. Go down the list only when the one above genuinely doesn't apply.

1. **`getByRole`** with `{ name }` — how assistive tech sees the page. Default choice for buttons, links, headings, inputs, dialogs.
2. **`getByLabelText`** — form fields. If a field has no accessible label, that's a bug the test just found.
3. **`getByPlaceholderText`** — only when no label exists.
4. **`getByText`** — non-interactive content.
5. **`getByDisplayValue`** — the current value of a filled field.
6. **`getByAltText`**, **`getByTitle`** — images and elements where those are the accessible name.
7. **`getByTestId`** — escape hatch. Legitimate when there's nothing user-visible to target (a chart canvas, a dynamic list row), not as a way to avoid fixing accessibility.

Never `container.querySelector`, never assert on class names, never reach into component internals. Import `screen` and query from it rather than destructuring the `render` return.

Variants:

- `getBy*` — must exist now; throws with a printed DOM if not.
- `queryBy*` — **only** for asserting absence (`expect(screen.queryByRole(...)).not.toBeInTheDocument()`).
- `findBy*` — async, retries until it appears. This is how you wait for anything.

`*AllBy*` for multiple matches.

## Interaction

Use `@testing-library/user-event`, not `fireEvent`. `fireEvent` dispatches one synthetic event; `user-event` reproduces what a real interaction actually fires (pointer events, focus, keydown/keypress/input/keyup), which is where real bugs hide.

Current API — **`setup()` before render, `await` every interaction**:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

test("submits the new value and clears the input", async () => {
  const user = userEvent.setup();
  render(<UndoableInput />);

  await user.type(screen.getByLabelText(/new value/i), "two");
  await user.click(screen.getByRole("button", { name: /submit/i }));

  expect(screen.getByText(/present: two/i)).toBeInTheDocument();
});
```

Cleanup between tests is automatic. Don't set values by assigning `input.value` — that skips React's event handling.

## Waiting

- Prefer `findBy*` over `waitFor` — it's the same thing with a better failure message.
- Inside `waitFor`: **one assertion, no side effects.** The callback runs repeatedly; anything with side effects runs repeatedly too.
- `waitForElementToBeRemoved` for disappearance (a spinner). Asserting removal with a bare `queryBy` races.
- Don't wrap `user-event` calls in `act` — they handle it. If you see an `act` warning, something async is updating state after the test moved on; find it rather than papering over it.

## Custom hooks

**Default: test the hook through a component that uses it.** That's how it will actually be consumed, it exercises the real render cycle, and the test reads like a description of the feature. For a hook that exists only to tidy up one component, the component's own tests already cover it — write nothing extra.

Reach for `renderHook` when the hook is a reusable, published, or genuinely complex API with many states that would need several throwaway example components to exercise:

```tsx
import { renderHook, act } from "@testing-library/react";

test("undo restores the previous value", () => {
  const { result } = renderHook(() => useUndo("one"));

  act(() => {
    result.current.set("two");
  });
  act(() => {
    result.current.undo();
  });

  expect(result.current.present).toBe("one");
  expect(result.current.future).toEqual(["two"]);
});
```

`renderHook` comes from `@testing-library/react` — the separate `@testing-library/react-hooks` package is deprecated. It also gives you `rerender` (for effect-dependency changes) and `unmount` (for cleanup functions).

`act` is required here precisely because you're calling into the hook directly rather than through a user interaction. Always read state fresh from `result.current` — never destructure it, since the reference is replaced on each render.

## Network: mock the boundary, not your client

Don't mock your API client, and don't mock `fetch`. Mocking the client means nothing verifies that you're calling it correctly — rename `data` to `body` and every test still passes. Mocking `fetch` means reimplementing your backend inline in every test file, and still not checking headers or auth.

Use **MSW**, which intercepts at the network layer. Your real client code runs, so URL construction, serialization, headers, status handling, and error paths are all under test. The same handlers can drive local development.

Current MSW v2 API — `http` + `HttpResponse`:

```ts
// test/handlers.ts
import { http, HttpResponse } from "msw";

export const handlers = [
  http.post("/api/checkout", async ({ request }) => {
    const cart = await request.json();
    return HttpResponse.json({ success: true, itemCount: cart.items.length });
  }),
];

// test/server.ts
import { setupServer } from "msw/node";
import { handlers } from "./handlers";
export const server = setupServer(...handlers);

// test setup file
import { server } from "./server";
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

`onUnhandledRequest: 'error'` is worth turning on — a request you forgot to handle should fail loudly, not hang.

Keep **happy-path** handlers in the shared setup so ordinary tests carry no network noise. Override per-test for errors and edge cases; `resetHandlers()` in `afterEach` keeps tests isolated:

```ts
test("shows the server error", async () => {
  server.use(
    http.post("/api/checkout", () =>
      HttpResponse.json({ message: "Card declined" }, { status: 500 }),
    ),
  );
  // ...
  expect(await screen.findByRole("alert")).toHaveTextContent(/card declined/i);
});
```

For concurrent test runners, `server.boundary()` scopes overrides so parallel tests don't leak into each other.

## Next.js App Router

- **Server Components can't be rendered by Testing Library.** Test them by extracting their logic into plain functions and unit-testing that, or cover them with Playwright against a running app. Don't contort RTL into it.
- Client Components (`'use client'`) test normally with RTL.
- Server Actions are async functions — unit-test the function directly, and cover the form flow E2E.
- Route handlers are plain functions taking a `Request`; call them directly.

## Common mistakes

- Testing state, props, or internals instead of rendered output — a change-detector test.
- `fireEvent` where `user-event` is correct.
- Forgetting `await` on `user-event` or `findBy*`.
- Destructuring `result.current` from `renderHook`.
- Using `queryBy*` for something that should exist (it returns `null`, and the failure message tells you nothing).
- Multiple assertions or side effects inside `waitFor`.
- Wrapping everything in `act` to silence warnings.
- `getByTestId` when a role or label would work — usually a hidden accessibility gap.
- Adding an `expect(...).toBeInTheDocument()` for an element you just queried with `getBy*`, which already threw if absent.
