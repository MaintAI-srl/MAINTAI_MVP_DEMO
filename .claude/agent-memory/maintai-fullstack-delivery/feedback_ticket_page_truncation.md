---
name: ticket_page_truncation
description: frontend/app/ticket/page.tsx was found truncated at 983 lines instead of the expected ~1193; restore from git
type: feedback
---

`frontend/app/ticket/page.tsx` was truncated from 1193 to 983 lines in a previous session, causing a JSX parse error in the return block. The fix is `git checkout HEAD -- frontend/app/ticket/page.tsx`.

**Why:** A previous edit likely failed mid-write or was incomplete, leaving the file with a broken return block missing the DataTable, modals, and closing tags.

**How to apply:** Before running a build, if ticket/page.tsx errors with "Unexpected token" or "Did you mean `{'}'}` or `&rbrace;`", check the line count — if it's around 983, restore from git.
