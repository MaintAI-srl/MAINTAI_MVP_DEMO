---
name: sheet_trigger_asChild
description: SheetTrigger from @base-ui/react/dialog does not support the asChild prop — style the trigger directly
type: feedback
---

The `SheetTrigger` component in `frontend/components/ui/sheet.tsx` is built on `@base-ui/react/dialog`, not Radix UI. It does not support the `asChild` prop. Using `<SheetTrigger asChild>` causes a TypeScript build error.

**Why:** The project migrated from Radix shadcn/ui to @base-ui. The `asChild` pattern is Radix-specific.

**How to apply:** When using `SheetTrigger`, apply styles directly via the `style` prop on `SheetTrigger` itself instead of wrapping a `Button` with `asChild`. Example in `GlobalQuickTicket.tsx`.
