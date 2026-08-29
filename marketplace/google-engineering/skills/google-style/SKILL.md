---
name: google-style
description: Google's language style guides — TypeScript, JavaScript, HTML/CSS, Python, Shell, Go, Java, C++, C#, Objective-C — as the authority on formatting, naming, comments, and language-feature use. Use before writing or editing code in any of these languages, when reviewing style in a diff, when naming things, when deciding whether a language feature is allowed, or when a style disagreement needs an authority. Carries the full text of each guide in references/.
---

# Google style guides

The style guide is the **absolute authority** on style questions. Anything the guide requires, follow. Anything it merely recommends is a judgment call between the guide and local convention — bias toward the guide unless local inconsistency would confuse. Anything the guide doesn't cover is personal preference: match the surrounding file, then the surrounding directory, then accept the author's choice.

RFC 2119 terms apply: _must_ / _must not_ are absolute, _should_ / _should not_ (= _prefer_ / _avoid_) admit judgment, _may_ is permission.

## Which reference to read

Read the matching file in `references/` before writing non-trivial code in that language. Each is the guide's full text.

| Language         | File                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------- |
| TypeScript / TSX | `references/typescript.md`                                                                   |
| JavaScript       | `references/javascript.md`                                                                   |
| HTML / CSS       | `references/html-css.md`                                                                     |
| Python           | `references/python.md`                                                                       |
| Shell / Bash     | `references/shell.md`                                                                        |
| Go               | `references/go-guide.md` (core), `go-decisions.md` (style decisions), `go-best-practices.md` |
| Java             | `references/java.md`                                                                         |
| C++              | `references/cpp.md`                                                                          |
| C#               | `references/csharp.md`                                                                       |
| Objective-C      | `references/objective-c.md`                                                                  |

Not covered by any Google guide: Rust, SQL, Swift, Kotlin, React/JSX component idioms. For those, follow the project's existing conventions and the user's global instructions.

## Universal rules

These carry across every guide and are the ones most often violated.

**Names are descriptive and unabbreviated.** Long enough to communicate what the thing is or does, short enough to read. Never abbreviate by deleting letters. Never use an abbreviation only your team knows. Never encode the type in the name — the type system already says it.

```
errorCount           dnsConnectionIndex     referrerUrl      customerId
n   nErr   nCompConns   wgcConnections   pcReader   cstmrId   kSecondsPerDay
```

Exception: variables in scope for ~10 lines or fewer may be short.

**Comments explain why, not what.** If code needs a comment to say what it's doing, simplify the code instead. Exceptions where "what" comments earn their place: regular expressions and complex algorithms. Documentation of a class/module/function is a different thing from a comment — it states purpose, usage, and behavior.

No comments boxed in asterisks or drawn banners.

**Consistency.** Brand-new files use Google style regardless of what neighboring files do. When adding to a non-conforming file, prefer reformatting it first if the change is significant; otherwise stay consistent with the file without violating the guide. Never let opportunistic style fixes muddle a functional change — split them out.

## TypeScript hot list

The rules that come up constantly. Full detail in `references/typescript.md`.

**Modules**

- Named exports only. **No default exports.**
- No `namespace`, no `require()`, no `/// <reference>`. ES modules only.
- Prefer relative imports within a project; limit `../../../` depth.
- Prefer named imports for frequently-used or clearly-named symbols; namespace imports (`import * as x`) when pulling many symbols from a large API.
- `import type {…}` when a symbol is only used as a type; `export type {…}` when re-exporting a type.
- No `export let` — mutable exports are banned. Use an explicit getter.
- No container classes of static members for namespacing — export the constants and functions.
- Export only what's used outside the module.

**Variables and literals**

- `const` by default, `let` when reassigned, **never `var`**. One variable per declaration.
- No `Array()`, no `Object()`, no `new String/Boolean/Number`.
- Spread must match what's being created: only spread iterables into arrays, only objects into objects, never primitives/null/undefined.
- Single quotes for strings. Template literals over concatenation. No line continuations.
- `===`/`!==` always. Exception: `== null` to catch null-and-undefined together.

**Types**

- Rely on inference for trivially-inferred types; annotate when it aids readability.
- `interface` over type-alias object literals. `T[]` over `Array<T>` for simple types; `Array<T>` for complex ones.
- Avoid `any` — provide a real type, or use `unknown`. If `any` is genuinely right (mocks in tests), suppress the lint and document why.
- Avoid `{}` — use `unknown`, `Record<string, T>`, or `object`.
- Type aliases must not bake in `|null`/`|undefined`; add it where actually used.
- Prefer optional fields/params (`foo?:`) over `|undefined`.
- Type assertions (`x as T`) and non-null assertions (`y!`) are unsafe — prefer a real runtime check. When you must assert, comment why. `as` syntax only, never `<T>x`.
- Annotate object literals with `: Foo`, don't assert them `as Foo` — annotation catches renamed fields.
- No `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`.
- Simplest type construct that works. Mapped/conditional types are allowed but cost readability, tooling, and stability — a little repetition is usually cheaper.

**Functions and classes**

- Function declarations for named functions; arrow functions for callbacks and nested functions. No `function` expressions.
- Concise arrow bodies only when the return value is used.
- No `#private` fields — use `private`. Never `public` except on non-readonly parameter properties. `readonly` on anything not reassigned after construction.
- Parameter properties (`constructor(private readonly foo: Foo) {}`) over manual plumbing. Initialize non-parameter fields at declaration.
- Getters must be pure — no observable state change.
- No `this` in static contexts. No prototype manipulation.
- Only throw `Error` or subclasses — including `Promise.reject`. `new Error(...)`, never bare `Error(...)`.
- Every `switch` has a `default`. No fallthrough from non-empty cases.
- Braced blocks for all control flow, except a single-line `if`.

**Naming**

| Style            | Applies to                                                                        |
| ---------------- | --------------------------------------------------------------------------------- |
| `UpperCamelCase` | class, interface, type, enum, decorator, type parameters, TSX component functions |
| `lowerCamelCase` | variable, parameter, function, method, property, module alias                     |
| `CONSTANT_CASE`  | module-level constants and enum values only                                       |

No `_` prefix or suffix, ever, including bare `_` for unused. Treat acronyms as words: `loadHttpUrl`, `customerId` — not `loadHTTPURL`, `customerID`. Don't mark interfaces `IFoo`.

**Comments**

- `/** JSDoc */` for documentation aimed at users of the code; `//` for implementation notes.
- Multi-line implementation comments use stacked `//`, not `/* */`.
- Document all top-level exports. Don't restate the parameter name and type — `@param`/`@return` only when they add information.
- No type annotations in JSDoc; TypeScript already has them.
- JSDoc goes **before** decorators.

### Where Google TS style conflicts with Next.js / React

Google's guide predates and doesn't cover these frameworks. Framework requirements win; note the deviation and move on.

- **`page.tsx`, `layout.tsx`, `route.ts`, `error.tsx`, `loading.tsx`, `middleware.ts` require default exports.** Next.js routing depends on it. Use named exports everywhere else.
- `next/dynamic`, `React.lazy`, and some library entry points need default exports.
- Arrow-function properties as event handlers are normal in React components — the guide's caution is about `this` binding, which doesn't apply to function components.
- Decorators are effectively absent from this stack anyway.

## Applying this in review

Style comments that aren't backed by a guide rule get prefixed `Nit:` and never block. Style violations that _are_ in the guide are ordinary review comments. Never bundle a large reformat with a functional change.
