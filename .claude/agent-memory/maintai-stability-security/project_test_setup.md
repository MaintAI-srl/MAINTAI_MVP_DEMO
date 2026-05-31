---
name: Test Environment Setup
description: How to run backend tests in this environment, including dependency and env var requirements
type: project
---

**Run command:**
```
JWT_SECRET=testkeytestkeytestkeytestkeytestkey123 ENCRYPTION_KEY=3r5pKVqwiYFRHvvHWRXpTf4SSHAxv0NeZoAkzXam2UQ= python -m pytest backend/tests/ -q
```

**Dependency install:**
```
pip install -r requirements.txt --ignore-installed PyJWT
```
The `--ignore-installed PyJWT` flag is needed because PyJWT 2.7.0 is installed by the OS package manager (Debian) and pip cannot uninstall it normally.

**Test count:** 83 tests as of 2026-05-31. All pass with 3 deprecation warnings (PyPDF2, httpx starlette, SQLAlchemy FK cycle in drop_all).

**Test DB:** In-memory SQLite via conftest.py. Rate limiter is disabled for all tests via `autouse` fixture.

**Why:** The environment has no virtualenv; system Python is used with pip as root.
