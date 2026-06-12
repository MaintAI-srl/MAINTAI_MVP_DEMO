---
name: Upload & Storage Security P1 — June 2026
description: Complete finding closure for upload and storage security P1 findings in MaintAI
type: project
---

Closed all P1 upload and storage findings in one session (2026-06-12).

**Why:** Prior state had: extension-only validation (bypassable with empty ext), `save_file()` returning public Supabase URLs (IDOR risk), no authenticated download endpoint (anyone with a URL got the file), firma not validated for PNG magic bytes.

**Changes made:**

1. `backend/core/file_validation.py` — Extended with:
   - New magic signatures: GIF (GIF87a/GIF89a), WEBP (RIFF+WEBP at offset 8), ZIP family (PK\x03\x04), OLE2 (D0CF...), MP4/MOV (ftyp at offset 4)
   - `validate_upload(content, filename, allowed_exts)` — full validation with whitelist, magic bytes, HTML marker protection for csv/txt, group handling for ZIP family and OLE2 family; raises ValueError with clear Italian-friendly messages; returns canonical extension
   - `validate_magic()` unchanged (retrocompatibility with asset_documenti.py)

2. `backend/core/storage.py` — Rewritten:
   - `save_file()` now returns internal path `uploads/<filename>` instead of public URL
   - Added `read_file(percorso) -> bytes` with path traversal protection (normalizes, checks within uploads/)
   - `_resolve_internal_path()` handles three legacy formats: internal path, /uploads/ local, https://supabase.co public URL
   - `delete_file()` updated for retrocompatibility with all path formats
   - Docstring notes that Supabase bucket must be set to PRIVATE manually

3. `backend/api/routes/tickets.py` — Updated:
   - `POST /tickets/{id}/allegati`: uses `validate_upload()` (not just extension), rejects empty extension, stores internal path, returns `/tickets/allegati/{id}/download` as url
   - `GET /tickets/{id}/allegati`: returns download endpoint URLs instead of raw paths
   - NEW `GET /tickets/allegati/{id}/download`: authenticated, tenant-filtered, streams via storage.read_file(), safe_serving() headers + nosniff
   - `POST /tickets/{id}/firma`: validates magic bytes (must be PNG), stores internal path, returns `/tickets/{id}/firma`
   - NEW `GET /tickets/{id}/firma`: authenticated, tenant-filtered, serves inline PNG with nosniff

4. `backend/services/email_poller.py` — Attachments now validated with `validate_upload()` after extension check; on failure: logs warning and skips allegato (does NOT block ticket creation)

5. `backend/api/routes/bulk_import.py` — Both /preview and /execute validate xlsx magic bytes (ZIP family) before attempting to parse

6. `backend/api/routes/piano_manutenzione.py` — import-pdf validates PDF magic bytes; import-excel validates xlsx/csv

7. `frontend/app/components/UploadAllegati.tsx` — Rewrote download/open to use authenticated fetch (credentials: include) + URL.createObjectURL instead of bare href links

8. `backend/tests/test_upload_security.py` — 14 new tests (7 HTTP integration + 7 unit)

**How to apply:** When reviewing any future upload endpoint, always use `validate_upload()` not `validate_magic()`. For downloads, always use `storage.read_file()` + `safe_serving()` + `sanitize_filename_header()` + `X-Content-Type-Options: nosniff`. The url field in TicketAllegato responses must always be the API download endpoint, never the raw storage path.

**Gap not closed:** Supabase bucket must be set to PRIVATE manually in Supabase Dashboard → Storage → bucket → Edit → uncheck Public. This cannot be done from code.
