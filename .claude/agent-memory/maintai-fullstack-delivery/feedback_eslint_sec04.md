---
name: ESLint SEC-04 patterns and gotchas
description: Patterns and gotchas found when fixing ESLint errors and enabling build lint gate (SEC-04 finding)
type: feedback
---

## eslint-disable-next-line placement rule
The `eslint-disable-next-line` comment MUST be on the line IMMEDIATELY preceding the flagged code. If a TODO comment falls between the directive and the flagged line, the directive is "unused" (it targets the TODO comment, not the setState).

Correct form:
```
// TODO(sec-04): revisione umana - explanation
// eslint-disable-next-line react-hooks/set-state-in-effect -- reason
setState(value);
```

**Why:** ESLint considers the directive active only for the very next line. A comment in between breaks the targeting.

**How to apply:** Always put TODO comments BEFORE eslint-disable-next-line directives when both are needed.

## Next.js 16 dropped eslint.ignoreDuringBuilds
In Next.js 16 (Turbopack), the `eslint` key in `next.config.ts` is no longer supported. The build warns: "eslint configuration in next.config.ts is no longer supported." The ESLint gate is now enforced via `npm run lint` separately (0 errors required).

**Why:** Next.js 16 removed built-in ESLint runner from the build pipeline.

**How to apply:** Remove `eslint: { ignoreDuringBuilds }` from next.config.ts entirely.

## Turbopack TLS certs for Google Fonts in sandboxed environments
In sandboxed build environments (no internet or TLS trust issues), Google Fonts fetch fails at build time. Fix:
```ts
experimental: {
  turbopackUseSystemTlsCerts: true,
},
```
This allows Turbopack to use system-level TLS certificates to fetch Google Fonts.

## @dnd-kit/core type exports
- `SyntheticListenerMap` is NOT in `@dnd-kit/core` public API index
- Use `DraggableSyntheticListeners` instead (= `SyntheticListenerMap | undefined`)
- Import: `import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core"`

## HTML entities: only in JSX text nodes, never inside {}
`&quot;` and `&apos;` are only valid in JSX text context (outside `{}`).
Inside `{expression}`, use normal JS strings with regular quotes.
```tsx
// WRONG - &quot; inside {} causes parse error:
{error.message || &quot;Errore sconosciuto&quot;}
// CORRECT:
{error.message || "Errore sconosciuto"}
```

## catch (err: unknown) pattern for no-explicit-any
Standard pattern for all catch blocks:
```ts
catch (err: unknown) {
  const msg = err instanceof Error ? err.message : "Fallback message";
}
```
For custom API error shapes: `(err as { detail?: string })?.detail ?? "fallback"`
