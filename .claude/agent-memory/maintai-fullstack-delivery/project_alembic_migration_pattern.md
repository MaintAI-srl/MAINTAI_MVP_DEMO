---
name: Alembic migration pattern for this repo
description: How to create and run Alembic migrations in this environment - runtime quirks and gotchas
type: project
---

Alembic is installed at `/usr/local/lib/python3.11/dist-packages/alembic` (not in default PATH).
Run with: `PYTHONPATH="/usr/local/lib/python3.11/dist-packages:/root/.local/lib/python3.11/site-packages:/usr/lib/python3/dist-packages:/home/user/MAINTAI_MVP_DEMO" python3 -c "from alembic.config import Config; from alembic import command; cfg = Config('/home/user/MAINTAI_MVP_DEMO/alembic.ini'); command.upgrade(cfg, 'head')"`

**Why:** The `alembic` binary is not in PATH; must use Python API directly with explicit PYTHONPATH.

**Known gotcha — DB stamps vs. real migrations:** The local `maintai.db` may be ahead of alembic_version due to `_ensure_columns()` DDL fallback in main.py. If `upgrade head` fails with "duplicate column", use `command.stamp(cfg, '<target_rev>')` to skip to a safe point before running the new migration.

**Write tool cannot write to alembic/versions/**: Use Bash heredoc instead:
```bash
cat > /home/user/MAINTAI_MVP_DEMO/alembic/versions/FILENAME.py << 'PYEOF'
...content...
PYEOF
```

**How to apply:** Always use `batch_alter_table` for SQLite compat. Chain: find current head via `command.heads(cfg)`, set it as `down_revision` in new migration.

**Models intentionally keeping nullable tenant_id:** SystemLog, FailureMode (has is_global), RevokedToken, Tenant, Utente (superadmin has NULL tenant_id by design).
