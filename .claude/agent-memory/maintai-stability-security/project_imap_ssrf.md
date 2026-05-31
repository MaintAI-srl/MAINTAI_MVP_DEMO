---
name: IMAP SSRF Prevention
description: _validate_imap_server() function added to email_config.py to block private/loopback IP addresses before IMAP connection test
type: project
---

**Fix:** Added `_validate_imap_server(server: str)` to `backend/api/routes/email_config.py`. It calls `socket.getaddrinfo()` to resolve the hostname, then checks each resolved IP against a list of private/loopback/link-local CIDR blocks. Raises HTTP 400 if any resolved address is private.

**Private networks blocked:** 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16, ::1/128, fc00::/7, fe80::/10

**Called before:** `_test_imap()` in the POST `/email-config/` endpoint.

**Note:** The file had only a POST (create) and DELETE endpoint — no PUT/update endpoint exists. The SSRF check is placed before `_test_imap()` in the one place where a user-supplied server address is tested against a real network connection.

**Why:** P2-11 — a malicious tenant could supply `127.0.0.1` or an internal IP as the IMAP server to probe internal network services via the backend.

**How to apply:** If a PUT endpoint is ever added to `email_config.py`, `_validate_imap_server()` must be called there too before any `_test_imap()` call.
