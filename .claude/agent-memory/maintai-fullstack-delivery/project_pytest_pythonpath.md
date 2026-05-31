---
name: pytest PYTHONPATH for backend tests
description: The exact PYTHONPATH needed to run backend tests in this environment
type: project
---

To run pytest in this repo, use:
```bash
JWT_SECRET=testkeytestkeytestkeytestkeytestkey123 ENCRYPTION_KEY=3r5pKVqwiYFRHvvHWRXpTf4SSHAxv0NeZoAkzXam2UQ= PYTHONPATH="/usr/local/lib/python3.11/dist-packages:/root/.local/lib/python3.11/site-packages:/usr/lib/python3/dist-packages:/home/user/MAINTAI_MVP_DEMO" ~/.local/bin/pytest backend/tests/ -q
```

**Why:** Multiple Python package directories needed:
- `/usr/local/lib/python3.11/dist-packages` — FastAPI, SQLAlchemy, Alembic, OpenAI, etc.
- `/root/.local/lib/python3.11/site-packages` — idna (required by httpx/openai)
- `/usr/lib/python3/dist-packages` — distro (required by openai client)
- `/home/user/MAINTAI_MVP_DEMO` — the project root for `backend.*` imports

The test JWT_SECRET and ENCRYPTION_KEY values above are the known-working test values.

**How to apply:** Always use these exact vars when running tests or investigating test failures.
